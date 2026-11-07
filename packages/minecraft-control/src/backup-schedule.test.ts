import { randomUUID } from "node:crypto";
import type { BackupRecord } from "@craftlayer/contracts";
import { backupPolicy } from "@craftlayer/contracts";
import { describe, expect, it } from "vitest";
import {
  backupHealth,
  backupOccurrence,
  planBackupRetention,
  reconcileBackupSchedule,
} from "./backup-schedule.js";

const day = 86400000,
  policy = (changes = {}) => ({
    policy_id: "11111111-1111-4111-8111-111111111111",
    timezone: "Europe/London",
    local_time: "04:00",
    retention_days: 14,
    offhost_weekday: 0,
    ...changes,
  }),
  at = (value: string) => Date.parse(value);

describe("backup policy contract", () => {
  it("refuses short retention, unknown zones and malformed times", () => {
    expect(backupPolicy.parse(policy())).toEqual(policy());
    for (const bad of [
      { retention_days: 13 },
      { timezone: "Mars/Olympus" },
      { local_time: "24:00" },
      { local_time: "4:00" },
      { offhost_weekday: 7 },
      { schedule: "* * * * *" },
    ])
      expect(() => backupPolicy.parse(policy(bad))).toThrow();
  });
});

describe("occurrences", () => {
  it("is stable per policy and date, and independent of later policy edits", () => {
    const first = backupOccurrence(policy(), "2026-11-07"),
      edited = backupOccurrence(policy({ local_time: "23:30" }), "2026-11-07");
    expect(first.occurrence_id).toBe(edited.occurrence_id);
    expect(first.occurrence_id).not.toBe(
      backupOccurrence(policy(), "2026-11-08").occurrence_id,
    );
    expect(first.occurrence_id).not.toBe(
      backupOccurrence(policy({ policy_id: randomUUID() }), "2026-11-07")
        .occurrence_id,
    );
    for (const bad of ["2026-02-30", "2026-13-01", "yesterday", ""])
      expect(() => backupOccurrence(policy(), bad)).toThrow(
        "BACKUP_LOCAL_DATE_INVALID",
      );
  });
  it("runs a skipped spring time just after the gap and never loses the day", () => {
    const value = backupOccurrence(
      policy({ local_time: "01:30" }),
      "2026-03-29",
    );
    expect(value).toMatchObject({
      adjustment: "skipped",
      scheduled_at: "2026-03-29T01:30:00.000Z",
    });
    expect(
      backupOccurrence(
        policy({ timezone: "America/New_York", local_time: "02:30" }),
        "2026-03-08",
      ),
    ).toMatchObject({
      adjustment: "skipped",
      scheduled_at: "2026-03-08T07:30:00.000Z",
    });
  });
  it("runs a repeated autumn time once, at the first instant", () => {
    expect(
      backupOccurrence(policy({ local_time: "01:30" }), "2026-10-25"),
    ).toMatchObject({
      adjustment: "repeated",
      scheduled_at: "2026-10-25T00:30:00.000Z",
    });
  });
  it("handles half-hour zones and half-hour daylight shifts", () => {
    expect(
      backupOccurrence(
        policy({ timezone: "Asia/Kolkata", local_time: "04:00" }),
        "2026-07-01",
      ).scheduled_at,
    ).toBe("2026-06-30T22:30:00.000Z");
    expect(
      backupOccurrence(
        policy({ timezone: "Australia/Lord_Howe", local_time: "02:15" }),
        "2026-10-04",
      ).adjustment,
    ).toBe("skipped");
  });
  it("marks exactly the configured local weekday for the off-host copy", () => {
    expect(backupOccurrence(policy(), "2026-11-08").offhost_copy).toBe(true);
    expect(backupOccurrence(policy(), "2026-11-07").offhost_copy).toBe(false);
  });
  it("keeps every day of two years distinct, ordered and on time across zones", () => {
    for (const timezone of [
      "Europe/London",
      "America/New_York",
      "Australia/Lord_Howe",
      "Asia/Kolkata",
      "UTC",
    ])
      for (const local_time of ["00:00", "01:30", "02:30", "23:59"]) {
        const value = policy({ timezone, local_time });
        let previous = 0;
        for (let i = 0; i < 730; i++) {
          const date = new Date(at("2026-01-01T00:00:00Z") + i * day)
              .toISOString()
              .slice(0, 10),
            instant = Date.parse(backupOccurrence(value, date).scheduled_at);
          expect(instant).toBeGreaterThan(previous);
          if (previous) {
            expect(instant - previous).toBeGreaterThan(21 * 3600000);
            expect(instant - previous).toBeLessThan(27 * 3600000);
          }
          previous = instant;
        }
      }
  });
});

describe("schedule reconciliation", () => {
  const now = at("2026-11-07T05:00:00Z");
  it("offers today's occurrence once and then reports current", () => {
    expect(reconcileBackupSchedule(policy(), "2026-11-06", now)).toMatchObject({
      status: "due",
      missed: 0,
      due: { local_date: "2026-11-07" },
    });
    expect(
      reconcileBackupSchedule(policy(), "2026-11-06", now + 1),
    ).toMatchObject({ status: "overdue", missed: 0 });
    expect(
      reconcileBackupSchedule(
        policy(),
        "2026-11-06",
        at("2026-11-07T04:10:00Z"),
      ),
    ).toMatchObject({ status: "due", due: { local_date: "2026-11-07" } });
    expect(reconcileBackupSchedule(policy(), "2026-11-07", now)).toMatchObject({
      status: "current",
      due: null,
      next: { local_date: "2026-11-08" },
    });
  });
  it("waits for the scheduled time on a new local date", () => {
    expect(
      reconcileBackupSchedule(
        policy(),
        "2026-11-06",
        at("2026-11-07T03:59:00Z"),
      ),
    ).toMatchObject({
      status: "current",
      due: null,
      next: { local_date: "2026-11-07" },
    });
  });
  it("reduces a long outage to one overdue occurrence with the true missed count", () => {
    const value = reconcileBackupSchedule(policy(), "2026-10-01", now);
    expect(value).toMatchObject({
      status: "overdue",
      missed: 36,
      due: { local_date: "2026-11-07" },
    });
    expect(reconcileBackupSchedule(policy(), "2026-11-07", now).due).toBeNull();
  });
  it("uses the local date, not UTC, near midnight", () => {
    expect(
      reconcileBackupSchedule(
        policy({ timezone: "Pacific/Auckland", local_time: "00:30" }),
        null,
        at("2026-11-07T12:00:00Z"),
      ).due?.local_date,
    ).toBe("2026-11-08");
  });
  it("stops rather than guesses when the clock is behind recorded history", () => {
    expect(reconcileBackupSchedule(policy(), "2026-11-09", now)).toMatchObject({
      status: "clock_anomaly",
      due: null,
    });
    expect(() => reconcileBackupSchedule(policy(), null, Number.NaN)).toThrow(
      "BACKUP_CLOCK_INVALID",
    );
  });
});

describe("retention", () => {
  const now = at("2026-11-07T00:00:00Z"),
    backup = (age: number, changes: Partial<BackupRecord> = {}) => ({
      id: randomUUID(),
      state: "complete" as const,
      created_at: new Date(now - age * day).toISOString(),
      verified_at: new Date(now - age * day).toISOString(),
      restore_tested_at: null,
      offhost_verified_at: null,
      legal_hold: false,
      ...changes,
    }),
    reason = (
      plan: ReturnType<typeof planBackupRetention>,
      value: { id: string },
    ) => plan.keep.find((x) => x.id === value.id)?.reason;
  it("expires old verified backups but keeps the retention window", () => {
    const fresh = backup(2),
      boundary = backup(14),
      old = backup(15),
      plan = planBackupRetention(policy(), [fresh, boundary, old], now);
    expect(plan.expire).toEqual([old.id]);
    expect(reason(plan, boundary)).toBe("within_retention");
  });
  it("never removes the last verified, off-host or restore-tested backup", () => {
    const restored = backup(90, { restore_tested_at: "2026-08-10T00:00:00Z" }),
      offsite = backup(60, { offhost_verified_at: "2026-09-08T00:00:00Z" }),
      other = backup(70),
      plan = planBackupRetention(policy(), [restored, offsite, other], now);
    expect(reason(plan, restored)).toBe("last_restore_tested");
    expect(reason(plan, offsite)).toBeDefined();
    expect(plan.expire).toEqual([other.id]);
  });
  it("keeps every complete backup when none is verified", () => {
    const old = backup(200, { verified_at: null }),
      plan = planBackupRetention(policy(), [old], now);
    expect(plan.expire).toEqual([]);
    expect(reason(plan, old)).toBe("no_verified_backup");
  });
  it("does not let an unverified newer backup protect or displace a verified one", () => {
    const verified = backup(40),
      unverified = backup(30, { verified_at: null }),
      plan = planBackupRetention(policy(), [verified, unverified], now);
    expect(reason(plan, verified)).toBe("last_verified");
    expect(plan.expire).toEqual([unverified.id]);
  });
  it("keeps holds and in-progress work, and expires old failures", () => {
    const held = backup(400, { legal_hold: true }),
      pending = backup(400, { state: "pending", verified_at: null }),
      failed = backup(30, { state: "failed", verified_at: null }),
      keeper = backup(1),
      plan = planBackupRetention(
        policy(),
        [held, pending, failed, keeper],
        now,
      );
    expect(reason(plan, held)).toBe("legal_hold");
    expect(reason(plan, pending)).toBe("in_progress");
    expect(plan.expire).toEqual([failed.id]);
  });
  it("does not count a failed record as verified evidence", () => {
    const failed = backup(1, { state: "failed" }),
      old = backup(100, { verified_at: null }),
      plan = planBackupRetention(policy(), [failed, old], now);
    expect(reason(plan, old)).toBe("no_verified_backup");
  });
  it("applies longer configured retention", () => {
    const value = backup(20);
    expect(
      planBackupRetention(
        policy({ retention_days: 30 }),
        [value, backup(1)],
        now,
      ).expire,
    ).toEqual([]);
  });
});

describe("health", () => {
  const now = at("2026-11-07T12:00:00Z"),
    record = (hours: number, changes: Partial<BackupRecord> = {}) => {
      const stamp = new Date(now - hours * 3600000).toISOString();
      return {
        id: randomUUID(),
        state: "complete" as const,
        created_at: stamp,
        verified_at: stamp,
        restore_tested_at: null,
        offhost_verified_at: null,
        legal_hold: false,
        ...changes,
      };
    };
  it("reports absent evidence as none, never healthy", () => {
    expect(backupHealth(policy(), [], now)).toEqual({
      local: "none",
      offhost: "none",
      restore: "none",
      last_restore_tested_at: null,
      recovery_point_age_ms: null,
    });
    expect(
      backupHealth(policy(), [record(1, { verified_at: null })], now).local,
    ).toBe("none");
  });
  it("keeps local, off-host and restore evidence independent", () => {
    expect(backupHealth(policy(), [record(2)], now)).toMatchObject({
      local: "healthy",
      offhost: "none",
      restore: "none",
      recovery_point_age_ms: 7200000,
    });
    expect(backupHealth(policy(), [record(26)], now).local).toBe("overdue");
    expect(
      backupHealth(
        policy(),
        [
          record(2),
          record(24 * 9, {
            offhost_verified_at: new Date(now - 9 * day).toISOString(),
          }),
        ],
        now,
      ).offhost,
    ).toBe("overdue");
  });
  it("ages recovery point from creation, not from a later verification", () => {
    expect(
      backupHealth(
        policy(),
        [record(30, { verified_at: new Date(now).toISOString() })],
        now,
      ),
    ).toMatchObject({ local: "overdue", recovery_point_age_ms: 108000000 });
  });
});
