import {
  bigint,
  boolean,
  char,
  date,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { memberships } from "./identity-schema.js";
import { managementOperations, minecraftServers } from "./management-schema.js";

// SQL 0029 is authoritative for RLS, grants, revision/transition triggers and CHECKs.
const scope = {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  serverId: uuid("server_id").notNull(),
};
export const minecraftBackupPolicies = pgTable(
  "minecraft_backup_policies",
  {
    ...scope,
    policyId: uuid("policy_id").notNull(),
    revision: integer("revision").notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    localTime: char("local_time", { length: 5 }).notNull(),
    retentionDays: integer("retention_days").notNull(),
    offhostWeekday: integer("offhost_weekday").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by").notNull(),
    operationId: uuid("operation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.serverId, t.revision),
    unique().on(t.organizationId, t.operationId),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.serverId],
      foreignColumns: [
        minecraftServers.organizationId,
        minecraftServers.projectId,
        minecraftServers.environmentId,
        minecraftServers.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.serverId, t.operationId],
      foreignColumns: [
        managementOperations.organizationId,
        managementOperations.serverId,
        managementOperations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.createdBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftBackupOccurrences = pgTable(
  "minecraft_backup_occurrences",
  {
    ...scope,
    policyId: uuid("policy_id").notNull(),
    policyRevision: integer("policy_revision").notNull(),
    occurrenceKey: char("occurrence_key", { length: 64 }).notNull(),
    kind: text("kind").notNull(),
    localDate: date("local_date"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    offhostCopy: boolean("offhost_copy").notNull().default(false),
    state: text("state").notNull().default("pending"),
    failureCode: text("failure_code").notNull().default("none"),
    requestedBy: uuid("requested_by"),
    operationId: uuid("operation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.serverId, t.occurrenceKey),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.serverId],
      foreignColumns: [
        minecraftServers.organizationId,
        minecraftServers.projectId,
        minecraftServers.environmentId,
        minecraftServers.id,
      ],
    }),
  ],
);
export const minecraftBackups = pgTable(
  "minecraft_backups",
  {
    ...scope,
    occurrenceId: uuid("occurrence_id").notNull(),
    state: text("state").notNull().default("pending"),
    archiveSha256: char("archive_sha256", { length: 64 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    manifestHash: char("manifest_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    offhostVerifiedAt: timestamp("offhost_verified_at", { withTimezone: true }),
    restoreTestedAt: timestamp("restore_tested_at", { withTimezone: true }),
    legalHold: boolean("legal_hold").notNull().default(false),
    legalHoldChangedBy: uuid("legal_hold_changed_by"),
    legalHoldChangedAt: timestamp("legal_hold_changed_at", {
      withTimezone: true,
    }),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.occurrenceId),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.serverId],
      foreignColumns: [
        minecraftServers.organizationId,
        minecraftServers.projectId,
        minecraftServers.environmentId,
        minecraftServers.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.occurrenceId],
      foreignColumns: [
        minecraftBackupOccurrences.organizationId,
        minecraftBackupOccurrences.id,
      ],
    }),
  ],
);
export const minecraftBackupOutbox = pgTable(
  "minecraft_backup_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    occurrenceId: uuid("occurrence_id").notNull(),
    event: text("event").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.occurrenceId],
      foreignColumns: [
        minecraftBackupOccurrences.organizationId,
        minecraftBackupOccurrences.id,
      ],
    }),
  ],
);
