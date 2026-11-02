import {
  boolean,
  char,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { memberships } from "./identity-schema.js";
import {
  minecraftReservationOperations,
  minecraftReservations,
} from "./reservation-schema.js";
// SQL 0021 additionally owns immutable intake/dispatch-kind guards, forced RLS and grants.
export const minecraftDeploymentIntents = pgTable(
  "minecraft_deployment_intents",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    dispatchOperationId: uuid("dispatch_operation_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    state: text("state").notNull().default("pending_qualification"),
    executionEnabled: boolean("execution_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.reservationId),
    unique().on(t.organizationId, t.actorId, t.requestKey),
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
      columns: [t.organizationId, t.reservationId, t.dispatchOperationId],
      foreignColumns: [
        minecraftReservationOperations.organizationId,
        minecraftReservationOperations.reservationId,
        minecraftReservationOperations.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftDeploymentIntentOutbox = pgTable(
  "minecraft_deployment_intent_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    intentId: uuid("intent_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.intentId),
    foreignKey({
      columns: [t.organizationId, t.intentId],
      foreignColumns: [
        minecraftDeploymentIntents.organizationId,
        minecraftDeploymentIntents.id,
      ],
    }),
  ],
);
