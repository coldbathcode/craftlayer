import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AuthError, type IdentityService } from "@craftlayer/auth";
import {
  type AiPlayerInput,
  type AiPlayerMemoryInput,
  type AiPlayerSpend,
  type AiPlayerTaskInput,
  type AiPlayerUpdate,
  aiPlayerAssignments,
  aiPlayerHostCreated,
  aiPlayerHostList,
  aiPlayerInput,
  aiPlayerInstruction,
  aiPlayerList,
  aiPlayerMemory,
  aiPlayerMemoryInput,
  aiPlayerMemoryList,
  aiPlayerObservation,
  aiPlayerPending,
  aiPlayerReport,
  aiPlayerSpend,
  aiPlayerTaskInput,
  aiPlayerThink,
  aiPlayerThought,
  aiPlayerTranscript,
  aiPlayerUpdate,
  aiPlayerView,
  aiPlayerWorkerMessages,
  type GenerateRequest,
  type GenerateResult,
  type ModelDescriptor,
} from "@craftlayer/contracts";
import {
  ceilingMicroUsd,
  type ModelChoice,
  maximumCost,
  ProviderError,
  RouterBlocked,
  type StandingAuthority,
} from "@craftlayer/providers";
import pg from "pg";
import { z } from "zod";

/**
 * Master plan G3 (ADR 0051, ADR 0053). AI players: profiles an adult owns, the worker
 * hosts that run their bodies, standing master tasks, bounded memory, the conversation
 * and per-player spending. A worker host never holds provider keys or game-server
 * authority: it asks this service for each model call, and the call runs on the owning
 * adult's current standing, limited to the chosen model and to the player's limits.
 */
export interface AiPlayerGateway {
  generateStanding(
    standing: StandingAuthority,
    choice: ModelChoice,
    request: GenerateRequest,
    signal?: AbortSignal,
  ): Promise<{ result: GenerateResult; attempts: number }>;
  refreshStanding(
    standing: StandingAuthority,
    connectionId: string,
  ): Promise<ModelDescriptor[]>;
  chosenModel(
    standing: StandingAuthority,
    choice: ModelChoice,
  ): Promise<ModelDescriptor | null>;
}

interface PlayerRow {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  persona: string;
  rules: string;
  owner_user_id: string;
  owner_membership_id: string;
  connection_id: string;
  model_id: string;
  host_id: string | null;
  game_host: string;
  game_port: number;
  game_version: string;
  mc_username: string;
  mc_auth: "offline" | "microsoft";
  instructors: unknown;
  daily_limit_micro: string;
  total_limit_micro: string;
  calls_per_hour: number;
  desired_state: "running" | "stopped";
  stop_latched: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}
interface TaskRow {
  id: string;
  player_id: string;
  title: string;
  goal: string;
  priority: number;
  condition: "always" | "owner_online" | "day" | "night";
  enabled: boolean;
}
interface HostRow {
  id: string;
  organization_id: string;
  label: string;
  created_at: Date;
  last_seen_at: Date | null;
  revoked_at: Date | null;
}
export interface HostIdentity {
  org: string;
  hostId: string;
}
export class AiPlayerRefusal extends AuthError {
  constructor(
    readonly reason:
      | "out_of_budget"
      | "stopped"
      | "rate_limited"
      | "model_unavailable"
      | "standing_revoked",
    message: string,
  ) {
    super(
      reason === "rate_limited" ? 429 : 409,
      `AI_PLAYER_${reason.toUpperCase()}`,
      message,
    );
  }
}

const STATUS_STALE_MS = 30_000;
const TRANSCRIPT_KEEP = 2000;
const PLAYER_MEMORY_KEEP = 400;
const TOKEN_PREFIX = "clah";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const iso = (d: Date) => d.toISOString();
function notFound(): never {
  throw new AuthError(404, "NOT_FOUND", "AI player not found.");
}
function conflict(message: string): never {
  throw new AuthError(409, "AI_PLAYER_CONFLICT", message);
}
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/**
 * The player's charge for one call: observed tokens at the reserved price snapshot,
 * with the same dimension rules as the ledger but without its floor at the reserved
 * maximum (the ledger books the worst case for the hourly limits; ADR 0053).
 */
export function pricedCall(
  model: ModelDescriptor,
  request: GenerateRequest,
  usage: GenerateResult["usage"],
): bigint | null {
  if (
    usage.quality !== "observed" ||
    usage.input_tokens === null ||
    usage.output_tokens === null
  )
    return null;
  const input = BigInt(usage.input_tokens),
    output = BigInt(usage.output_tokens);
  const units: Record<string, bigint> = {
    input,
    output,
    cache_read: input,
    cache_write: input,
    request: 1n,
    image: 0n,
    audio: 0n,
    reasoning: output,
    tool: request.tools.length ? 16n : 0n,
  };
  let total = 0n;
  for (const [key, count] of Object.entries(units)) {
    const price =
      model.pricing.dimensions[key as keyof typeof model.pricing.dimensions];
    if (!price) return null;
    total += ceilingMicroUsd(price.amount, 1n) * count;
  }
  return total;
}

export class AiPlayers {
  #pool: pg.Pool;
  #auth: IdentityService;
  #gateway: AiPlayerGateway;
  #now: () => number;
  constructor(options: {
    databaseUrl: string;
    auth: IdentityService;
    gateway: AiPlayerGateway;
    clock?: () => number;
  }) {
    if (new URL(options.databaseUrl).username !== "craftlayer_runtime")
      throw new Error("Restricted runtime role required");
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 4,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
    this.#auth = options.auth;
    this.#gateway = options.gateway;
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
  async #audit(
    c: pg.PoolClient,
    org: string,
    actor: string,
    action: string,
    target: string,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome) values($1,$2,$3,$4,'allowed')",
      [org, actor, action, target],
    );
  }
  async #player(c: pg.PoolClient, org: string, id: string, lock = false) {
    if (!z.uuid().safeParse(id).success) notFound();
    const row = (
      await c.query<PlayerRow>(
        `select * from ai_players where organization_id=$1 and id=$2${lock ? " for update" : ""}`,
        [org, id],
      )
    ).rows[0];
    return row ?? notFound();
  }
  /** Locate a player, then run under the adult's ai_player:manage in its project. */
  async #manage<T>(
    token: string,
    org: string,
    id: string,
    fn: (
      c: pg.PoolClient,
      actor: string,
      row: PlayerRow,
      login: string,
    ) => Promise<T>,
    permission: "ai_player:manage" | "ai_player:instruct" = "ai_player:manage",
  ): Promise<T> {
    const located = await this.#tx(org, (c) => this.#player(c, org, id));
    return this.#auth.guardResource(
      token,
      org,
      permission,
      { kind: "project", id: located.project_id },
      (p) =>
        this.#tx(org, async (c) => {
          const row = await this.#player(c, org, id, true);
          if (row.project_id !== located.project_id) notFound();
          return fn(c, p.user.id, row, p.user.login);
        }),
    );
  }
  #standing(row: PlayerRow): StandingAuthority {
    return {
      org: row.organization_id,
      userId: row.owner_user_id,
      membershipId: row.owner_membership_id,
      projectId: row.project_id,
    };
  }
  #choice(row: PlayerRow): ModelChoice {
    return { connection_id: row.connection_id, model_id: row.model_id };
  }

  async #tasks(c: pg.PoolClient, org: string, playerIds: string[]) {
    if (!playerIds.length) return new Map<string, TaskRow[]>();
    const rows = (
      await c.query<TaskRow>(
        "select id,player_id,title,goal,priority,condition,enabled from ai_player_tasks where organization_id=$1 and player_id=any($2) order by priority desc,created_at,id",
        [org, playerIds],
      )
    ).rows;
    const map = new Map<string, TaskRow[]>();
    for (const row of rows)
      map.set(row.player_id, [...(map.get(row.player_id) ?? []), row]);
    return map;
  }
  async #spend(
    c: pg.PoolClient,
    org: string,
    row: PlayerRow,
  ): Promise<AiPlayerSpend> {
    const now = this.#now(),
      day = utcDay(now);
    const totals = (
      await c.query<{
        total: string;
        total_reserved: string;
        today: string | null;
        today_reserved: string | null;
        calls: number | null;
        input: string | null;
        output: string | null;
      }>(
        "select coalesce(sum(used_micro),0)::text as total,coalesce(sum(reserved_micro),0)::text as total_reserved,max(case when day=$3 then used_micro end)::text as today,max(case when day=$3 then reserved_micro end)::text as today_reserved,max(case when day=$3 then calls end) as calls,max(case when day=$3 then input_tokens end)::text as input,max(case when day=$3 then output_tokens end)::text as output from ai_player_spend_days where organization_id=$1 and player_id=$2",
        [org, row.id, day],
      )
    ).rows[0];
    const hour = (
      await c.query<{ n: string }>(
        "select count(*)::text as n from ai_player_calls where organization_id=$1 and player_id=$2 and created_at>$3",
        [org, row.id, new Date(now - 3600_000)],
      )
    ).rows[0];
    const today = BigInt(totals?.today ?? "0"),
      todayReserved = BigInt(totals?.today_reserved ?? "0"),
      total = BigInt(totals?.total ?? "0"),
      totalReserved = BigInt(totals?.total_reserved ?? "0"),
      daily = BigInt(row.daily_limit_micro),
      overall = BigInt(row.total_limit_micro);
    const usedDay = today + todayReserved,
      usedAll = total + totalReserved;
    return aiPlayerSpend.parse({
      day,
      today_micro: today.toString(),
      today_reserved_micro: todayReserved.toString(),
      total_micro: total.toString(),
      daily_limit_micro: row.daily_limit_micro,
      total_limit_micro: row.total_limit_micro,
      calls_today: totals?.calls ?? 0,
      calls_last_hour: Number(hour?.n ?? 0),
      input_tokens_today: Number(totals?.input ?? 0),
      output_tokens_today: Number(totals?.output ?? 0),
      warning: usedDay * 5n >= daily * 4n || usedAll * 5n >= overall * 4n,
      exhausted: usedDay >= daily || usedAll >= overall,
    });
  }
  async #view(
    c: pg.PoolClient,
    org: string,
    row: PlayerRow,
    tasks?: TaskRow[],
  ) {
    const status = (
      await c.query<{ state: string; detail: unknown; reported_at: Date }>(
        "select state,detail,reported_at from ai_player_status where organization_id=$1 and player_id=$2",
        [org, row.id],
      )
    ).rows[0];
    const list =
      tasks ?? (await this.#tasks(c, org, [row.id])).get(row.id) ?? [];
    return aiPlayerView.parse({
      id: row.id,
      name: row.name,
      project_id: row.project_id,
      persona: row.persona,
      rules: row.rules,
      owner_user_id: row.owner_user_id,
      connection_id: row.connection_id,
      model_id: row.model_id,
      host_id: row.host_id,
      game_host: row.game_host,
      game_port: row.game_port,
      game_version: row.game_version,
      mc_username: row.mc_username,
      mc_auth: row.mc_auth,
      instructors: row.instructors,
      daily_limit_micro: row.daily_limit_micro,
      total_limit_micro: row.total_limit_micro,
      calls_per_hour: row.calls_per_hour,
      desired_state: row.desired_state,
      stop_latched: row.stop_latched,
      version: row.version,
      tasks: list.map(({ player_id: _p, ...t }) => t),
      status: status
        ? {
            state: status.state,
            detail: aiPlayerObservation.parse(status.detail),
            reported_at: iso(status.reported_at),
            stale: this.#now() - status.reported_at.getTime() > STATUS_STALE_MS,
          }
        : null,
      spend: await this.#spend(c, org, row),
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    });
  }

  // ---- Owner API ----------------------------------------------------------------

  async list(token: string, org: string) {
    return this.#auth.guardOrganization(token, org, "ai_player:manage", () =>
      this.#tx(org, async (c) => {
        const rows = (
          await c.query<PlayerRow>(
            "select * from ai_players where organization_id=$1 order by created_at,id limit 50",
            [org],
          )
        ).rows;
        const tasks = await this.#tasks(
          c,
          org,
          rows.map((r) => r.id),
        );
        const players = [];
        for (const row of rows)
          players.push(await this.#view(c, org, row, tasks.get(row.id) ?? []));
        return aiPlayerList.parse({ players });
      }),
    );
  }
  async get(token: string, org: string, id: string) {
    return this.#manage(token, org, id, (c, _actor, row) =>
      this.#view(c, org, row),
    );
  }
  /** The chosen model must be an approved model of an enabled connection right now. */
  async #checkModel(standing: StandingAuthority, choice: ModelChoice) {
    let model = await this.#gateway
      .chosenModel(standing, choice)
      .catch(() => null);
    if (!model) {
      await this.#gateway
        .refreshStanding(standing, choice.connection_id)
        .catch(() => []);
      model = await this.#gateway
        .chosenModel(standing, choice)
        .catch(() => null);
    }
    if (!model)
      throw new AuthError(
        409,
        "AI_PLAYER_MODEL_UNAVAILABLE",
        "That model is not available on that connection.",
      );
    if (model.capabilities.tools !== true)
      throw new AuthError(
        409,
        "AI_PLAYER_MODEL_NO_TOOLS",
        "That model cannot use tools, which an AI player needs.",
      );
  }
  async create(token: string, org: string, input: AiPlayerInput) {
    const value = aiPlayerInput.parse(input);
    const who = await this.#auth.authorize(token, org, "ai_player:manage", {
      kind: "project",
      id: value.project_id,
    });
    await this.#checkModel(
      {
        org,
        userId: who.userId,
        membershipId: who.membershipId,
        projectId: value.project_id,
      },
      { connection_id: value.connection_id, model_id: value.model_id },
    );
    return this.#auth.guardResource(
      token,
      org,
      "ai_player:manage",
      { kind: "project", id: value.project_id },
      (p) =>
        this.#tx(org, async (c) => {
          if (value.host_id) await this.#activeHost(c, org, value.host_id);
          const id = randomUUID();
          try {
            await c.query(
              "insert into ai_players(id,organization_id,project_id,name,persona,rules,owner_user_id,owner_membership_id,connection_id,model_id,host_id,game_host,game_port,game_version,mc_username,mc_auth,instructors,daily_limit_micro,total_limit_micro,calls_per_hour) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)",
              [
                id,
                org,
                value.project_id,
                value.name,
                value.persona,
                value.rules,
                p.user.id,
                who.membershipId,
                value.connection_id,
                value.model_id,
                value.host_id,
                value.game_host,
                value.game_port,
                value.game_version,
                value.mc_username,
                value.mc_auth,
                JSON.stringify(value.instructors),
                value.daily_limit_micro,
                value.total_limit_micro,
                value.calls_per_hour,
              ],
            );
          } catch (error) {
            if ((error as { code?: string }).code === "23505")
              conflict("An AI player with that name already exists.");
            throw error;
          }
          await this.#audit(c, org, p.user.id, "ai_player.created", id);
          return this.#view(c, org, await this.#player(c, org, id));
        }),
    );
  }
  async update(token: string, org: string, id: string, input: AiPlayerUpdate) {
    const value = aiPlayerUpdate.parse(input);
    const current = await this.get(token, org, id);
    if (value.connection_id !== undefined || value.model_id !== undefined) {
      const row = await this.#tx(org, (c) => this.#player(c, org, id));
      await this.#checkModel(this.#standing(row), {
        connection_id: value.connection_id ?? current.connection_id,
        model_id: value.model_id ?? current.model_id,
      });
    }
    return this.#manage(token, org, id, async (c, actor, row) => {
      if (row.version !== value.expected_version)
        throw new AuthError(
          409,
          "AI_PLAYER_VERSION_CONFLICT",
          "Refresh and try again.",
        );
      if (value.host_id) await this.#activeHost(c, org, value.host_id);
      const fields: Array<[string, unknown]> = [];
      const set = (column: string, v: unknown) => {
        if (v !== undefined) fields.push([column, v]);
      };
      set("name", value.name);
      set("persona", value.persona);
      set("rules", value.rules);
      set("connection_id", value.connection_id);
      set("model_id", value.model_id);
      set("host_id", value.host_id);
      set("game_host", value.game_host);
      set("game_port", value.game_port);
      set("game_version", value.game_version);
      set("mc_username", value.mc_username);
      set("mc_auth", value.mc_auth);
      set(
        "instructors",
        value.instructors === undefined
          ? undefined
          : JSON.stringify(value.instructors),
      );
      set("daily_limit_micro", value.daily_limit_micro);
      set("total_limit_micro", value.total_limit_micro);
      set("calls_per_hour", value.calls_per_hour);
      if (fields.length) {
        const sql = fields
          .map(
            ([column], i) =>
              `${column}=$${i + 3}${column === "instructors" ? "::jsonb" : ""}`,
          )
          .join(",");
        try {
          await c.query(
            `update ai_players set ${sql},version=version+1,updated_at=now() where organization_id=$1 and id=$2`,
            [org, id, ...fields.map(([, v]) => v)],
          );
        } catch (error) {
          if ((error as { code?: string }).code === "23505")
            conflict("An AI player with that name already exists.");
          throw error;
        }
        await this.#audit(c, org, actor, "ai_player.updated", id);
      }
      return this.#view(c, org, await this.#player(c, org, id));
    });
  }
  async remove(token: string, org: string, id: string) {
    return this.#manage(token, org, id, async (c, actor, row) => {
      if (row.desired_state === "running")
        conflict("Stop the AI player before removing it.");
      // Spending history goes with the player; the audit event stays.
      await c.query(
        "delete from ai_players where organization_id=$1 and id=$2",
        [org, id],
      );
      await this.#audit(c, org, actor, "ai_player.removed", id);
      return { removed: true as const };
    });
  }
  async setTasks(
    token: string,
    org: string,
    id: string,
    tasks: AiPlayerTaskInput[],
  ) {
    const list = z.array(aiPlayerTaskInput).max(32).parse(tasks);
    return this.#manage(token, org, id, async (c, actor) => {
      await c.query(
        "delete from ai_player_tasks where organization_id=$1 and player_id=$2",
        [org, id],
      );
      for (const t of list)
        await c.query(
          "insert into ai_player_tasks(id,organization_id,player_id,title,goal,priority,condition,enabled) values($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            org,
            id,
            t.title,
            t.goal,
            t.priority,
            t.condition,
            t.enabled,
          ],
        );
      await c.query(
        "update ai_players set version=version+1,updated_at=now() where organization_id=$1 and id=$2",
        [org, id],
      );
      await this.#audit(c, org, actor, "ai_player.tasks_changed", id);
      return this.#view(c, org, await this.#player(c, org, id));
    });
  }
  async start(token: string, org: string, id: string) {
    return this.#manage(token, org, id, async (c, actor, row) => {
      if (row.stop_latched)
        conflict(
          "This AI player was stopped. Clear the stop before starting it again.",
        );
      const hostId =
        row.host_id ??
        conflict("Choose the worker host that runs this AI player first.");
      await this.#activeHost(c, org, hostId);
      await c.query(
        "update ai_players set desired_state='running',version=version+1,updated_at=now() where organization_id=$1 and id=$2",
        [org, id],
      );
      await this.#system(c, org, id, "Started by an adult.");
      await this.#audit(c, org, actor, "ai_player.started", id);
      return this.#view(c, org, await this.#player(c, org, id));
    });
  }
  /** Stop latches: it outranks everything and only an adult clears it. */
  async stop(token: string, org: string, id: string) {
    return this.#manage(token, org, id, async (c, actor) => {
      await c.query(
        "update ai_players set desired_state='stopped',stop_latched=true,version=version+1,updated_at=now() where organization_id=$1 and id=$2",
        [org, id],
      );
      await this.#system(c, org, id, "Stopped by an adult.");
      await this.#audit(c, org, actor, "ai_player.stopped", id);
      return this.#view(c, org, await this.#player(c, org, id));
    });
  }
  async clearStop(token: string, org: string, id: string) {
    return this.#manage(token, org, id, async (c, actor) => {
      await c.query(
        "update ai_players set stop_latched=false,version=version+1,updated_at=now() where organization_id=$1 and id=$2",
        [org, id],
      );
      await this.#audit(c, org, actor, "ai_player.stop_cleared", id);
      return this.#view(c, org, await this.#player(c, org, id));
    });
  }
  async instruct(
    token: string,
    org: string,
    id: string,
    input: { body: string },
    channel: "dashboard" | "mcp" = "dashboard",
  ) {
    const value = aiPlayerInstruction.parse(input);
    return this.#manage(
      token,
      org,
      id,
      async (c, _actor, _row, login) => {
        const messageId = randomUUID();
        await this.#insertMessage(c, org, id, {
          id: messageId,
          direction: "instruction",
          channel,
          author: (channel === "mcp" ? `${login} (via AI agent)` : login).slice(
            0,
            64,
          ),
          body: value.body,
        });
        return { id: messageId };
      },
      channel === "mcp" ? "ai_player:instruct" : "ai_player:manage",
    );
  }
  async transcript(token: string, org: string, id: string, after = 0) {
    return this.#manage(token, org, id, async (c) => {
      const rows = (
        await c.query<{
          id: string;
          seq: string;
          direction: string;
          channel: string;
          author: string;
          body: string;
          delivered_at: Date | null;
          created_at: Date;
        }>(
          "select * from (select id,seq,direction,channel,author,body,delivered_at,created_at from ai_player_messages where organization_id=$1 and player_id=$2 and seq>$3 order by seq desc limit 200) m order by seq",
          [org, id, after],
        )
      ).rows;
      return aiPlayerTranscript.parse({
        messages: rows.map((r) => ({
          id: r.id,
          seq: Number(r.seq),
          direction: r.direction,
          channel: r.channel,
          author: r.author,
          body: r.body,
          delivered: r.delivered_at !== null,
          created_at: iso(r.created_at),
        })),
      });
    });
  }
  async memories(token: string, org: string, id: string) {
    return this.#manage(token, org, id, (c) => this.#memoryList(c, org, id));
  }
  async addMemory(
    token: string,
    org: string,
    id: string,
    input: AiPlayerMemoryInput,
  ) {
    const value = aiPlayerMemoryInput.parse(input);
    return this.#manage(token, org, id, async (c, actor) => {
      const memory = await this.#insertMemory(c, org, id, value, "owner");
      await this.#audit(c, org, actor, "ai_player.memory_added", id);
      return memory;
    });
  }
  async forgetMemory(token: string, org: string, id: string, memoryId: string) {
    z.uuid().parse(memoryId);
    return this.#manage(token, org, id, async (c, actor) => {
      const gone = await c.query(
        "delete from ai_player_memories where organization_id=$1 and player_id=$2 and id=$3",
        [org, id, memoryId],
      );
      if (!gone.rowCount) notFound();
      await this.#audit(c, org, actor, "ai_player.memory_forgotten", id);
      return { forgotten: true as const };
    });
  }

  // ---- AI agents (MCP, ai_player:instruct) ------------------------------------

  /** The AI players an agent may instruct: only those in projects its token reaches. */
  async agentList(token: string, org: string) {
    const rows = await this.#tx(
      org,
      async (c) =>
        (
          await c.query<PlayerRow>(
            "select * from ai_players where organization_id=$1 order by created_at,id limit 50",
            [org],
          )
        ).rows,
    );
    const allowed = new Set<string>();
    for (const project of new Set(rows.map((r) => r.project_id))) {
      try {
        await this.#auth.authorize(token, org, "ai_player:instruct", {
          kind: "project",
          id: project,
        });
        allowed.add(project);
      } catch (error) {
        if (!(error instanceof AuthError) || ![403, 404].includes(error.status))
          throw error;
      }
    }
    if (rows.length && !allowed.size)
      throw new AuthError(
        403,
        "PERMISSION_DENIED",
        "You do not have permission for this action.",
      );
    if (!rows.length)
      await this.#auth.authorize(token, org, "organization:read", {
        kind: "organization",
        id: org,
      });
    return this.#tx(org, async (c) => {
      const visible = rows.filter((r) => allowed.has(r.project_id));
      const tasks = await this.#tasks(
        c,
        org,
        visible.map((r) => r.id),
      );
      const players = [];
      for (const row of visible)
        players.push(await this.#view(c, org, row, tasks.get(row.id) ?? []));
      return aiPlayerList.parse({ players });
    });
  }
  async agentTranscript(token: string, org: string, id: string, after = 0) {
    return this.#manage(
      token,
      org,
      id,
      async (c) => {
        const rows = (
          await c.query<{
            id: string;
            seq: string;
            direction: string;
            channel: string;
            author: string;
            body: string;
            delivered_at: Date | null;
            created_at: Date;
          }>(
            "select * from (select id,seq,direction,channel,author,body,delivered_at,created_at from ai_player_messages where organization_id=$1 and player_id=$2 and seq>$3 order by seq desc limit 100) m order by seq",
            [org, id, after],
          )
        ).rows;
        return aiPlayerTranscript.parse({
          messages: rows.map((r) => ({
            id: r.id,
            seq: Number(r.seq),
            direction: r.direction,
            channel: r.channel,
            author: r.author,
            body: r.body,
            delivered: r.delivered_at !== null,
            created_at: iso(r.created_at),
          })),
        });
      },
      "ai_player:instruct",
    );
  }
  /** An agent may stop an AI player (never start it). The stop latches like an adult's. */
  async agentStop(token: string, org: string, id: string) {
    return this.#manage(
      token,
      org,
      id,
      async (c, actor) => {
        await c.query(
          "update ai_players set desired_state='stopped',stop_latched=true,version=version+1,updated_at=now() where organization_id=$1 and id=$2",
          [org, id],
        );
        await this.#system(
          c,
          org,
          id,
          "Stopped by an AI agent acting for an adult.",
        );
        await this.#audit(c, org, actor, "ai_player.stopped", id);
        return this.#view(c, org, await this.#player(c, org, id));
      },
      "ai_player:instruct",
    );
  }

  // ---- Worker hosts ----------------------------------------------------------------

  async createHost(token: string, org: string, label: string) {
    const name = z.string().trim().min(1).max(80).parse(label);
    return this.#auth.guardOrganization(token, org, "ai_player:manage", (p) =>
      this.#tx(org, async (c) => {
        const id = randomUUID(),
          secret = `${TOKEN_PREFIX}_${org}_${id}_${randomBytes(32).toString("base64url")}`;
        await c.query(
          "insert into ai_player_hosts(id,organization_id,label,token_hash,created_by) values($1,$2,$3,$4,$5)",
          [id, org, name, sha(secret), p.user.id],
        );
        await this.#audit(c, org, p.user.id, "ai_player.host_created", id);
        const row = (
          await c.query<HostRow>(
            "select * from ai_player_hosts where organization_id=$1 and id=$2",
            [org, id],
          )
        ).rows[0];
        if (!row) notFound();
        return aiPlayerHostCreated.parse({
          ...this.#hostView(row as HostRow),
          token: secret,
        });
      }),
    );
  }
  async listHosts(token: string, org: string) {
    return this.#auth.guardOrganization(token, org, "ai_player:manage", () =>
      this.#tx(org, async (c) =>
        aiPlayerHostList.parse({
          hosts: (
            await c.query<HostRow>(
              "select * from ai_player_hosts where organization_id=$1 order by created_at,id limit 20",
              [org],
            )
          ).rows.map((r) => this.#hostView(r)),
        }),
      ),
    );
  }
  async revokeHost(token: string, org: string, hostId: string) {
    z.uuid().parse(hostId);
    return this.#auth.guardOrganization(token, org, "ai_player:manage", (p) =>
      this.#tx(org, async (c) => {
        const done = await c.query(
          "update ai_player_hosts set revoked_at=now(),revoked_by=$3 where organization_id=$1 and id=$2 and revoked_at is null",
          [org, hostId, p.user.id],
        );
        if (!done.rowCount) notFound();
        // Its players stop; they need a new host and an adult start.
        await c.query(
          "update ai_players set desired_state='stopped',host_id=null,version=version+1,updated_at=now() where organization_id=$1 and host_id=$2",
          [org, hostId],
        );
        await this.#audit(c, org, p.user.id, "ai_player.host_revoked", hostId);
        return { revoked: true as const };
      }),
    );
  }
  #hostView(row: HostRow) {
    return {
      id: row.id,
      label: row.label,
      created_at: iso(row.created_at),
      last_seen_at: row.last_seen_at ? iso(row.last_seen_at) : null,
      revoked: row.revoked_at !== null,
    };
  }
  async #activeHost(c: pg.PoolClient, org: string, hostId: string) {
    const ok = await c.query(
      "select 1 from ai_player_hosts where organization_id=$1 and id=$2 and revoked_at is null",
      [org, hostId],
    );
    if (!ok.rowCount)
      conflict("That worker host does not exist or was revoked.");
  }
  /** Resolves a worker host token. The organization is part of the token, never trusted alone. */
  async host(token: string): Promise<HostIdentity> {
    const match =
      /^clah_([0-9a-f-]{36})_([0-9a-f-]{36})_[A-Za-z0-9_-]{43}$/.exec(token);
    const fail = () => {
      throw new AuthError(
        401,
        "UNAUTHENTICATED",
        "Worker host token is invalid or revoked.",
      );
    };
    if (!match?.[1] || !match[2]) return fail();
    const org = match[1],
      hostId = match[2];
    if (!z.uuid().safeParse(org).success || !z.uuid().safeParse(hostId).success)
      return fail();
    return this.#tx(org, async (c) => {
      const row = (
        await c.query<{ id: string; last_seen_at: Date | null }>(
          "select id,last_seen_at from ai_player_hosts where organization_id=$1 and id=$2 and token_hash=$3 and revoked_at is null",
          [org, hostId, sha(token)],
        )
      ).rows[0];
      if (!row) return fail();
      if (
        !row.last_seen_at ||
        this.#now() - row.last_seen_at.getTime() > 15_000
      )
        await c.query(
          "update ai_player_hosts set last_seen_at=$3 where organization_id=$1 and id=$2",
          [org, hostId, new Date(this.#now())],
        );
      return { org, hostId };
    });
  }
  async #hosted(
    c: pg.PoolClient,
    host: HostIdentity,
    playerId: string,
    lock = false,
  ) {
    const row = await this.#player(c, host.org, playerId, lock);
    if (row.host_id !== host.hostId) notFound();
    return row;
  }
  async assignments(host: HostIdentity) {
    return this.#tx(host.org, async (c) => {
      const rows = (
        await c.query<PlayerRow>(
          "select * from ai_players where organization_id=$1 and host_id=$2 order by created_at,id limit 20",
          [host.org, host.hostId],
        )
      ).rows;
      const tasks = await this.#tasks(
        c,
        host.org,
        rows.map((r) => r.id),
      );
      return aiPlayerAssignments.parse({
        players: rows.map((r) => ({
          id: r.id,
          name: r.name,
          persona: r.persona,
          rules: r.rules,
          model_id: r.model_id,
          game_host: r.game_host,
          game_port: r.game_port,
          game_version: r.game_version,
          mc_username: r.mc_username,
          mc_auth: r.mc_auth,
          instructors: r.instructors,
          tasks: (tasks.get(r.id) ?? []).map(({ player_id: _p, ...t }) => t),
          run: r.desired_state === "running" && !r.stop_latched,
          version: r.version,
        })),
        poll_after_ms: 2000,
      });
    });
  }
  async report(host: HostIdentity, playerId: string, input: unknown) {
    const value = aiPlayerReport.parse(input);
    return this.#tx(host.org, async (c) => {
      await this.#hosted(c, host, playerId);
      await c.query(
        "insert into ai_player_status(organization_id,player_id,state,detail,reported_at) values($1,$2,$3,$4::jsonb,$5) on conflict(organization_id,player_id) do update set state=excluded.state,detail=excluded.detail,reported_at=excluded.reported_at",
        [
          host.org,
          playerId,
          value.state,
          JSON.stringify(value.detail),
          new Date(this.#now()),
        ],
      );
      return { ok: true as const };
    });
  }
  /** Hands over waiting instructions once. A stopped player receives none. */
  async pending(host: HostIdentity, playerId: string) {
    return this.#tx(host.org, async (c) => {
      const row = await this.#hosted(c, host, playerId, true);
      if (row.desired_state !== "running" || row.stop_latched)
        return aiPlayerPending.parse({ instructions: [] });
      const rows = (
        await c.query<{
          id: string;
          channel: string;
          author: string;
          body: string;
          created_at: Date;
        }>(
          "update ai_player_messages set delivered_at=$3 where organization_id=$1 and seq in (select seq from ai_player_messages where organization_id=$1 and player_id=$2 and direction='instruction' and delivered_at is null order by seq limit 20 for update skip locked) returning id,channel,author,body,created_at",
          [host.org, playerId, new Date(this.#now())],
        )
      ).rows;
      return aiPlayerPending.parse({
        instructions: rows
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
          .map((r) => ({ ...r, created_at: iso(r.created_at) })),
      });
    });
  }
  async post(host: HostIdentity, playerId: string, input: unknown) {
    const value = aiPlayerWorkerMessages.parse(input);
    return this.#tx(host.org, async (c) => {
      await this.#hosted(c, host, playerId);
      for (const m of value.messages)
        await this.#insertMessage(c, host.org, playerId, {
          id: randomUUID(),
          ...m,
        });
      return { ok: true as const };
    });
  }
  /** In-game chat from one of the owner's identities becomes an instruction. */
  async ownerChat(
    host: HostIdentity,
    playerId: string,
    author: string,
    body: string,
  ) {
    const text = aiPlayerInstruction.parse({ body }).body;
    return this.#tx(host.org, async (c) => {
      await this.#hosted(c, host, playerId);
      const id = randomUUID();
      await this.#insertMessage(c, host.org, playerId, {
        id,
        direction: "instruction",
        channel: "game",
        author: z.string().trim().min(1).max(64).parse(author),
        body: text,
      });
      // The worker acts on it directly; mark delivered so it is not handed over twice.
      await c.query(
        "update ai_player_messages set delivered_at=$3 where organization_id=$1 and id=$2",
        [host.org, id, new Date(this.#now())],
      );
      return { id };
    });
  }
  async memoriesFor(host: HostIdentity, playerId: string) {
    return this.#tx(host.org, async (c) => {
      await this.#hosted(c, host, playerId);
      return this.#memoryList(c, host.org, playerId);
    });
  }
  async remember(host: HostIdentity, playerId: string, input: unknown) {
    const value = aiPlayerMemoryInput.parse(input);
    return this.#tx(host.org, async (c) => {
      await this.#hosted(c, host, playerId);
      const memory = await this.#insertMemory(
        c,
        host.org,
        playerId,
        value,
        "player",
      );
      // Keep the player's own memories bounded; the owner's notes are never pruned.
      await c.query(
        "delete from ai_player_memories where organization_id=$1 and player_id=$2 and source='player' and id in (select id from ai_player_memories where organization_id=$1 and player_id=$2 and source='player' order by created_at desc offset $3)",
        [host.org, playerId, PLAYER_MEMORY_KEEP],
      );
      return memory;
    });
  }

  /**
   * One model call for a player: reserve the worst case against its daily and total
   * limits, call the chosen model on the owner's standing, settle with the ledger's
   * charge. An unknown outcome keeps the worst case as spent.
   */
  async think(host: HostIdentity, playerId: string, input: unknown) {
    const value = aiPlayerThink.parse(input);
    const row = await this.#tx(host.org, async (c) => {
      const r = await this.#hosted(c, host, playerId, true);
      if (r.desired_state !== "running" || r.stop_latched)
        throw new AiPlayerRefusal("stopped", "This AI player is stopped.");
      const recent = (
        await c.query<{ n: string }>(
          "select count(*)::text as n from ai_player_calls where organization_id=$1 and player_id=$2 and created_at>$3",
          [host.org, playerId, new Date(this.#now() - 3600_000)],
        )
      ).rows[0];
      if (Number(recent?.n ?? 0) >= r.calls_per_hour)
        throw new AiPlayerRefusal(
          "rate_limited",
          "This AI player reached its calls per hour.",
        );
      return r;
    });
    const standing = this.#standing(row),
      choice = this.#choice(row);
    const standingCall = async <T>(call: () => Promise<T>): Promise<T> => {
      try {
        return await call();
      } catch (error) {
        if (error instanceof AuthError && error.code === "STANDING_REVOKED")
          throw new AiPlayerRefusal(
            "standing_revoked",
            "The adult who owns this AI player no longer has authority.",
          );
        throw error;
      }
    };
    let model = await standingCall(() =>
      this.#gateway.chosenModel(standing, choice),
    );
    if (!model || model.pricing.expires_at - this.#now() < 60_000) {
      await standingCall(() =>
        this.#gateway.refreshStanding(standing, choice.connection_id),
      ).catch((error) => {
        if (error instanceof AiPlayerRefusal) throw error;
      });
      model = await standingCall(() =>
        this.#gateway.chosenModel(standing, choice),
      );
    }
    if (!model)
      throw new AiPlayerRefusal(
        "model_unavailable",
        "The chosen model is not available right now.",
      );
    const request: GenerateRequest = {
      schema_version: 1,
      request_id: value.request_id,
      messages: value.messages,
      max_input_tokens: value.max_input_tokens,
      max_output_tokens: value.max_output_tokens,
      timeout_ms: 45000,
      response_format: "text",
      tools: value.tools,
    };
    const maxMicro = maximumCost(model, request);
    if (maxMicro === null)
      throw new AiPlayerRefusal(
        "model_unavailable",
        "The chosen model has no complete price.",
      );
    const day = utcDay(this.#now());
    await this.#tx(host.org, async (c) => {
      const r = await this.#hosted(c, host, playerId, true);
      if (r.desired_state !== "running" || r.stop_latched)
        throw new AiPlayerRefusal("stopped", "This AI player is stopped.");
      await c.query(
        "insert into ai_player_spend_days(organization_id,player_id,day) values($1,$2,$3) on conflict do nothing",
        [host.org, playerId, day],
      );
      const t = (
        await c.query<{ day_used: string; all_used: string }>(
          "select coalesce(sum(case when day=$3 then used_micro+reserved_micro end),0)::text as day_used,coalesce(sum(used_micro+reserved_micro),0)::text as all_used from ai_player_spend_days where organization_id=$1 and player_id=$2",
          [host.org, playerId, day],
        )
      ).rows[0];
      const dayUsed = BigInt(t?.day_used ?? "0"),
        allUsed = BigInt(t?.all_used ?? "0");
      if (
        dayUsed + maxMicro > BigInt(r.daily_limit_micro) ||
        allUsed + maxMicro > BigInt(r.total_limit_micro)
      )
        throw new AiPlayerRefusal(
          "out_of_budget",
          "This AI player reached its spending limit.",
        );
      await c.query(
        "insert into ai_player_calls(id,organization_id,player_id,day,model_id,max_micro,created_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          value.request_id,
          host.org,
          playerId,
          day,
          model.id,
          maxMicro.toString(),
          new Date(this.#now()),
        ],
      );
      await c.query(
        "update ai_player_spend_days set reserved_micro=reserved_micro+$4,calls=calls+1 where organization_id=$1 and player_id=$2 and day=$3",
        [host.org, playerId, day, maxMicro.toString()],
      );
    });
    let result: GenerateResult | null = null,
      failure: unknown = null;
    try {
      result = (await this.#gateway.generateStanding(standing, choice, request))
        .result;
    } catch (error) {
      failure = error;
    }
    const settled = await this.#tx(host.org, async (c) => {
      const charge = (
        await c.query<{
          charged: string;
          uncertain: boolean;
          dispatched: boolean;
        }>(
          "select coalesce(sum(r.charged_cost),0)::text as charged,coalesce(bool_or(r.state='uncertain'),false) as uncertain,coalesce(bool_or(r.state in ('dispatched','uncertain','settled')),false) as dispatched from usage_reservations r join provider_requests q on q.organization_id=r.organization_id and q.id=r.request_pk where q.organization_id=$1 and q.request_id=$2",
          [host.org, value.request_id],
        )
      ).rows[0];
      const uncertain = !result && (charge?.uncertain || charge?.dispatched);
      // Unknown usage or an unknown outcome keeps the worst case as spent.
      const priced = result ? pricedCall(model, request, result.usage) : null;
      const charged = result ? (priced ?? maxMicro) : uncertain ? maxMicro : 0n;
      const state = result ? "settled" : uncertain ? "uncertain" : "released";
      await c.query(
        "update ai_player_calls set state=$3,charged_micro=$4,input_tokens=$5,output_tokens=$6,settled_at=now() where organization_id=$1 and id=$2",
        [
          host.org,
          value.request_id,
          state,
          charged.toString(),
          result?.usage.input_tokens ?? null,
          result?.usage.output_tokens ?? null,
        ],
      );
      await c.query(
        "update ai_player_spend_days set reserved_micro=greatest(reserved_micro-$4,0),used_micro=used_micro+$5,input_tokens=input_tokens+$6,output_tokens=output_tokens+$7 where organization_id=$1 and player_id=$2 and day=$3",
        [
          host.org,
          playerId,
          day,
          maxMicro.toString(),
          charged.toString(),
          result?.usage.input_tokens ?? 0,
          result?.usage.output_tokens ?? 0,
        ],
      );
      const r = await this.#player(c, host.org, playerId);
      return { charged, spend: await this.#spend(c, host.org, r) };
    });
    if (!result) {
      if (failure instanceof AuthError && failure.code === "STANDING_REVOKED")
        throw new AiPlayerRefusal(
          "standing_revoked",
          "The adult who owns this AI player no longer has authority.",
        );
      if (failure instanceof RouterBlocked)
        throw new AiPlayerRefusal(
          "model_unavailable",
          `The model call was blocked: ${failure.reasons.slice(0, 4).join(", ")}.`,
        );
      if (failure instanceof ProviderError)
        throw new AiPlayerRefusal(
          "model_unavailable",
          `The model call failed: ${failure.code}.`,
        );
      throw failure;
    }
    return aiPlayerThought.parse({
      text: result.text,
      tool_calls: result.tool_calls,
      finish_reason: result.finish_reason,
      charged_micro: settled.charged.toString(),
      spend: settled.spend,
    });
  }

  // ---- Shared ------------------------------------------------------------------

  async #insertMessage(
    c: pg.PoolClient,
    org: string,
    playerId: string,
    m: {
      id: string;
      direction: string;
      channel: string;
      author: string;
      body: string;
    },
  ) {
    await c.query(
      "insert into ai_player_messages(id,organization_id,player_id,direction,channel,author,body) values($1,$2,$3,$4,$5,$6,$7)",
      [
        m.id,
        org,
        playerId,
        m.direction,
        m.channel,
        m.author.slice(0, 64),
        m.body.slice(0, 2000),
      ],
    );
    await c.query(
      "delete from ai_player_messages where organization_id=$1 and player_id=$2 and seq < (select seq from ai_player_messages where organization_id=$1 and player_id=$2 order by seq desc offset $3 limit 1)",
      [org, playerId, TRANSCRIPT_KEEP],
    );
  }
  async #system(c: pg.PoolClient, org: string, playerId: string, body: string) {
    await this.#insertMessage(c, org, playerId, {
      id: randomUUID(),
      direction: "system",
      channel: "system",
      author: "CraftLayer",
      body,
    });
  }
  async #memoryList(c: pg.PoolClient, org: string, playerId: string) {
    const rows = (
      await c.query<{
        id: string;
        kind: string;
        content: string;
        tags: string[];
        x: number | null;
        y: number | null;
        z: number | null;
        source: string;
        created_at: Date;
      }>(
        "select id,kind,content,tags,x,y,z,source,created_at from ai_player_memories where organization_id=$1 and player_id=$2 and (expires_at is null or expires_at>$3) order by created_at desc limit 500",
        [org, playerId, new Date(this.#now())],
      )
    ).rows;
    return aiPlayerMemoryList.parse({
      memories: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        content: r.content,
        tags: r.tags,
        position:
          r.x === null || r.y === null || r.z === null
            ? null
            : { x: r.x, y: r.y, z: r.z },
        source: r.source,
        created_at: iso(r.created_at),
      })),
    });
  }
  async #insertMemory(
    c: pg.PoolClient,
    org: string,
    playerId: string,
    value: AiPlayerMemoryInput,
    source: "owner" | "player",
  ) {
    const id = randomUUID();
    const row = (
      await c.query<{ created_at: Date }>(
        "insert into ai_player_memories(id,organization_id,player_id,kind,content,tags,x,y,z,source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning created_at",
        [
          id,
          org,
          playerId,
          value.kind,
          value.content,
          value.tags,
          value.position?.x ?? null,
          value.position?.y ?? null,
          value.position?.z ?? null,
          source,
        ],
      )
    ).rows[0];
    return aiPlayerMemory.parse({
      ...value,
      id,
      source,
      created_at: iso(row?.created_at ?? new Date(this.#now())),
    });
  }
}
