import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("organizations_name_nonempty", sql`length(trim(${t.name})) > 0`),
  ],
);
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: varchar("name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("projects_org_id_unique").on(t.organizationId, t.id),
    check("projects_name_nonempty", sql`length(trim(${t.name})) > 0`),
  ],
);
