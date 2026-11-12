import type {
  AgentToken,
  ServerActionKind,
  ServerActionRequest,
  ServerView,
} from "@craftlayer/contracts";

/** Plain words for the AI helpers screen (B3). No internal names reach the page. */
type ReadPermission = AgentToken["permissions"][number];

/**
 * What a new AI helper may read: enough to list the family's servers, see who is
 * playing, follow a change it asked for and read backups. Nothing about host
 * computers, missions or other AI players.
 */
export const helperReads: ReadPermission[] = [
  "organization:read",
  "project:read",
  "environment:read",
  "server:read",
  "player:read",
  "operation:read",
  "backup:read",
];
/** Every action a helper may be allowed to ask for, in the order shown. */
export const askWords: Record<ServerActionKind, string> = {
  allow_player: "let a player join",
  revoke_player: "remove a player",
  kick_player: "kick a player",
  say: "send a message",
  save: "save the world",
  start: "turn on",
  stop: "turn off",
  restart: "restart",
};
export const askKinds = Object.keys(askWords) as ServerActionKind[];
const readWords: Partial<Record<ReadPermission, string>> = {
  "server:read": "servers",
  "player:read": "players",
  "backup:read": "backups",
  "node:read": "host computers",
  "mission:read": "missions",
  "agent:read": "AI players",
  "event:read": "activity",
};
/** "a", "a and b", "a, b and c". */
export function list(words: string[]) {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
export function readsLine(permissions: readonly ReadPermission[]) {
  const words = (Object.keys(readWords) as ReadPermission[])
    .filter((p) => permissions.includes(p))
    .map((p) => readWords[p] as string);
  return words.length ? list(words) : "names only";
}
/** Empty when the helper is read only. */
export function asksLine(kinds: readonly ServerActionKind[]) {
  return list(
    askKinds.filter((k) => kinds.includes(k)).map((k) => askWords[k]),
  );
}
const label = (name: string) => name.replace(/^\./, "").replaceAll("_", " ");
/** What one request would do, e.g. "let BigCrazyPickle join Family Survival". */
export function requestWords(request: ServerActionRequest, server: string) {
  switch (request.kind) {
    case "allow_player":
      return `let ${
        request.player.edition === "java"
          ? label(request.player.name)
          : request.player.gamertag
      } join ${server}`;
    case "revoke_player":
      return `remove ${label(request.name)} from ${server}`;
    case "kick_player":
      return `kick ${label(request.name)} from ${server}`;
    case "say":
      return `send a message to everyone on ${server}`;
    case "save":
      return `save the world on ${server}`;
    case "start":
      return `turn on ${server}`;
    case "stop":
      return `turn off ${server}`;
    case "restart":
      return `restart ${server}`;
  }
}
/** Words the helper wrote that would be shown in the game. Untrusted: text only. */
export function requestText(request: ServerActionRequest) {
  if (request.kind === "say") return request.message;
  if (request.kind === "kick_player") return request.reason ?? null;
  return null;
}
/** A day such as "8 Dec", with the year when it is not this year. */
export function day(iso: string, now = Date.now()) {
  const date = new Date(iso);
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}
export interface ServerGroup {
  key: string;
  projectId: string;
  environmentId: string;
  names: string[];
}
/**
 * A key covers every server kept together in one place, not a single server, so the
 * choice offered is the group and its label names everything in it.
 */
export function serverGroups(
  servers: readonly Pick<
    ServerView,
    "name" | "project_id" | "environment_id"
  >[],
): ServerGroup[] {
  const groups = new Map<string, ServerGroup>();
  for (const server of servers) {
    const group = groups.get(server.environment_id);
    if (group) group.names.push(server.name);
    else
      groups.set(server.environment_id, {
        key: server.environment_id,
        projectId: server.project_id,
        environmentId: server.environment_id,
        names: [server.name],
      });
  }
  return [...groups.values()];
}
/** The servers a connected helper can see, by name. */
export function seenBy(
  helper: Pick<AgentToken, "project_id" | "environment_id">,
  servers: readonly Pick<
    ServerView,
    "name" | "project_id" | "environment_id"
  >[],
) {
  return servers
    .filter((s) =>
      helper.environment_id
        ? s.environment_id === helper.environment_id
        : s.project_id === helper.project_id,
    )
    .map((s) => s.name);
}
