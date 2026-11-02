import {
  char,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { minecraftDeploymentIntents } from "./deployment-schema.js";
import { memberships } from "./identity-schema.js";
import { minecraftReservations } from "./reservation-schema.js";
// SQL 0023 supplies original-grant binding, immutable rows, forced RLS and restricted grants.
export const minecraftDeploymentAuthorizations = pgTable(
  "minecraft_deployment_authorizations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    intentId: uuid("intent_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    stopHash: char("stop_hash", { length: 64 }).notNull(),
    nodeGrant: jsonb("node_grant").notNull(),
    serverGrant: jsonb("server_grant").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.intentId),
    unique().on(t.organizationId, t.actorId, t.requestKey),
    foreignKey({
      columns: [t.organizationId, t.intentId],
      foreignColumns: [
        minecraftDeploymentIntents.organizationId,
        minecraftDeploymentIntents.id,
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
export const minecraftDeploymentAuthorizationOutbox = pgTable(
  "minecraft_deployment_authorization_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    authorizationId: uuid("authorization_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.authorizationId),
    foreignKey({
      columns: [t.organizationId, t.authorizationId],
      foreignColumns: [
        minecraftDeploymentAuthorizations.organizationId,
        minecraftDeploymentAuthorizations.id,
      ],
    }),
  ],
);
