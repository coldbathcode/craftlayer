import { randomUUID } from "node:crypto";
import type { Principal } from "@craftlayer/auth";
import {
  attemptHandle,
  type RuntimeReason,
  stopRequest,
  stopView,
} from "@craftlayer/contracts";
import type { Permission } from "@craftlayer/core";
import type pg from "pg";
import { z } from "zod";
import { RuntimeModels } from "./models.js";
import { deny, digest, type MissionRow } from "./repository.js";
import type { WorkerContext } from "./workers.js";

export const instanceStopScope = "00000000-0000-4000-8000-000000000001";
type Scope = z.infer<typeof stopRequest>;
interface StopRow {
  id: string;
  organization_id: string | null;
  kind: Scope["kind"];
  scope_id: string;
  epoch: number;
  created_at: Date;
  cleared_at: Date | null;
}
export class RuntimeStops extends RuntimeModels {
  protected override async retire(
    c: pg.PoolClient,
    ctx: WorkerContext,
    state: string,
  ) {
    await super.retire(c, ctx, state);
    await c.query(
      "update runtime_stop_targets set quiesced_at=coalesce(quiesced_at,$3) where organization_id=$1 and attempt_id=$2",
      [ctx.worker.organization_id, ctx.attempt.id, new Date(this.now())],
    );
  }
  protected override async blockAttempt(
    c: pg.PoolClient,
    ctx: WorkerContext,
    reason: RuntimeReason,
  ) {
    const result = await super.blockAttempt(c, ctx, reason);
    await this.settleCancellation(
      c,
      await this.mission(c, ctx.worker.organization_id, ctx.mission.id),
    );
    return result;
  }
  protected override async control(
    c: pg.PoolClient,
    m: MissionRow,
  ): Promise<boolean> {
    return !!(
      await c.query(
        "select 1 from runtime_stop_latches where latched and ((kind='instance') or (kind='organization' and scope_id=$1) or (kind='environment' and scope_id=$2) or (kind='mission' and scope_id=$3)) limit 1",
        [m.organization_id, m.environment_id, m.id],
      )
    ).rowCount;
  }
  protected override async queued(c: pg.PoolClient, m: MissionRow) {
    if (await this.control(c, m)) deny("STOP_LATCHED", 403);
    await super.queued(c, m);
  }
  private async stopScope<T>(
    token: string,
    org: string,
    v: Pick<Scope, "kind" | "scope_id">,
    permission: Permission,
    op: (p: Principal) => Promise<T>,
  ): Promise<T> {
    if (v.kind === "instance") {
      if (v.scope_id !== instanceStopScope) deny("STOP_SCOPE", 400);
      return this.auth.guardInstance(token, op);
    }
    let environment: string | undefined;
    if (v.kind === "organization") {
      if (v.scope_id !== org) deny("STOP_SCOPE", 403);
    } else if (v.kind === "mission")
      environment = (await this.locateMission(token, org, v.scope_id))
        .environment_id;
    else environment = v.scope_id;
    return this.auth.guardResource(
      token,
      org,
      permission,
      {
        kind: environment ? "environment" : "organization",
        id: environment ?? org,
      },
      async (p) => {
        if (p.user.account_type !== "adult") deny("SIMULATION_ONLY", 403);
        if (environment)
          await this.tx(org, async (c) => {
            if (
              (await this.environment(c, org, environment)).type !==
              "simulation"
            )
              deny("SIMULATION_ONLY", 403);
          });
        return op(p);
      },
    );
  }
  private async organizations(
    c: pg.PoolClient,
    org: string | null,
  ): Promise<string[]> {
    if (org) return [org];
    return (
      await c.query<{ organization_id: string }>(
        "select organization_id from runtime_tenants order by organization_id",
      )
    ).rows.map((r) => r.organization_id);
  }
  private async tenant(c: pg.PoolClient, org: string) {
    await c.query("select set_config('app.organization_id',$1,true)", [org]);
  }
  private async interrupt(
    c: pg.PoolClient,
    m: MissionRow,
    mode: "pause" | "cancel",
    operation?: string,
  ) {
    if (["succeeded", "failed", "cancelled"].includes(m.state)) return;
    if (operation)
      await c.query(
        "insert into runtime_stop_targets(organization_id,operation_id,attempt_id,deadline_at) select organization_id,$3,id,deadline_at from runtime_attempts where organization_id=$1 and mission_id=$2 and state in ('leased','running','cancel_requested','uncertain') on conflict do nothing",
        [m.organization_id, m.id, operation],
      );
    await c.query(
      "update runtime_attempts set state='cancel_requested' where organization_id=$1 and mission_id=$2 and state in ('leased','running')",
      [m.organization_id, m.id],
    );
    await c.query(
      "update runtime_tasks set state='cancel_requested',reason=$3 where organization_id=$1 and mission_id=$2 and state in ('leased','running')",
      [m.organization_id, m.id, mode === "cancel" ? "cancel" : "stop"],
    );
    if (mode === "cancel")
      await c.query(
        "update runtime_tasks set state='cancelled',reason='cancel' where organization_id=$1 and mission_id=$2 and state in ('pending','ready','retry_wait','blocked') and not exists(select 1 from runtime_attempts a where a.organization_id=$1 and a.task_id=runtime_tasks.id and a.state in ('leased','running','cancel_requested','uncertain'))",
        [m.organization_id, m.id],
      );
    if (m.state === "draft" && mode === "pause") return;
    const state =
      mode === "cancel"
        ? m.state === "draft"
          ? "cancelled"
          : "cancelling"
        : "paused";
    if (m.state === "cancelling" && mode === "pause") return;
    await c.query(
      "update runtime_missions set state=$3,reason=$4,generation=generation+1,version=version+1,cancel_requested_at=case when $3 in ('cancelling','cancelled') then coalesce(cancel_requested_at,$5) else cancel_requested_at end where organization_id=$1 and id=$2",
      [
        m.organization_id,
        m.id,
        state,
        mode === "cancel" ? "cancel" : "stop",
        new Date(this.now()),
      ],
    );
    if (mode === "cancel")
      await this.settleCancellation(
        c,
        await this.mission(c, m.organization_id, m.id),
      );
    await this.event(
      c,
      m,
      mode === "cancel" ? "mission.cancel_requested" : "mission.paused",
      { state, operation_id: operation ?? null },
    );
  }
  protected async settleCancellation(c: pg.PoolClient, m: MissionRow) {
    const row = (
      await c.query<{ cancel_requested_at: Date | null }>(
        "select cancel_requested_at from runtime_missions where organization_id=$1 and id=$2",
        [m.organization_id, m.id],
      )
    ).rows[0];
    if (
      !row?.cancel_requested_at ||
      ["succeeded", "failed", "cancelled"].includes(m.state)
    ) {
      if (m.state === "cancelled") await this.releaseMission(c, m);
      return;
    }
    const active = (
      await c.query<{ state: string }>(
        "select state from runtime_attempts where organization_id=$1 and mission_id=$2 and state in ('leased','running','cancel_requested','uncertain')",
        [m.organization_id, m.id],
      )
    ).rows;
    if (active.length) {
      if (
        active.some((a) => a.state === "uncertain") &&
        m.state === "cancelling"
      )
        await c.query(
          "update runtime_missions set state='blocked',reason='uncertain',version=version+1 where organization_id=$1 and id=$2",
          [m.organization_id, m.id],
        );
      return;
    }
    await c.query(
      "update runtime_tasks set state='cancelled',reason='cancel' where organization_id=$1 and mission_id=$2 and state in ('pending','ready','retry_wait','blocked','cancel_requested')",
      [m.organization_id, m.id],
    );
    await c.query(
      "update runtime_missions set state='cancelled',reason='cancel',version=version+1 where organization_id=$1 and id=$2",
      [m.organization_id, m.id],
    );
    await this.releaseMission(c, m);
    await this.event(c, m, "mission.cancelled", { state: "cancelled" });
  }
  async missionControl(
    token: string,
    org: string,
    id: string,
    command: "pause" | "cancel",
    expected: number,
    key: string,
  ) {
    const located = await this.locateMission(token, org, z.uuid().parse(id));
    return this.scoped(
      token,
      org,
      located.environment_id,
      command === "cancel" ? "mission:cancel" : "mission:pause",
      async (c, p) =>
        this.idempotent(
          c,
          org,
          p.user.id,
          `mission.${command}/${id}`,
          key,
          { expected_version: expected },
          async () => {
            const m = await this.mission(c, org, id);
            this.version(m, expected);
            if (
              ["succeeded", "failed", "cancelled"].includes(m.state) ||
              (command === "pause" && ["draft", "cancelling"].includes(m.state))
            )
              deny("MISSION_STATE");
            await this.interrupt(c, m, command);
            await this.audit(
              c,
              org,
              p.user.id,
              `runtime.mission_${command}`,
              id,
            );
            return this.view(c, await this.mission(c, org, id));
          },
        ),
    );
  }
  async resumeMission(
    token: string,
    org: string,
    id: string,
    expected: number,
    key: string,
  ) {
    const located = await this.locateMission(token, org, z.uuid().parse(id));
    // Issue without holding another session lock, then compose read-only grant guards.
    const pauseGrant = await this.auth.issueExecutionGrant(
      token,
      org,
      "mission:pause",
      { kind: "environment", id: located.environment_id },
    );
    const grant = await this.auth.issueExecutionGrant(
      token,
      org,
      "mission:execute",
      { kind: "environment", id: located.environment_id },
    );
    return this.auth.guardExecution(pauseGrant, () =>
      this.auth.guardExecution(grant, (p) =>
        this.tx(org, (c) =>
          this.idempotent(
            c,
            org,
            p.user.id,
            `mission.resume/${id}`,
            key,
            { expected_version: expected },
            async () => {
              const m = await this.mission(c, org, id);
              this.version(m, expected);
              if (
                p.user.account_type !== "adult" ||
                !["paused", "blocked"].includes(m.state) ||
                (await this.control(c, m))
              )
                deny("RESUME_DENIED", 403);
              const cancellation = (
                await c.query(
                  "select 1 from runtime_missions where organization_id=$1 and id=$2 and cancel_requested_at is not null",
                  [org, id],
                )
              ).rowCount;
              const active = (
                await c.query(
                  "select 1 from runtime_attempts where organization_id=$1 and mission_id=$2 and state in ('leased','running','cancel_requested','uncertain')",
                  [org, id],
                )
              ).rowCount;
              if (active || cancellation) deny("QUIESCENCE_REQUIRED");
              const tasks = (
                await c.query<{
                  attempt_count: number;
                  definition: { max_attempts: number };
                  state: string;
                }>(
                  "select attempt_count,definition,state from runtime_tasks where organization_id=$1 and mission_id=$2",
                  [org, id],
                )
              ).rows;
              if (
                tasks.some(
                  (t) =>
                    ["blocked", "cancel_requested"].includes(t.state) &&
                    t.attempt_count >= t.definition.max_attempts,
                )
              )
                deny("ATTEMPT_LIMIT");
              await c.query(
                "update runtime_tasks set state='pending',reason='none',next_attempt_at=$3 where organization_id=$1 and mission_id=$2 and state='blocked'",
                [org, id, new Date(this.now())],
              );
              const generation = m.generation + 1;
              await c.query(
                "update runtime_missions set state='queued',reason='none',generation=$3,execution_grant=$4,execution_digest=$5,version=version+1 where organization_id=$1 and id=$2",
                [
                  org,
                  id,
                  generation,
                  grant,
                  digest({
                    mission: id,
                    hash: m.template_hash,
                    generation,
                    grant,
                  }),
                ],
              );
              const current = await this.mission(c, org, id);
              if (!current.deadline || current.deadline.getTime() <= this.now())
                deny("MISSION_DEADLINE");
              await this.queued(c, current);
              await this.audit(
                c,
                org,
                p.user.id,
                "runtime.mission_resumed",
                id,
              );
              await this.event(c, current, "mission.resumed", {
                state: "queued",
              });
              return this.view(c, current);
            },
          ),
        ),
      ),
    );
  }
  private async createStop(org: string | null, v: Scope, actor: string | null) {
    return this.maintenance(async (c) => {
      if (org) await this.tenant(c, org);
      const id = randomUUID(),
        latch = (
          await c.query<{ epoch: number }>(
            "insert into runtime_stop_latches(kind,scope_id,organization_id,epoch,latched,operation_id,reason) values($1,$2,$3,1,true,$4,$5) on conflict(kind,scope_id) do update set epoch=runtime_stop_latches.epoch+1,latched=true,operation_id=excluded.operation_id,reason=excluded.reason returning epoch",
            [v.kind, v.scope_id, org, id, v.reason],
          )
        ).rows[0];
      if (!latch) deny();
      await c.query(
        "insert into runtime_stop_operations(id,organization_id,kind,scope_id,epoch,reason,actor_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          org,
          v.kind,
          v.scope_id,
          latch.epoch,
          v.reason,
          actor,
          new Date(this.now()),
        ],
      );
      const organizations = await this.organizations(c, org);
      for (const tenant of organizations) {
        await this.tenant(c, tenant);
        const missions = (
          await c.query<MissionRow>(
            "select * from runtime_missions where organization_id=$1 and state in ('queued','running','paused','blocked','cancelling') and ($2='instance' or $2='organization' or ($2='environment' and environment_id=$3) or ($2='mission' and id=$3)) order by id",
            [tenant, v.kind, v.scope_id],
          )
        ).rows;
        for (const m of missions) await this.interrupt(c, m, "pause", id);
        await this.audit(c, tenant, actor, "runtime.stop_requested", id);
      }
      return this.stopDto(c, {
        id,
        organization_id: org,
        kind: v.kind,
        scope_id: v.scope_id,
        epoch: latch.epoch,
        created_at: new Date(this.now()),
        cleared_at: null,
      });
    });
  }
  async requestStop(token: string, org: string, input: unknown) {
    const v = stopRequest.parse(input);
    return this.stopScope(token, org, v, "stop:request", (p) =>
      this.createStop(v.kind === "instance" ? null : org, v, p.user.id),
    );
  }
  async localEmergencyStop(recovery: string, reason: string) {
    const v = stopRequest.parse({
      kind: "instance",
      scope_id: instanceStopScope,
      reason,
    });
    return this.auth.guardLocalRecovery(recovery, () =>
      this.createStop(null, v, null),
    );
  }
  private async stopDto(c: pg.PoolClient, row: StopRow) {
    let requested = 0,
      acknowledged = 0,
      quiesced = 0,
      unreachable = 0;
    for (const org of await this.organizations(c, row.organization_id)) {
      await this.tenant(c, org);
      const counts = (
        await c.query<{
          requested: number;
          acknowledged: number;
          quiesced: number;
          unreachable: number;
        }>(
          "select count(*)::int as requested,count(acknowledged_at)::int as acknowledged,count(quiesced_at)::int as quiesced,count(*) filter(where acknowledged_at is null and quiesced_at is null and deadline_at<=$2)::int as unreachable from runtime_stop_targets where operation_id=$1",
          [row.id, new Date(this.now())],
        )
      ).rows[0];
      requested += counts?.requested ?? 0;
      acknowledged += counts?.acknowledged ?? 0;
      quiesced += counts?.quiesced ?? 0;
      unreachable += counts?.unreachable ?? 0;
    }
    if (row.organization_id) await this.tenant(c, row.organization_id);
    const latch = (
      await c.query(
        "select latched,operation_id from runtime_stop_latches where kind=$1 and scope_id=$2",
        [row.kind, row.scope_id],
      )
    ).rows[0];
    return stopView.parse({
      id: row.id,
      kind: row.kind,
      scope_id: row.scope_id,
      epoch: row.epoch,
      latched: !!latch?.latched,
      requested,
      acknowledged,
      quiesced,
      unreachable,
      created_at: row.created_at.toISOString(),
      cleared_at: row.cleared_at?.toISOString() ?? null,
    });
  }
  private async locateStop(token: string, org: string, id: string) {
    z.uuid().parse(id);
    return this.member(token, org, () =>
      this.tx(org, async (c) => {
        const row = (
          await c.query<StopRow>(
            "select * from runtime_stop_operations where id=$1 and (organization_id=$2 or kind='instance')",
            [id, org],
          )
        ).rows[0];
        if (!row) deny("NOT_FOUND", 404);
        return row;
      }),
    );
  }
  async getStop(token: string, org: string, id: string) {
    const row = await this.locateStop(token, org, id);
    return this.stopScope(token, org, row, "stop:request", () =>
      this.maintenance(async (c) => {
        if (row.organization_id) await this.tenant(c, org);
        return this.stopDto(c, row);
      }),
    );
  }
  async clearStop(
    token: string,
    org: string,
    id: string,
    epoch: number,
    reason: string,
  ) {
    z.string().trim().min(1).max(240).parse(reason);
    const row = await this.locateStop(token, org, id);
    return this.stopScope(token, org, row, "stop:clear", (p) =>
      this.maintenance(async (c) => {
        if (row.organization_id) await this.tenant(c, org);
        const result = await c.query(
          "update runtime_stop_latches set latched=false,epoch=epoch+1,reason=$4 where kind=$1 and scope_id=$2 and operation_id=$3 and epoch=$5 and latched returning epoch",
          [row.kind, row.scope_id, id, reason, epoch],
        );
        if (!result.rowCount) deny("STOP_VERSION");
        await c.query(
          "update runtime_stop_operations set cleared_at=$2 where id=$1",
          [id, new Date(this.now())],
        );
        for (const tenant of await this.organizations(c, row.organization_id)) {
          await this.tenant(c, tenant);
          await this.audit(c, tenant, p.user.id, "runtime.stop_cleared", id);
        }
        return this.stopDto(c, { ...row, cleared_at: new Date(this.now()) });
      }),
    );
  }
  override async acknowledgeStopped(
    token: string,
    protocol: number,
    input: unknown,
  ) {
    const result = await super.acknowledgeStopped(token, protocol, input),
      h = attemptHandle.parse(input),
      parts = this.workerParts(token, protocol);
    await this.tx(parts.org, async (c) => {
      const ctx = await this.attemptContext(c, token, protocol, h, true);
      await c.query(
        "update runtime_stop_targets set acknowledged_at=coalesce(acknowledged_at,$3),quiesced_at=case when $4 then coalesce(quiesced_at,$3) else quiesced_at end where organization_id=$1 and attempt_id=$2",
        [
          parts.org,
          h.attempt_id,
          new Date(this.now()),
          ["released", "failed", "succeeded", "cancelled"].includes(
            ctx.attempt.state,
          ),
        ],
      );
      await this.settleCancellation(c, ctx.mission);
    });
    return result;
  }
}
