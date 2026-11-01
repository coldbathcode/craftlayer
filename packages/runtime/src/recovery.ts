import {
  reconcileAttempt,
  recoveryEvidence,
  taskDefinition,
} from "@craftlayer/contracts";
import type pg from "pg";
import { deny, digest, type TaskRow } from "./repository.js";
import { RuntimeStops } from "./stops.js";
import type { AttemptRow, WorkerContext } from "./workers.js";

export class RuntimeRecovery extends RuntimeStops {
  private async context(
    c: pg.PoolClient,
    org: string,
    a: AttemptRow,
  ): Promise<WorkerContext> {
    const worker = (
        await c.query<WorkerContext["worker"]>(
          "select * from runtime_workers where organization_id=$1 and id=$2",
          [org, a.worker_id],
        )
      ).rows[0],
      task = (
        await c.query<TaskRow>(
          "select * from runtime_tasks where organization_id=$1 and id=$2",
          [org, a.task_id],
        )
      ).rows[0],
      mission = await this.mission(c, org, a.mission_id);
    if (!worker || !task || task.fence !== a.fence) deny("RECOVERY_STATE");
    return { worker, task, mission, attempt: a };
  }
  protected override async recoverExpired() {
    const organizations = await this.maintenance(
      async (c) =>
        (
          await c.query<{ organization_id: string }>(
            "select organization_id from runtime_tenants order by organization_id",
          )
        ).rows,
    );
    for (const { organization_id: org } of organizations)
      await this.tx(org, async (c) => {
        const attempts = (
          await c.query<AttemptRow>(
            "select a.* from runtime_attempts a join runtime_workers w on w.organization_id=a.organization_id and w.id=a.worker_id where a.organization_id=$1 and a.state in ('leased','running','cancel_requested') and (a.lease_expires_at<=$2 or a.deadline_at<=$2 or w.revoked_at is not null or w.expires_at<=$2) order by a.deadline_at,a.id limit 4 for update of a",
            [org, new Date(this.now())],
          )
        ).rows;
        for (const a of attempts) {
          const ctx = await this.context(c, org, a),
            unknown = (
              await c.query(
                "select 1 from runtime_action_receipts where organization_id=$1 and attempt_id=$2 union all select 1 from runtime_model_calls where organization_id=$1 and attempt_id=$2 and state in ('dispatched','uncertain') limit 1",
                [org, a.id],
              )
            ).rowCount;
          if (unknown) {
            await this.uncertain(c, ctx);
            continue;
          }
          await c.query(
            "update runtime_model_calls set state='invalid' where organization_id=$1 and attempt_id=$2 and state='prepared'",
            [org, a.id],
          );
          await this.retire(c, ctx, "released");
          const definition = taskDefinition.parse(ctx.task.definition),
            running =
              ["queued", "running"].includes(ctx.mission.state) &&
              ctx.mission.generation === a.generation &&
              !(await this.control(c, ctx.mission)),
            retry = running && ctx.task.attempt_count < definition.max_attempts;
          await c.query(
            "update runtime_tasks set state=$3,reason=$4,next_attempt_at=$5 where organization_id=$1 and id=$2 and state in ('leased','running','cancel_requested')",
            [
              org,
              ctx.task.id,
              retry ? "retry_wait" : running ? "failed" : "blocked",
              retry ? "retry" : running ? "lease_lost" : "stop",
              new Date(this.now() + 1000),
            ],
          );
          await this.settleCancellation(
            c,
            await this.mission(c, org, ctx.mission.id),
          );
          await this.serviceAudit(
            c,
            org,
            ctx.worker.id,
            ctx.task.id,
            a.id,
            "runtime.attempt_expired",
          );
          await this.event(c, ctx.mission, "task.recovered", {
            task_id: ctx.task.id,
            state: retry ? "retry_wait" : running ? "failed" : "blocked",
            reason: retry ? "retry" : "lease_lost",
          });
          if (running)
            await c.query(
              "update runtime_tenants set active=true where organization_id=$1",
              [org],
            );
        }
      });
  }
  private async evidence(c: pg.PoolClient, ctx: WorkerContext) {
    const org = ctx.worker.organization_id,
      receipts = (
        await c.query<{ id: string; state: string; action_hash: string }>(
          "select id,state,action_hash from runtime_action_receipts where organization_id=$1 and attempt_id=$2 order by id",
          [org, ctx.attempt.id],
        )
      ).rows,
      calls = (
        await c.query<{ request_id: string; state: string }>(
          "select request_id,state from runtime_model_calls where organization_id=$1 and attempt_id=$2 order by step",
          [org, ctx.attempt.id],
        )
      ).rows,
      extra = (
        await c.query<{ worker_stopped_at: Date | null }>(
          "select worker_stopped_at from runtime_attempts where organization_id=$1 and id=$2",
          [org, ctx.attempt.id],
        )
      ).rows[0];
    return recoveryEvidence.parse({
      attempt_id: ctx.attempt.id,
      task_id: ctx.task.id,
      worker_id: ctx.worker.id,
      deadline_at: ctx.attempt.deadline_at.toISOString(),
      worker_revoked: !!ctx.worker.revoked_at,
      worker_acknowledged: !!extra?.worker_stopped_at,
      evidence_hash: digest({
        organization: org,
        mission: ctx.mission.id,
        generation: ctx.attempt.generation,
        fence: ctx.attempt.fence,
        definition: ctx.task.definition,
        attempt: ctx.attempt.id,
        state: ctx.attempt.state,
        receipts,
        calls,
        worker_revoked_at: ctx.worker.revoked_at,
        worker_stopped_at: extra?.worker_stopped_at ?? null,
      }),
      receipts: receipts.map(({ id, state }) => ({ id, state })),
      model_calls: calls,
    });
  }
  async recovery(token: string, org: string, id: string) {
    const located = await this.locateMission(token, org, id);
    return this.scoped(
      token,
      org,
      located.environment_id,
      "mission:cancel",
      async (c) => {
        const rows = (
            await c.query<AttemptRow>(
              "select * from runtime_attempts where organization_id=$1 and mission_id=$2 and state='uncertain' order by id",
              [org, id],
            )
          ).rows,
          result = [];
        for (const a of rows)
          result.push(await this.evidence(c, await this.context(c, org, a)));
        return result;
      },
    );
  }
  async reconcileRuntime(
    token: string,
    org: string,
    mission: string,
    attempt: string,
    input: unknown,
  ) {
    const v = reconcileAttempt.parse(input),
      located = await this.locateMission(token, org, mission);
    return this.scoped(
      token,
      org,
      located.environment_id,
      "mission:cancel",
      async (c, p) => {
        const a = (
          await c.query<AttemptRow>(
            "select * from runtime_attempts where organization_id=$1 and mission_id=$2 and id=$3 and state='uncertain' for update",
            [org, mission, attempt],
          )
        ).rows[0];
        if (!a) deny("RECOVERY_STATE");
        const ctx = await this.context(c, org, a),
          evidence = await this.evidence(c, ctx);
        if (evidence.evidence_hash !== v.evidence_hash) deny("RECOVERY_STALE");
        // Revocation fences every new permit; the adult still attests external quiescence explicitly.
        if (
          !ctx.worker.revoked_at ||
          a.deadline_at.getTime() > this.now() ||
          a.lease_expires_at.getTime() > this.now()
        )
          deny("QUIESCENCE_REQUIRED");
        const unresolved = (
          await c.query(
            "select 1 from runtime_model_calls m join provider_requests q on q.organization_id=m.organization_id and q.request_id=m.request_id join usage_reservations r on r.organization_id=q.organization_id and r.request_pk=q.id where m.organization_id=$1 and m.attempt_id=$2 and r.state in ('reserved','dispatched','uncertain') limit 1",
            [org, attempt],
          )
        ).rowCount;
        if (unresolved) deny("PROVIDER_RECONCILIATION_REQUIRED");
        await c.query(
          "insert into runtime_reconciliations(organization_id,attempt_id,actor_id,evidence_hash,reason,created_at) values($1,$2,$3,$4,$5,$6)",
          [
            org,
            attempt,
            p.user.id,
            v.evidence_hash,
            v.reason,
            new Date(this.now()),
          ],
        );
        await this.retire(c, ctx, "failed");
        await c.query(
          "update runtime_tasks set state='failed',verified=false,reason='uncertain' where organization_id=$1 and id=$2 and state='blocked'",
          [org, ctx.task.id],
        );
        await this.settleCancellation(c, await this.mission(c, org, mission));
        const current = await this.mission(c, org, mission),
          active = (
            await c.query(
              "select 1 from runtime_attempts where organization_id=$1 and mission_id=$2 and state in ('leased','running','cancel_requested','uncertain') limit 1",
              [org, mission],
            )
          ).rowCount;
        if (
          !active &&
          !["succeeded", "failed", "cancelled"].includes(current.state)
        ) {
          await c.query(
            "update runtime_missions set state='failed',reason='uncertain',version=version+1 where organization_id=$1 and id=$2",
            [org, mission],
          );
          await this.releaseMission(c, current);
        }
        await this.audit(
          c,
          org,
          p.user.id,
          "runtime.attempt_reconciled",
          attempt,
        );
        await this.event(c, ctx.mission, "task.reconciled", {
          task_id: ctx.task.id,
          state: "failed",
          verified: false,
        });
        return this.view(c, await this.mission(c, org, mission));
      },
    );
  }
}
