import { createHash, randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  adoptionCommit,
  adoptionPlan,
  adoptionRequest,
  type CapturedObservation,
  capturedObservation,
  type InventoryTarget,
  observationView,
  operationAccepted,
  operationView,
  playersView,
  serverView,
  targetView,
} from "@craftlayer/contracts";
import { type Authority, canAccess, type Permission } from "@craftlayer/core";
import pg from "pg";
import { z } from "zod";

export interface ObservationSource {
  list(organization: string, environment: string): Promise<InventoryTarget[]>;
}
const emptySource: ObservationSource = { list: async () => [] };
export function managementHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function denied(code = "MANAGEMENT_CONFLICT", status = 409): never {
  throw new AuthError(
    status,
    code,
    "Server observation request denied; refresh your authorized selection.",
  );
}
interface ServerRow {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  name: string;
  target_id: string;
  binding_hash: string;
  registered: boolean;
  version: number;
  observation_fence: number;
  observation: CapturedObservation | null;
}
interface OperationRow {
  id: string;
  server_id: string;
  environment_id: string;
  kind: string;
  state: string;
  request_hash: string;
  failure_code: string;
  deadline: Date;
  created_at: Date;
  finished_at: Date | null;
}
export class MinecraftControl {
  #pool: pg.Pool;
  #auth: IdentityService;
  #source: ObservationSource;
  #now: () => number;
  constructor(options: {
    databaseUrl: string;
    auth: IdentityService;
    source?: ObservationSource;
    clock?: () => number;
  }) {
    if (new URL(options.databaseUrl).username !== "craftlayer_runtime")
      throw new Error("Restricted runtime role required");
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 3,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
    this.#auth = options.auth;
    this.#source = options.source ?? emptySource;
    this.#now = options.clock ?? Date.now;
  }
  async close() {
    await this.#pool.end();
  }
  async #tx<T>(org: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    z.uuid().parse(org);
    const c = await this.#pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.organization_id',$1,true)", [org]);
      await c.query(
        "select pg_advisory_xact_lock(hashtextextended($1,74618020))",
        [org],
      );
      const value = await fn(c);
      await c.query("commit");
      return value;
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  }
  async #scope<T>(
    token: string,
    org: string,
    environment: string,
    permission: Permission,
    fn: (
      c: pg.PoolClient,
      p: Principal,
      a: Authority,
      project: string,
    ) => Promise<T>,
  ) {
    return this.#auth.guardResource(
      token,
      org,
      permission,
      { kind: "environment", id: environment },
      (p, a) =>
        this.#tx(org, async (c) => {
          const e = (
            await c.query<{ project_id: string; type: string }>(
              "select project_id,type from environments where organization_id=$1 and id=$2",
              [org, environment],
            )
          ).rows[0];
          if (!e) denied("NOT_FOUND", 404);
          if (e.type !== "minecraft" || p.user.account_type !== "adult")
            denied("MINECRAFT_ADULT_ONLY", 403);
          return fn(c, p, a, e.project_id);
        }),
    );
  }
  async #locate(token: string, org: string, id: string) {
    z.uuid().parse(id);
    return this.#auth.guardOrganization(token, org, "organization:read", () =>
      this.#tx(org, async (c) => {
        const row = (
          await c.query<ServerRow>(
            "select * from minecraft_servers where organization_id=$1 and id=$2",
            [org, id],
          )
        ).rows[0];
        if (!row) denied("NOT_FOUND", 404);
        return row;
      }),
    );
  }
  async #server(c: pg.PoolClient, org: string, id: string) {
    const row = (
      await c.query<ServerRow>(
        "select * from minecraft_servers where organization_id=$1 and id=$2 for update",
        [org, id],
      )
    ).rows[0];
    if (!row) denied("NOT_FOUND", 404);
    return row;
  }
  #freshness(observation: CapturedObservation | null) {
    if (!observation) return "unavailable" as const;
    const age = this.#now() - Date.parse(observation.observed_at);
    return age >= 0 && age <= 60000 ? ("fresh" as const) : ("stale" as const);
  }
  #view(row: ServerRow, a: Authority) {
    const scope = {
      kind: "environment" as const,
      id: row.environment_id,
      projectId: row.project_id,
      environmentType: "minecraft",
    };
    const o = row.observation
      ? capturedObservation.parse(row.observation)
      : null;
    const { players: _players, ...fields } = o ?? { players: null };
    return serverView.parse({
      id: row.id,
      project_id: row.project_id,
      environment_id: row.environment_id,
      name: row.name,
      management_mode: "adopted_read_only",
      registered: row.registered,
      version: row.version,
      target_id: row.target_id,
      observation: o
        ? observationView.parse({
            ...fields,
            source: "captured_inventory",
            freshness: this.#freshness(o),
            player_count: o.players?.length ?? null,
            family_ready: false,
          })
        : null,
      can_observe: row.registered && canAccess(a, "server:observe", scope),
      can_unregister: row.registered && canAccess(a, "server:adopt", scope),
    });
  }
  #op(row: OperationRow) {
    return operationView.parse({
      id: row.id,
      server_id: row.server_id,
      environment_id: row.environment_id,
      kind: row.kind,
      state: row.state,
      failure_code: row.failure_code,
      created_at: row.created_at.toISOString(),
      finished_at: row.finished_at?.toISOString() ?? null,
      recovery_required:
        row.state === "running" && row.deadline.getTime() <= this.#now(),
    });
  }
  async #event(
    c: pg.PoolClient,
    org: string,
    p: Pick<Principal, "user">,
    id: string,
    action: string,
    server: string,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [org, p.user.id, action, server, { operation_id: id }],
    );
    await c.query(
      "insert into management_outbox(id,organization_id,operation_id,schema_version) values($1,$2,$3,1)",
      [randomUUID(), org, id],
    );
  }
  async #replay(
    c: pg.PoolClient,
    org: string,
    actor: string,
    kind: string,
    key: string,
    input: unknown,
  ) {
    z.uuid().parse(key);
    const op = (
      await c.query<OperationRow>(
        "select * from management_operations where organization_id=$1 and actor_id=$2 and kind=$3 and request_key=$4",
        [org, actor, kind, key],
      )
    ).rows[0];
    if (op && op.request_hash !== managementHash(input))
      denied("IDEMPOTENCY_CONFLICT");
    return op;
  }
  async #target(org: string, environment: string, id: string) {
    let targets: InventoryTarget[];
    try {
      targets = await Promise.race([
        this.#source.list(org, environment),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("SOURCE_TIMEOUT")),
            2000,
          );
          timer.unref();
        }),
      ]);
    } catch {
      denied("SOURCE_UNAVAILABLE", 503);
    }
    const target = targets.find(
      (t) =>
        t.id === id &&
        t.organization_id === org &&
        t.environment_id === environment,
    );
    if (!target) denied("TARGET_NOT_AVAILABLE", 404);
    const parsed = capturedObservation.safeParse(target.observation);
    if (
      !parsed.success ||
      Date.parse(parsed.data.observed_at) > this.#now() + 5000
    )
      denied("SOURCE_UNAVAILABLE", 503);
    return { ...target, observation: parsed.data };
  }
  async targets(token: string, org: string, environment: string) {
    await this.#scope(token, org, environment, "server:adopt", async () => {});
    let targets: InventoryTarget[];
    try {
      targets = await this.#source.list(org, environment);
    } catch {
      denied("SOURCE_UNAVAILABLE", 503);
    }
    return this.#scope(token, org, environment, "server:adopt", async () =>
      targets
        .filter(
          (t) => t.organization_id === org && t.environment_id === environment,
        )
        .slice(0, 100)
        .map((t) =>
          targetView.parse({
            id: t.id,
            label: t.label,
            binding_hash: t.binding_hash,
            source: "captured_inventory",
            observed_at: t.observation.observed_at,
          }),
        ),
    );
  }
  async plan(token: string, org: string, input: unknown) {
    const v = adoptionRequest.parse(input);
    await this.#scope(
      token,
      org,
      v.environment_id,
      "server:adopt",
      async () => {},
    );
    const t = await this.#target(org, v.environment_id, v.target_id);
    return this.#scope(token, org, v.environment_id, "server:adopt", async () =>
      adoptionPlan.parse({
        environment_id: v.environment_id,
        name: v.name,
        target: {
          id: t.id,
          label: t.label,
          binding_hash: t.binding_hash,
          source: "captured_inventory",
          observed_at: t.observation.observed_at,
        },
        plan_hash: managementHash([
          org,
          v.environment_id,
          v.target_id,
          v.name,
          t.binding_hash,
        ]),
        effects: "register_only",
        requires_world_changes: false,
      }),
    );
  }
  async adopt(token: string, org: string, input: unknown, key: string) {
    const v = adoptionCommit.parse(input);
    const old = await this.#scope(
      token,
      org,
      v.environment_id,
      "server:adopt",
      (c, p) => this.#replay(c, org, p.user.id, "adopt", key, v),
    );
    if (old)
      return operationAccepted.parse({
        operation_id: old.id,
        server_id: old.server_id,
      });
    const t = await this.#target(org, v.environment_id, v.target_id);
    if (
      managementHash([
        org,
        v.environment_id,
        v.target_id,
        v.name,
        t.binding_hash,
      ]) !== v.plan_hash
    )
      denied("PLAN_CHANGED");
    return this.#scope(
      token,
      org,
      v.environment_id,
      "server:adopt",
      async (c, p, _a, project) => {
        const replay = await this.#replay(c, org, p.user.id, "adopt", key, v);
        if (replay)
          return operationAccepted.parse({
            operation_id: replay.id,
            server_id: replay.server_id,
          });
        if (
          (
            await c.query(
              "select id from minecraft_servers where organization_id=$1 and environment_id=$2 and (target_id=$3 or binding_hash=$4)",
              [org, v.environment_id, v.target_id, t.binding_hash],
            )
          ).rowCount
        )
          denied("ALREADY_REGISTERED");
        const server = randomUUID(),
          id = randomUUID(),
          now = new Date(this.#now());
        await c.query(
          "insert into minecraft_servers(id,organization_id,project_id,environment_id,name,target_id,binding_hash,observation) values($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            server,
            org,
            project,
            v.environment_id,
            v.name,
            v.target_id,
            t.binding_hash,
            t.observation,
          ],
        );
        await c.query(
          "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at,finished_at) values($1,$2,$3,$4,$5,$6,$7,'adopt',$8,$9,'succeeded',0,$10,$10,$10)",
          [
            id,
            org,
            project,
            v.environment_id,
            server,
            p.user.id,
            p.sessionId,
            key,
            managementHash(v),
            now,
          ],
        );
        await this.#event(c, org, p, id, "server.adopted_read_only", server);
        return operationAccepted.parse({ operation_id: id, server_id: server });
      },
    );
  }
  async list(token: string, org: string, environment: string, cursor?: string) {
    return this.#scope(
      token,
      org,
      environment,
      "server:read",
      async (c, _p, a) => {
        if (
          cursor &&
          !(
            await c.query(
              "select id from minecraft_servers where organization_id=$1 and environment_id=$2 and id=$3",
              [org, environment, z.uuid().parse(cursor)],
            )
          ).rowCount
        )
          denied("CURSOR_DENIED", 404);
        const rows = (
          await c.query<ServerRow>(
            "select * from minecraft_servers where organization_id=$1 and environment_id=$2 and ($3::uuid is null or id>$3) order by id limit 51",
            [org, environment, cursor ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map((r) => this.#view(r, a)),
          next_cursor: rows.length > 50 ? (rows[49]?.id ?? null) : null,
        };
      },
    );
  }
  async get(token: string, org: string, id: string) {
    const row = await this.#locate(token, org, id);
    return this.#scope(
      token,
      org,
      row.environment_id,
      "server:read",
      async (c, _p, a) => this.#view(await this.#server(c, org, id), a),
    );
  }
  async players(token: string, org: string, id: string) {
    const row = await this.#locate(token, org, id);
    return this.#scope(
      token,
      org,
      row.environment_id,
      "player:read",
      async (c) => {
        const r = await this.#server(c, org, id);
        const o = r.observation
          ? capturedObservation.parse(r.observation)
          : null;
        return playersView.parse({
          server_id: id,
          observed_at: o?.observed_at ?? null,
          freshness: this.#freshness(o),
          supported: o?.players !== null && o !== null,
          players: o?.players ?? null,
        });
      },
    );
  }
  async operation(token: string, org: string, id: string) {
    const row = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () =>
        this.#tx(org, async (c) => {
          const op = (
            await c.query<OperationRow>(
              "select * from management_operations where organization_id=$1 and id=$2",
              [org, z.uuid().parse(id)],
            )
          ).rows[0];
          if (!op) denied("NOT_FOUND", 404);
          return op;
        }),
    );
    return this.#scope(
      token,
      org,
      row.environment_id,
      "operation:read",
      async (c) => {
        const op = (
          await c.query<OperationRow>(
            "select * from management_operations where organization_id=$1 and id=$2",
            [org, id],
          )
        ).rows[0];
        if (!op) denied("NOT_FOUND", 404);
        return this.#op(op);
      },
    );
  }
}
