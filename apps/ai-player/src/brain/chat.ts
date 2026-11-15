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
