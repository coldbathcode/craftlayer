import {
  char,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { environments, memberships } from "./identity-schema.js";
import { minecraftNodes } from "./node-schema.js";

// SQL 0020 additionally owns state transitions, port guards, RLS and restricted grants.
export const minecraftReservations = pgTable(
  "minecraft_reservations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    deploymentId: uuid("deployment_id").notNull().unique(),
    serverId: uuid("server_id").notNull().unique(),
    worldId: uuid("world_id").notNull().unique(),
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    templateId: text("template_id").notNull(),
    planHash: char("plan_hash", { length: 64 }).notNull(),
    templateHash: char("template_hash", { length: 64 }).notNull(),
    policyHash: char("policy_hash", { length: 64 }).notNull(),
    admissionHash: char("admission_hash", { length: 64 }).notNull(),
    nodeVersion: integer("node_version").notNull(),
    credentialVersion: integer("credential_version").notNull(),
    cpuMilli: integer("cpu_milli").notNull(),
    memoryMb: integer("memory_mb").notNull(),
    diskMb: integer("disk_mb").notNull(),
    javaPort: integer("java_port").notNull(),
    bedrockPort: integer("bedrock_port").notNull(),
    state: text("state").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.nodeId, t.id),
    unique().on(t.organizationId, t.projectId, t.environmentId, t.nodeId, t.id),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.nodeId],
      foreignColumns: [
        minecraftNodes.organizationId,
        minecraftNodes.projectId,
        minecraftNodes.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId],
      foreignColumns: [
        environments.organizationId,
        environments.projectId,
        environments.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftReservationPorts = pgTable(
  "minecraft_reservation_ports",
  {
    organizationId: uuid("organization_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    protocol: text("protocol").notNull(),
    port: integer("port").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.protocol, t.port] }),
    foreignKey({
      columns: [t.organizationId, t.nodeId, t.reservationId],
      foreignColumns: [
        minecraftReservations.organizationId,
        minecraftReservations.nodeId,
        minecraftReservations.id,
      ],
    }),
  ],
);
export const minecraftReservationOperations = pgTable(
  "minecraft_reservation_operations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    actorId: uuid("actor_id"),
    sessionId: uuid("session_id"),
    kind: text("kind").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.actorId, t.kind, t.requestKey),
    foreignKey({
      columns: [
        t.organizationId,
        t.projectId,
        t.environmentId,
        t.nodeId,
        t.reservationId,
      ],
      foreignColumns: [
        minecraftReservations.organizationId,
        minecraftReservations.projectId,
        minecraftReservations.environmentId,
        minecraftReservations.nodeId,
        minecraftReservations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftReservationOutbox = pgTable(
  "minecraft_reservation_outbox",
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
        minecraftReservationOperations.organizationId,
        minecraftReservationOperations.id,
      ],
    }),
  ],
);
