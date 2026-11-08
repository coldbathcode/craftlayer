import {
  boolean,
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
import { organizations, projects } from "./schema.js";
// SQL migrations are authoritative for RLS, column privileges, triggers and CHECK constraints.
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  login: varchar("login", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 254 }).unique(),
  accountType: text("account_type").notNull(),
  passwordHash: text("password_hash").notNull(),
  authVersion: integer("auth_version").notNull().default(1),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const installationSettings = pgTable("installation_settings", {
  id: boolean("id").primaryKey().default(true),
  bootstrapHash: char("bootstrap_hash", { length: 64 }),
  recoveryHash: char("recovery_hash", { length: 64 }).notNull(),
  bootstrappedAt: timestamp("bootstrapped_at", { withTimezone: true }),
});
export const instanceOwners = pgTable("instance_owners", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
});
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
  authVersion: integer("auth_version").notNull(),
  idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    authVersion: integer("auth_version").notNull().default(1),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.userId),
  ],
);
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 80 }).notNull(),
    builtIn: boolean("built_in").notNull().default(false),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.name),
  ],
);
export const membershipRoles = pgTable(
  "membership_roles",
  {
    organizationId: uuid("organization_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    roleId: uuid("role_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.membershipId, t.roleId] }),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
  ],
);
export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    type: text("type").notNull(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    unique().on(t.organizationId, t.projectId, t.id),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
  ],
);
/** Master plan C1. CHECK/trigger/RLS rules live in migration 0028. */
export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    membershipId: uuid("membership_id").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    name: varchar("name", { length: 60 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
    permissions: text("permissions").array().notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }),
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
