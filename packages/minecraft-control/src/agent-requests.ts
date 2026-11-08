import { createHash, randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  agentRequestAccepted,
  agentRequestDecision,
  agentRequestPage,
  agentRequestView,
  type ServerActionKind,
  type ServerActionRequest,
  serverActionRequest,
} from "@craftlayer/contracts";
import { type Authority, canAccess } from "@craftlayer/core";
import pg from "pg";
import { z } from "zod";
import { actionPermission, type ServerActions } from "./server-actions.js";

/**
 * Master plan C3. An AI agent asks for a typed server action; an adult with that
 * action's permission approves or declines. Approval creates the real server action
 * as the adult, so the audit shows both who asked and who allowed it. The agent never
 * executes anything, and the agent's reason text is shown to the adult as untrusted.
 */
function denied(code = "AGENT_REQUEST_CONFLICT", status = 409): never {
  throw new AuthError(
    status,
    code,
    "Agent request denied; refresh your authorized selection.",
  );
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const OPEN_LIMIT = 20,
  TTL_MS = 24 * 3600_000;
const reason = z
  .string()
  .trim()
  .max(280)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: shown to a parent as one plain line
  .regex(/^[^\u0000-\u001f\u007f]*$/)
  .default("");
const agentRequestInput = z.strictObject({
  action: serverActionRequest,
  reason,
});
interface ServerRow {
  id: string;
  project_id: string;
  environment_id: string;
  registered: boolean;
}
interface RequestRow {
  id: string;
  server_id: string;
  agent_id: string;
  agent_name: string;
  kind: ServerActionKind;
  request: ServerActionRequest;
  reason: string;
  state: "pending" | "approved" | "declined" | "cancelled" | "expired";
  decided_by: string | null;
  decided_at: Date | null;
  note: string | null;
  action_id: string | null;
  created_at: Date;
  expires_at: Date;
}
const iso = (d: Date | null) => d?.toISOString() ?? null;
export class AgentRequests {
  #pool: pg.Pool;
  #auth: IdentityService;
  #actions: Pick<ServerActions, "request">;
  #now: () => number;
  constructor(options: {
    databaseUrl: string;
    auth: IdentityService;
    actions: Pick<ServerActions, "request">;
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
    this.#actions = options.actions;
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
        "select pg_advisory_xact_lock(hashtextextended($1,74618031))",
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
  async #locate(token: string, org: string, serverId: string) {
    z.uuid().parse(serverId);
    return this.#auth.guardOrganization(token, org, "organization:read", () =>
      this.#tx(org, (c) => this.#server(c, org, serverId)),
    );
  }
  async #row(c: pg.PoolClient, org: string, id: string, forUpdate = false) {
    const row = (
      await c.query<RequestRow>(
        `select r.id,r.server_id,r.agent_id,t.name as agent_name,r.kind,r.request,r.reason,r.state,r.decided_by,r.decided_at,r.note,r.action_id,r.created_at,r.expires_at from minecraft_agent_requests r join agent_tokens t on t.organization_id=r.organization_id and t.id=r.agent_id where r.organization_id=$1 and r.id=$2${forUpdate ? " for update of r" : ""}`,
        [org, id],
      )
    ).rows[0];
    if (!row) denied("NOT_FOUND", 404);
    return row;
  }
  #view(row: RequestRow, canDecide: boolean) {
    return agentRequestView.parse({
      id: row.id,
      server_id: row.server_id,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      kind: row.kind,
      request: row.request,
      reason: row.reason,
      state: row.state,
      decided_at: iso(row.decided_at),
      note: row.note,
      action_id: row.action_id,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      can_decide: canDecide && row.state === "pending",
    });
  }
  #canDecide(
    p: Principal,
    a: Authority,
    server: ServerRow,
    kind: ServerActionKind,
  ) {
    return (
      !p.agent &&
      p.user.account_type === "adult" &&
      canAccess(a, actionPermission[kind], {
        kind: "environment",
        id: server.environment_id,
        projectId: server.project_id,
        environmentType: "minecraft",
      })
    );
  }
  async #audit(
    c: pg.PoolClient,
    org: string,
    p: Principal,
    action: string,
    serverId: string,
    details: Record<string, string | boolean>,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [
        org,
        p.user.id,
        action,
        serverId,
        { ...details, ...(p.agent ? { agent_id: p.agent.id } : {}) },
      ],
    );
  }
  async #outbox(c: pg.PoolClient, org: string, id: string, event: string) {
    await c.query(
      "insert into minecraft_agent_request_outbox(id,organization_id,request_id,event,schema_version) values($1,$2,$3,$4,1)",
      [randomUUID(), org, id, event],
    );
  }

  /** Only an agent may ask, only for kinds its token carries, only where it can read the server. */
  async request(
    token: string,
    org: string,
    serverId: string,
    input: unknown,
    key: string,
  ) {
    const value = agentRequestInput.parse(input);
    z.uuid().parse(key);
    const located = await this.#locate(token, org, serverId);
    return this.#auth.guardResource(
      token,
      org,
      "server:read",
      { kind: "environment", id: located.environment_id },
      (p) =>
        this.#tx(org, async (c) => {
          if (!p.agent) denied("AGENT_ONLY", 403);
          if (!p.agent.mayRequest.includes(value.action.kind))
            denied("AGENT_MAY_NOT_REQUEST", 403);
          const server = await this.#server(c, org, serverId);
          if (!server.registered) denied("SERVER_NOT_REGISTERED");
          const body = { server_id: serverId, ...value };
          const replay = (
            await c.query<RequestRow & { request_hash: string }>(
              "select r.id,r.server_id,r.agent_id,t.name as agent_name,r.kind,r.request,r.request_hash,r.reason,r.state,r.decided_by,r.decided_at,r.note,r.action_id,r.created_at,r.expires_at from minecraft_agent_requests r join agent_tokens t on t.organization_id=r.organization_id and t.id=r.agent_id where r.organization_id=$1 and r.agent_id=$2 and r.request_key=$3",
              [org, p.agent.id, key],
            )
          ).rows[0];
          if (replay) {
            if (replay.request_hash !== hash(body))
              denied("IDEMPOTENCY_CONFLICT");
            return agentRequestAccepted.parse({
              request_id: replay.id,
              server_id: serverId,
              state: replay.state,
            });
          }
          const open = (
            await c.query<{ n: number }>(
              "select count(*)::int n from minecraft_agent_requests where organization_id=$1 and agent_id=$2 and state='pending'",
              [org, p.agent.id],
            )
          ).rows[0];
          if ((open?.n ?? 0) >= OPEN_LIMIT) denied("AGENT_REQUEST_LIMIT", 429);
          const now = new Date(this.#now()),
            id = randomUUID();
          await c.query(
            "insert into minecraft_agent_requests(id,organization_id,project_id,environment_id,server_id,agent_id,created_by,request_key,kind,request,request_hash,reason,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
            [
              id,
              org,
              server.project_id,
              server.environment_id,
              serverId,
              p.agent.id,
              p.user.id,
              key,
              value.action.kind,
              JSON.stringify(value.action),
              hash(body),
              value.reason,
              now,
              new Date(now.getTime() + TTL_MS),
            ],
          );
          await this.#outbox(c, org, id, "requested");
          await this.#audit(
            c,
            org,
            p,
            "server.agent_request_created",
            serverId,
            { request_id: id, kind: value.action.kind },
          );
          return agentRequestAccepted.parse({
            request_id: id,
            server_id: serverId,
            state: "pending",
          });
        }),
    );
  }
  /** Adults see every request for a server they can read; an agent sees only its own. */
  async list(token: string, org: string, serverId: string) {
    const located = await this.#locate(token, org, serverId);
    return this.#auth.guardResource(
      token,
      org,
      "server:read",
      { kind: "environment", id: located.environment_id },
      (p, a) =>
        this.#tx(org, async (c) => {
          const server = await this.#server(c, org, serverId);
          const rows = (
            await c.query<RequestRow>(
              `select r.id,r.server_id,r.agent_id,t.name as agent_name,r.kind,r.request,r.reason,r.state,r.decided_by,r.decided_at,r.note,r.action_id,r.created_at,r.expires_at from minecraft_agent_requests r join agent_tokens t on t.organization_id=r.organization_id and t.id=r.agent_id where r.organization_id=$1 and r.server_id=$2${p.agent ? " and r.agent_id=$3" : ""} order by r.created_at desc limit 100`,
              p.agent ? [org, serverId, p.agent.id] : [org, serverId],
            )
          ).rows;
          return agentRequestPage.parse({
            server_id: serverId,
            items: rows.map((r) =>
              this.#view(r, this.#canDecide(p, a, server, r.kind)),
            ),
          });
        }),
    );
  }
  /** Approve (creates the real action as the deciding adult) or decline. Agents cannot decide.
   * Authorization completes before the action is requested: nesting identity guards would
   * block on the session row the outer guard holds. */
  async decide(token: string, org: string, id: string, input: unknown) {
    const value = agentRequestDecision.parse(input);
    z.uuid().parse(id);
    const located = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#row(c, org, id)),
    );
    const server = await this.#locate(token, org, located.server_id);
    const { p, a } = await this.#auth.guardResource(
      token,
      org,
      actionPermission[located.kind],
      { kind: "environment", id: server.environment_id },
      async (p, a) => ({ p, a }),
    );
    if (p.agent) denied("AGENT_DENIED", 403);
    if (p.user.account_type !== "adult") denied("ADULT_ONLY", 403);
    let actionId: string | null = null;
    if (value.decision === "approve") {
      const row = await this.#tx(org, (c) => this.#row(c, org, id));
      if (row.state !== "pending") denied("AGENT_REQUEST_NOT_PENDING");
      if (row.expires_at.getTime() <= this.#now())
        denied("AGENT_REQUEST_EXPIRED");
      // The real action is created under the adult's own authority, idempotent on the request ID.
      actionId = (
        await this.#actions.request(
          token,
          org,
          row.server_id,
          row.request,
          row.id,
        )
      ).action_id;
    }
    return this.#tx(org, async (c) => {
      const row = await this.#row(c, org, id, true);
      if (row.state !== "pending") denied("AGENT_REQUEST_NOT_PENDING");
      const now = new Date(this.#now());
      await c.query(
        "update minecraft_agent_requests set state=$3,decided_by=$4,decided_at=$5,note=$6,action_id=$7,version=version+1 where organization_id=$1 and id=$2",
        [
          org,
          id,
          value.decision === "approve" ? "approved" : "declined",
          p.user.id,
          now,
          value.note ?? null,
          actionId,
        ],
      );
      await this.#outbox(
        c,
        org,
        id,
        value.decision === "approve" ? "approved" : "declined",
      );
      await this.#audit(
        c,
        org,
        p,
        value.decision === "approve"
          ? "server.agent_request_approved"
          : "server.agent_request_declined",
        row.server_id,
        {
          request_id: id,
          kind: row.kind,
          requesting_agent_id: row.agent_id,
          ...(actionId ? { action_id: actionId } : {}),
        },
      );
      return this.#view(
        await this.#row(c, org, id),
        this.#canDecide(p, a, server, row.kind),
      );
    });
  }
  /** An agent may withdraw its own pending request. */
  async cancel(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const located = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#row(c, org, id)),
    );
    const server = await this.#locate(token, org, located.server_id);
    return this.#auth.guardResource(
      token,
      org,
      "server:read",
      { kind: "environment", id: server.environment_id },
      (p, a) =>
        this.#tx(org, async (c) => {
          const row = await this.#row(c, org, id, true);
          if (!p.agent || p.agent.id !== row.agent_id)
            denied("AGENT_REQUEST_NOT_OWN", 403);
          if (row.state !== "pending") denied("AGENT_REQUEST_NOT_PENDING");
          await c.query(
            "update minecraft_agent_requests set state='cancelled',decided_at=$3,version=version+1 where organization_id=$1 and id=$2",
            [org, id, new Date(this.#now())],
          );
          await this.#outbox(c, org, id, "cancelled");
          await this.#audit(
            c,
            org,
            p,
            "server.agent_request_cancelled",
            row.server_id,
            { request_id: id, kind: row.kind },
          );
          return this.#view(
            await this.#row(c, org, id),
            this.#canDecide(p, a, server, row.kind),
          );
        }),
    );
  }
  /** Composition-trusted: pending requests past their deadline are marked expired. */
  async expireStale(org: string) {
    return this.#tx(org, async (c) => {
      const now = new Date(this.#now());
      const rows = (
        await c.query<{ id: string }>(
          "update minecraft_agent_requests set state='expired',decided_at=$2,version=version+1 where organization_id=$1 and state='pending' and expires_at<=$2 returning id",
          [org, now],
        )
      ).rows;
      for (const r of rows) await this.#outbox(c, org, r.id, "expired");
      return rows.length;
    });
  }
}
