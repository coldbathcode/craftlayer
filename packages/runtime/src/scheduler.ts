import { randomUUID } from "node:crypto";
import { AuthError } from "@craftlayer/auth";
import {
  type DispatchReference,
  dispatchReference,
  taskDefinition,
} from "@craftlayer/contracts";
import {
  dependencyDecision,
  missionOutcome,
  validateDag,
} from "@craftlayer/core";
import type pg from "pg";
import { RuntimeQuotas } from "./quotas.js";
import { deny, digest, type MissionRow, type TaskRow } from "./repository.js";
export type Publisher = (
  reference: DispatchReference,
  environment: string,
) => Promise<void>;
export class RuntimeScheduler extends RuntimeQuotas {
  protected async recoverExpired(): Promise<void> {}
  protected async resolvePending(_org: string): Promise<void> {}
  protected override async queued(c: pg.PoolClient, row: MissionRow) {
    await this.admit(c, row);
    await c.query(
      "insert into runtime_tenants(organization_id) values($1) on conflict(organization_id) do update set active=true",
      [row.organization_id],
    );
    await this.progress(c, row);
  }
  protected async control(
    _c: pg.PoolClient,
    _row: MissionRow,
  ): Promise<boolean> {
    return false;
  }
  protected async progress(c: pg.PoolClient, row: MissionRow) {
    if (!["queued", "running"].includes(row.state)) return;
    if (await this.control(c, row)) return;
    if (
      !row.execution_grant ||
      row.execution_digest !==
        digest({
          mission: row.id,
          hash: row.template_hash,
          generation: row.generation,
          grant: row.execution_grant,
        })
    )
      deny("GRANT_DENIED", 403);
    const graph = this.snapshot(row);
    if (!row.deadline || row.deadline.getTime() <= this.now()) {
      await c.query(
        "update runtime_missions set state='blocked',reason='deadline',version=version+1 where organization_id=$1 and id=$2",
        [row.organization_id, row.id],
      );
      return;
    }
    const tasks = (
        await c.query<TaskRow>(
          "select * from runtime_tasks where organization_id=$1 and mission_id=$2 order by node_key for update",
          [row.organization_id, row.id],
        )
      ).rows,
      states = new Map(tasks.map((t) => [t.node_key, t.state]));
    if (
      tasks.length !== graph.nodes.length ||
      tasks.some(
        (t) =>
          !graph.nodes.some(
            (n) =>
              n.key === t.node_key &&
              digest(taskDefinition.parse(t.definition)) === digest(n),
          ),
      )
    )
      deny("SNAPSHOT_INVALID", 403);
    for (const key of validateDag(graph.nodes)) {
      const t = tasks.find((t) => t.node_key === key);
      if (!t) deny("SNAPSHOT_INVALID", 403);
      if (
        t.state !== "pending" &&
        !(t.state === "retry_wait" && t.next_attempt_at.getTime() <= this.now())
      )
        continue;
      const def = taskDefinition.parse(t.definition),
        decision = dependencyDecision(def, states);
      if (decision === "ready") {
        await c.query(
          "update runtime_tasks set state='ready',reason='none' where organization_id=$1 and id=$2",
          [row.organization_id, t.id],
        );
        t.state = "ready";
        states.set(t.node_key, "ready");
        await this.event(c, row, "task.ready", {
          task_id: t.id,
          state: "ready",
        });
      } else if (decision === "blocked") {
        if (def.required) {
          await c.query(
            "update runtime_tasks set state='blocked',reason='dependencies' where organization_id=$1 and id=$2",
            [row.organization_id, t.id],
          );
          await c.query(
            "update runtime_tasks set state='failed' where organization_id=$1 and id=$2",
            [row.organization_id, t.id],
          );
          t.state = "failed";
        } else {
          if (t.state !== "pending") deny("INVALID_TRANSITION");
          await c.query(
            "update runtime_tasks set state='skipped',reason='dependencies' where organization_id=$1 and id=$2",
            [row.organization_id, t.id],
          );
          t.state = "skipped";
        }
        states.set(t.node_key, t.state);
      }
    }
    const outcome = missionOutcome(
      tasks.map((t) => taskDefinition.parse(t.definition)),
      states,
    );
    if (outcome !== "running") {
      const active = (
        await c.query(
          "select id from runtime_attempts where organization_id=$1 and mission_id=$2 and state in ('leased','running','uncertain','cancel_requested')",
          [row.organization_id, row.id],
        )
      ).rowCount;
      if (active) {
        await c.query(
          "update runtime_missions set state='blocked',reason='required_failure',version=version+1 where organization_id=$1 and id=$2",
          [row.organization_id, row.id],
        );
        return;
      }
      await c.query(
        "update runtime_missions set state=$3,reason=$4,version=version+1 where organization_id=$1 and id=$2",
        [
          row.organization_id,
          row.id,
          outcome,
          outcome === "failed" ? "required_failure" : "none",
        ],
      );
      await this.releaseMission(c, row);
      await this.event(c, row, `mission.${outcome}`, { state: outcome });
      return;
    }
    for (const task of tasks.filter((t) => t.state === "ready"))
      await this.ensureOutbox(c, row, task.id, task.next_attempt_at);
  }
  protected async ensureOutbox(
    c: pg.PoolClient,
    row: MissionRow,
    task: string,
    notBefore: Date,
  ) {
    const count =
      (
        await c.query<{ n: number }>(
          "select count(*)::int as n from runtime_outbox where organization_id=$1 and task_id=$2",
          [row.organization_id, task],
        )
      ).rows[0]?.n ?? 0;
    if (count >= 128) {
      await c.query(
        "update runtime_tasks set state='blocked',reason='capacity' where organization_id=$1 and id=$2 and state='ready'",
        [row.organization_id, task],
      );
      await c.query(
        "update runtime_missions set state='blocked',reason='capacity',version=version+1 where organization_id=$1 and id=$2",
        [row.organization_id, row.id],
      );
      return;
    }
    if (
      (
        await c.query(
          "select id from runtime_outbox where organization_id=$1 and task_id=$2 and generation=$3 and created_at>=$5 and (published_at is null or published_at>$4) limit 1",
          [
            row.organization_id,
            task,
            row.generation,
            new Date(this.now() - 5000),
            notBefore,
          ],
        )
      ).rowCount
    )
      return;
    await c.query(
      "insert into runtime_outbox(id,organization_id,mission_id,task_id,generation,created_at,next_publish_at) values($1,$2,$3,$4,$5,$6,$6)",
      [
        randomUUID(),
        row.organization_id,
        row.id,
        task,
        row.generation,
        new Date(this.now()),
      ],
    );
  }
  /** One tenant turn per call, serialized by a transaction-scoped global leadership lock. */
  async schedulerTick(publish: Publisher): Promise<string | null> {
    await this.recoverExpired();
    const org = await this.maintenance(async (c) => {
      const next = (
        await c.query<{ organization_id: string }>(
          "select organization_id from runtime_tenants where active order by turn,organization_id limit 1 for update skip locked",
        )
      ).rows[0];
      if (!next) return null;
      const turn = (
        await c.query<{ turn: string }>(
          "update runtime_instance set turn=turn+1 where id=true returning turn",
        )
      ).rows[0]?.turn;
      await c.query(
        "update runtime_tenants set turn=$2 where organization_id=$1",
        [next.organization_id, turn],
      );
      return next.organization_id;
    });
    if (!org) return null;
    await this.resolvePending(org);
    const rows = await this.tx(
      org,
      async (c) =>
        (
          await c.query<MissionRow>(
            "select * from runtime_missions where organization_id=$1 and state in ('queued','running') order by created_at,id limit 4",
            [org],
          )
        ).rows,
    );
    for (const row of rows) {
      if (!row.execution_grant) continue;
      try {
        await this.auth.guardExecution(row.execution_grant, () =>
          this.tx(org, async (c) =>
            this.progress(c, await this.mission(c, org, row.id)),
          ),
        );
      } catch (error) {
        if (!(error instanceof AuthError && error.status === 403)) throw error;
        await this.tx(org, async (c) => {
          const current = await this.mission(c, org, row.id);
          if (["queued", "running"].includes(current.state)) {
            await c.query(
              "update runtime_missions set state='blocked',reason='permission',version=version+1 where organization_id=$1 and id=$2",
              [org, row.id],
            );
            await this.event(c, current, "mission.blocked", {
              reason: "permission",
            });
          }
        });
      }
    }
    const batch = await this.tx(org, async (c) => {
      const out = (
        await c.query<{
          id: string;
          task_id: string;
          generation: number;
          environment_id: string;
        }>(
          "select o.id,o.task_id,o.generation,m.environment_id from runtime_outbox o join runtime_missions m on m.organization_id=o.organization_id and m.id=o.mission_id join runtime_tasks t on t.organization_id=o.organization_id and t.id=o.task_id where o.organization_id=$1 and o.published_at is null and o.next_publish_at<=$2 and (o.lease_expires_at is null or o.lease_expires_at<=$2) and m.state in ('queued','running') and t.state='ready' and m.generation=o.generation order by o.created_at,o.id limit 4 for update of o skip locked",
          [org, new Date(this.now())],
        )
      ).rows;
      const result = [];
      for (const o of out) {
        const lease = randomUUID();
        await c.query(
          "update runtime_outbox set lease_id=$3,lease_expires_at=$4,attempts=least(attempts+1,1000000) where organization_id=$1 and id=$2",
          [org, o.id, lease, new Date(this.now() + 15000)],
        );
        result.push({ ...o, lease });
      }
      return result;
    });
    for (const o of batch) {
      let ok = false;
      try {
        await publish(
          dispatchReference.parse({
            schema_version: 1,
            event_id: o.id,
            organization_id: org,
            task_id: o.task_id,
            execution_generation: o.generation,
          }),
          o.environment_id,
        );
        ok = true;
      } catch {}
      await this.tx(org, (c) =>
        c.query(
          ok
            ? "update runtime_outbox set published_at=$4,lease_id=null,lease_expires_at=null where organization_id=$1 and id=$2 and lease_id=$3"
            : "update runtime_outbox set next_publish_at=$4,lease_id=null,lease_expires_at=null where organization_id=$1 and id=$2 and lease_id=$3",
          [org, o.id, o.lease, new Date(this.now() + (ok ? 0 : 2000))],
        ),
      );
    }
    await this.tx(org, (c) =>
      c.query(
        "update runtime_tenants set active=exists(select 1 from runtime_missions where organization_id=$1 and state in ('queued','running')) where organization_id=$1",
        [org],
      ),
    );
    return org;
  }
}
