import { AsyncLocalStorage } from "node:async_hooks";
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
  identityEnrollmentAccepted,
  identityEnrollmentPage,
  identityEnrollmentRequest,
  inventoryTarget,
  observationView,
  operationAccepted,
  operationView,
  pendingIdentityEnrollment,
  playersView,
  serverActivity,
  serverView,
  targetView,
} from "@craftlayer/contracts";
import { type Authority, canAccess, type Permission } from "@craftlayer/core";
import pg from "pg";
import { z } from "zod";

const requestContext = new AsyncLocalStorage<string>();
export function withManagementRequest<T>(id: string, fn: () => Promise<T>) {
  return requestContext.run(z.uuid().parse(id), fn);
}

export interface ObservationSource {
  list(organization: string, environment: string): Promise<InventoryTarget[]>;
  observe?(
    organization: string,
    environment: string,
    targetId: string,
  ): Promise<InventoryTarget>;
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
            source: o.source ?? "captured_inventory",
            freshness: this.#freshness(o),
            player_count:
              o.state === "unavailable"
                ? null
                : (o.reported_player_count ?? o.players?.length ?? null),
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
      [
        org,
        p.user.id,
        action,
        server,
        {
          operation_id: id,
          source: requestContext.getStore() ? "rest" : "internal",
          ...(requestContext.getStore()
            ? { request_id: requestContext.getStore() }
            : {}),
        },
      ],
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
  async #bounded<T>(read: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("SOURCE_TIMEOUT")), 2000);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async #load(org: string, environment: string) {
    try {
      return z
        .array(inventoryTarget)
        .max(100)
        .parse(await this.#bounded(() => this.#source.list(org, environment)))
        .filter(
          (t) => t.organization_id === org && t.environment_id === environment,
        );
    } catch {
      denied("SOURCE_UNAVAILABLE", 503);
    }
  }
  async #target(org: string, environment: string, id: string) {
    const target = (await this.#load(org, environment)).find(
      (t) => t.id === id,
    );
    if (!target) denied("TARGET_NOT_AVAILABLE", 404);
    if (Date.parse(target.observation.observed_at) > this.#now() + 5000)
      denied("SOURCE_UNAVAILABLE", 503);
    return target;
  }
  async targets(token: string, org: string, environment: string) {
    await this.#scope(token, org, environment, "server:adopt", async () => {});
    const targets = await this.#load(org, environment);
    return this.#scope(token, org, environment, "server:adopt", async () =>
      targets.map((t) =>
        targetView.parse({
          id: t.id,
          label: t.label,
          binding_hash: t.binding_hash,
          source: t.java_status ? "java_status" : "captured_inventory",
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
          source: t.java_status ? "java_status" : "captured_inventory",
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
        const existing = (
          await c.query<ServerRow>(
            "select * from minecraft_servers where organization_id=$1 and environment_id=$2 and (target_id=$3 or binding_hash=$4)",
            [org, v.environment_id, v.target_id, t.binding_hash],
          )
        ).rows[0];
        if (
          existing &&
          (existing.registered ||
            existing.target_id !== v.target_id ||
            existing.binding_hash !== t.binding_hash)
        )
          denied("ALREADY_REGISTERED");
        await this.#admit(c, org, v.environment_id, p.user.id);
        const server = existing?.id ?? randomUUID(),
          id = randomUUID(),
          now = new Date(this.#now());
        if (existing)
          await c.query(
            "update minecraft_servers set registered=true,name=$3,observation=$4,version=version+1,observation_fence=observation_fence+1 where organization_id=$1 and id=$2",
            [org, server, v.name, t.observation],
          );
        else
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
  /** Names are requests, never authenticated identities or implicit web/game bindings. */
  async enrollIdentity(
    token: string,
    org: string,
    id: string,
    input: unknown,
    key: string,
  ) {
    const request = identityEnrollmentRequest.parse(input),
      located = await this.#locate(token, org, id),
      body = { server_id: id, ...request };
    return this.#scope(
      token,
      org,
      located.environment_id,
      "player:enroll",
      async (c, p, _a, project) => {
        const row = await this.#server(c, org, id);
        const replay = await this.#replay(
          c,
          org,
          p.user.id,
          "identity_enroll",
          key,
          body,
        );
        if (replay) {
          const old = (
            await c.query<{ id: string }>(
              "select id from minecraft_identity_enrollments where organization_id=$1 and server_id=$2 and operation_id=$3",
              [org, id, replay.id],
            )
          ).rows[0];
          if (!old) denied("ENROLLMENT_RECEIPT_MISSING");
          return identityEnrollmentAccepted.parse({
            operation_id: replay.id,
            enrollment_id: old.id,
            server_id: id,
          });
        }
        if (!row.registered) denied("SERVER_NOT_REGISTERED");
        await this.#admit(c, org, row.environment_id, p.user.id);
        const count = (
          await c.query<{ total: number }>(
            "select count(*)::int total from minecraft_identity_enrollments where organization_id=$1 and server_id=$2",
            [org, id],
          )
        ).rows[0];
        if (!count || count.total >= 200) denied("ENROLLMENT_LIMIT", 429);
        const operation = randomUUID(),
          enrollment = randomUUID(),
          now = new Date(this.#now());
        await c.query(
          "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at,finished_at) values($1,$2,$3,$4,$5,$6,$7,'identity_enroll',$8,$9,'succeeded',0,$10,$10,$10)",
          [
            operation,
            org,
            project,
            row.environment_id,
            id,
            p.user.id,
            p.sessionId,
            key,
            managementHash(body),
            now,
          ],
        );
        await c.query(
          "insert into minecraft_identity_enrollments(id,organization_id,project_id,environment_id,server_id,requested_by,operation_id,edition,requested_name,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            enrollment,
            org,
            project,
            row.environment_id,
            id,
            p.user.id,
            operation,
            request.edition,
            request.requested_name,
            now,
            new Date(now.getTime() + 86400000),
          ],
        );
        await this.#event(
          c,
          org,
          p,
          operation,
          "server.identity_enrollment_requested",
          id,
        );
        return identityEnrollmentAccepted.parse({
          operation_id: operation,
          enrollment_id: enrollment,
          server_id: id,
        });
      },
    );
  }
  async identityEnrollments(
    token: string,
    org: string,
    id: string,
    cursor?: string,
  ) {
    const located = await this.#locate(token, org, id);
    return this.#scope(
      token,
      org,
      located.environment_id,
      "player:read",
      async (c) => {
        await this.#server(c, org, id);
        if (cursor) {
          z.uuid().parse(cursor);
          if (
            !(
              await c.query(
                "select 1 from minecraft_identity_enrollments where organization_id=$1 and server_id=$2 and id=$3",
                [org, id, cursor],
              )
            ).rowCount
          )
            denied("NOT_FOUND", 404);
        }
        const rows = (
          await c.query<{
            id: string;
            edition: string;
            requested_name: string;
            created_at: Date;
            expires_at: Date;
          }>(
            "select id,edition,requested_name,created_at,expires_at from minecraft_identity_enrollments where organization_id=$1 and server_id=$2 and ($3::uuid is null or id>$3) order by id limit 51",
            [org, id, cursor ?? null],
          )
        ).rows;
        return identityEnrollmentPage.parse({
          next_cursor: rows.length > 50 ? (rows[49]?.id ?? null) : null,
          items: rows.slice(0, 50).map((r) =>
            pendingIdentityEnrollment.parse({
              id: r.id,
              server_id: id,
              edition: r.edition,
              requested_name: r.requested_name,
              state: "pending",
              reason: "authenticated_bridge_unavailable",
              created_at: r.created_at.toISOString(),
              expires_at: r.expires_at.toISOString(),
              expired: r.expires_at.getTime() <= this.#now(),
              identity_verified: false,
              access_granted: false,
            }),
          ),
        });
      },
    );
  }
  async #admit(
    c: pg.PoolClient,
    org: string,
    environment: string,
    actor: string,
  ) {
    const count = (
      await c.query<{ total: number; recent: number }>(
        "select count(*)::int total,count(*) filter(where actor_id=$3 and created_at>$4)::int recent from management_operations where organization_id=$1 and environment_id=$2",
        [org, environment, actor, new Date(this.#now() - 60000)],
      )
    ).rows[0];
    if (!count || count.total >= 10000 || count.recent >= 12)
      denied("MANAGEMENT_LIMIT", 429);
  }
  async observe(
    token: string,
    org: string,
    id: string,
    expected: number,
    key: string,
  ) {
    z.number().int().positive().parse(expected);
    const located = await this.#locate(token, org, id);
    const prepared = await this.#scope(
      token,
      org,
      located.environment_id,
      "server:observe",
      async (c, p) => {
        const old = await this.#replay(c, org, p.user.id, "observe", key, {
          id,
          expected,
        });
        if (old) return { op: old, p, replay: true, row: located };
        const row = await this.#server(c, org, id);
        if (!row.registered || row.version !== expected)
          denied("VERSION_CONFLICT");
        await this.#admit(c, org, row.environment_id, p.user.id);
        const expired = (
          await c.query<{ id: string }>(
            "update management_operations set state='failed',failure_code='interrupted',finished_at=$3 where organization_id=$1 and server_id=$2 and state='running' and deadline<=$3 returning id",
            [org, id, new Date(this.#now())],
          )
        ).rows;
        for (const previous of expired)
          await this.#event(
            c,
            org,
            p,
            previous.id,
            "server.observation_failed",
            id,
          );
        const fence = row.observation_fence + 1,
          opId = randomUUID(),
          now = new Date(this.#now());
        await c.query(
          "update minecraft_servers set observation_fence=$3 where organization_id=$1 and id=$2",
          [org, id, fence],
        );
        const op = (
          await c.query<OperationRow>(
            "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at) values($1,$2,$3,$4,$5,$6,$7,'observe',$8,$9,'running',$10,$11,$12) returning *",
            [
              opId,
              org,
              row.project_id,
              row.environment_id,
              id,
              p.user.id,
              p.sessionId,
              key,
              managementHash({ id, expected }),
              fence,
              new Date(this.#now() + 5000),
              now,
            ],
          )
        ).rows[0];
        if (!op) denied();
        await this.#event(c, org, p, opId, "server.observation_requested", id);
        return {
          op,
          p,
          replay: false,
          row: { ...row, observation_fence: fence },
        };
      },
    );
    const receipt = operationAccepted.parse({
      operation_id: prepared.op.id,
      server_id: id,
    });
    if (prepared.replay) return receipt;
    let target: InventoryTarget;
    try {
      target = this.#source.observe
        ? inventoryTarget.parse(
            await this.#bounded(
              () =>
                this.#source.observe?.(
                  org,
                  located.environment_id,
                  prepared.row.target_id,
                ) as Promise<InventoryTarget>,
            ),
          )
        : await this.#target(
            org,
            located.environment_id,
            prepared.row.target_id,
          );
      if (
        target.organization_id !== org ||
        target.environment_id !== located.environment_id ||
        target.id !== prepared.row.target_id ||
        target.binding_hash !== prepared.row.binding_hash ||
        Date.parse(target.observation.observed_at) > this.#now() + 5000
      )
        throw new Error("SOURCE_CHANGED");
    } catch {
      await this.#finishFailed(
        org,
        prepared.op.id,
        id,
        prepared.p,
        "source_unavailable",
      );
      return receipt;
    }
    try {
      await this.#scope(
        token,
        org,
        located.environment_id,
        "server:observe",
        async (c, p) => {
          const row = await this.#server(c, org, id);
          const op = (
            await c.query<OperationRow>(
              "select * from management_operations where organization_id=$1 and id=$2 for update",
              [org, prepared.op.id],
            )
          ).rows[0];
          if (
            op?.state !== "running" ||
            op.deadline.getTime() <= this.#now() ||
            row.observation_fence !== prepared.row.observation_fence ||
            !row.registered
          )
            denied("OBSERVATION_FENCED");
          await c.query(
            "update minecraft_servers set observation=$3,version=version+1 where organization_id=$1 and id=$2",
            [org, id, target.observation],
          );
          await c.query(
            "update management_operations set state='succeeded',finished_at=$3 where organization_id=$1 and id=$2",
            [org, op.id, new Date(this.#now())],
          );
          await this.#event(
            c,
            org,
            p,
            op.id,
            "server.observation_recorded",
            id,
          );
        },
      );
    } catch {
      await this.#finishFailed(
        org,
        prepared.op.id,
        id,
        prepared.p,
        "authority_changed",
      );
    }
    return receipt;
  }
  async #finishFailed(
    org: string,
    op: string,
    server: string,
    p: Principal,
    code: "source_unavailable" | "authority_changed",
  ) {
    // Settlement records only the already-admitted canonical failed operation;
    // it grants no authority to update observations after actor revocation.
    await this.#tx(org, async (c) => {
      const changed = await c.query(
        "update management_operations set state='failed',failure_code=$3,finished_at=$4 where organization_id=$1 and id=$2 and state='running' returning id",
        [org, op, code, new Date(this.#now())],
      );
      if (changed.rowCount)
        await this.#event(c, org, p, op, "server.observation_failed", server);
    });
  }
  async unregister(
    token: string,
    org: string,
    id: string,
    expected: number,
    key: string,
  ) {
    z.number().int().positive().parse(expected);
    const located = await this.#locate(token, org, id);
    return this.#scope(
      token,
      org,
      located.environment_id,
      "server:adopt",
      async (c, p) => {
        const old = await this.#replay(c, org, p.user.id, "unregister", key, {
          id,
          expected,
        });
        if (old)
          return operationAccepted.parse({
            operation_id: old.id,
            server_id: id,
          });
        const row = await this.#server(c, org, id);
        if (!row.registered || row.version !== expected)
          denied("VERSION_CONFLICT");
        await this.#admit(c, org, row.environment_id, p.user.id);
        const op = randomUUID(),
          now = new Date(this.#now());
        await c.query(
          "update minecraft_servers set registered=false,version=version+1,observation_fence=observation_fence+1 where organization_id=$1 and id=$2",
          [org, id],
        );
        await c.query(
          "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at,finished_at) values($1,$2,$3,$4,$5,$6,$7,'unregister',$8,$9,'succeeded',$10,$11,$11,$11)",
          [
            op,
            org,
            row.project_id,
            row.environment_id,
            id,
            p.user.id,
            p.sessionId,
            key,
            managementHash({ id, expected }),
            row.observation_fence + 1,
            now,
          ],
        );
        await this.#event(c, org, p, op, "server.unregistered", id);
        return operationAccepted.parse({ operation_id: op, server_id: id });
      },
    );
  }
  async activity(token: string, org: string, id: string) {
    const row = await this.#locate(token, org, id);
    return this.#scope(
      token,
      org,
      row.environment_id,
      "audit:read",
      async (c) => {
        const rows = (
          await c.query<{
            action: string;
            created_at: Date;
            outcome: string;
            details: { operation_id: string };
          }>(
            "select action,created_at,outcome,details from audit_events where organization_id=$1 and target_id=$2 and action in ('server.adopted_read_only','server.observation_requested','server.observation_recorded','server.observation_failed','server.unregistered','server.identity_enrollment_requested') order by id desc limit 30",
            [org, id],
          )
        ).rows;
        return serverActivity.parse({
          items: rows.map((r) => ({
            action: r.action,
            occurred_at: r.created_at.toISOString(),
            outcome: r.outcome,
            operation_id: r.details.operation_id,
          })),
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

export {
  floodgateUuid,
  identityContinuity,
  normalizeAuthenticatedIdentity,
} from "./identity-policy.js";
export { InventoryFileSource } from "./inventory.js";

export { NodeControl } from "./nodes.js";
export { calculateProvisionPlan, familyTemplate } from "./provisioning.js";
