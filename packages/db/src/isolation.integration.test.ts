import { randomUUID } from "node:crypto";
import { organizationContext } from "@craftlayer/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  listProjects,
  schema,
  withOrganization,
} from "./index.js";

const runtimeUrl = process.env.TEST_DATABASE_URL;
if (!runtimeUrl)
  throw new Error(
    "TEST_DATABASE_URL is required; run pnpm test:db (or the documented external test DB setup)",
  );
const { pool, db } = createDatabase(runtimeUrl, 1);
const a = organizationContext(randomUUID());
const b = organizationContext(randomUUID());
beforeAll(async () => {
  for (const ctx of [a, b])
    await withOrganization(db, ctx, async (tx) => {
      await tx
        .insert(schema.organizations)
        .values({ id: ctx.organizationId, name: "Tenant fixture" });
      await tx.insert(schema.projects).values({
        id: randomUUID(),
        organizationId: ctx.organizationId,
        name: ctx === a ? "A" : "B",
      });
    });
});
afterAll(async () => {
  for (const ctx of [a, b])
    await withOrganization(db, ctx, async (tx) => {
      await tx.execute(
        sql`delete from projects where organization_id=${ctx.organizationId}`,
      );
      await tx.execute(
        sql`delete from organizations where id=${ctx.organizationId}`,
      );
    });
  await pool.end();
});
describe("runtime-role tenant boundary", () => {
  it("has no owner, superuser, bypass, DDL or migration privileges", async () => {
    const { rows } = await pool.query(
      "select current_user,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb from pg_roles where rolname=current_user",
    );
    expect(rows[0]).toMatchObject({
      current_user: "craftlayer_runtime",
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const owners = await pool.query(
      "select tableowner from pg_tables where schemaname='public' and tablename in ('organizations','projects')",
    );
    expect(owners.rows).toHaveLength(2);
    expect(
      owners.rows.every((row) => row.tableowner === "craftlayer_migrator"),
    ).toBe(true);
    const policies = await pool.query(
      "select relrowsecurity,relforcerowsecurity from pg_class where relname in ('organizations','projects') and relnamespace='public'::regnamespace",
    );
    expect(
      policies.rows.every(
        (row) => row.relrowsecurity && row.relforcerowsecurity,
      ),
    ).toBe(true);
    await expect(
      pool.query("create table forbidden(id integer)"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      pool.query("select * from craftlayer_migrations"),
    ).rejects.toThrow(/permission denied/);
    await expect(pool.query("set role craftlayer_migrator")).rejects.toThrow(
      /permission denied/,
    );
  });
  it("denies rows without context", async () => {
    expect((await pool.query("select * from projects")).rows).toEqual([]);
    await expect(
      pool.query(
        "insert into projects(id,organization_id,name) values($1,$2,'forged')",
        [randomUUID(), a.organizationId],
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("isolates unfiltered reads and pooled sequential contexts", async () => {
    for (const ctx of [a, b, a]) {
      const rows = await withOrganization(
        db,
        ctx,
        async (tx) => await tx.select().from(schema.projects),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.organizationId).toBe(ctx.organizationId);
    }
    expect(await listProjects(db, a)).toHaveLength(1);
    expect((await pool.query("select * from projects")).rows).toEqual([]);
  });
  it("denies forged tenant writes", async () => {
    await expect(
      withOrganization(db, a, (tx) =>
        tx.insert(schema.projects).values({
          id: randomUUID(),
          organizationId: b.organizationId,
          name: "forged",
        }),
      ),
    ).rejects.toThrow();
  });
  it("does not leak context after rollback or statement timeout", async () => {
    await expect(
      withOrganization(db, a, async () => {
        throw new Error("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
    expect((await pool.query("select * from projects")).rows).toEqual([]);
    await expect(
      withOrganization(db, a, async (tx) => {
        await tx.execute(sql`set local statement_timeout='20ms'`);
        await tx.execute(sql`select pg_sleep(0.1)`);
      }),
    ).rejects.toThrow();
    expect((await pool.query("select * from projects")).rows).toEqual([]);
  });
  it("enforces composite tenant references", async () => {
    // A migration-owned fixture child proves the project composite-key convention.
    await expect(
      withOrganization(db, a, (tx) =>
        tx.execute(
          sql`insert into project_reference_fixture(organization_id,project_id) select ${a.organizationId}::uuid,id from projects where organization_id=${b.organizationId}`,
        ),
      ),
    ).resolves.toBeDefined();
    const bProjects = await listProjects(db, b);
    await expect(
      withOrganization(db, a, (tx) =>
        tx.execute(
          sql`insert into project_reference_fixture(organization_id,project_id) values(${a.organizationId},${bProjects[0]?.id})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});
