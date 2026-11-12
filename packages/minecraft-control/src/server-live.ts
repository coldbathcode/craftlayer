import { randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  knockAllowed,
  knockPage,
  knockView,
  type NodeKnock,
  nodeStatusReportRequest,
  type ServerActionRequest,
  type ServerPower,
  serverLiveView,
} from "@craftlayer/contracts";
import { type Authority, canAccess, type Permission } from "@craftlayer/core";
import pg from "pg";
import { z } from "zod";
import type { ServerActions } from "./server-actions.js";

/**
 * Master plan A2 and A4 (ADR 0046). What a bound host sees of its server: whether it
 * is on, who is playing, and who was refused at the door. The host reports over the
 * private link; people read it here and decide each knock. Allowing a knock creates
 * the ordinary `allow_player` action for exactly the account the server refused, so
 * nobody ever types an account number. Built without an identity service (the node
 * gateway) this class can only record reports.
 */
function denied(code = "LIVE_CONFLICT", status = 409): never {
  throw new AuthError(
    status,
    code,
    "Server status request denied; refresh your authorized selection.",
  );
}
/** A report older than this is the last known state, not the present. */
export const LIVE_FRESH_MS = 45_000;
const KNOCK_TTL_MS = 24 * 3600_000,
  /** An allowed account that is refused again after this long is asking again. */
  ALLOW_GRACE_MS = 2 * 60_000;
interface ServerRow {
  id: string;
  project_id: string;
  environment_id: string;
  registered: boolean;
}
interface LiveRow {
  power: ServerPower;
  online: number | null;
  max_players: number | null;
  players: string[] | null;
  reported_at: Date;
}
interface KnockRow {
  id: string;
  server_id: string;
  account_uuid: string;
  name: string;
  edition: "bedrock" | "java";
  xuid: string | null;
  first_at: Date;
  last_at: Date;
  attempts: number;
  state: "asking" | "allowed" | "ignored";
  decided_at: Date | null;
}
const knockColumns =
  "id,server_id,account_uuid,name,edition,xuid,first_at,last_at,attempts,state,decided_at";
/** The action that lets in exactly the account that knocked. Null when the recorded
 * name cannot be a real account name, which the server would refuse anyway. */
export function knockAllowRequest(knock: {
  name: string;
  edition: "bedrock" | "java";
  xuid: string | null;
}): ServerActionRequest | null {
  if (knock.edition === "java")
    return /^[A-Za-z0-9_]{1,16}$/.test(knock.name)
      ? {
          kind: "allow_player",
          player: { edition: "java", name: knock.name },
        }
      : null;
  if (!knock.xuid) return null;
  // The server shows a Bedrock player as a prefixed name with spaces replaced. The
  // account number decides who gets in; the gamertag is only the label on the list.
  const gamertag = knock.name
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .slice(0, 16)
    .trim();
  return gamertag
    ? {
        kind: "allow_player",
        player: { edition: "bedrock", gamertag, xuid: knock.xuid },
      }
    : null;
}
export class ServerLive {
  #pool: pg.Pool;
  #auth: IdentityService | undefined;
  #actions: Pick<ServerActions, "request"> | undefined;
  #now: () => number;
  constructor(options: {
    databaseUrl: string;
    auth?: IdentityService;
    actions?: Pick<ServerActions, "request">;
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
        "select id,project_id,environment_id,registered from minecraft_servers where organization_id=$1 and id=$2",
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
  ) {
    z.uuid().parse(serverId);
    const auth = this.#auth;
    if (!auth) denied("LIVE_USER_API_UNAVAILABLE", 503);
    const located = await auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#server(c, org, serverId)),
    );
    return auth.guardResource(
      token,
      org,
      permission,
      { kind: "environment", id: located.environment_id },
      (p, a) =>
        this.#tx(org, async (c) =>
          fn(c, p, a, await this.#server(c, org, serverId)),
        ),
    );
  }
  #mayDecide(p: Principal, a: Authority, server: ServerRow) {
    return (
      p.user.account_type === "adult" &&
      !p.agent &&
      canAccess(a, "player:manage", {
        kind: "environment",
        id: server.environment_id,
        projectId: server.project_id,
        environmentType: "minecraft",
      })
    );
  }
  #knock(row: KnockRow, canDecide: boolean) {
    return knockView.parse({
      id: row.id,
      server_id: row.server_id,
      name: row.name,
      edition: row.edition,
      first_at: row.first_at.toISOString(),
      last_at: row.last_at.toISOString(),
      attempts: row.attempts,
      state: row.state,
      can_decide: canDecide && row.state === "asking",
    });
  }

  /** Power and players as the host last reported them. */
  async live(token: string, org: string, serverId: string) {
    return this.#scoped(token, org, serverId, "server:read", async (c) => {
      const bound = !!(
        await c.query(
          "select 1 from minecraft_server_nodes where organization_id=$1 and server_id=$2 and released_at is null limit 1",
          [org, serverId],
        )
      ).rowCount;
      const row = (
        await c.query<LiveRow>(
          "select power,online,max_players,players,reported_at from minecraft_server_live where organization_id=$1 and server_id=$2",
          [org, serverId],
        )
      ).rows[0];
      return serverLiveView.parse({
        server_id: serverId,
        host_bound: bound,
        power: row?.power ?? "unknown",
        fresh:
          bound &&
          !!row &&
          this.#now() - row.reported_at.getTime() <= LIVE_FRESH_MS,
        reported_at: row?.reported_at.toISOString() ?? null,
        online: row?.online ?? null,
        max_players: row?.max_players ?? null,
        players: row?.players ?? null,
      });
    });
  }
  /** Accounts refused in the last 24 hours that nobody has decided yet. */
  async knocks(token: string, org: string, serverId: string) {
    return this.#scoped(
      token,
      org,
      serverId,
      "server:read",
      async (c, p, a, server) => {
        const rows = (
          await c.query<KnockRow>(
            `select ${knockColumns} from minecraft_server_knocks where organization_id=$1 and server_id=$2 and state='asking' and last_at>$3 order by last_at desc limit 50`,
            [org, serverId, new Date(this.#now() - KNOCK_TTL_MS)],
          )
        ).rows;
        const may = this.#mayDecide(p, a, server);
        return knockPage.parse({
          server_id: serverId,
          items: rows.map((r) => this.#knock(r, may)),
        });
      },
    );
  }
  async #locateKnock(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const auth = this.#auth;
    if (!auth) denied("LIVE_USER_API_UNAVAILABLE", 503);
    return auth.guardOrganization(token, org, "organization:read", () =>
      this.#tx(org, async (c) => {
        const row = (
          await c.query<KnockRow>(
            `select ${knockColumns} from minecraft_server_knocks where organization_id=$1 and id=$2`,
            [org, id],
          )
        ).rows[0];
        if (!row) denied("NOT_FOUND", 404);
        return row;
      }),
    );
  }
  async #decide(
    token: string,
    org: string,
    knock: KnockRow,
    state: "allowed" | "ignored",
    actionId: string | null,
  ) {
    return this.#scoped(
      token,
      org,
      knock.server_id,
      "player:manage",
      async (c, p, a, server) => {
        if (!this.#mayDecide(p, a, server)) denied("KNOCK_ADULT_ONLY", 403);
        const row = (
          await c.query<KnockRow>(
            `update minecraft_server_knocks set state=$3,decided_by=$4,decided_at=$5,action_id=$6 where organization_id=$1 and id=$2 and state='asking' returning ${knockColumns}`,
            [org, knock.id, state, p.user.id, new Date(this.#now()), actionId],
          )
        ).rows[0];
        if (!row) {
          // Already decided: the same answer again changes nothing.
          const current = (
            await c.query<KnockRow>(
              `select ${knockColumns} from minecraft_server_knocks where organization_id=$1 and id=$2`,
              [org, knock.id],
            )
          ).rows[0];
          if (!current || current.state !== state) denied("KNOCK_DECIDED");
          return this.#knock(current, false);
        }
        await c.query(
          "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
          [
            org,
            p.user.id,
            state === "allowed"
              ? "server.knock_allowed"
              : "server.knock_ignored",
            knock.server_id,
            {
              knock_id: knock.id,
              edition: knock.edition,
              ...(actionId ? { action_id: actionId } : {}),
            },
          ],
        );
        return this.#knock(row, false);
      },
    );
  }
  /** Lets in exactly the account that knocked, through the ordinary audited action. */
  async allowKnock(token: string, org: string, id: string, key: string) {
    z.uuid().parse(key);
    const actions = this.#actions;
    if (!actions) denied("LIVE_USER_API_UNAVAILABLE", 503);
    const knock = await this.#locateKnock(token, org, id);
    if (knock.state === "ignored") denied("KNOCK_DECIDED");
    if (knock.last_at.getTime() <= this.#now() - KNOCK_TTL_MS)
      denied("KNOCK_EXPIRED");
    const request = knockAllowRequest(knock);
    if (!request) denied("KNOCK_NAME_UNSUPPORTED", 422);
    // The action service checks the adult's permission and is idempotent by key.
    const action = await actions.request(
      token,
      org,
      knock.server_id,
      request,
      key,
    );
    return knockAllowed.parse({
      knock: await this.#decide(token, org, knock, "allowed", action.action_id),
      action,
    });
  }
  /** Hides the knock. The same account asks again only by trying again a day later. */
  async ignoreKnock(token: string, org: string, id: string) {
    const knock = await this.#locateKnock(token, org, id);
    return this.#decide(token, org, knock, "ignored", null);
  }

  // Node path. Called only by the private gateway after it has authenticated the
  // node. No HTTP surface.

  /** Records one server's report from the host bound to it; anyone else is refused. */
  async recordNodeReport(
    org: string,
    nodeId: string,
    input: {
      server_id: string;
      power: ServerPower;
      online: number | null;
      max_players: number | null;
      players: string[] | null;
      knocks: NodeKnock[];
    },
  ) {
    const v = nodeStatusReportRequest
      .pick({
        server_id: true,
        power: true,
        online: true,
        max_players: true,
        players: true,
        knocks: true,
      })
      .parse(input);
    z.uuid().parse(nodeId);
    return this.#tx(org, async (c) => {
      const bound = (
        await c.query(
          "select 1 from minecraft_server_nodes b join minecraft_nodes n on n.organization_id=b.organization_id and n.id=b.node_id join minecraft_servers s on s.organization_id=b.organization_id and s.id=b.server_id where b.organization_id=$1 and b.server_id=$2 and b.node_id=$3 and b.released_at is null and n.state='active' and s.registered for share of b",
          [org, v.server_id, nodeId],
        )
      ).rowCount;
      if (!bound) denied("STATUS_REPORT_DENIED", 403);
      const now = new Date(this.#now()),
        on = v.power === "on";
      await c.query(
        "insert into minecraft_server_live(organization_id,server_id,node_id,power,online,max_players,players,reported_at) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(organization_id,server_id) do update set node_id=excluded.node_id,power=excluded.power,online=excluded.online,max_players=excluded.max_players,players=excluded.players,reported_at=excluded.reported_at",
        [
          org,
          v.server_id,
          nodeId,
          v.power,
          on ? v.online : null,
          v.max_players,
          on && v.players ? JSON.stringify(v.players) : null,
          now,
        ],
      );
      for (const k of v.knocks) {
        const last = new Date(k.last_at);
        // Nothing from the future, nothing older than a day.
        if (
          last.getTime() > now.getTime() + 300_000 ||
          last.getTime() <= now.getTime() - KNOCK_TTL_MS
        )
          continue;
        const existing = (
          await c.query<KnockRow>(
            `select ${knockColumns} from minecraft_server_knocks where organization_id=$1 and server_id=$2 and account_uuid=$3 for update`,
            [org, v.server_id, k.account_uuid],
          )
        ).rows[0];
        if (!existing) {
          await c.query(
            "insert into minecraft_server_knocks(id,organization_id,server_id,account_uuid,name,edition,xuid,first_at,last_at,attempts) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [
              randomUUID(),
              org,
              v.server_id,
              k.account_uuid,
              k.name,
              k.edition,
              k.xuid,
              new Date(k.first_at),
              last,
              k.attempts,
            ],
          );
          continue;
        }
        if (last.getTime() <= existing.last_at.getTime()) continue;
        // A decided knock asks again only on a new refusal well after the decision.
        const wait =
          existing.state === "ignored" ? KNOCK_TTL_MS : ALLOW_GRACE_MS;
        const reopen =
          existing.state !== "asking" &&
          !!existing.decided_at &&
          last.getTime() > existing.decided_at.getTime() + wait;
        await c.query(
          `update minecraft_server_knocks set name=$3,last_at=$4,attempts=$5${reopen ? ",state='asking',decided_by=null,decided_at=null,action_id=null" : ""} where organization_id=$1 and id=$2`,
          [
            org,
            existing.id,
            k.name,
            last,
            Math.max(existing.attempts + 1, k.attempts),
          ],
        );
      }
    });
  }
}
