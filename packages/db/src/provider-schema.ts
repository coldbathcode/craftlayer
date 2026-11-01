import {
  bigserial,
  boolean,
  char,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { memberships } from "./identity-schema.js";
import { organizations, projects } from "./schema.js";

// SQL migrations remain authoritative for security policies, grants and CHECKs.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    endpointId: varchar("endpoint_id", { length: 40 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    credentialVersion: integer("credential_version").notNull().default(0),
    keyId: varchar("key_id", { length: 40 }),
    credentialPayload: bytea("credential_payload"),
    catalogRequestedAt: timestamp("catalog_requested_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("provider_connections_org_id").on(t.organizationId, t.id),
    index("provider_connections_org").on(t.organizationId, t.createdAt, t.id),
  ],
);
export const modelSnapshots = pgTable(
  "model_snapshots",
  {
    organizationId: uuid("organization_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    connectionVersion: integer("connection_version").notNull(),
    modelId: varchar("model_id", { length: 180 }).notNull(),
    descriptor: jsonb("descriptor").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.connectionId, t.modelId] }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [
        providerConnections.organizationId,
        providerConnections.id,
      ],
    }),
    index("model_snapshots_expiry").on(t.organizationId, t.expiresAt),
  ],
);

export const providerRoutingState = pgTable("provider_routing_state", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  version: integer("version").notNull().default(1),
  stopped: boolean("stopped").notNull().default(false),
});
export const providerScopePolicies = pgTable(
  "provider_scope_policies",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    scopeKind: text("scope_kind").notNull(),
    scopeId: uuid("scope_id").notNull(),
    version: integer("version").notNull().default(1),
    policy: jsonb("policy").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.scopeKind, t.scopeId] })],
);
export const providerCooldowns = pgTable(
  "provider_cooldowns",
  {
    organizationId: uuid("organization_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    retryAt: timestamp("retry_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.connectionId] }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [
        providerConnections.organizationId,
        providerConnections.id,
      ],
    }),
  ],
);
export const providerBudgetLimits = pgTable(
  "provider_budget_limits",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    scopeKind: text("scope_kind").notNull(),
    scopeId: uuid("scope_id").notNull(),
    version: integer("version").notNull().default(0),
    limits: jsonb("limits").notNull(),
    activeCount: integer("active_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.scopeKind, t.scopeId] })],
);
const counterColumns = () => ({
  reservedCalls: numeric("reserved_calls", { precision: 38, scale: 0 })
    .notNull()
    .default("0"),
  reservedInputTokens: numeric("reserved_input_tokens", {
    precision: 38,
    scale: 0,
  })
    .notNull()
    .default("0"),
  reservedOutputTokens: numeric("reserved_output_tokens", {
    precision: 38,
    scale: 0,
  })
    .notNull()
    .default("0"),
  reservedTotalTokens: numeric("reserved_total_tokens", {
    precision: 38,
    scale: 0,
  })
    .notNull()
    .default("0"),
  reservedMicroUsd: numeric("reserved_micro_usd", { precision: 38, scale: 0 })
    .notNull()
    .default("0"),
  usedCalls: numeric("used_calls", { precision: 38, scale: 0 })
    .notNull()
    .default("0"),
  usedInputTokens: numeric("used_input_tokens", { precision: 38, scale: 0 })
    .notNull()
    .default("0"),
  usedOutputTokens: numeric("used_output_tokens", { precision: 38, scale: 0 })
    .notNull()
    .default("0"),
  usedTotalTokens: numeric("used_total_tokens", { precision: 38, scale: 0 })
    .notNull()
    .default("0"),
  usedMicroUsd: numeric("used_micro_usd", { precision: 38, scale: 0 })
    .notNull()
    .default("0"),
});
export const providerBudgetWindows = pgTable(
  "provider_budget_windows",
  {
    organizationId: uuid("organization_id").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: uuid("scope_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    ...counterColumns(),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.scopeKind, t.scopeId, t.windowStart],
    }),
    foreignKey({
      columns: [t.organizationId, t.scopeKind, t.scopeId],
      foreignColumns: [
        providerBudgetLimits.organizationId,
        providerBudgetLimits.scopeKind,
        providerBudgetLimits.scopeId,
      ],
    }),
  ],
);
export const providerInstanceActive = pgTable("provider_instance_active", {
  id: boolean("id").primaryKey().default(true),
  activeCount: integer("active_count").notNull().default(0),
});
export const providerInstanceWindows = pgTable("provider_instance_windows", {
  windowStart: timestamp("window_start", { withTimezone: true }).primaryKey(),
  ...counterColumns(),
});
export const providerRequests = pgTable(
  "provider_requests",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    missionId: uuid("mission_id"),
    taskId: uuid("task_id"),
    inputHash: char("input_hash", { length: 64 }).notNull(),
    state: text("state").notNull().default("claimed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.requestId),
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
  ],
);
export const usageReservations = pgTable(
  "usage_reservations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    requestPk: uuid("request_pk").notNull(),
    attempt: integer("attempt").notNull(),
    connectionId: uuid("connection_id").notNull(),
    connectionVersion: integer("connection_version").notNull(),
    modelId: varchar("model_id", { length: 180 }).notNull(),
    pricing: jsonb("pricing").notNull(),
    policyEpoch: char("policy_epoch", { length: 64 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("reserved"),
    inputMax: numeric("input_max", { precision: 38, scale: 0 }).notNull(),
    outputMax: numeric("output_max", { precision: 38, scale: 0 }).notNull(),
    toolMax: integer("tool_max").notNull().default(0),
    maxCost: numeric("max_cost", { precision: 38, scale: 0 }).notNull(),
    chargedInput: numeric("charged_input", { precision: 38, scale: 0 }),
    chargedOutput: numeric("charged_output", { precision: 38, scale: 0 }),
    chargedCost: numeric("charged_cost", { precision: 38, scale: 0 }),
    usageQuality: text("usage_quality"),
    providerRequestId: varchar("provider_request_id", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.requestPk, t.attempt),
    foreignKey({
      columns: [t.organizationId, t.requestPk],
      foreignColumns: [providerRequests.organizationId, providerRequests.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [
        providerConnections.organizationId,
        providerConnections.id,
      ],
    }),
  ],
);
export const reservationBudgetLinks = pgTable(
  "reservation_budget_links",
  {
    organizationId: uuid("organization_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: uuid("scope_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.reservationId],
      foreignColumns: [usageReservations.organizationId, usageReservations.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.scopeKind, t.scopeId, t.windowStart],
      foreignColumns: [
        providerBudgetWindows.organizationId,
        providerBudgetWindows.scopeKind,
        providerBudgetWindows.scopeId,
        providerBudgetWindows.windowStart,
      ],
    }),
    primaryKey({
      columns: [t.organizationId, t.reservationId, t.scopeKind, t.scopeId],
    }),
  ],
);
export const usageLedger = pgTable("usage_ledger", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  reservationId: uuid("reservation_id").notNull(),
  event: text("event").notNull(),
  usageQuality: text("usage_quality").notNull(),
  spendQuality: text("spend_quality").notNull(),
  reservedDelta: jsonb("reserved_delta").notNull(),
  usedDelta: jsonb("used_delta").notNull(),
  receiptHash: char("receipt_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
