import type {
  BackupStatusView,
  ServerLiveView,
  ServerView,
} from "@craftlayer/contracts";
import { ApiError } from "@craftlayer/sdk";

/** Plain words only on the family screens (B1): no codes, no internal terms. */
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "never";
  const then = new Date(iso),
    seconds = Math.max(0, Math.round((now - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  const time = then.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const days = Math.floor(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) /
      86400000,
  );
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${then.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}
/** The server shows iPad and console players with a leading dot and underscores. */
export function playerLabel(name: string) {
  return name.replace(/^\./, "").replaceAll("_", " ");
}
export function playerDevice(name: string) {
  return name.startsWith(".") ? "iPad or console" : "Computer";
}
export function size(bytes: number | null) {
  if (bytes === null) return "";
  return bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}
export type Power = "on" | "off" | "starting" | "unreachable" | "unknown";
/** What to say about a server right now, and how sure we are. */
export function powerOf(
  server: ServerView,
  live: ServerLiveView | null,
): { power: Power; live: boolean; playing: number | null; names: string[] } {
  if (live?.host_bound) {
    if (!live.fresh)
      return { power: "unreachable", live: true, playing: null, names: [] };
    return {
      power: live.power === "unknown" ? "unreachable" : live.power,
      live: true,
      playing: live.online,
      names: live.players ?? [],
    };
  }
  // No host looks after this server: all we have is the last outside check.
  const o = server.observation;
  if (o?.freshness !== "fresh")
    return { power: "unknown", live: false, playing: null, names: [] };
  return {
    power:
      o.state === "online" ? "on" : o.state === "offline" ? "off" : "unknown",
    live: false,
    playing: o.player_count,
    names: [],
  };
}
export const powerWord: Record<Power, string> = {
  on: "On",
  off: "Off",
  starting: "Starting",
  unreachable: "Can't reach it",
  unknown: "Not checked yet",
};
export function backupLine(status: BackupStatusView | null) {
  if (!status) return { text: "Last backup: checking…", ok: true };
  const health = status.policy?.health;
  if (!health || health.recovery_point_age_ms === null)
    return { text: "Last backup: none yet", ok: false };
  const at = new Date(Date.now() - health.recovery_point_age_ms).toISOString();
  return { text: `Last backup: ${ago(at)}`, ok: health.local === "healthy" };
}
/** The shared error words from the B1 design. Never a raw code. */
export function friendly(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "You've been signed out to keep things safe. Sign in again.";
    if (error.status === 403) return "Only a manager can do this.";
    if (error.status === 429)
      return "That's a lot at once. Wait a moment and try again.";
    if (
      [
        "ACTIONS_STILL_OPEN",
        "LIFECYCLE_ACTION_PENDING",
        "ACTION_QUEUE_FULL",
        "BACKUP_IN_PROGRESS",
      ].includes(error.code)
    )
      return "Something else is still in progress. Try again in a moment.";
    if (error.code === "KNOCK_DECIDED" || error.code === "KNOCK_EXPIRED")
      return "That request is no longer waiting.";
  }
  return "That didn't work. Nothing was changed. Try again.";
}
export function signedOut(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}
export const newKey = () => crypto.randomUUID();
