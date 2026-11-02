import {
  char,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { minecraftDeploymentIntents } from "./deployment-schema.js";
import { memberships } from "./identity-schema.js";
import { minecraftNodeCredentials } from "./node-schema.js";
import { minecraftReservations } from "./reservation-schema.js";
// SQL 0022 owns immutable command bindings/transitions, forced RLS and restricted grants.
export const minecraftDeploymentJobs = pgTable(
  "minecraft_deployment_jobs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    credentialVersion: integer("credential_version").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    intentId: uuid("intent_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    nodeGrant: jsonb("node_grant").notNull(),
    serverGrant: jsonb("server_grant").notNull(),
    command: jsonb("command").notNull(),
    commandHash: char("command_hash", { length: 64 }).notNull(),
    stopHash: char("stop_hash", { length: 64 }).notNull(),
    leaseId: uuid("lease_id").notNull().unique(),
    attempt: integer("attempt").notNull(),
    fence: integer("fence").notNull(),
    state: text("state").notNull(),
    version: integer("version").notNull().default(1),
    receipt: jsonb("receipt"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.nodeId, t.credentialVersion, t.id),
    unique().on(t.organizationId, t.intentId),
    unique().on(t.organizationId, t.reservationId),
    unique().on(t.organizationId, t.actorId, t.requestKey),
    foreignKey({
      columns: [t.organizationId, t.intentId],
      foreignColumns: [
        minecraftDeploymentIntents.organizationId,
        minecraftDeploymentIntents.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.nodeId, t.credentialVersion],
      foreignColumns: [
        minecraftNodeCredentials.organizationId,
        minecraftNodeCredentials.nodeId,
        minecraftNodeCredentials.version,
      ],
    }),
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
export const minecraftDeploymentJobRequests = pgTable(
  "minecraft_deployment_job_requests",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    credentialVersion: integer("credential_version").notNull(),
    jobId: uuid("job_id").notNull(),
    requestId: uuid("request_id").notNull(),
    permitNonce: uuid("permit_nonce"),
    kind: text("kind").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.nodeId, t.credentialVersion, t.requestId),
    unique().on(t.organizationId, t.jobId, t.permitNonce),
    foreignKey({
      columns: [t.organizationId, t.nodeId, t.credentialVersion, t.jobId],
      foreignColumns: [
        minecraftDeploymentJobs.organizationId,
        minecraftDeploymentJobs.nodeId,
        minecraftDeploymentJobs.credentialVersion,
        minecraftDeploymentJobs.id,
      ],
    }),
  ],
);
export const minecraftDeploymentJobOutbox = pgTable(
  "minecraft_deployment_job_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    jobId: uuid("job_id").notNull(),
    kind: text("kind").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.jobId],
      foreignColumns: [
        minecraftDeploymentJobs.organizationId,
        minecraftDeploymentJobs.id,
      ],
    }),
  ],
);
