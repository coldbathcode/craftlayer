import { z } from "zod";

/** Typed server actions (master plan A3). Every request is one of these shapes; there
 * is no free-text console command anywhere in the contract. */
const id = z.uuid().refine((v) => v === v.toLowerCase());
export const gamePlayerName = z.string().regex(/^\.?[A-Za-z0-9_]{1,16}$/);
export const gamertag = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 ]{1,16}$/)
  .refine((v) => !/^ | $| {2}/.test(v), "Single internal spaces only");
export const xuid = z.string().regex(/^[0-9]{1,20}$/);
export const gameMessage = z
  .string()
  .trim()
  .min(1)
  .max(256)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: chat must not carry control or formatting characters
  .regex(/^[^\u0000-\u001f\u007f§]+$/)
  .refine((v) => !v.startsWith("/"), "Messages cannot start a command");
export const serverActionRequest = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("allow_player"),
    player: z.discriminatedUnion("edition", [
      z.strictObject({ edition: z.literal("java"), name: gamePlayerName }),
      z.strictObject({ edition: z.literal("bedrock"), gamertag, xuid }),
    ]),
  }),
  z.strictObject({ kind: z.literal("revoke_player"), name: gamePlayerName }),
  z.strictObject({
    kind: z.literal("kick_player"),
    name: gamePlayerName,
    reason: gameMessage.max(100).optional(),
  }),
  z.strictObject({ kind: z.literal("say"), message: gameMessage }),
  z.strictObject({ kind: z.literal("save") }),
  z.strictObject({ kind: z.literal("start") }),
  z.strictObject({ kind: z.literal("stop") }),
  z.strictObject({ kind: z.literal("restart") }),
]);
export const serverActionKind = z.enum([
  "allow_player",
  "revoke_player",
  "kick_player",
  "say",
  "save",
  "start",
  "stop",
  "restart",
]);
export const serverActionState = z.enum([
  "pending",
  "dispatched",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
]);
export const serverActionFailure = z.enum([
  "none",
  "node_unavailable",
  "server_unreachable",
  "refused_by_server",
  "not_verified",
  "expired",
  "cancelled",
  "interrupted",
]);
/** The server's own words, bounded, never a secret. */
export const serverActionEvidence = z.strictObject({
  ok: z.boolean(),
  evidence: z.string().max(2000),
  detail: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
});
export const serverActionView = z.strictObject({
  id,
  server_id: id,
  operation_id: id,
  kind: serverActionKind,
  request: serverActionRequest,
  state: serverActionState,
  failure_code: serverActionFailure,
  fence: z.number().int().positive(),
  evidence: serverActionEvidence.nullable(),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  dispatched_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
  /** True while no node is bound to execute actions for this server. */
  awaiting_node: z.boolean(),
  can_cancel: z.boolean(),
});
export const serverActionAccepted = z.strictObject({
  action_id: id,
  operation_id: id,
  server_id: id,
  state: serverActionState,
  awaiting_node: z.boolean(),
});
export const serverActionPage = z.strictObject({
  server_id: id,
  items: z.array(serverActionView).max(100),
});
export type ServerActionRequest = z.infer<typeof serverActionRequest>;
export type ServerActionView = z.infer<typeof serverActionView>;
export type ServerActionKind = z.infer<typeof serverActionKind>;
