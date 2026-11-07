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
