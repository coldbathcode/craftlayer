import { createHash, randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  type ServerActionKind,
  type ServerActionRequest,
  serverActionAccepted,
  serverActionEvidence,
  serverActionPage,
  serverActionRequest,
  serverActionView,
} from "@craftlayer/contracts";
import type { Authority, Permission } from "@craftlayer/core";
import pg from "pg";
import { z } from "zod";

/**
 * Master plan A3 (intake). Typed server actions as durable requests: an adult asks for
 * exactly one of a fixed set of game actions; the request is validated, permission
 * checked per kind, fenced per server, audited and stored `pending`. A bound node later
 * executes it through the private game-control channel and records the server's own
 * words as evidence. This service never touches a server itself, and the result
 * methods below have no HTTP surface.
 */
function denied(code = "ACTION_CONFLICT", status = 409): never {
  throw new AuthError(
    status,
    code,
    "Server action request denied; refresh your authorized selection.",
  );
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Which permission each action needs. Nothing maps to a raw command. */
export const actionPermission: Record<ServerActionKind, Permission> = {
  allow_player: "player:manage",
  revoke_player: "player:manage",
  kick_player: "player:manage",
  say: "server:control",
  save: "server:control",
  start: "server:control",
  stop: "server:control",
  restart: "server:control",
};
/** Lifecycle actions wait for everything else; nothing is queued behind a pending stop. */
const lifecycle = new Set<ServerActionKind>(["start", "stop", "restart"]);
const OPEN_LIMIT = 8,
  TTL_MS = 10 * 60_000;
interface ServerRow {
  id: string;
  project_id: string;
  environment_id: string;
  registered: boolean;
}
interface ActionRow {
  id: string;
  server_id: string;
  operation_id: string;
  kind: ServerActionKind;
  request: ServerActionRequest;
  state:
    | "pending"
    | "dispatched"
    | "succeeded"
    | "failed"
    | "expired"
    | "cancelled";
  failure_code: string;
  fence: number;
  evidence: z.infer<typeof serverActionEvidence> | null;
  version: number;
  created_at: Date;
  expires_at: Date;
  dispatched_at: Date | null;
  finished_at: Date | null;
}
const iso = (d: Date | null) => d?.toISOString() ?? null;
export class ServerActions {
  #pool: pg.Pool;
  #auth: IdentityService;
  #now: () => number;
  constructor(options: {
    databaseUrl: string;
    auth: IdentityService;
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
        "select pg_advisory_xact_lock(hashtextextended($1,74618030))",
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
  async #server(c: pg.PoolClient, org: string, id: string) {
    const row = (
      await c.query<ServerRow>(
        "select id,project_id,environment_id,registered from minecraft_servers where organization_id=$1 and id=$2 for share",
        [org, id],
      )
    ).rows[0];
    if (!row) denied("NOT_FOUND", 404);
    return row;
  }
  async #scoped<T>(
    token: string,
    org: string,
    serverId: string,
    permission: Permission,
    fn: (
      c: pg.PoolClient,
      p: Principal,
      a: Authority,
      server: ServerRow,
    ) => Promise<T>,
    adultOnly = true,
  ) {
    z.uuid().parse(serverId);
    const located = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#server(c, org, serverId)),
    );
    return this.#auth.guardResource(
      token,
      org,
      permission,
      { kind: "environment", id: located.environment_id },
      (p, a) =>
        this.#tx(org, async (c) => {
          const server = await this.#server(c, org, serverId);
          if (adultOnly && p.user.account_type !== "adult")
            denied("ACTION_ADULT_ONLY", 403);
          // Agents never act directly; C3 gives them requests an adult approves.
          if (adultOnly && p.agent) denied("AGENT_DENIED", 403);
          return fn(c, p, a, server);
        }),
    );
  }
  async #bound(c: pg.PoolClient, org: string, serverId: string) {
    return !!(
      await c.query(
        "select 1 from minecraft_reservations where organization_id=$1 and server_id=$2 and state='allocated' limit 1",
        [org, serverId],
      )
    ).rowCount;
  }
  #view(row: ActionRow, bound: boolean) {
    return serverActionView.parse({
      id: row.id,
      server_id: row.server_id,
      operation_id: row.operation_id,
      kind: row.kind,
      request: row.request,
      state: row.state,
      failure_code: row.failure_code,
      fence: row.fence,
      evidence: row.evidence,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      dispatched_at: iso(row.dispatched_at),
      finished_at: iso(row.finished_at),
      awaiting_node: row.state === "pending" && !bound,
      can_cancel: row.state === "pending",
    });
  }
  async #row(c: pg.PoolClient, org: string, id: string, forUpdate = false) {
    const row = (
      await c.query<ActionRow>(
        `select id,server_id,operation_id,kind,request,state,failure_code,fence,evidence,version,created_at,expires_at,dispatched_at,finished_at from minecraft_server_actions where organization_id=$1 and id=$2${forUpdate ? " for update" : ""}`,
        [org, id],
      )
    ).rows[0];
    if (!row) denied("NOT_FOUND", 404);
    return row;
  }
  async #event(
    c: pg.PoolClient,
    org: string,
    p: Principal,
    action: string,
    serverId: string,
    details: Record<string, string | boolean>,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [org, p.user.id, action, serverId, details],
    );
  }
  async #outbox(
    c: pg.PoolClient,
    org: string,
    actionId: string,
    event: string,
  ) {
    await c.query(
      "insert into minecraft_server_action_outbox(id,organization_id,action_id,event,schema_version) values($1,$2,$3,$4,1)",
      [randomUUID(), org, actionId, event],
    );
  }

  /** Validate, authorize per kind, fence and store a pending action. Idempotent by key. */
  async request(
    token: string,
    org: string,
    serverId: string,
    input: unknown,
    key: string,
  ) {
    const value = serverActionRequest.parse(input);
    z.uuid().parse(key);
    const permission = actionPermission[value.kind];
    return this.#scoped(
      token,
      org,
      serverId,
      permission,
      async (c, p, _a, server) => {
        if (!server.registered) denied("SERVER_NOT_REGISTERED");
        const body = { server_id: serverId, ...value };
        const replay = (
          await c.query<{ id: string; request_hash: string }>(
            "select id,request_hash from management_operations where organization_id=$1 and actor_id=$2 and kind='server_action' and request_key=$3",
            [org, p.user.id, key],
          )
        ).rows[0];
        if (replay) {
          if (replay.request_hash !== hash(body))
            denied("IDEMPOTENCY_CONFLICT");
          const existing = (
            await c.query<ActionRow>(
              "select id,server_id,operation_id,kind,request,state,failure_code,fence,evidence,version,created_at,expires_at,dispatched_at,finished_at from minecraft_server_actions where organization_id=$1 and operation_id=$2",
              [org, replay.id],
            )
          ).rows[0];
          if (!existing) denied("ACTION_RECEIPT_MISSING");
          return serverActionAccepted.parse({
            action_id: existing.id,
            operation_id: existing.operation_id,
            server_id: serverId,
            state: existing.state,
            awaiting_node:
              existing.state === "pending" &&
              !(await this.#bound(c, org, serverId)),
          });
        }
        const open = (
          await c.query<{ kind: ServerActionKind }>(
            "select kind from minecraft_server_actions where organization_id=$1 and server_id=$2 and state in ('pending','dispatched')",
            [org, serverId],
          )
        ).rows;
        if (open.length >= OPEN_LIMIT) denied("ACTION_QUEUE_FULL", 429);
        if (open.some((o) => lifecycle.has(o.kind)))
          denied("LIFECYCLE_ACTION_PENDING");
        if (lifecycle.has(value.kind) && open.length)
          denied("ACTIONS_STILL_OPEN");
        const now = new Date(this.#now()),
          operation = randomUUID(),
          id = randomUUID(),
          fence =
            (
              await c.query<{ next: number }>(
                "select coalesce(max(fence),0)+1 as next from minecraft_server_actions where organization_id=$1 and server_id=$2",
                [org, serverId],
              )
            ).rows[0]?.next ?? 1;
        await c.query(
          "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at) values($1,$2,$3,$4,$5,$6,$7,'server_action',$8,$9,'running',$10,$11,$12)",
          [
            operation,
            org,
            server.project_id,
            server.environment_id,
            serverId,
            p.user.id,
            p.sessionId,
            key,
            hash(body),
            fence,
            new Date(now.getTime() + TTL_MS),
            now,
          ],
        );
        await c.query(
          "insert into minecraft_server_actions(id,organization_id,project_id,environment_id,server_id,operation_id,actor_id,session_id,kind,request,request_hash,fence,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          [
            id,
            org,
            server.project_id,
            server.environment_id,
            serverId,
            operation,
            p.user.id,
            p.sessionId,
            value.kind,
            JSON.stringify(value),
            hash(body),
            fence,
            now,
            new Date(now.getTime() + TTL_MS),
          ],
        );
        await this.#outbox(c, org, id, "requested");
        await c.query(
          "insert into management_outbox(id,organization_id,operation_id,schema_version) values($1,$2,$3,1)",
          [randomUUID(), org, operation],
        );
        await this.#event(c, org, p, "server.action_requested", serverId, {
          operation_id: operation,
          action_id: id,
          kind: value.kind,
        });
        return serverActionAccepted.parse({
          action_id: id,
          operation_id: operation,
          server_id: serverId,
          state: "pending",
          awaiting_node: !(await this.#bound(c, org, serverId)),
        });
      },
    );
  }
  async list(token: string, org: string, serverId: string) {
    return this.#scoped(
      token,
      org,
      serverId,
      "server:read",
      async (c) => {
        const bound = await this.#bound(c, org, serverId);
        const rows = (
          await c.query<ActionRow>(
            "select id,server_id,operation_id,kind,request,state,failure_code,fence,evidence,version,created_at,expires_at,dispatched_at,finished_at from minecraft_server_actions where organization_id=$1 and server_id=$2 order by fence desc limit 100",
            [org, serverId],
          )
        ).rows;
        return serverActionPage.parse({
          server_id: serverId,
          items: rows.map((r) => this.#view(r, bound)),
        });
      },
      false,
    );
  }
  async get(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const located = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#row(c, org, id)),
    );
    return this.#scoped(
      token,
      org,
      located.server_id,
      "server:read",
      async (c) =>
        this.#view(
          await this.#row(c, org, id),
          await this.#bound(c, org, located.server_id),
        ),
      false,
    );
  }
  /** Only a pending action can be cancelled; dispatched work is finished by its node. */
  async cancel(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const located = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#row(c, org, id)),
    );
    return this.#scoped(
      token,
      org,
      located.server_id,
      actionPermission[located.kind],
      async (c, p) => {
        const row = await this.#row(c, org, id, true);
        if (row.state !== "pending") denied("ACTION_NOT_PENDING");
        const now = new Date(this.#now());
        await c.query(
          "update minecraft_server_actions set state='cancelled',failure_code='cancelled',finished_at=$3,version=version+1 where organization_id=$1 and id=$2",
          [org, id, now],
        );
        await c.query(
          "update management_operations set state='failed',failure_code='interrupted',finished_at=$3 where organization_id=$1 and id=$2 and state='running'",
          [org, row.operation_id, now],
        );
        await this.#outbox(c, org, id, "cancelled");
        await this.#event(
          c,
          org,
          p,
          "server.action_cancelled",
          located.server_id,
          { action_id: id, kind: row.kind },
        );
        return this.#view(
          await this.#row(c, org, id),
          await this.#bound(c, org, located.server_id),
        );
      },
    );
  }

  // Composition-trusted methods below: the node dispatch path, not HTTP.

  /** Oldest pending, unexpired action for a server, marked dispatched. */
  async claimNext(org: string, serverId: string) {
    z.uuid().parse(serverId);
    return this.#tx(org, async (c) => {
      const now = new Date(this.#now());
      const row = (
        await c.query<ActionRow>(
          "update minecraft_server_actions set state='dispatched',dispatched_at=$3,version=version+1 where organization_id=$1 and id=(select id from minecraft_server_actions where organization_id=$1 and server_id=$2 and state='pending' and expires_at>$3 order by fence limit 1 for update skip locked) returning id,server_id,operation_id,kind,request,state,failure_code,fence,evidence,version,created_at,expires_at,dispatched_at,finished_at",
          [org, serverId, now],
        )
      ).rows[0];
      if (row) await this.#outbox(c, org, row.id, "dispatched");
      return row ? this.#view(row, true) : null;
    });
  }
  /** The node's result: the server's own words, bounded. Success requires `ok`. */
  async recordResult(
    org: string,
    id: string,
    result: unknown,
    failure:
      | "server_unreachable"
      | "refused_by_server"
      | "not_verified"
      | "interrupted"
      | null = null,
  ) {
    const evidence = serverActionEvidence.parse(result);
    z.uuid().parse(id);
    return this.#tx(org, async (c) => {
      const row = await this.#row(c, org, id, true);
      if (row.state !== "dispatched") denied("ACTION_NOT_DISPATCHED");
      const now = new Date(this.#now()),
        succeeded = evidence.ok && failure === null;
      await c.query(
        "update minecraft_server_actions set state=$3,failure_code=$4,evidence=$5,finished_at=$6,version=version+1 where organization_id=$1 and id=$2",
        [
          org,
          id,
          succeeded ? "succeeded" : "failed",
          succeeded ? "none" : (failure ?? "not_verified"),
          JSON.stringify(evidence),
          now,
        ],
      );
      await c.query(
        "update management_operations set state=$3,failure_code=$4,finished_at=$5 where organization_id=$1 and id=$2 and state='running'",
        [
          org,
          row.operation_id,
          succeeded ? "succeeded" : "failed",
          succeeded ? "none" : "interrupted",
          now,
        ],
      );
      await this.#outbox(c, org, id, "finished");
      return this.#view(await this.#row(c, org, id), true);
    });
  }
  /** Pending or dispatched work past its deadline is marked expired; nothing is retried. */
  async expireStale(org: string) {
    return this.#tx(org, async (c) => {
      const now = new Date(this.#now());
      const rows = (
        await c.query<{ id: string; operation_id: string }>(
          "update minecraft_server_actions set state='expired',failure_code='expired',finished_at=$2,version=version+1 where organization_id=$1 and state in ('pending','dispatched') and expires_at<=$2 returning id,operation_id",
          [org, now],
        )
      ).rows;
      for (const r of rows) {
        await c.query(
          "update management_operations set state='failed',failure_code='interrupted',finished_at=$3 where organization_id=$1 and id=$2 and state='running'",
          [org, r.operation_id, now],
        );
        await this.#outbox(c, org, r.id, "expired");
      }
      return rows.length;
    });
  }
}
