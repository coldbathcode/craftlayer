import { z } from "zod";

const id = z.uuid().refine((v) => v === v.toLowerCase());
const zone = z
  .string()
  .min(1)
  .max(64)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");
// Policy data only. It grants no save, archive, restore or transfer capability.
export const backupPolicy = z.strictObject({
  policy_id: id,
  timezone: zone,
  local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  retention_days: z.number().int().min(14).max(3650),
  offhost_weekday: z.number().int().min(0).max(6),
});
export const backupRecord = z.strictObject({
  id,
  state: z.enum(["pending", "complete", "failed"]),
  created_at: z.iso.datetime(),
  verified_at: z.iso.datetime().nullable(),
  restore_tested_at: z.iso.datetime().nullable(),
  offhost_verified_at: z.iso.datetime().nullable(),
  legal_hold: z.boolean(),
});
export type BackupPolicy = z.infer<typeof backupPolicy>;
export type BackupRecord = z.infer<typeof backupRecord>;
// Durable records (master plan D1). Views only; none of these implies a backup exists on disk.
export const backupPolicyInput = backupPolicy.omit({ policy_id: true }).extend({
  enabled: z.boolean().default(true),
});
export const backupScheduleView = z.strictObject({
  status: z.enum(["current", "due", "overdue", "clock_anomaly", "disabled"]),
  due_local_date: z.string().nullable(),
  missed: z.number().int().min(0),
  next_scheduled_at: z.iso.datetime().nullable(),
});
export const backupHealthView = z.strictObject({
  local: z.enum(["none", "healthy", "overdue"]),
  offhost: z.enum(["none", "healthy", "overdue"]),
  restore: z.enum(["none", "tested"]),
  last_restore_tested_at: z.iso.datetime().nullable(),
  recovery_point_age_ms: z.number().int().min(0).nullable(),
});
export const backupPolicyView = z.strictObject({
  server_id: id,
  policy_id: id,
  revision: z.number().int().positive(),
  timezone: zone,
  local_time: backupPolicy.shape.local_time,
  retention_days: backupPolicy.shape.retention_days,
  offhost_weekday: backupPolicy.shape.offhost_weekday,
  enabled: z.boolean(),
  created_at: z.iso.datetime(),
  schedule: backupScheduleView,
  health: backupHealthView,
  /** Always false until a restore has been proven on this server. */
  family_ready: z.literal(false),
});
export const backupStatusView = z.strictObject({
  server_id: id,
  policy: backupPolicyView.nullable(),
  open_occurrence: id.nullable(),
  can_manage: z.boolean(),
});
export const backupOccurrenceView = z.strictObject({
  id,
  kind: z.enum(["scheduled", "manual"]),
  local_date: z.string().nullable(),
  scheduled_at: z.iso.datetime(),
  offhost_copy: z.boolean(),
  state: z.enum(["pending", "running", "complete", "failed"]),
  failure_code: z.enum([
    "none",
    "node_unavailable",
    "save_failed",
    "archive_failed",
    "verification_failed",
    "cancelled",
    "interrupted",
  ]),
  created_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
});
export const backupItemView = backupRecord.extend({
  occurrence: backupOccurrenceView,
  archive_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  size_bytes: z.number().int().min(0).nullable(),
  completed_at: z.iso.datetime().nullable(),
});
export const backupListView = z.strictObject({
  server_id: id,
  items: z.array(backupItemView).max(200),
  retention: z.strictObject({
    keep: z.array(z.strictObject({ id, reason: z.string() })).max(200),
    expire: z.array(id).max(200),
  }),
});
export const backupRequestAccepted = z.strictObject({
  operation_id: id,
  occurrence_id: id,
  server_id: id,
  state: z.enum(["pending", "running"]),
});
export const legalHoldRequest = z.strictObject({ legal_hold: z.boolean() });
export type BackupPolicyInput = z.infer<typeof backupPolicyInput>;
export type BackupPolicyView = z.infer<typeof backupPolicyView>;
export type BackupStatusView = z.infer<typeof backupStatusView>;
export type BackupListView = z.infer<typeof backupListView>;
