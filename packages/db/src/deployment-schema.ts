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

// SQL 0026 owns canonical review guards, bounded expiry, immutable state and forced RLS.
export const minecraftDeploymentApprovalRequests = pgTable(
  "minecraft_deployment_approval_requests",
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
    reviewHash: char("review_hash", { length: 64 }).notNull(),
    review: jsonb("review").notNull(),
    nodeGrant: jsonb("node_grant").notNull(),
    serverGrant: jsonb("server_grant").notNull(),
    state: text("state").notNull().default("awaiting_review"),
    executionEnabled: boolean("execution_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.intentId),
    unique().on(t.organizationId, t.actorId, t.requestKey),
    index("minecraft_deployment_approval_requests_scope").on(
      t.organizationId,
      t.projectId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
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
export const minecraftDeploymentApprovalRequestOutbox = pgTable(
  "minecraft_deployment_approval_request_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.requestId),
    foreignKey({
      columns: [t.organizationId, t.requestId],
      foreignColumns: [
        minecraftDeploymentApprovalRequests.organizationId,
        minecraftDeploymentApprovalRequests.id,
      ],
    }),
  ],
);

// SQL 0027 owns reviewer independence, exact review binding, immutability and forced RLS.
export const minecraftDeploymentApprovalDecisions = pgTable(
  "minecraft_deployment_approval_decisions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    reviewerId: uuid("reviewer_id").notNull(),
    reviewerSessionId: uuid("reviewer_session_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    reviewHash: char("review_hash", { length: 64 }).notNull(),
    stopHash: char("stop_hash", { length: 64 }).notNull(),
    decisionHash: char("decision_hash", { length: 64 }).notNull(),
    decision: text("decision").notNull(),
    reviewerApprovalGrant: jsonb("reviewer_approval_grant").notNull(),
    reviewerNodeGrant: jsonb("reviewer_node_grant"),
    reviewerServerGrant: jsonb("reviewer_server_grant"),
    executionEnabled: boolean("execution_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.requestId),
    unique().on(t.organizationId, t.reviewerId, t.requestKey),
    foreignKey({
      columns: [t.organizationId, t.requestId],
      foreignColumns: [
        minecraftDeploymentApprovalRequests.organizationId,
        minecraftDeploymentApprovalRequests.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.reviewerId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftDeploymentApprovalRevocations = pgTable(
  "minecraft_deployment_approval_revocations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    approvalGrant: jsonb("approval_grant").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.decisionId),
    unique().on(t.organizationId, t.actorId, t.requestKey),
    foreignKey({
      columns: [t.organizationId, t.decisionId],
      foreignColumns: [
        minecraftDeploymentApprovalDecisions.organizationId,
        minecraftDeploymentApprovalDecisions.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const minecraftDeploymentApprovalDecisionOutbox = pgTable(
  "minecraft_deployment_approval_decision_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    decisionId: uuid("decision_id").notNull(),
    event: text("event").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.decisionId, t.event),
    foreignKey({
      columns: [t.organizationId, t.decisionId],
      foreignColumns: [
        minecraftDeploymentApprovalDecisions.organizationId,
        minecraftDeploymentApprovalDecisions.id,
      ],
    }),
  ],
);
