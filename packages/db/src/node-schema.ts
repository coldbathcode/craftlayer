import {
  char,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { memberships } from "./identity-schema.js";
import { projects } from "./schema.js";
// SQL 0018 owns RLS, append-only history, transition checks and restricted grants.
export const minecraftNodes = pgTable(
  "minecraft_nodes",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    state: text("state").notNull(),
    version: integer("version").notNull().default(1),
    credentialVersion: integer("credential_version").notNull().default(1),
    enrollmentExpiresAt: timestamp("enrollment_expires_at", {
      withTimezone: true,
    }).notNull(),
    lastSequence: integer("last_sequence").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    capacity: jsonb("capacity"),
    enrolledBy: uuid("enrolled_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.id),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.enrolledBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftNodeCredentials = pgTable(
  "minecraft_node_credentials",
  {
    organizationId: uuid("organization_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    version: integer("version").notNull(),
    publicKey: varchar("public_key", { length: 59 }).notNull().unique(),
    certificateSha256: char("certificate_sha256", { length: 64 })
      .notNull()
      .unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.nodeId, t.version] }),
    foreignKey({
      columns: [t.organizationId, t.nodeId],
      foreignColumns: [minecraftNodes.organizationId, minecraftNodes.id],
    }),
  ],
);
export const minecraftNodeOperations = pgTable(
  "minecraft_node_operations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    kind: text("kind").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.actorId, t.kind, t.requestKey),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.nodeId],
      foreignColumns: [
        minecraftNodes.organizationId,
        minecraftNodes.projectId,
        minecraftNodes.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftNodeOutbox = pgTable(
  "minecraft_node_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.operationId],
      foreignColumns: [
        minecraftNodeOperations.organizationId,
        minecraftNodeOperations.id,
      ],
    }),
  ],
);
