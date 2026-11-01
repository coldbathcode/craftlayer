import {
  bigint,
  boolean,
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
import { environments, memberships } from "./identity-schema.js";
import { organizations } from "./schema.js";

// SQL migrations remain authoritative for transition triggers, bounds, grants, partial indexes and forced RLS.
const time = (name: string) => timestamp(name, { withTimezone: true });
export const runtimeAgents = pgTable(
  "runtime_agents",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    adapter: text("adapter").notNull(),
    state: text("state").notNull().default("idle"),
    version: integer("version").notNull().default(1),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.environmentId, t.id),
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
export const runtimeGroups = pgTable(
  "runtime_groups",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.environmentId, t.id),
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
export const runtimeGroupAgents = pgTable(
  "runtime_group_agents",
  {
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    groupId: uuid("group_id").notNull(),
    agentId: uuid("agent_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.groupId, t.agentId] }),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.groupId],
      foreignColumns: [
        runtimeGroups.organizationId,
        runtimeGroups.projectId,
        runtimeGroups.environmentId,
        runtimeGroups.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.agentId],
      foreignColumns: [
        runtimeAgents.organizationId,
        runtimeAgents.projectId,
        runtimeAgents.environmentId,
        runtimeAgents.id,
      ],
    }),
  ],
);
export const runtimeTemplates = pgTable(
  "runtime_templates",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    familyId: uuid("family_id").notNull(),
    version: integer("version").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    adapter: text("adapter").notNull(),
    hash: char("hash", { length: 64 }).notNull(),
    graph: jsonb("graph").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.familyId, t.version),
    unique().on(t.organizationId, t.id, t.hash),
    unique().on(t.organizationId, t.projectId, t.environmentId, t.id, t.hash),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId],
      foreignColumns: [
        environments.organizationId,
        environments.projectId,
        environments.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.createdBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const runtimeMissions = pgTable(
  "runtime_missions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    groupId: uuid("group_id").notNull(),
    templateId: uuid("template_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    templateHash: char("template_hash", { length: 64 }).notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdBy: uuid("created_by").notNull(),
    state: text("state").notNull().default("draft"),
    reason: text("reason").notNull().default("none"),
    version: integer("version").notNull().default(1),
    generation: integer("generation").notNull().default(1),
    executionGrant: jsonb("execution_grant"),
    executionDigest: char("execution_digest", { length: 64 }),
    deadline: time("deadline"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.environmentId, t.id),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.groupId],
      foreignColumns: [
        runtimeGroups.organizationId,
        runtimeGroups.projectId,
        runtimeGroups.environmentId,
        runtimeGroups.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.templateId, t.templateHash],
      foreignColumns: [
        runtimeTemplates.organizationId,
        runtimeTemplates.id,
        runtimeTemplates.hash,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.createdBy],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);
export const runtimeTasks = pgTable(
  "runtime_tasks",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    nodeKey: varchar("node_key", { length: 40 }).notNull(),
    definition: jsonb("definition").notNull(),
    required: boolean("required").notNull(),
    state: text("state").notNull().default("pending"),
    reason: text("reason").notNull().default("dependencies"),
    attemptCount: integer("attempt_count").notNull().default(0),
    fence: integer("fence").notNull().default(0),
    verified: boolean("verified").notNull().default(false),
    result: jsonb("result"),
    nextAttemptAt: time("next_attempt_at").notNull().defaultNow(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.missionId, t.id),
    unique().on(t.organizationId, t.missionId, t.nodeKey),
    foreignKey({
      columns: [t.organizationId, t.missionId],
      foreignColumns: [runtimeMissions.organizationId, runtimeMissions.id],
    }),
  ],
);
export const runtimeDependencies = pgTable(
  "runtime_dependencies",
  {
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    taskId: uuid("task_id").notNull(),
    prerequisiteId: uuid("prerequisite_id").notNull(),
    required: boolean("required").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.missionId, t.taskId, t.prerequisiteId],
    }),
    foreignKey({
      columns: [t.organizationId, t.missionId, t.taskId],
      foreignColumns: [
        runtimeTasks.organizationId,
        runtimeTasks.missionId,
        runtimeTasks.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.missionId, t.prerequisiteId],
      foreignColumns: [
        runtimeTasks.organizationId,
        runtimeTasks.missionId,
        runtimeTasks.id,
      ],
    }),
  ],
);
export const runtimeAttempts = pgTable(
  "runtime_attempts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    taskId: uuid("task_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    workerId: uuid("worker_id").notNull(),
    generation: integer("generation").notNull(),
    fence: integer("fence").notNull(),
    state: text("state").notNull(),
    leaseExpiresAt: time("lease_expires_at").notNull(),
    deadlineAt: time("deadline_at").notNull(),
    startedAt: time("started_at").notNull(),
    finishedAt: time("finished_at"),
    toolCalls: integer("tool_calls").notNull().default(0),
    runtimeMs: integer("runtime_ms").notNull().default(0),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.taskId, t.fence),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.workerId],
      foreignColumns: [
        runtimeWorkers.organizationId,
        runtimeWorkers.projectId,
        runtimeWorkers.environmentId,
        runtimeWorkers.id,
      ],
    }),
    unique().on(t.organizationId, t.missionId, t.taskId, t.id),
    foreignKey({
      columns: [t.organizationId, t.missionId, t.taskId],
      foreignColumns: [
        runtimeTasks.organizationId,
        runtimeTasks.missionId,
        runtimeTasks.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.agentId],
      foreignColumns: [
        runtimeAgents.organizationId,
        runtimeAgents.projectId,
        runtimeAgents.environmentId,
        runtimeAgents.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.missionId],
      foreignColumns: [
        runtimeMissions.organizationId,
        runtimeMissions.projectId,
        runtimeMissions.environmentId,
        runtimeMissions.id,
      ],
    }),
  ],
);
export const runtimeEvents = pgTable(
  "runtime_events",
  {
    sequence: bigint("sequence", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    id: uuid("id").notNull().unique(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    missionId: uuid("mission_id"),
    type: varchar("type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId],
      foreignColumns: [
        environments.organizationId,
        environments.projectId,
        environments.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.environmentId, t.missionId],
      foreignColumns: [
        runtimeMissions.organizationId,
        runtimeMissions.projectId,
        runtimeMissions.environmentId,
        runtimeMissions.id,
      ],
    }),
  ],
);
export const runtimeActionReceipts = pgTable(
  "runtime_action_receipts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    taskId: uuid("task_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    actionKey: char("action_key", { length: 64 }).notNull(),
    actionHash: char("action_hash", { length: 64 }).notNull(),
    state: text("state").notNull(),
    result: jsonb("result"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.actionKey),
    foreignKey({
      columns: [t.organizationId, t.missionId, t.taskId],
      foreignColumns: [
        runtimeTasks.organizationId,
        runtimeTasks.missionId,
        runtimeTasks.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.missionId, t.taskId, t.attemptId],
      foreignColumns: [
        runtimeAttempts.organizationId,
        runtimeAttempts.missionId,
        runtimeAttempts.taskId,
        runtimeAttempts.id,
      ],
    }),
  ],
);
export const runtimeApprovals = pgTable(
  "runtime_approvals",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    taskId: uuid("task_id").notNull(),
    actionHash: char("action_hash", { length: 64 }).notNull(),
    requesterId: uuid("requester_id").notNull(),
    approverId: uuid("approver_id"),
    approverGrant: jsonb("approver_grant"),
    generation: integer("generation").notNull(),
    state: text("state").notNull().default("pending"),
    expiresAt: time("expires_at").notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.taskId, t.generation, t.actionHash),
    foreignKey({
      columns: [t.organizationId, t.missionId, t.taskId],
      foreignColumns: [
        runtimeTasks.organizationId,
        runtimeTasks.missionId,
        runtimeTasks.id,
      ],
    }),
    foreignKey({
      columns: [t.organizationId, t.requesterId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
    foreignKey({
      columns: [t.organizationId, t.approverId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);

export const runtimeIdempotency = pgTable(
  "runtime_idempotency",
  {
    organizationId: uuid("organization_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    route: varchar("route", { length: 120 }).notNull(),
    key: uuid("key").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    response: jsonb("response").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.actorId, t.route, t.key] }),
    foreignKey({
      columns: [t.organizationId, t.actorId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }),
  ],
);

export const runtimeInstance = pgTable("runtime_instance", {
  id: boolean("id").primaryKey().default(true),
  turn: bigint("turn", { mode: "bigint" }).notNull().default(0n),
  activeMissions: integer("active_missions").notNull().default(0),
  activeAgents: integer("active_agents").notNull().default(0),
  storageBytes: bigint("storage_bytes", { mode: "bigint" })
    .notNull()
    .default(0n),
});
export const runtimeTenants = pgTable("runtime_tenants", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  turn: bigint("turn", { mode: "bigint" }).notNull().default(0n),
  active: boolean("active").notNull().default(true),
});
export const runtimeInstanceHours = pgTable("runtime_instance_hours", {
  windowStart: time("window_start").primaryKey(),
  toolCalls: integer("tool_calls").notNull().default(0),
  runtimeMs: integer("runtime_ms").notNull().default(0),
});
export const runtimeQuotaScopes = pgTable(
  "runtime_quota_scopes",
  {
    organizationId: uuid("organization_id").notNull(),
    kind: text("kind").notNull(),
    scopeId: uuid("scope_id").notNull(),
    limits: jsonb("limits").notNull(),
    version: integer("version").notNull().default(1),
    activeMissions: integer("active_missions").notNull().default(0),
    activeAgents: integer("active_agents").notNull().default(0),
    storageBytes: bigint("storage_bytes", { mode: "bigint" })
      .notNull()
      .default(0n),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.kind, t.scopeId] })],
);
export const runtimeQuotaHours = pgTable(
  "runtime_quota_hours",
  {
    organizationId: uuid("organization_id").notNull(),
    kind: text("kind").notNull(),
    scopeId: uuid("scope_id").notNull(),
    windowStart: time("window_start").notNull(),
    toolCalls: integer("tool_calls").notNull().default(0),
    runtimeMs: integer("runtime_ms").notNull().default(0),
  },
  (t) => [
    primaryKey({
      columns: [t.organizationId, t.kind, t.scopeId, t.windowStart],
    }),
    foreignKey({
      columns: [t.organizationId, t.kind, t.scopeId],
      foreignColumns: [
        runtimeQuotaScopes.organizationId,
        runtimeQuotaScopes.kind,
        runtimeQuotaScopes.scopeId,
      ],
    }),
  ],
);
export const runtimeStorageReservations = pgTable(
  "runtime_storage_reservations",
  {
    organizationId: uuid("organization_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    bytes: bigint("bytes", { mode: "bigint" }).notNull(),
    scopes: jsonb("scopes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.resourceId] })],
);
export const runtimeAdmissions = pgTable(
  "runtime_admissions",
  {
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    scopes: jsonb("scopes").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.missionId] }),
    foreignKey({
      columns: [t.organizationId, t.missionId],
      foreignColumns: [runtimeMissions.organizationId, runtimeMissions.id],
    }),
  ],
);
export const runtimeAttemptQuotas = pgTable(
  "runtime_attempt_quotas",
  {
    organizationId: uuid("organization_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    scopes: jsonb("scopes").notNull(),
    active: boolean("active").notNull().default(true),
    toolCalls: integer("tool_calls").notNull(),
    runtimeMs: integer("runtime_ms").notNull(),
    windowStart: time("window_start").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.attemptId] }),
    foreignKey({
      columns: [t.organizationId, t.attemptId],
      foreignColumns: [runtimeAttempts.organizationId, runtimeAttempts.id],
    }),
  ],
);
export const runtimeOutbox = pgTable(
  "runtime_outbox",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    taskId: uuid("task_id").notNull(),
    generation: integer("generation").notNull(),
    createdAt: time("created_at").notNull(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: time("lease_expires_at"),
    publishedAt: time("published_at"),
    nextPublishAt: time("next_publish_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.missionId, t.taskId],
      foreignColumns: [
        runtimeTasks.organizationId,
        runtimeTasks.missionId,
        runtimeTasks.id,
      ],
    }),
  ],
);

export const runtimeWorkers = pgTable(
  "runtime_workers",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    protocol: integer("protocol").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    version: integer("version").notNull().default(1),
    expiresAt: time("expires_at").notNull(),
    revokedAt: time("revoked_at"),
    lastSeenAt: time("last_seen_at"),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.environmentId, t.id),
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
export const runtimeModelCalls = pgTable(
  "runtime_model_calls",
  {
    organizationId: uuid("organization_id").notNull(),
    missionId: uuid("mission_id").notNull(),
    taskId: uuid("task_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    step: integer("step").notNull(),
    requestId: uuid("request_id").notNull().unique(),
    state: text("state").notNull(),
    proposal: jsonb("proposal"),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.attemptId, t.step] }),
    foreignKey({
      columns: [t.organizationId, t.missionId, t.taskId, t.attemptId],
      foreignColumns: [
        runtimeAttempts.organizationId,
        runtimeAttempts.missionId,
        runtimeAttempts.taskId,
        runtimeAttempts.id,
      ],
    }),
  ],
);
