import {
  boolean,
  char,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { environments, memberships } from "./identity-schema.js";
// SQL 0016 is authoritative for RLS, grants, immutable bindings and transitions.
export const minecraftServers = pgTable(
  "minecraft_servers",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    targetId: varchar("target_id", { length: 64 }).notNull(),
    bindingHash: char("binding_hash", { length: 64 }).notNull(),
    registered: boolean("registered").notNull().default(true),
    version: integer("version").notNull().default(1),
    observationFence: integer("observation_fence").notNull().default(0),
    observation: jsonb("observation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.environmentId, t.id),
    unique().on(t.organizationId, t.environmentId, t.targetId),
    unique().on(t.organizationId, t.environmentId, t.bindingHash),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId],
      foreignColumns: [
        environments.organizationId,
        environments.projectId,
        environments.id,
      ],
    }),
  ],
);
export const managementOperations = pgTable(
  "management_operations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    serverId: uuid("server_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    kind: text("kind").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    state: text("state").notNull(),
    failureCode: text("failure_code").notNull().default("none"),
    fence: integer("fence").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("management_operations_window").on(
      t.organizationId,
      t.environmentId,
      t.createdAt,
      t.actorId,
    ),
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.serverId, t.id),
    unique().on(t.organizationId, t.actorId, t.kind, t.requestKey),
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
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const managementOutbox = pgTable(
  "management_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.operationId],
      foreignColumns: [
        managementOperations.organizationId,
        managementOperations.id,
      ],
    }),
  ],
);

// SQL 0017 permits pending, immutable requests only; no verified/access columns.
export const minecraftIdentityEnrollments = pgTable(
  "minecraft_identity_enrollments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    serverId: uuid("server_id").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    operationId: uuid("operation_id").notNull(),
    edition: text("edition").notNull(),
    requestedName: varchar("requested_name", { length: 32 }).notNull(),
    state: text("state").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("minecraft_identity_enrollments_history").on(
      t.organizationId,
      t.serverId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("minecraft_identity_enrollments_expiry").on(
      t.organizationId,
      t.serverId,
      t.expiresAt,
    ),
    unique().on(t.organizationId, t.id),
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
      columns: [t.organizationId, t.requestedBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
