import type { OrganizationContext } from "@craftlayer/core";
import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export { schema };
export type Database = NodePgDatabase<typeof schema>;
export type ScopedTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export function createDatabase(connectionString: string, max = 5) {
  const pool = new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
/** Only call with context established by trusted authorization/maintenance code. */
export async function withOrganization<T>(
  db: Database,
  context: OrganizationContext,
  operation: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.organization_id', ${context.organizationId}, true)`,
    );
    return operation(tx);
  });
}
export function listProjects(db: Database, context: OrganizationContext) {
  return withOrganization(db, context, async (tx) =>
    tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, context.organizationId)),
  );
}
