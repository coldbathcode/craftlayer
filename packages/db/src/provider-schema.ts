import {
  boolean,
  customType,
  foreignKey,
  index,
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
import { organizations } from "./schema.js";

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
