import { createHash } from "node:crypto";
import {
  type BackupPolicy,
  type BackupRecord,
  backupPolicy,
  backupRecord,
} from "@craftlayer/contracts";

const day = 86400000,
  overdueAfter = 3600000,
  // A weekly copy may land a day late without alarming the parent dashboard.
  offhostWindow = 8 * day;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, value);
  }
  return value;
}
/** The zone's wall clock at an instant, expressed as if it were UTC milliseconds. */
function wallAt(zone: string, instant: number) {
  const parts: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(instant))
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  return Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
}
const offsetAt = (zone: string, instant: number) =>
  wallAt(zone, instant) - Math.floor(instant / 1000) * 1000;
/**
 * Resolve a wall time. A repeated time runs once, at its first instant. A skipped time
 * runs just after the gap, by the offset in force before it, so no daily run is lost.
 */
function resolve(zone: string, wall: number) {
  const before = offsetAt(zone, wall - day),
    after = offsetAt(zone, wall + day),
    matches = [...new Set([wall - before, wall - after])]
      .filter((instant) => wallAt(zone, instant) === wall)
      .sort((a, b) => a - b),
    first = matches[0];
  if (first !== undefined)
    return {
      instant: first,
      adjustment: matches.length > 1 ? "repeated" : "none",
    } as const;
  return { instant: wall - before, adjustment: "skipped" } as const;
}
const dateKey = (wall: number) => new Date(wall).toISOString().slice(0, 10);
const dateWall = (key: string) => Date.parse(`${key}T00:00:00.000Z`);

/**
 * One logical backup per policy and local date. Revision is deliberately excluded:
 * editing a policy must not make a second backup for a date already taken.
 */
export function backupOccurrence(input: BackupPolicy, localDate: string) {
  const policy = backupPolicy.parse(input),
    midnight = dateWall(localDate);
  if (!Number.isFinite(midnight) || dateKey(midnight) !== localDate)
    throw new Error("BACKUP_LOCAL_DATE_INVALID");
  const [hour, minute] = policy.local_time.split(":").map(Number),
    resolved = resolve(
      policy.timezone,
      midnight + (hour ?? 0) * 3600000 + (minute ?? 0) * 60000,
    );
  return {
    occurrence_id: createHash("sha256")
      .update(`backup.occurrence.v1/${policy.policy_id}/${localDate}`)
      .digest("hex"),
    local_date: localDate,
    scheduled_at: new Date(resolved.instant).toISOString(),
    adjustment: resolved.adjustment,
    offhost_copy: new Date(midnight).getUTCDay() === policy.offhost_weekday,
  };
}
/**
 * Decide what the scheduler may do now. At most one occurrence is ever due, so an
 * outage can never produce a burst of catch-up runs against a live world.
 */
export function reconcileBackupSchedule(
  input: BackupPolicy,
  lastLocalDate: string | null,
  now: number,
) {
  const policy = backupPolicy.parse(input);
  if (!Number.isSafeInteger(now)) throw new Error("BACKUP_CLOCK_INVALID");
  const today = dateKey(wallAt(policy.timezone, now)),
    occurrence = (offset: number) =>
      backupOccurrence(policy, dateKey(dateWall(today) + offset * day)),
    current = occurrence(0),
    latest = Date.parse(current.scheduled_at) <= now ? current : occurrence(-1),
    next = latest === current ? occurrence(1) : current;
  if (lastLocalDate !== null && lastLocalDate > latest.local_date)
    return { status: "clock_anomaly", due: null, missed: 0, next } as const;
  if (lastLocalDate === latest.local_date)
    return { status: "current", due: null, missed: 0, next } as const;
  const missed =
      lastLocalDate === null
        ? 0
        : Math.round(
            (dateWall(latest.local_date) - dateWall(lastLocalDate)) / day,
          ) - 1,
    late = now - Date.parse(latest.scheduled_at) > overdueAfter;
  return {
    status: missed > 0 || late ? "overdue" : "due",
    due: latest,
    missed,
    next,
  } as const;
}
const time = (value: string | null) =>
  value === null ? null : Date.parse(value);
function newest(
  records: readonly BackupRecord[],
  field: "verified_at" | "restore_tested_at" | "offhost_verified_at",
) {
  let best: BackupRecord | undefined;
  for (const r of records)
    if (
      r.state === "complete" &&
      r[field] !== null &&
      (!best || Date.parse(r.created_at) > Date.parse(best.created_at))
    )
      best = r;
  return best;
}
/**
 * Choose what retention may remove. This only proposes; deletion stays a separate
 * audited effect. With no verified backup, every complete one is kept: an unproven
 * archive may still be the only copy of a family world.
 */
export function planBackupRetention(
  input: BackupPolicy,
  values: readonly BackupRecord[],
  now: number,
) {
  const policy = backupPolicy.parse(input),
    records = values.map((v) => backupRecord.parse(v));
  if (!Number.isSafeInteger(now)) throw new Error("BACKUP_CLOCK_INVALID");
  const cutoff = now - policy.retention_days * day,
    verified = newest(records, "verified_at"),
    protectedIds = new Map<string, string>();
  for (const [field, reason] of [
    ["offhost_verified_at", "last_offhost_verified"],
    ["verified_at", "last_verified"],
    ["restore_tested_at", "last_restore_tested"],
  ] as const) {
    const r = newest(records, field);
    if (r) protectedIds.set(r.id, reason);
  }
  const keep: { id: string; reason: string }[] = [],
    expire: string[] = [];
  for (const r of records) {
    const reason = r.legal_hold
      ? "legal_hold"
      : (protectedIds.get(r.id) ??
        (r.state === "pending"
          ? "in_progress"
          : Date.parse(r.created_at) >= cutoff
            ? "within_retention"
            : r.state === "complete" && !verified
              ? "no_verified_backup"
              : null));
    if (reason) keep.push({ id: r.id, reason });
    else expire.push(r.id);
  }
  return { keep, expire };
}
/**
 * Local, off-host and restore evidence stay separate: one healthy signal must never
 * imply another. Absent evidence reports "none", never healthy.
 */
export function backupHealth(
  input: BackupPolicy,
  values: readonly BackupRecord[],
  now: number,
) {
  backupPolicy.parse(input);
  const records = values.map((v) => backupRecord.parse(v)),
    local = newest(records, "verified_at"),
    offhost = newest(records, "offhost_verified_at"),
    restore = newest(records, "restore_tested_at"),
    localAt = local ? Date.parse(local.created_at) : null,
    offhostAt = time(offhost?.offhost_verified_at ?? null);
  return {
    local:
      localAt === null
        ? "none"
        : now - localAt <= day + overdueAfter
          ? "healthy"
          : "overdue",
    offhost:
      offhostAt === null
        ? "none"
        : now - offhostAt <= offhostWindow
          ? "healthy"
          : "overdue",
    restore: restore ? "tested" : "none",
    last_restore_tested_at: restore?.restore_tested_at ?? null,
    recovery_point_age_ms: localAt === null ? null : now - localAt,
  } as const;
}
