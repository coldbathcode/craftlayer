import type { Instructor, Memory } from "../api/client.js";

/**
 * What the player says in game is checked before it is sent: one line, short, no
 * commands, nothing from a small block list. A model can never run a server command
 * through chat because a leading slash is removed.
 */
const BLOCKED =
  /\b(fuck|shit|bitch|cunt|dick|bastard|slut|whore|nigg\w*|fag\w*|kill yourself|kys)\b/i;
export function safeChat(text: string): string | null {
  const line = text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip every control character
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[/\\]+/, "")
    .trim();
  if (!line || BLOCKED.test(line)) return null;
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}

/** Floodgate gives a Bedrock player the UUID 00000000-0000-0000-xxxx-xxxxxxxxxxxx from its XUID. */
export function floodgateUuid(xuid: string): string | null {
  if (!/^[0-9]{1,20}$/.test(xuid)) return null;
  const hex = BigInt(xuid).toString(16).padStart(16, "0");
  if (hex.length > 16) return null;
  return `00000000-0000-0000-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** Is this chat author one of the owner's in-game identities? */
export function isOwner(
  instructors: Instructor[],
  username: string,
  uuid: string | undefined,
): boolean {
  const id = uuid?.toLowerCase();
  return instructors.some((i) => {
    if (i.kind === "name")
      return i.value.toLowerCase() === username.toLowerCase();
    if (i.kind === "java") return !!id && i.value.toLowerCase() === id;
    return !!id && floodgateUuid(i.value) === id;
  });
}

/**
 * The owner talks to the player by starting with its name ("Pip, ..."), or by
 * whispering. Everything else the owner says is ordinary chat with other people.
 */
export function addressedText(message: string, names: string[]): string | null {
  const text = message.trim();
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^@?${escaped}\\b[\\s,:!-]*`, "i").exec(text);
    if (match) return text.slice(match[0].length).trim() || "hello";
  }
  return null;
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
/** The most useful memories for this turn: owner notes first, then by overlap and recency. */
export function relevantMemories(
  all: Memory[],
  focus: string,
  limit = 12,
): Memory[] {
  const focusWords = words(focus);
  const scored = all.map((m, index) => {
    const overlap = [...words(`${m.content} ${m.tags.join(" ")}`)].filter((w) =>
      focusWords.has(w),
    ).length;
    const owner = m.source === "owner" ? 3 : 0;
    const recency = Math.max(0, 2 - index / 25);
    const kind = m.kind === "place" || m.kind === "lesson" ? 0.5 : 0;
    return { m, score: overlap * 2 + owner + recency + kind };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.m);
}

const PAIR =
  /([a-zA-Z_][a-zA-Z0-9_]*)\s*[=:]\s*("(?:[^"\\]|\\.)*"|'[^']*'|-?\d+(?:\.\d+)?|true|false)/g;
const NAME_KEYS = ["tool_name", "tool", "name", "function"] as const;
const ARG_KEYS = [
  "tool_args",
  "arguments",
  "args",
  "parameters",
  "input",
] as const;
/**
 * The other shape small models write: a JSON object such as
 * `{"tool_name": "look_around", "tool_args": {}}`, possibly in a code fence.
 */
function jsonToolCall(
  text: string,
  known: (name: string) => boolean,
): { name: string; arguments: Record<string, unknown> } | null {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!body.startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = NAME_KEYS.map((k) => record[k]).find(
    (v): v is string => typeof v === "string",
  );
  if (!name || !known(name)) return null;
  const args =
    ARG_KEYS.map((k) => record[k]).find((v) => v !== undefined) ?? {};
  return args && typeof args === "object" && !Array.isArray(args)
    ? { name, arguments: args as Record<string, unknown> }
    : null;
}

/**
 * Small models sometimes write a tool call as text, for example
 * `say(text="Hi!")`, instead of making the call. If the whole reply is one call
 * to a known skill with readable arguments, return it so the brain can run it
 * (after the usual argument check). Anything else returns null.
 */
export function toolCallInText(
  text: string,
  known: (name: string) => boolean,
): { name: string; arguments: Record<string, unknown> } | null {
  const json = jsonToolCall(text, known);
  if (json) return json;
  const match = /^`*\s*([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)\s*`*$/i.exec(
    text.trim(),
  );
  if (!match?.[1] || !known(match[1])) return null;
  const inside = (match[2] ?? "").trim();
  if (!inside) return { name: match[1], arguments: {} };
  if (inside.startsWith("{")) {
    try {
      const value = JSON.parse(inside);
      return value && typeof value === "object" && !Array.isArray(value)
        ? { name: match[1], arguments: value }
        : null;
    } catch {
      return null;
    }
  }
  const args: Record<string, unknown> = {};
  let consumed = inside;
  for (const [whole, key, raw] of inside.matchAll(PAIR)) {
    if (!key || raw === undefined) continue;
    consumed = consumed.replace(whole, "");
    args[key] = raw.startsWith('"')
      ? JSON.parse(raw)
      : raw.startsWith("'")
        ? raw.slice(1, -1)
        : raw === "true" || raw === "false"
          ? raw === "true"
          : Number(raw);
  }
  // Only separators may be left over; otherwise the text was not a clean call.
  return Object.keys(args).length && /^[\s,]*$/.test(consumed)
    ? { name: match[1], arguments: args }
    : null;
}

/**
 * Text that starts like a call to a known skill (even a cut-off one) must never
 * be said in the game.
 */
export function looksLikeToolCall(
  text: string,
  known: (name: string) => boolean,
) {
  const match = /^`*\s*([a-z_][a-z0-9_]*)\s*\(/i.exec(text.trim());
  if (match?.[1] && known(match[1])) return true;
  // A JSON object naming a known skill is a call, not a message.
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "");
  if (!trimmed.startsWith("{")) return false;
  return NAME_KEYS.some((key) => {
    const named = new RegExp(`"${key}"\\s*:\\s*"([a-z_][a-z0-9_]*)"`, "i").exec(
      trimmed,
    );
    return !!named?.[1] && known(named[1]);
  });
}
