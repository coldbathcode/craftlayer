import { z } from "zod";

/**
 * The worker host's only line to CraftLayer. It carries the host token and nothing
 * else: no provider keys, no database, no game-server authority. Shapes mirror
 * `packages/contracts/src/ai-players.ts`; responses are checked here too.
 */
const instructor = z.object({
  kind: z.enum(["java", "bedrock", "name"]),
  value: z.string(),
  label: z.string().default(""),
});
const task = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  priority: z.number(),
  condition: z.enum(["always", "owner_online", "day", "night"]),
  enabled: z.boolean(),
});
export const assignmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  persona: z.string(),
  rules: z.string(),
  model_id: z.string(),
  game_host: z.string(),
  game_port: z.number(),
  game_version: z.string(),
  mc_username: z.string(),
  mc_auth: z.enum(["offline", "microsoft"]),
  instructors: z.array(instructor),
  tasks: z.array(task),
  run: z.boolean(),
  version: z.number(),
});
export type Assignment = z.infer<typeof assignmentSchema>;
export type MasterTask = z.infer<typeof task>;
export type Instructor = z.infer<typeof instructor>;
const assignments = z.object({
  players: z.array(assignmentSchema),
  poll_after_ms: z.number(),
});
const pending = z.object({
  instructions: z.array(
    z.object({
      id: z.string(),
      channel: z.string(),
      author: z.string(),
      body: z.string(),
      created_at: z.string(),
    }),
  ),
});
export const memorySchema = z.object({
  id: z.string(),
  kind: z.enum(["fact", "place", "person", "lesson", "note", "summary"]),
  content: z.string(),
  tags: z.array(z.string()),
  position: z
    .object({ x: z.number(), y: z.number(), z: z.number() })
    .nullable(),
  source: z.enum(["owner", "player"]),
  created_at: z.string(),
});
export type Memory = z.infer<typeof memorySchema>;
const spend = z.object({
  today_micro: z.string(),
  total_micro: z.string(),
  daily_limit_micro: z.string(),
  total_limit_micro: z.string(),
  warning: z.boolean(),
  exhausted: z.boolean(),
});
export const thoughtSchema = z.object({
  text: z.string(),
  tool_calls: z.array(
    z.object({
      name: z.string(),
      arguments: z.record(z.string(), z.unknown()),
    }),
  ),
  finish_reason: z.enum(["stop", "length", "tool_calls"]),
  charged_micro: z.string(),
  spend,
});
export type Thought = z.infer<typeof thoughtSchema>;

export interface Observation {
  position: { x: number; y: number; z: number } | null;
  health: number | null;
  food: number | null;
  dimension: string | null;
  time_of_day: "day" | "night" | null;
  activity: string;
  inventory: string[];
  nearby_players: string[];
  sign_in: { url: string; code: string; expires_at: string } | null;
  error: string | null;
}
export type PlayerState =
  | "offline"
  | "connecting"
  | "online"
  | "sign_in_required"
  | "stopped"
  | "out_of_budget"
  | "error";
export interface ThinkRequest {
  request_id: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_input_tokens: number;
  max_output_tokens: number;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}
export type WorkerMessage = {
  direction: "reply" | "event" | "decision";
  channel: "game" | "player" | "system";
  author: string;
  body: string;
};

/** A refusal from CraftLayer (out of budget, stopped, rate limited, model unavailable). */
export class Refused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "Refused";
  }
}

export interface HostApi {
  assignments(): Promise<{ players: Assignment[]; poll_after_ms: number }>;
  report(
    player: string,
    state: PlayerState,
    detail: Observation,
  ): Promise<void>;
  pending(player: string): Promise<z.infer<typeof pending>["instructions"]>;
  post(player: string, messages: WorkerMessage[]): Promise<void>;
  ownerChat(player: string, author: string, body: string): Promise<void>;
  think(player: string, request: ThinkRequest): Promise<Thought>;
  memories(player: string): Promise<Memory[]>;
  remember(
    player: string,
    memory: {
      kind: Memory["kind"];
      content: string;
      tags: string[];
      position: Memory["position"];
    },
  ): Promise<void>;
}

export class HostClient implements HostApi {
  readonly #base: string;
  readonly #token: string;
  constructor(base: string, token: string) {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("API_URL_PROTOCOL");
    if (!/^clah_\S{1,200}$/.test(token)) throw new Error("HOST_TOKEN_FORMAT");
    this.#base = url.toString().replace(/\/$/, "");
    this.#token = token;
  }
  async #call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = 10000,
  ) {
    const response = await fetch(`${this.#base}/api/v1/ai-player-host${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ code: z.string(), message: z.string() }) })
        .safeParse(json);
      throw new Refused(
        response.status,
        error.success ? error.data.error.code : `HTTP_${response.status}`,
        error.success
          ? error.data.error.message
          : "CraftLayer refused the request.",
      );
    }
    return json;
  }
  async assignments() {
    return assignments.parse(await this.#call("GET", "/assignments"));
  }
  async report(player: string, state: PlayerState, detail: Observation) {
    await this.#call("POST", `/players/${player}/status`, { state, detail });
  }
  async pending(player: string) {
    return pending.parse(await this.#call("POST", `/players/${player}/pending`))
      .instructions;
  }
  async post(player: string, messages: WorkerMessage[]) {
    for (let i = 0; i < messages.length; i += 20)
      await this.#call("POST", `/players/${player}/messages`, {
        messages: messages.slice(i, i + 20).map((m) => ({
          ...m,
          author: m.author.slice(0, 64),
          body: m.body.slice(0, 2000),
        })),
      });
  }
  async ownerChat(player: string, author: string, body: string) {
    await this.#call("POST", `/players/${player}/owner-chat`, {
      author: author.slice(0, 64),
      body: body.slice(0, 2000),
    });
  }
  async think(player: string, request: ThinkRequest) {
    return thoughtSchema.parse(
      await this.#call("POST", `/players/${player}/think`, request, 70000),
    );
  }
  async memories(player: string) {
    return z
      .object({ memories: z.array(memorySchema) })
      .parse(await this.#call("GET", `/players/${player}/memories`)).memories;
  }
  async remember(
    player: string,
    memory: {
      kind: Memory["kind"];
      content: string;
      tags: string[];
      position: Memory["position"];
    },
  ) {
    await this.#call("POST", `/players/${player}/memories`, memory);
  }
}
