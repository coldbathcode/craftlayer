import { z } from "zod";
import { xuidFromFloodgateUuid } from "./floodgate.js";

/** One line of plugins/CraftLayerKnock/knocks.jsonl written by the Knock server plugin. */
export const knockRecord = z.strictObject({
  v: z.literal(1),
  at: z.iso.datetime(),
  result: z.literal("KICK_WHITELIST"),
  edition: z.enum(["bedrock", "java"]),
  name: z.string().regex(/^[\x20-\x7e]{1,64}$/),
  uuid: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  xuid: z
    .string()
    .regex(/^[0-9]{1,20}$/)
    .optional(),
});
export type KnockRecord = z.infer<typeof knockRecord>;
export interface Knock {
  uuid: string;
  name: string;
  edition: "bedrock" | "java";
  xuid: string | null;
  first_at: string;
  last_at: string;
  attempts: number;
}
const MAX_BYTES = 2 * 1024 * 1024,
  TTL_MS = 24 * 3600 * 1000;
/** Parses the knock file into "asking to join" entries: one per account, newest last,
 * attempts counted, anything older than 24 hours dropped, malformed lines ignored. The
 * XUID of a Bedrock account is taken from the Floodgate UUID itself, never trusted from text. */
export function parseKnocks(text: string, now = Date.now()): Knock[] {
  if (text.length > MAX_BYTES) text = text.slice(-MAX_BYTES);
  const byUuid = new Map<string, Knock>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const r = knockRecord.safeParse(parsed);
    if (!r.success) continue;
    const at = Date.parse(r.data.at);
    if (Number.isNaN(at) || at < now - TTL_MS || at > now + 300000) continue;
    const uuid = r.data.uuid.toLowerCase();
    const derived = xuidFromFloodgateUuid(uuid);
    const edition = derived ? "bedrock" : "java";
    const existing = byUuid.get(uuid);
    if (existing) {
      existing.attempts++;
      existing.last_at = r.data.at;
      existing.name = r.data.name;
    } else
      byUuid.set(uuid, {
        uuid,
        name: r.data.name,
        edition,
        xuid: derived,
        first_at: r.data.at,
        last_at: r.data.at,
        attempts: 1,
      });
  }
  return [...byUuid.values()].sort((a, b) =>
    a.last_at.localeCompare(b.last_at),
  );
}
