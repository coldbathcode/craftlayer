import { z } from "zod";
import { generateRequestSchema, microUsd } from "./providers.js";

/** Master plan G. JSON-safe contracts for AI players, their owner API and worker hosts. */

const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: plain single-line text shown to adults
    .regex(/^[^\u0000-\u001f\u007f]*$/);
const text = (max: number) =>
  z
    .string()
    .max(max)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: keep newlines and tabs only
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);

export const aiPlayerName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/);
export const minecraftUsername = z.string().regex(/^[A-Za-z0-9_]{3,16}$/);
export const aiPlayerInstructor = z.strictObject({
  /** java: Java UUID; bedrock: Floodgate/Xbox XUID; name: in-game name (offline test worlds only). */
  kind: z.enum(["java", "bedrock", "name"]),
  value: z.string().trim().min(1).max(64),
  label: line(40).default(""),
});
export const aiPlayerTaskCondition = z.enum([
  "always",
  "owner_online",
  "day",
  "night",
]);
export const aiPlayerTaskInput = z.strictObject({
  title: line(80).min(1),
  goal: text(500).trim().min(1),
  priority: z.number().int().min(1).max(100),
  condition: aiPlayerTaskCondition.default("always"),
  enabled: z.boolean().default(true),
});
export const aiPlayerTask = aiPlayerTaskInput.extend({ id: z.uuid() });

/** Profile fields without defaults: an update changes only what it names. */
const aiPlayerFields = {
  name: aiPlayerName,
  project_id: z.uuid(),
  persona: text(2000),
  rules: text(2000),
  connection_id: z.uuid(),
  model_id: z.string().min(1).max(180),
  host_id: z.uuid().nullable(),
  game_host: z.string().regex(/^[A-Za-z0-9.:_-]{1,253}$/),
  game_port: z.number().int().min(1).max(65535),
  game_version: z.string().regex(/^[0-9]+(\.[0-9]+){1,2}$/),
  mc_username: minecraftUsername,
  mc_auth: z.enum(["offline", "microsoft"]),
  instructors: z.array(aiPlayerInstructor).max(8),
  daily_limit_micro: microUsd,
  total_limit_micro: microUsd,
  calls_per_hour: z.number().int().min(1).max(1200),
};
export const aiPlayerInput = z.strictObject({
  ...aiPlayerFields,
  persona: aiPlayerFields.persona.default(""),
  rules: aiPlayerFields.rules.default(""),
  host_id: aiPlayerFields.host_id.default(null),
  game_version: aiPlayerFields.game_version.default("26.1"),
  instructors: aiPlayerFields.instructors.default([]),
  calls_per_hour: aiPlayerFields.calls_per_hour.default(120),
});
export const aiPlayerUpdate = z
  .strictObject(aiPlayerFields)
  .omit({ project_id: true })
  .partial()
  .extend({ expected_version: z.number().int().positive() });

export const aiPlayerStatusState = z.enum([
  "offline",
  "connecting",
  "online",
  "sign_in_required",
  "stopped",
  "out_of_budget",
  "error",
]);
export const aiPlayerObservation = z.strictObject({
  position: z
    .strictObject({ x: z.number(), y: z.number(), z: z.number() })
    .nullable()
    .default(null),
  health: z.number().min(0).max(1024).nullable().default(null),
  food: z.number().min(0).max(1024).nullable().default(null),
  dimension: line(40).nullable().default(null),
  time_of_day: z.enum(["day", "night"]).nullable().default(null),
  activity: line(160).default(""),
  inventory: z.array(line(48)).max(36).default([]),
  nearby_players: z.array(line(32)).max(16).default([]),
  /** Shown while a Microsoft sign-in is waiting for the owner. */
  sign_in: z
    .strictObject({
      url: z.url(),
      code: z.string().regex(/^[A-Z0-9-]{4,16}$/),
      expires_at: z.iso.datetime(),
    })
    .nullable()
    .default(null),
  error: line(200).nullable().default(null),
});
export const aiPlayerStatus = z.strictObject({
  state: aiPlayerStatusState,
  detail: aiPlayerObservation,
  reported_at: z.iso.datetime(),
  stale: z.boolean(),
});
export const aiPlayerSpend = z.strictObject({
  day: z.iso.date(),
  today_micro: microUsd,
  today_reserved_micro: microUsd,
  total_micro: microUsd,
  daily_limit_micro: microUsd,
  total_limit_micro: microUsd,
  calls_today: z.number().int().nonnegative(),
  calls_last_hour: z.number().int().nonnegative(),
  input_tokens_today: z.number().int().nonnegative(),
  output_tokens_today: z.number().int().nonnegative(),
  warning: z.boolean(),
  exhausted: z.boolean(),
});
export const aiPlayerView = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  project_id: z.uuid(),
  persona: z.string(),
  rules: z.string(),
  owner_user_id: z.uuid(),
  connection_id: z.uuid(),
  model_id: z.string(),
  host_id: z.uuid().nullable(),
  game_host: z.string(),
  game_port: z.number().int(),
  game_version: z.string(),
  mc_username: z.string(),
  mc_auth: z.enum(["offline", "microsoft"]),
  instructors: z.array(aiPlayerInstructor),
  daily_limit_micro: microUsd,
  total_limit_micro: microUsd,
  calls_per_hour: z.number().int(),
  desired_state: z.enum(["running", "stopped"]),
  stop_latched: z.boolean(),
  version: z.number().int().positive(),
  tasks: z.array(aiPlayerTask).max(32),
  status: aiPlayerStatus.nullable(),
  spend: aiPlayerSpend,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export const aiPlayerList = z.strictObject({
  players: z.array(aiPlayerView).max(50),
});

export const aiPlayerMessageDirection = z.enum([
  "instruction",
  "reply",
  "event",
  "decision",
  "system",
]);
export const aiPlayerMessageChannel = z.enum([
  "dashboard",
  "game",
  "mcp",
  "system",
  "player",
]);
export const aiPlayerMessage = z.strictObject({
  id: z.uuid(),
  seq: z.number().int().positive(),
  direction: aiPlayerMessageDirection,
  channel: aiPlayerMessageChannel,
  author: z.string().max(64),
  body: z.string().max(2000),
  delivered: z.boolean(),
  created_at: z.iso.datetime(),
});
export const aiPlayerTranscript = z.strictObject({
  messages: z.array(aiPlayerMessage).max(200),
});
export const aiPlayerInstruction = z.strictObject({
  body: text(2000).trim().min(1),
});

export const aiPlayerMemoryKind = z.enum([
  "fact",
  "place",
  "person",
  "lesson",
  "note",
  "summary",
]);
export const aiPlayerMemoryInput = z.strictObject({
  kind: aiPlayerMemoryKind,
  content: text(500).trim().min(1),
  tags: z
    .array(z.string().regex(/^[a-z0-9_-]{1,24}$/))
    .max(8)
    .default([]),
  position: z
    .strictObject({
      x: z.number().int().min(-30_000_000).max(30_000_000),
      y: z.number().int().min(-2048).max(2048),
      z: z.number().int().min(-30_000_000).max(30_000_000),
    })
    .nullable()
    .default(null),
});
export const aiPlayerMemory = aiPlayerMemoryInput.extend({
  id: z.uuid(),
  source: z.enum(["owner", "player"]),
  created_at: z.iso.datetime(),
});
export const aiPlayerMemoryList = z.strictObject({
  memories: z.array(aiPlayerMemory).max(500),
});

export const aiPlayerHostView = z.strictObject({
  id: z.uuid(),
  label: z.string(),
  created_at: z.iso.datetime(),
  last_seen_at: z.iso.datetime().nullable(),
  revoked: z.boolean(),
});
export const aiPlayerHostCreated = aiPlayerHostView.extend({
  /** Shown once. Store it in the worker host's protected token file. */
  token: z.string(),
});
export const aiPlayerHostList = z.strictObject({
  hosts: z.array(aiPlayerHostView).max(20),
});

// Worker host API.
export const aiPlayerAssignment = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  persona: z.string(),
  rules: z.string(),
  model_id: z.string(),
  game_host: z.string(),
  game_port: z.number().int(),
  game_version: z.string(),
  mc_username: z.string(),
  mc_auth: z.enum(["offline", "microsoft"]),
  instructors: z.array(aiPlayerInstructor),
  tasks: z.array(aiPlayerTask).max(32),
  run: z.boolean(),
  version: z.number().int().positive(),
});
export const aiPlayerAssignments = z.strictObject({
  players: z.array(aiPlayerAssignment).max(20),
  poll_after_ms: z.number().int().min(500).max(60000),
});
export const aiPlayerReport = z.strictObject({
  state: aiPlayerStatusState,
  detail: aiPlayerObservation,
});
export const aiPlayerWorkerMessage = z.strictObject({
  direction: z.enum(["reply", "event", "decision"]),
  channel: z.enum(["game", "player", "system"]),
  author: z.string().trim().min(1).max(64),
  body: text(2000).trim().min(1),
});
export const aiPlayerWorkerMessages = z.strictObject({
  messages: z.array(aiPlayerWorkerMessage).min(1).max(20),
});
export const aiPlayerPending = z.strictObject({
  instructions: z
    .array(
      z.strictObject({
        id: z.uuid(),
        channel: aiPlayerMessageChannel,
        author: z.string(),
        body: z.string(),
        created_at: z.iso.datetime(),
      }),
    )
    .max(20),
});
/** A model call the worker asks for; the API decides model, credentials and budget. */
export const aiPlayerThink = generateRequestSchema
  .pick({
    request_id: true,
    messages: true,
    max_output_tokens: true,
    tools: true,
  })
  .extend({
    max_input_tokens: z.number().int().min(256).max(131072),
  });
export const aiPlayerThought = z.strictObject({
  text: z.string().max(262144),
  tool_calls: z
    .array(
      z.strictObject({
        name: z.string().max(64),
        arguments: z.record(z.string(), z.json()),
      }),
    )
    .max(16),
  finish_reason: z.enum(["stop", "length", "tool_calls"]),
  charged_micro: microUsd,
  spend: aiPlayerSpend,
});
export const aiPlayerThinkRefused = z.strictObject({
  code: z.enum([
    "out_of_budget",
    "stopped",
    "rate_limited",
    "model_unavailable",
    "standing_revoked",
  ]),
  message: z.string(),
});

export type AiPlayerInput = z.input<typeof aiPlayerInput>;
export type AiPlayerUpdate = z.input<typeof aiPlayerUpdate>;
export type AiPlayerView = z.infer<typeof aiPlayerView>;
export type AiPlayerTaskInput = z.input<typeof aiPlayerTaskInput>;
export type AiPlayerMemoryInput = z.input<typeof aiPlayerMemoryInput>;
export type AiPlayerAssignment = z.infer<typeof aiPlayerAssignment>;
export type AiPlayerObservation = z.infer<typeof aiPlayerObservation>;
export type AiPlayerThink = z.infer<typeof aiPlayerThink>;
export type AiPlayerThought = z.infer<typeof aiPlayerThought>;
export type AiPlayerSpend = z.infer<typeof aiPlayerSpend>;
