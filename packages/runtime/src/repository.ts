import { createHash, randomUUID } from "node:crypto";
import {
  AuthError,
  type ExecutionGrant,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import { graphSchema, missionView } from "@craftlayer/contracts";
import type { Permission } from "@craftlayer/core";
import type { ProviderGateway } from "@craftlayer/providers";
import pg from "pg";
import { z } from "zod";

export const digest = (value: unknown): string => {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
};
export function deny(code = "RUNTIME_CONFLICT", status = 409): never {
  throw new AuthError(
    status,
    code,
    "Runtime operation denied; refresh the authorized resource.",
  );
}
export interface RuntimeOptions {
  databaseUrl: string;
  auth: IdentityService;
  providers?: ProviderGateway;
  cursorSecret: string;
  clock?: () => number;
}
export interface EnvironmentRow {
  id: string;
  organization_id: string;
  project_id: string;
  type: string;
}
export interface MissionRow {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  group_id: string;
  template_id: string;
  template_hash: string;
  snapshot: unknown;
  created_by: string;
  state: string;
  reason: string;
  version: number;
  generation: number;
  execution_grant: ExecutionGrant | null;
  execution_digest: string | null;
  deadline: Date | null;
  created_at: Date;
  name: string;
}
export interface TaskRow {
  agent_id?: string | null;
  id: string;
  organization_id: string;
  mission_id: string;
  node_key: string;
  definition: unknown;
  required: boolean;
  state: string;
  reason: string;
  attempt_count: number;
  fence: number;
  verified: boolean;
  result: unknown;
  next_attempt_at: Date;
}
export class RuntimeRepository {
  #pool: pg.Pool;
  protected readonly auth: IdentityService;
  protected readonly providers: ProviderGateway | undefined;
  protected readonly cursorSecret: string;
  protected readonly now: () => number;
  constructor(options: RuntimeOptions) {
    if (new URL(options.databaseUrl).username !== "craftlayer_runtime")
      throw new Error("Restricted runtime role required");
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
    this.auth = options.auth;
    this.providers = options.providers;
    this.cursorSecret = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(options.cursorSecret);
    this.now = options.clock ?? Date.now;
  }
  async close() {
    await this.#pool.end();
  }
  private async transaction<T>(
    org: string | null,
    operation: (c: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    if (org) z.uuid().parse(org);
    const c = await this.#pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(74618006)");
      await c.query("select set_config('app.runtime_internal','enabled',true)");
      if (org) {
        await c.query("select set_config('app.organization_id',$1,true)", [
          org,
        ]);
        await c.query(
          "select pg_advisory_xact_lock(hashtextextended($1,74618005))",
          [org],
        );
      }
      const value = await operation(c);
      await c.query("commit");
      return value;
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  }
  protected tx<T>(org: string, operation: (c: pg.PoolClient) => Promise<T>) {
    return this.transaction(org, operation);
  }
  protected maintenance<T>(operation: (c: pg.PoolClient) => Promise<T>) {
    return this.transaction(null, operation);
  }
  protected async storage(
    _c: pg.PoolClient,
    _org: string,
    _user: string,
    _project: string,
    _id: string,
    _bytes: number,
  ): Promise<void> {}
  protected async environment(
    c: pg.PoolClient,
    org: string,
    id: string,
  ): Promise<EnvironmentRow> {
    const row = (
      await c.query<EnvironmentRow>(
        "select id,organization_id,project_id,type from environments where organization_id=$1 and id=$2",
        [org, z.uuid().parse(id)],
      )
    ).rows[0];
    if (!row) deny("NOT_FOUND", 404);
    return row;
  }
  protected async member<T>(
    token: string,
    org: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.auth.guardOrganization(
      token,
      org,
      "organization:read",
      operation,
    );
  }
  protected async scoped<T>(
    token: string,
    org: string,
    environment: string,
    permission: Permission,
    operation: (
      c: pg.PoolClient,
      p: Principal,
      e: EnvironmentRow,
    ) => Promise<T>,
  ): Promise<T> {
    return this.auth.guardResource(
      token,
      org,
      permission,
      { kind: "environment", id: environment },
      (p) =>
        this.tx(org, async (c) => {
          const e = await this.environment(c, org, environment);
          if (e.type !== "simulation" || p.user.account_type !== "adult")
            deny("SIMULATION_ONLY", 403);
          return operation(c, p, e);
        }),
    );
  }
  protected async mission(
    c: pg.PoolClient,
    org: string,
    id: string,
  ): Promise<MissionRow> {
    const row = (
      await c.query<MissionRow>(
        "select * from runtime_missions where organization_id=$1 and id=$2 for update",
        [org, z.uuid().parse(id)],
      )
    ).rows[0];
    if (!row) deny("NOT_FOUND", 404);
    return row;
  }
  protected async locateMission(token: string, org: string, id: string) {
    return this.member(token, org, () =>
      this.tx(org, (c) => this.mission(c, org, id)),
    );
  }
  protected async view(c: pg.PoolClient, row: MissionRow) {
    const tasks = (
      await c.query<TaskRow>(
        "select t.*,(select a.agent_id from runtime_attempts a where a.organization_id=t.organization_id and a.task_id=t.id order by a.fence desc limit 1) as agent_id from runtime_tasks t where t.organization_id=$1 and t.mission_id=$2 order by t.node_key,t.id limit 50",
        [row.organization_id, row.id],
      )
    ).rows;
    return missionView.parse({
      id: row.id,
      project_id: row.project_id,
      environment_id: row.environment_id,
      group_id: row.group_id,
      name: row.name,
      state: row.state,
      reason: row.reason,
      version: row.version,
      generation: row.generation,
      template_hash: row.template_hash,
      created_at: row.created_at.toISOString(),
      tasks: tasks.map((t) => ({
        id: t.id,
        agent_id: t.agent_id ?? null,
        key: t.node_key,
        state: t.state,
        reason: t.reason,
        attempt_count: t.attempt_count,
        fence: t.fence,
        verified: t.verified,
        result: t.result,
      })),
    });
  }
  protected async audit(
    c: pg.PoolClient,
    org: string,
    actor: string | null,
    action: string,
    id: string,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome) values($1,$2,$3,$4,'allowed')",
      [org, actor, action, id],
    );
  }
  protected async event(
    c: pg.PoolClient,
    row: Pick<
      MissionRow,
      "organization_id" | "project_id" | "environment_id" | "id"
    >,
    type: string,
    payload: Record<string, unknown>,
  ) {
    await c.query(
      "insert into runtime_events(id,organization_id,project_id,environment_id,mission_id,type,payload,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        row.organization_id,
        row.project_id,
        row.environment_id,
        row.id,
        type,
        payload,
        new Date(this.now()),
      ],
    );
  }
  protected async idempotent<T>(
    c: pg.PoolClient,
    org: string,
    actor: string,
    route: string,
    key: string,
    body: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    z.uuid().parse(key);
    const hash = digest(body),
      old = (
        await c.query<{ request_hash: string; response: T }>(
          "select request_hash,response from runtime_idempotency where organization_id=$1 and actor_id=$2 and route=$3 and key=$4",
          [org, actor, route, key],
        )
      ).rows[0];
    if (old) {
      if (old.request_hash !== hash) deny("IDEMPOTENCY_CONFLICT");
      return old.response;
    }
    const value = await operation();
    await c.query(
      "insert into runtime_idempotency(organization_id,actor_id,route,key,request_hash,response) values($1,$2,$3,$4,$5,$6)",
      [org, actor, route, key, hash, JSON.parse(JSON.stringify(value))],
    );
    return value;
  }
  protected version(row: { version: number }, expected: number) {
    if (row.version !== expected) deny("VERSION_CONFLICT");
  }
  protected snapshot(row: MissionRow) {
    const graph = graphSchema.parse(row.snapshot);
    if (digest(graph) !== row.template_hash) deny("SNAPSHOT_INVALID", 403);
    return graph;
  }
  protected async queued(_c: pg.PoolClient, _row: MissionRow): Promise<void> {}
}
