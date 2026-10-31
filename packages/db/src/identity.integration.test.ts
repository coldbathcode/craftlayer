import { randomUUID } from "node:crypto";
import { organizationPermissions, rolePermissions } from "@craftlayer/core";
import pg from "pg";
import { afterAll, expect, it } from "vitest";

if (!process.env.TEST_IDENTITY_DATABASE_URL)
  throw new Error("Identity test database required");
const identity = new pg.Pool({
  connectionString: process.env.TEST_IDENTITY_DATABASE_URL,
  max: 1,
});
const runtime = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 1,
});
afterAll(async () => {
  await identity.end();
  await runtime.end();
});
it("keeps global identity inaccessible to runtime and denies identity DDL/bypass", async () => {
  await expect(runtime.query("select * from users")).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    identity.query("create table identity_bypass(id integer)"),
  ).rejects.toThrow(/permission denied/);
  const r = await identity.query(
    "select rolsuper,rolbypassrls from pg_roles where rolname=current_user",
  );
  expect(r.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  expect((await identity.query("select * from memberships")).rows).toEqual([]);
});
it("seeds exact role permission templates idempotently", async () => {
  const p = await identity.query(
    "select id from permissions where id not in ('instance:manage','organization:create')",
  );
  expect(p.rows.map((r) => r.id).sort()).toEqual(
    [...organizationPermissions].sort(),
  );
  for (const [name, permissions] of Object.entries(rolePermissions)) {
    const r = await identity.query(
      "select permission from built_in_role_permissions where role_name=$1",
      [name],
    );
    expect(r.rows.map((r) => r.permission).sort()).toEqual(
      [...permissions].sort(),
    );
  }
});
it("rejects cross-org role assignment with a composite FK", async () => {
  const c = await identity.connect();
  const a = randomUUID(),
    b = randomUUID(),
    user = randomUUID(),
    member = randomUUID(),
    role = randomUUID();
  try {
    await c.query("begin");
    await c.query("select set_config('app.organization_id',$1,true)", [a]);
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,'adult','fixture')",
      [user, `u${user}`],
    );
    await c.query("insert into organizations(id,name) values($1,'A')", [a]);
    await c.query(
      "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
      [member, a, user],
    );
    await c.query("select set_config('app.organization_id',$1,true)", [b]);
    await c.query("insert into organizations(id,name) values($1,'B')", [b]);
    await c.query(
      "insert into roles(id,organization_id,name) values($1,$2,'viewer')",
      [role, b],
    );
    await c.query("select set_config('app.organization_id',$1,true)", [a]);
    await expect(
      c.query(
        "insert into membership_roles(organization_id,membership_id,role_id) values($1,$2,$3)",
        [a, member, role],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  } finally {
    await c.query("rollback");
    c.release();
  }
});
it("does not grant audit mutation or child-to-owner promotion", async () => {
  await expect(
    identity.query("delete from instance_audit_events"),
  ).rejects.toThrow(/permission denied/);
  await expect(
    identity.query("update audit_events set action='tampered'"),
  ).rejects.toThrow(/permission denied/);
  const c = await identity.connect();
  try {
    await c.query("begin");
    const id = randomUUID();
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,'child','fixture')",
      [id, `c${id}`],
    );
    await expect(
      c.query("insert into instance_owners(user_id) values($1)", [id]),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    await c.query("rollback");
    c.release();
  }
});
