import {
  defaultRuntimeLimits,
  runtimeLimitsSchema,
  runtimeQuotaView,
} from "@craftlayer/contracts";
import type pg from "pg";
import { z } from "zod";
import { RuntimeCommands } from "./commands.js";
import { deny, type MissionRow } from "./repository.js";
export interface QuotaScope {
  kind: "organization" | "user" | "project";
  id: string;
}
interface QuotaRow {
  limits: unknown;
  version: number;
  active_missions: number;
  active_agents: number;
  storage_bytes: string;
}
export class RuntimeQuotas extends RuntimeCommands {
  protected scopes(org: string, user: string, project: string): QuotaScope[] {
    return [
      { kind: "organization", id: org },
      { kind: "project", id: project },
      { kind: "user", id: user },
    ];
  }
  protected async quota(c: pg.PoolClient, org: string, scope: QuotaScope) {
    await c.query(
      "insert into runtime_quota_scopes(organization_id,kind,scope_id,limits) values($1,$2,$3,$4) on conflict do nothing",
      [org, scope.kind, scope.id, defaultRuntimeLimits],
    );
    const row = (
      await c.query<QuotaRow>(
        "select * from runtime_quota_scopes where organization_id=$1 and kind=$2 and scope_id=$3 for update",
        [org, scope.kind, scope.id],
      )
    ).rows[0];
    if (!row) deny();
    return { ...row, limits: runtimeLimitsSchema.parse(row.limits) };
  }
  protected hour() {
    return new Date(Math.floor(this.now() / 3600000) * 3600000);
  }
  protected override async storage(
    c: pg.PoolClient,
    org: string,
    user: string,
    project: string,
    id: string,
    bytes: number,
  ) {
    const scopes = this.scopes(org, user, project),
      global = (
        await c.query<{ storage_bytes: string }>(
          "select storage_bytes from runtime_instance where id=true for update",
        )
      ).rows[0];
    if (!global || BigInt(global.storage_bytes) + BigInt(bytes) > 268435456n)
      deny("STORAGE_CAPACITY", 429);
    for (const scope of scopes) {
      const q = await this.quota(c, org, scope);
      if (
        BigInt(q.storage_bytes) + BigInt(bytes) >
        BigInt(q.limits.storage_bytes)
      )
        deny("STORAGE_CAPACITY", 429);
    }
    await c.query(
      "insert into runtime_storage_reservations(organization_id,resource_id,bytes,scopes) values($1,$2,$3,$4)",
      [org, id, bytes, JSON.stringify(scopes)],
    );
    await c.query(
      "update runtime_instance set storage_bytes=storage_bytes+$1 where id=true",
      [bytes],
    );
    for (const s of scopes)
      await c.query(
        "update runtime_quota_scopes set storage_bytes=storage_bytes+$4 where organization_id=$1 and kind=$2 and scope_id=$3",
        [org, s.kind, s.id, bytes],
      );
  }
  protected async admit(c: pg.PoolClient, row: MissionRow) {
    const org = row.organization_id;
    if (
      (
        await c.query(
          "select mission_id from runtime_admissions where organization_id=$1 and mission_id=$2",
          [org, row.id],
        )
      ).rowCount
    )
      return;
    if (!row.execution_grant) deny("GRANT_DENIED", 403);
    const scopes = this.scopes(org, row.execution_grant.userId, row.project_id),
      global = (
        await c.query<{ active_missions: number }>(
          "select active_missions from runtime_instance where id=true for update",
        )
      ).rows[0];
    if (!global || global.active_missions >= 4) deny("MISSION_CAPACITY", 429);
    for (const scope of scopes) {
      const q = await this.quota(c, org, scope);
      if (q.active_missions >= q.limits.active_missions)
        deny("MISSION_CAPACITY", 429);
    }
    await c.query(
      "insert into runtime_admissions(organization_id,mission_id,scopes) values($1,$2,$3)",
      [org, row.id, JSON.stringify(scopes)],
    );
    await c.query(
      "update runtime_instance set active_missions=active_missions+1 where id=true",
    );
    for (const s of scopes)
      await c.query(
        "update runtime_quota_scopes set active_missions=active_missions+1 where organization_id=$1 and kind=$2 and scope_id=$3",
        [org, s.kind, s.id],
      );
  }
  protected async releaseMission(c: pg.PoolClient, row: MissionRow) {
    const record = (
      await c.query<{ scopes: QuotaScope[] }>(
        "update runtime_admissions set active=false where organization_id=$1 and mission_id=$2 and active returning scopes",
        [row.organization_id, row.id],
      )
    ).rows[0];
    if (!record) return;
    await c.query(
      "update runtime_instance set active_missions=active_missions-1 where id=true",
    );
    for (const s of record.scopes)
      await c.query(
        "update runtime_quota_scopes set active_missions=active_missions-1 where organization_id=$1 and kind=$2 and scope_id=$3",
        [row.organization_id, s.kind, s.id],
      );
  }
  protected async reserveAttempt(
    c: pg.PoolClient,
    row: MissionRow,
    id: string,
    runtimeMs: number,
  ) {
    if (!row.execution_grant) deny("GRANT_DENIED", 403);
    const org = row.organization_id,
      scopes = this.scopes(org, row.execution_grant.userId, row.project_id),
      hour = this.hour();
    const global = (
      await c.query<{ active_agents: number }>(
        "select active_agents from runtime_instance where id=true for update",
      )
    ).rows[0];
    if (!global || global.active_agents >= 8) deny("AGENT_CAPACITY", 429);
    await c.query(
      "insert into runtime_instance_hours(window_start) values($1) on conflict do nothing",
      [hour],
    );
    const g = (
      await c.query<{ tool_calls: number; runtime_ms: number }>(
        "select tool_calls,runtime_ms from runtime_instance_hours where window_start=$1 for update",
        [hour],
      )
    ).rows[0];
    if (!g || g.tool_calls + 10 > 10000 || g.runtime_ms + runtimeMs > 3600000)
      deny("RUNTIME_BUDGET", 429);
    for (const scope of scopes) {
      const q = await this.quota(c, org, scope);
      if (q.active_agents >= q.limits.active_agents)
        deny("AGENT_CAPACITY", 429);
      await c.query(
        "insert into runtime_quota_hours(organization_id,kind,scope_id,window_start) values($1,$2,$3,$4) on conflict do nothing",
        [org, scope.kind, scope.id, hour],
      );
      const h = (
        await c.query<{ tool_calls: number; runtime_ms: number }>(
          "select tool_calls,runtime_ms from runtime_quota_hours where organization_id=$1 and kind=$2 and scope_id=$3 and window_start=$4 for update",
          [org, scope.kind, scope.id, hour],
        )
      ).rows[0];
      if (
        !h ||
        h.tool_calls + 10 > q.limits.hourly_tool_calls ||
        h.runtime_ms + runtimeMs > q.limits.hourly_runtime_ms
      )
        deny("RUNTIME_BUDGET", 429);
    }
    await c.query(
      "insert into runtime_attempt_quotas(organization_id,attempt_id,scopes,tool_calls,runtime_ms,window_start) values($1,$2,$3,10,$4,$5)",
      [org, id, JSON.stringify(scopes), runtimeMs, hour],
    );
    await c.query(
      "update runtime_instance set active_agents=active_agents+1 where id=true",
    );
    await c.query(
      "update runtime_instance_hours set tool_calls=tool_calls+10,runtime_ms=runtime_ms+$2 where window_start=$1",
      [hour, runtimeMs],
    );
    for (const s of scopes) {
      await c.query(
        "update runtime_quota_scopes set active_agents=active_agents+1 where organization_id=$1 and kind=$2 and scope_id=$3",
        [org, s.kind, s.id],
      );
      await c.query(
        "update runtime_quota_hours set tool_calls=tool_calls+10,runtime_ms=runtime_ms+$5 where organization_id=$1 and kind=$2 and scope_id=$3 and window_start=$4",
        [org, s.kind, s.id, hour, runtimeMs],
      );
    }
  }
  protected async releaseAttempt(c: pg.PoolClient, org: string, id: string) {
    const record = (
      await c.query<{ scopes: QuotaScope[] }>(
        "update runtime_attempt_quotas set active=false where organization_id=$1 and attempt_id=$2 and active returning scopes",
        [org, id],
      )
    ).rows[0];
    if (!record) return;
    await c.query(
      "update runtime_instance set active_agents=active_agents-1 where id=true",
    );
    for (const s of record.scopes)
      await c.query(
        "update runtime_quota_scopes set active_agents=active_agents-1 where organization_id=$1 and kind=$2 and scope_id=$3",
        [org, s.kind, s.id],
      );
  }
  private async canonicalQuota(
    c: pg.PoolClient,
    org: string,
    scope: QuotaScope,
  ) {
    if (scope.kind === "organization") {
      if (scope.id !== org) deny("NOT_FOUND", 404);
    } else if (
      !(
        await c.query(
          scope.kind === "user"
            ? "select user_id from memberships where organization_id=$1 and user_id=$2"
            : "select id from projects where organization_id=$1 and id=$2",
          [org, scope.id],
        )
      ).rowCount
    )
      deny("NOT_FOUND", 404);
  }
  async runtimeBudget(
    token: string,
    org: string,
    kind: QuotaScope["kind"],
    id: string,
  ) {
    return this.auth.guardOrganization(token, org, "budget:manage", () =>
      this.tx(org, async (c) => {
        z.uuid().parse(id);
        const s = { kind, id };
        await this.canonicalQuota(c, org, s);
        return this.quotaView(c, org, s);
      }),
    );
  }
  protected async quotaView(c: pg.PoolClient, org: string, s: QuotaScope) {
    const q = await this.quota(c, org, s),
      h = (
        await c.query<{ tool_calls: number; runtime_ms: number }>(
          "select tool_calls,runtime_ms from runtime_quota_hours where organization_id=$1 and kind=$2 and scope_id=$3 and window_start=$4",
          [org, s.kind, s.id, this.hour()],
        )
      ).rows[0];
    return runtimeQuotaView.parse({
      accounting: "reserved_estimates",
      version: q.version,
      limits: q.limits,
      active_missions: q.active_missions,
      active_agents: q.active_agents,
      storage_bytes: Number(q.storage_bytes),
      hourly_tool_calls: h?.tool_calls ?? 0,
      hourly_runtime_ms: h?.runtime_ms ?? 0,
    });
  }
  async setRuntimeBudget(
    token: string,
    org: string,
    kind: QuotaScope["kind"],
    id: string,
    version: number,
    input: unknown,
  ) {
    const limits = runtimeLimitsSchema.parse(input);
    return this.auth.guardOrganization(token, org, "budget:manage", (p) =>
      this.tx(org, async (c) => {
        const s = { kind, id: z.uuid().parse(id) };
        await this.canonicalQuota(c, org, s);
        const q = await this.quota(c, org, s);
        this.version(q, version);
        await c.query(
          "update runtime_quota_scopes set limits=$4,version=version+1 where organization_id=$1 and kind=$2 and scope_id=$3",
          [org, kind, id, limits],
        );
        await this.audit(c, org, p.user.id, "runtime.budget_changed", id);
        return this.quotaView(c, org, s);
      }),
    );
  }
}
