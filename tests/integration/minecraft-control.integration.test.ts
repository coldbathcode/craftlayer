import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../packages/auth/src/index.js";
import type { InventoryTarget } from "../../packages/contracts/src/minecraft.js";
import {
  instancePermissions,
  organizationPermissions,
  rolePermissions,
} from "../../packages/core/src/index.js";
import { MinecraftControl } from "../../packages/minecraft-control/src/index.js";

const identityUrl = process.env.TEST_MANAGEMENT_IDENTITY_DATABASE_URL;
const runtimeUrl = process.env.TEST_MANAGEMENT_DATABASE_URL;
if (!identityUrl || !runtimeUrl)
  throw new Error("Disposable database required");
const identity = new pg.Pool({ connectionString: identityUrl, max: 2 });
const runtime = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
const auth = new AuthService({
  databaseUrl: identityUrl,
  bootstrapToken: randomBytes(32).toString("hex"),
  recoveryToken: randomBytes(32).toString("hex"),
  csrfSecret: randomBytes(32).toString("hex"),
});
const org = randomUUID(),
  foreignOrg = randomUUID(),
  project = randomUUID(),
  environment = randomUUID(),
  otherEnvironment = randomUUID(),
  targetId = "family";
let adult = "",
  viewer = "",
  child = "",
  server = "",
  operation = "";
let target: InventoryTarget;
let sourceHook: (() => Promise<void>) | undefined;
const service = new MinecraftControl({
  databaseUrl: runtimeUrl,
  auth,
  source: {
    list: async () => [target],
    observe: async () => {
      await sourceHook?.();
      return target;
    },
  },
});
async function tx<T>(
  pool: pg.Pool,
  scope: string,
  fn: (c: pg.PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.organization_id',$1,true)", [scope]);
    const v = await fn(c);
    await c.query("commit");
    return v;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
async function member(role: string, type = "adult") {
  const user = randomUUID(),
    membership = randomUUID(),
    session = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await tx(identity, org, async (c) => {
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,$3,'synthetic-unused-hash')",
      [user, `mc-${user}`, type],
    );
    await c.query(
      "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
      [membership, org, user],
    );
    await c.query(
      "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name=$3",
      [org, membership, role],
    );
    await c.query(
      "insert into sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at) values($1,$2,$3,1,now()+interval '1 hour',now()+interval '2 hours')",
      [session, user, createHash("sha256").update(token).digest("hex")],
    );
    if (role === "viewer")
      for (const permission of ["server:read", "player:read", "operation:read"])
        await c.query(
          "insert into resource_grants(id,organization_id,membership_id,permission,project_id,environment_id) values($1,$2,$3,$4,$5,$6)",
          [randomUUID(), org, membership, permission, project, environment],
        );
  });
  return token;
}
beforeAll(async () => {
  await auth.initialize();
  await tx(identity, org, async (c) => {
    await c.query(
      "insert into organizations(id,name) values($1,'Management fixture')",
      [org],
    );
    await c.query(
      "insert into projects(id,organization_id,name) values($1,$2,'Family')",
      [project, org],
    );
    for (const id of [environment, otherEnvironment])
      await c.query(
        "insert into environments(id,organization_id,project_id,name,type) values($1,$2,$3,'Family world','minecraft')",
        [id, org, project],
      );
    const roles = (
      await c.query<{ role_name: string }>(
        "select distinct role_name from built_in_role_permissions",
      )
    ).rows;
    for (const role of roles) {
      const id = randomUUID();
      await c.query(
        "insert into roles(id,organization_id,name,built_in) values($1,$2,$3,true)",
        [id, org, role.role_name],
      );
      await c.query(
        "insert into role_permissions(organization_id,role_id,permission) select $1,$2,permission from built_in_role_permissions where role_name=$3",
        [org, id, role.role_name],
      );
    }
  });
  await tx(identity, foreignOrg, (c) =>
    c.query("insert into organizations(id,name) values($1,'Foreign fixture')", [
      foreignOrg,
    ]),
  );
  adult = await member("org_admin");
  viewer = await member("viewer");
  child = await member("org_admin", "child");
  target = {
    id: targetId,
    organization_id: org,
    environment_id: environment,
    label: "Existing family server",
    binding_hash: "a".repeat(64),
    observation: {
      observed_at: new Date().toISOString(),
      state: "offline",
      java: { host: "127.0.0.1", port: 25565 },
      bedrock: null,
      players: null,
      online_authentication: true,
      allowlist_enabled: true,
      enforce_allowlist: true,
      rcon_public: false,
      backup_verified: false,
      identity_verified: false,
    },
  };
});
afterAll(async () => {
  await service.close();
  await auth.close();
  await identity.end();
  await runtime.end();
});
describe("Minecraft registry tenant and operation boundary", () => {
  it("matches the typed permission and built-in role registry to actual fresh/upgraded migration seeds", async () => {
    const [permissions, roles] = await Promise.all([
      identity.query<{ id: string }>("select id from permissions order by id"),
      identity.query<{ role_name: string; permission: string }>(
        "select role_name,permission from built_in_role_permissions",
      ),
    ]);
    expect(permissions.rows.map((p) => p.id)).toEqual(
      [...organizationPermissions, ...instancePermissions].sort(),
    );
    expect(
      roles.rows.map((r) => `${r.role_name}|${r.permission}`).sort(),
    ).toEqual(
      Object.entries(rolePermissions)
        .flatMap(([role, values]) =>
          values.map((permission) => `${role}|${permission}`),
        )
        .sort(),
    );
  });
  it("upgrades an existing tenant role and removes migration-only discovery policy", async () => {
    await tx(identity, "00000000-0000-4000-8000-00000000f101", async (c) => {
      const rows = (
        await c.query<{ permission: string }>(
          "select permission from role_permissions where role_id='00000000-0000-4000-8000-00000000f102' order by permission",
        )
      ).rows.map((r) => r.permission);
      // 0029 grants viewers backup:read on upgrade as well as on fresh installs.
      expect(rows).toEqual([
        "backup:read",
        "operation:read",
        "player:read",
        "server:read",
      ]);
      expect(
        (
          await c.query(
            "select 1 from role_permissions where role_id='00000000-0000-4000-8000-00000000f103' and permission='player:enroll'",
          )
        ).rowCount,
      ).toBe(1);
    });
  });
  it("registers once under concurrent replay with atomic operation, audit and outbox", async () => {
    const request = {
      environment_id: environment,
      target_id: targetId,
      name: "Family survival",
    };
    const plan = await service.plan(adult, org, request);
    const key = randomUUID();
    const input = { ...request, plan_hash: plan.plan_hash };
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => service.adopt(adult, org, input, key)),
    );
    expect(new Set(receipts.map((r) => r.operation_id)).size).toBe(1);
    server = receipts[0]?.server_id ?? "";
    operation = receipts[0]?.operation_id ?? "";
    const op = await service.operation(adult, org, operation);
    expect(op.state).toBe("succeeded");
    await tx(runtime, org, async (c) => {
      expect(
        (
          await c.query(
            "select count(*)::int n from minecraft_servers where organization_id=$1",
            [org],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select count(*)::int n from management_outbox where organization_id=$1 and operation_id=$2",
            [org, operation],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select count(*)::int n from audit_events where organization_id=$1 and action='server.adopted_read_only' and target_id=$2",
            [org, server],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    await expect(
      service.adopt(adult, org, { ...input, name: "Changed" }, key),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  });
  it("permits explicit viewer reads but denies child/admin unions, viewer writes and ungranted worlds", async () => {
    expect((await service.list(viewer, org, environment)).items[0]?.id).toBe(
      server,
    );
    expect((await service.get(viewer, org, server)).can_observe).toBe(false);
    await expect(
      service.plan(viewer, org, {
        environment_id: environment,
        target_id: targetId,
        name: "x",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.list(child, org, environment)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.list(viewer, org, otherEnvironment),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.get(adult, foreignOrg, server)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.operation(adult, foreignOrg, operation),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.get("", org, server)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("denies unknown/changed bindings and foreign cursor/source targets with no registration", async () => {
    await expect(
      service.plan(adult, org, {
        environment_id: environment,
        target_id: "unknown",
        name: "x",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.adopt(
        adult,
        org,
        {
          environment_id: environment,
          target_id: targetId,
          name: "x",
          plan_hash: "f".repeat(64),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409, code: "PLAN_CHANGED" });
    await expect(
      service.list(adult, org, environment, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    const prior = target;
    target = { ...target, organization_id: foreignOrg };
    await expect(
      service.plan(adult, org, {
        environment_id: environment,
        target_id: targetId,
        name: "x",
      }),
    ).rejects.toMatchObject({ status: 404 });
    target = prior;
  });
  it("enforces forced RLS, cross-project FKs, immutable bindings and append-only operation history", async () => {
    expect(
      (
        await runtime.query("select id from minecraft_servers where id=$1", [
          server,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(
      tx(runtime, foreignOrg, (c) =>
        c.query(
          "insert into minecraft_servers(id,organization_id,project_id,environment_id,name,target_id,binding_hash) values($1,$2,$3,$4,'foreign','x',$5)",
          [randomUUID(), foreignOrg, project, environment, "c".repeat(64)],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      tx(runtime, org, (c) =>
        c.query("update minecraft_servers set binding_hash=$2 where id=$1", [
          server,
          "b".repeat(64),
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, org, (c) =>
        c.query(
          "update management_operations set state='failed',failure_code='interrupted' where id=$1",
          [operation],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, org, (c) =>
        c.query("delete from management_outbox where operation_id=$1", [
          operation,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await runtime.query(
          "select 1 from pg_policies where policyname in ('f1_migration_discovery','f2_migration_discovery')",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("honors session revocation before returning server data", async () => {
    const token = await member("viewer");
    await auth.logout(token);
    await expect(service.get(token, org, server)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("Minecraft HTTP and observation boundary", () => {
  it("serves typed 3.1 routes with session/CSRF/scope and no arbitrary commands", async () => {
    const app = await buildApp({
      auth,
      minecraft: service,
      publicUrl: "http://127.0.0.1:3000",
      readiness: async () => true,
    });
    const headers = {
      cookie: `craftlayer_session=${adult}`,
      "x-craftlayer-organization": org,
    };
    try {
      const schema = (
        await app.inject({ method: "GET", url: "/api/v1/openapi.json" })
      ).json();
      expect(schema.openapi).toBe("3.1.0");
      expect(schema.paths["/api/v1/servers/{id}/start"]).toBeUndefined();
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/servers?environment_id=${environment}`,
            headers: { "x-craftlayer-organization": org },
          })
        ).statusCode,
      ).toBe(401);
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/servers/${server}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().management_mode).toBe("adopted_read_only");
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/servers/${server}/observe`,
            headers,
            payload: { expected_version: 1 },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/servers/${server}/observe`,
            headers: {
              ...headers,
              origin: "http://127.0.0.1:3000",
              "x-csrf-token": auth.csrfToken(adult),
              "idempotency-key": randomUUID(),
            },
            payload: { expected_version: 1, command: "start" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/servers/${server}/start`,
            headers: {
              ...headers,
              origin: "http://127.0.0.1:3000",
              "x-csrf-token": auth.csrfToken(adult),
            },
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
    const requestApp = await buildApp({
      auth,
      minecraft: service,
      publicUrl: "http://127.0.0.1:3000",
      readiness: async () => true,
    });
    try {
      const response = await requestApp.inject({
        method: "POST",
        url: `/api/v1/servers/${server}/observe`,
        headers: {
          ...headers,
          origin: "http://127.0.0.1:3000",
          "x-csrf-token": auth.csrfToken(adult),
          "idempotency-key": randomUUID(),
        },
        payload: {
          expected_version: (await service.get(adult, org, server)).version,
        },
      });
      expect(response.statusCode).toBe(202);
      await tx(runtime, org, async (c) =>
        expect(
          (
            await c.query(
              "select count(*)::int n from audit_events where organization_id=$1 and details->>'request_id'=$2 and details->>'operation_id'=$3",
              [
                org,
                response.headers["x-request-id"],
                response.json().operation_id,
              ],
            )
          ).rows[0].n,
        ).toBe(2),
      );
    } finally {
      await requestApp.close();
    }
    const remote = await buildApp({
      auth,
      minecraft: service,
      publicUrl: "https://management.example.invalid",
      readiness: async () => true,
    });
    try {
      expect(
        (
          await remote.inject({
            method: "GET",
            url: `/api/v1/servers?environment_id=${environment}`,
            headers,
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      await remote.close();
    }
  });
  it("updates captured observations with a durable fenced operation and replay", async () => {
    const current = await service.get(adult, org, server);
    const key = randomUUID();
    target = {
      ...target,
      observation: {
        ...target.observation,
        observed_at: new Date().toISOString(),
        players: [{ name: "FixturePlayer", edition: "java" }],
        state: "online",
      },
    };
    const op = await service.observe(adult, org, server, current.version, key);
    expect((await service.operation(adult, org, op.operation_id)).state).toBe(
      "succeeded",
    );
    expect(
      await service.observe(adult, org, server, current.version, key),
    ).toEqual(op);
    expect(
      (await service.players(viewer, org, server)).players?.[0]?.name,
    ).toBe("FixturePlayer");
    expect(
      (await service.activity(adult, org, server)).items.some(
        (e) => e.action === "server.observation_recorded",
      ),
    ).toBe(true);
    await expect(
      service.observe(viewer, org, server, current.version, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("does not commit observation data after session revocation during source I/O", async () => {
    const actor = await member("org_admin");
    const current = await service.get(adult, org, server);
    let release: () => void = () => {};
    let enter: () => void = () => {};
    const entered = new Promise<void>((done) => {
      enter = done;
    });
    const block = new Promise<void>((done) => {
      release = done;
    });
    sourceHook = async () => {
      enter();
      await block;
    };
    const pending = service.observe(
      actor,
      org,
      server,
      current.version,
      randomUUID(),
    );
    await entered;
    await auth.logout(actor);
    release();
    const op = await pending;
    sourceHook = undefined;
    expect((await service.operation(adult, org, op.operation_id)).state).toBe(
      "failed",
    );
    expect((await service.get(adult, org, server)).version).toBe(
      current.version,
    );
  });
  it("unregisters metadata only and fences an in-flight observation", async () => {
    const current = await service.get(adult, org, server);
    let release: () => void = () => {};
    let enter: () => void = () => {};
    const entered = new Promise<void>((done) => {
      enter = done;
    });
    const block = new Promise<void>((done) => {
      release = done;
    });
    sourceHook = async () => {
      enter();
      await block;
    };
    const pending = service.observe(
      adult,
      org,
      server,
      current.version,
      randomUUID(),
    );
    await entered;
    const removed = await service.unregister(
      adult,
      org,
      server,
      current.version,
      randomUUID(),
    );
    release();
    const old = await pending;
    sourceHook = undefined;
    expect((await service.operation(adult, org, old.operation_id)).state).toBe(
      "failed",
    );
    expect(
      (await service.operation(adult, org, removed.operation_id)).state,
    ).toBe("succeeded");
    expect((await service.get(adult, org, server)).registered).toBe(false);
    expect(target.binding_hash).toBe("a".repeat(64));
    const input = {
      environment_id: environment,
      target_id: targetId,
      name: "Re-adopted family",
    };
    const plan = await service.plan(adult, org, input);
    const restored = await service.adopt(
      adult,
      org,
      { ...input, plan_hash: plan.plan_hash },
      randomUUID(),
    );
    expect(restored.server_id).toBe(server);
    expect((await service.get(adult, org, server)).registered).toBe(true);
  });
});

describe("pending Minecraft identity resolution boundary", () => {
  it("records one pending request under concurrent replay without changing server/access state", async () => {
    const actor = await member("org_admin"),
      key = randomUUID(),
      body = { edition: "bedrock", requested_name: "Family Player" };
    const before = await service.get(adult, org, server);
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.enrollIdentity(actor, org, server, body, key),
      ),
    );
    expect(new Set(receipts.map((r) => r.operation_id)).size).toBe(1);
    expect(new Set(receipts.map((r) => r.enrollment_id)).size).toBe(1);
    const receipt = receipts[0];
    if (!receipt) throw new Error("Receipt missing");
    const page = await service.identityEnrollments(viewer, org, server),
      request = page.items.find((r) => r.id === receipt.enrollment_id);
    expect(request).toMatchObject({
      state: "pending",
      reason: "authenticated_bridge_unavailable",
      identity_verified: false,
      access_granted: false,
      expired: false,
    });
    expect(
      (await service.operation(actor, org, receipt.operation_id)).state,
    ).toBe("succeeded");
    expect((await service.get(adult, org, server)).version).toBe(
      before.version,
    );
    await tx(runtime, org, async (c) => {
      expect(
        (
          await c.query(
            "select 1 from minecraft_identity_enrollments where operation_id=$1",
            [receipt.operation_id],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select 1 from management_outbox where operation_id=$1",
            [receipt.operation_id],
          )
        ).rowCount,
      ).toBe(1);
      const audit = (
        await c.query<{ details: Record<string, unknown> }>(
          "select details from audit_events where details->>'operation_id'=$1",
          [receipt.operation_id],
        )
      ).rows;
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain("Family Player");
    });
    await expect(
      service.enrollIdentity(
        actor,
        org,
        server,
        { ...body, requested_name: "Changed Player" },
        key,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await auth.logout(actor);
    await expect(
      service.enrollIdentity(actor, org, server, body, key),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("denies child/admin unions, viewer writes, foreign scope and caller verification claims", async () => {
    const body = { edition: "java", requested_name: "TestPlayer" };
    for (const actor of [child, viewer])
      await expect(
        service.enrollIdentity(actor, org, server, body, randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.identityEnrollments(child, org, server),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.identityEnrollments(adult, foreignOrg, server),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.enrollIdentity(
        adult,
        org,
        server,
        { ...body, profile_uuid: randomUUID(), identity_verified: true },
        randomUUID(),
      ),
    ).rejects.toThrow();
    await expect(
      service.identityEnrollments(adult, org, server, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    const expired = new MinecraftControl({
      databaseUrl: runtimeUrl,
      auth,
      clock: () => Date.now() + 25 * 3600000,
    });
    try {
      expect(
        (await expired.identityEnrollments(adult, org, server)).items.every(
          (r) => r.expired && !r.identity_verified && !r.access_granted,
        ),
      ).toBe(true);
    } finally {
      await expired.close();
    }
  });
  it("enforces forced RLS, tenant operation/server FKs and immutable pending-only rows", async () => {
    expect(
      (await runtime.query("select * from minecraft_identity_enrollments"))
        .rows,
    ).toHaveLength(0);
    await expect(
      tx(runtime, org, (c) =>
        c.query("update minecraft_identity_enrollments set state='verified'"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tx(runtime, org, (c) =>
        c.query("delete from minecraft_identity_enrollments"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const rows = await tx(runtime, org, (c) =>
      c.query("select * from minecraft_identity_enrollments limit 1"),
    );
    const row = rows.rows[0];
    if (!row) throw new Error("Fixture enrollment missing");
    const otherServer = randomUUID();
    await tx(runtime, org, (c) =>
      c.query(
        "insert into minecraft_servers(id,organization_id,project_id,environment_id,name,target_id,binding_hash) values($1,$2,$3,$4,'Other fixture',$5,$6)",
        [
          otherServer,
          org,
          project,
          environment,
          `identity-${randomUUID()}`,
          randomBytes(32).toString("hex"),
        ],
      ),
    );
    const otherOperation = randomUUID();
    await tx(runtime, org, (c) =>
      c.query(
        "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at,finished_at) select $1,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,$2,request_hash,state,fence,deadline,created_at,finished_at from management_operations where organization_id=$3 and id=$4",
        [otherOperation, randomUUID(), org, row.operation_id],
      ),
    );
    await expect(
      tx(runtime, org, (c) =>
        c.query(
          "insert into minecraft_identity_enrollments(id,organization_id,project_id,environment_id,server_id,requested_by,operation_id,edition,requested_name,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,'java','TestPlayer',now(),now()+interval '1 hour')",
          [
            randomUUID(),
            org,
            project,
            environment,
            otherServer,
            row.requested_by,
            otherOperation,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      tx(runtime, org, (c) =>
        c.query(
          "insert into minecraft_identity_enrollments(id,organization_id,project_id,environment_id,server_id,requested_by,operation_id,edition,requested_name,state,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,'java','TestPlayer','verified',now(),now()+interval '1 hour')",
          [
            randomUUID(),
            org,
            project,
            environment,
            server,
            row.requested_by,
            row.operation_id,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, foreignOrg, (c) =>
        c.query(
          "insert into minecraft_identity_enrollments(id,organization_id,project_id,environment_id,server_id,requested_by,operation_id,edition,requested_name,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,'java','TestPlayer',now(),now()+interval '1 hour')",
          [
            randomUUID(),
            foreignOrg,
            project,
            environment,
            server,
            row.requested_by,
            row.operation_id,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("serves pending-only typed HTTP receipts with CSRF, idempotency and correlated audit", async () => {
    const actor = await member("org_admin"),
      app = await buildApp({
        auth,
        minecraft: service,
        publicUrl: "http://127.0.0.1:3000",
        readiness: async () => true,
      });
    const path = `/api/v1/servers/${server}/identity-enrollments`,
      headers = {
        cookie: `craftlayer_session=${actor}`,
        "x-craftlayer-organization": org,
        origin: "http://127.0.0.1:3000",
        "idempotency-key": randomUUID(),
      };
    try {
      const me = (
        await app.inject({ method: "GET", url: "/api/v1/auth/me", headers })
      ).json();
      const write = { ...headers, "x-csrf-token": me.csrf_token };
      expect(
        (
          await app.inject({
            method: "GET",
            url: path,
            headers: { "x-craftlayer-organization": org },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            headers,
            payload: { edition: "java", requested_name: "TestPlayer" },
          })
        ).statusCode,
      ).toBe(403);
      for (const field of [
        "uuid",
        "xuid",
        "identity_verified",
        "allowlist",
        "web_user_id",
        "rcon_password",
      ])
        expect(
          (
            await app.inject({
              method: "POST",
              url: path,
              headers: write,
              payload: {
                edition: "java",
                requested_name: "TestPlayer",
                [field]: "untrusted",
              },
            })
          ).statusCode,
        ).toBe(400);
      const result = await app.inject({
        method: "POST",
        url: path,
        headers: write,
        payload: { edition: "java", requested_name: "TestPlayer" },
      });
      expect(result.statusCode).toBe(202);
      const duplicate = await app.inject({
        method: "POST",
        url: path,
        headers: { ...write, "idempotency-key": randomUUID() },
        payload: { edition: "java", requested_name: "TestPlayer" },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error).toMatchObject({
        code: "ENROLLMENT_PENDING",
      });
      const replay = await app.inject({
        method: "POST",
        url: path,
        headers: write,
        payload: { edition: "java", requested_name: "TestPlayer" },
      });
      expect(replay.statusCode).toBe(202);
      expect(replay.json()).toEqual(result.json());
      const receipt = result.json(),
        page = (await app.inject({ method: "GET", url: path, headers })).json();
      expect(
        page.items.find((r: { id: string }) => r.id === receipt.enrollment_id),
      ).toMatchObject({
        identity_verified: false,
        access_granted: false,
        state: "pending",
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: `${path}/${receipt.enrollment_id}/verify`,
            headers: write,
            payload: { identity_verified: true },
          })
        ).statusCode,
      ).toBe(404);
      const audit = await tx(runtime, org, (c) =>
        c.query(
          "select details->>'request_id' as request_id from audit_events where details->>'operation_id'=$1",
          [receipt.operation_id],
        ),
      );
      expect(audit.rows[0].request_id).toBe(result.headers["x-request-id"]);
    } finally {
      await app.close();
    }
  });
});

async function operationLimitFixture(
  fn: (f: {
    service: MinecraftControl;
    token: string;
    server: string;
    operation: string;
    seed: (count: number, ageMs: number) => Promise<void>;
    seedEnrollments: (
      count: number,
      ageMs: number,
      microseconds?: number,
    ) => Promise<void>;
    advance: (ms: number) => void;
    observe: (
      key?: string,
      expected?: number,
    ) => ReturnType<MinecraftControl["observe"]>;
    rows: () => Promise<number>;
    reads: () => number;
  }) => Promise<void>,
) {
  const databaseUrl = runtimeUrl;
  if (!databaseUrl) throw new Error("Disposable rate-limit fixture required");
  const token = await member("org_admin"),
    scope = randomUUID();
  let now = Date.now(),
    reads = 0;
  await tx(identity, org, (c) =>
    c.query(
      "insert into environments(id,organization_id,project_id,name,type) values($1,$2,$3,'Rolling limit fixture','minecraft')",
      [scope, org, project],
    ),
  );
  const captured = {
      ...target,
      environment_id: scope,
      id: `rolling-${scope}`,
      observation: {
        ...target.observation,
        observed_at: new Date(now).toISOString(),
      },
    },
    limited = new MinecraftControl({
      databaseUrl,
      auth,
      clock: () => now,
      source: {
        list: async () => [captured],
        observe: async () => {
          reads++;
          return captured;
        },
      },
    });
  try {
    const input = {
        environment_id: scope,
        target_id: captured.id,
        name: "Rolling fixture",
      },
      plan = await limited.plan(token, org, input),
      receipt = await limited.adopt(
        token,
        org,
        { ...input, plan_hash: plan.plan_hash },
        randomUUID(),
      );
    await fn({
      service: limited,
      token,
      server: receipt.server_id,
      operation: receipt.operation_id,
      advance: (ms) => {
        now += ms;
      },
      seedEnrollments: async (count, age, microseconds = 0) => {
        await tx(runtime, org, (c) =>
          c.query(
            "with seeded as (insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at,finished_at) select gen_random_uuid(),o.organization_id,o.project_id,o.environment_id,o.server_id,o.actor_id,o.session_id,'identity_enroll',gen_random_uuid(),repeat('a',64),'succeeded',0,$3,$3,$3 from management_operations o cross join generate_series(1,$2) where o.id=$1 returning *) insert into minecraft_identity_enrollments(id,organization_id,project_id,environment_id,server_id,requested_by,operation_id,edition,requested_name,created_at,expires_at) select gen_random_uuid(),organization_id,project_id,environment_id,server_id,actor_id,id,'java','Historical',$3::timestamptz+($4::int*interval '1 microsecond'),$3::timestamptz+interval '24 hours'+($4::int*interval '1 microsecond') from seeded",
            [receipt.operation_id, count, new Date(now - age), microseconds],
          ),
        );
      },
      reads: () => reads,
      seed: async (count, age) => {
        await tx(runtime, org, (c) =>
          c.query(
            "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at,finished_at) select gen_random_uuid(),o.organization_id,o.project_id,o.environment_id,o.server_id,o.actor_id,o.session_id,'observe',gen_random_uuid(),repeat('a',64),'succeeded',0,$3,$3,$3 from management_operations o cross join generate_series(1,$2) where o.id=$1",
            [receipt.operation_id, count, new Date(now - age)],
          ),
        );
      },
      observe: async (key = randomUUID(), expected?: number) =>
        limited.observe(
          token,
          org,
          receipt.server_id,
          expected ??
            (await limited.get(token, org, receipt.server_id)).version,
          key,
        ),
      rows: async () =>
        tx(
          runtime,
          org,
          async (c) =>
            (
              await c.query<{ n: number }>(
                "select count(*)::int n from management_operations where organization_id=$1 and environment_id=$2",
                [org, scope],
              )
            ).rows[0]?.n ?? 0,
        ),
    });
  } finally {
    await limited.close();
  }
}
it(
  "reclaims historical operation capacity while preserving minute limits, replay and every historical row",
  () =>
    operationLimitFixture(async (f) => {
      await f.seed(10000, 25 * 3600000);
      const expected = (await f.service.get(f.token, org, f.server)).version,
        key = randomUUID(),
        receipt = await f.observe(key, expected);
      expect(
        (await f.service.operation(f.token, org, receipt.operation_id)).state,
      ).toBe("succeeded");
      await f.seed(10, 0);
      expect(await f.observe(key, expected)).toEqual(receipt);
      await expect(f.observe()).rejects.toMatchObject({
        status: 429,
        code: "MANAGEMENT_LIMIT",
        message: expect.stringContaining("one minute"),
      });
      expect(f.reads()).toBe(1);
      expect(await f.rows()).toBe(10012);
      f.advance(60001);
      await f.observe();
      expect(f.reads()).toBe(2);
      expect(await f.rows()).toBe(10013);
      expect((await f.service.operation(f.token, org, f.operation)).state).toBe(
        "succeeded",
      );
    }),
  15000,
);
it(
  "bounds the rolling daily management budget and becomes usable after expiry without deleting history",
  () =>
    operationLimitFixture(async (f) => {
      await f.seed(9999, 120000);
      await expect(f.observe()).rejects.toMatchObject({
        status: 429,
        code: "MANAGEMENT_LIMIT",
        message: expect.stringContaining("24-hour"),
      });
      expect(f.reads()).toBe(0);
      expect(await f.rows()).toBe(10000);
      f.advance(86400001);
      await f.observe();
      expect(f.reads()).toBe(1);
      expect(await f.rows()).toBe(10001);
      expect((await f.service.operation(f.token, org, f.operation)).state).toBe(
        "succeeded",
      );
    }),
  15000,
);

it("reclaims expired enrollment capacity without deleting requests or granting identity/access", () =>
  operationLimitFixture(async (f) => {
    await f.seedEnrollments(200, 25 * 3600000);
    const result = await f.service.enrollIdentity(
      f.token,
      org,
      f.server,
      { edition: "java", requested_name: "StillPending" },
      randomUUID(),
    );
    expect(result.server_id).toBe(f.server);
    await tx(runtime, org, async (c) => {
      expect(
        (
          await c.query(
            "select 1 from minecraft_identity_enrollments where server_id=$1",
            [f.server],
          )
        ).rowCount,
      ).toBe(201);
      expect(
        (
          await c.query(
            "select state from minecraft_identity_enrollments where id=$1",
            [result.enrollment_id],
          )
        ).rows[0]?.state,
      ).toBe("pending");
    });
    const page = await f.service.identityEnrollments(f.token, org, f.server);
    expect(page.items.some((r) => r.expired)).toBe(true);
    expect(
      page.items.every(
        (r) =>
          !r.identity_verified && !r.access_granted && r.state === "pending",
      ),
    ).toBe(true);
    expect(f.reads()).toBe(0);
    expect(await f.rows()).toBe(202);
  }));
it("retains a bounded unexpired enrollment budget, current replay and expiry-based recovery", () =>
  operationLimitFixture(async (f) => {
    await f.seedEnrollments(199, 120000);
    const body = { edition: "bedrock", requested_name: "Pending Family" },
      key = randomUUID(),
      result = await f.service.enrollIdentity(
        f.token,
        org,
        f.server,
        body,
        key,
      );
    expect(
      await f.service.enrollIdentity(f.token, org, f.server, body, key),
    ).toEqual(result);
    await expect(
      f.service.enrollIdentity(
        f.token,
        org,
        f.server,
        { ...body, requested_name: "Another Family" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      status: 429,
      code: "ENROLLMENT_LIMIT",
      message: expect.stringContaining("expires"),
    });
    f.advance(86400001);
    const next = await f.service.enrollIdentity(
      f.token,
      org,
      f.server,
      body,
      randomUUID(),
    );
    expect(next.enrollment_id).not.toBe(result.enrollment_id);
    await tx(runtime, org, async (c) => {
      expect(
        (
          await c.query(
            "select 1 from minecraft_identity_enrollments where server_id=$1",
            [f.server],
          )
        ).rowCount,
      ).toBe(201);
    });
    expect(
      (await f.service.operation(f.token, org, result.operation_id)).state,
    ).toBe("succeeded");
    expect(f.reads()).toBe(0);
    expect(await f.rows()).toBe(202);
  }));

it("deduplicates concurrent pending names across request keys without renewing or repeating metadata", () =>
  operationLimitFixture(async (f) => {
    const body = { edition: "bedrock", requested_name: " SharedPlayer " },
      keys = Array.from({ length: 8 }, () => randomUUID()),
      results = await Promise.allSettled(
        keys.map((key) =>
          f.service.enrollIdentity(f.token, org, f.server, body, key),
        ),
      ),
      accepted = results.flatMap((r, i) =>
        r.status === "fulfilled" ? [{ receipt: r.value, key: keys[i] }] : [],
      );
    expect(accepted).toHaveLength(1);
    for (const r of results)
      if (r.status === "rejected")
        expect(r.reason).toMatchObject({
          status: 409,
          code: "ENROLLMENT_PENDING",
        });
    const winner = accepted[0];
    if (!winner?.key) throw new Error("Missing winning request");
    const before = await f.service.identityEnrollments(f.token, org, f.server);
    expect(before.items).toHaveLength(1);
    expect(before.items[0]).toMatchObject({
      requested_name: "SharedPlayer",
      identity_verified: false,
      access_granted: false,
    });
    const other = await member("org_admin");
    await expect(
      f.service.enrollIdentity(other, org, f.server, body, randomUUID()),
    ).rejects.toMatchObject({ status: 409, code: "ENROLLMENT_PENDING" });
    expect(
      await f.service.enrollIdentity(f.token, org, f.server, body, winner.key),
    ).toEqual(winner.receipt);
    expect(await f.rows()).toBe(2); // Adoption and one accepted request only.
    await tx(runtime, org, async (c) => {
      for (const table of ["management_outbox", "audit_events"] as const) {
        const rows = await c.query(
          table === "management_outbox"
            ? "select 1 from management_outbox where operation_id=$1"
            : "select 1 from audit_events where details->>'operation_id'=$1",
          [winner.receipt.operation_id],
        );
        expect(rows.rowCount).toBe(1);
      }
    });
    f.advance(86400000);
    const next = await f.service.enrollIdentity(
      f.token,
      org,
      f.server,
      body,
      randomUUID(),
    );
    expect(next.enrollment_id).not.toBe(winner.receipt.enrollment_id);
    expect(
      await f.service.enrollIdentity(f.token, org, f.server, body, winner.key),
    ).toEqual(winner.receipt);
    const after = await f.service.identityEnrollments(f.token, org, f.server);
    expect(after.items).toHaveLength(2);
    expect(
      after.items.find((r) => r.id === winner.receipt.enrollment_id),
    ).toEqual({
      ...before.items[0],
      expired: true,
    });
    expect(
      after.items.every((r) => !r.identity_verified && !r.access_granted),
    ).toBe(true);
    expect(await f.rows()).toBe(3);
    expect(f.reads()).toBe(0);
  }));

it("keeps pending name deduplication within its server and edition without asserting identity equivalence", () =>
  operationLimitFixture(async (f) => {
    const body = { edition: "bedrock", requested_name: "SharedPlayer" };
    await f.service.enrollIdentity(f.token, org, f.server, body, randomUUID());
    await f.service.enrollIdentity(
      f.token,
      org,
      f.server,
      { ...body, edition: "java" },
      randomUUID(),
    );
    // Request comparison is exact after schema parsing, not account resolution.
    await f.service.enrollIdentity(
      f.token,
      org,
      f.server,
      { ...body, requested_name: "sharedplayer" },
      randomUUID(),
    );
    await operationLimitFixture(async (other) => {
      const result = await other.service.enrollIdentity(
        other.token,
        org,
        other.server,
        body,
        randomUUID(),
      );
      expect(result.server_id).toBe(other.server);
      expect(result.server_id).not.toBe(f.server);
      expect(await other.rows()).toBe(2);
    });
    expect(await f.rows()).toBe(4);
    expect(f.reads()).toBe(0);
  }));

it("pages newest enrollment history without gaps across tied sub-millisecond timestamps and new arrivals", () =>
  operationLimitFixture(async (f) => {
    const ids = () =>
      tx(runtime, org, async (c) =>
        (
          await c.query<{ id: string }>(
            "select id from minecraft_identity_enrollments where organization_id=$1 and server_id=$2",
            [org, f.server],
          )
        ).rows.map((r) => r.id),
      );
    await f.seedEnrollments(60, 7200000, 7);
    const older = (await ids()).sort().reverse(),
      oldSet = new Set(older);
    await f.seedEnrollments(41, 120000, 7);
    const newer = (await ids())
        .filter((id) => !oldSet.has(id))
        .sort()
        .reverse(),
      expected = [...newer, ...older],
      first = await f.service.identityEnrollments(f.token, org, f.server);
    expect(first.items.map((r) => r.id)).toEqual(expected.slice(0, 50));
    expect(first.next_cursor).toBe(expected[49]);
    if (!first.next_cursor) throw new Error("First cursor missing");
    f.advance(1);
    const arrival = await f.service.enrollIdentity(
      f.token,
      org,
      f.server,
      { edition: "java", requested_name: "NewestPlayer" },
      randomUUID(),
    );
    const second = await f.service.identityEnrollments(
      f.token,
      org,
      f.server,
      first.next_cursor,
    );
    expect(second.items.map((r) => r.id)).toEqual(expected.slice(50, 100));
    expect(second.next_cursor).toBe(expected[99]);
    if (!second.next_cursor) throw new Error("Second cursor missing");
    const third = await f.service.identityEnrollments(
      f.token,
      org,
      f.server,
      second.next_cursor,
    );
    expect(third.items.map((r) => r.id)).toEqual(expected.slice(100));
    expect(third.next_cursor).toBeNull();
    const traversed = [...first.items, ...second.items, ...third.items].map(
      (r) => r.id,
    );
    expect(traversed).toEqual(expected);
    expect(new Set(traversed).size).toBe(101);
    const last = third.items[0];
    if (!last) throw new Error("Last row missing");
    expect(
      await f.service.identityEnrollments(f.token, org, f.server, last.id),
    ).toEqual({ items: [], next_cursor: null });
    expect(
      (await f.service.identityEnrollments(f.token, org, f.server)).items[0]
        ?.id,
    ).toBe(arrival.enrollment_id);
    expect((await ids()).length).toBe(102);
    expect(f.reads()).toBe(0);
  }));

it("rejects another server's history cursor even when both servers are authorized", () =>
  operationLimitFixture(async (f) => {
    expect(await f.service.identityEnrollments(f.token, org, f.server)).toEqual(
      { items: [], next_cursor: null },
    );
    await operationLimitFixture(async (other) => {
      const receipt = await other.service.enrollIdentity(
        other.token,
        org,
        other.server,
        { edition: "java", requested_name: "OtherPlayer" },
        randomUUID(),
      );
      await expect(
        f.service.identityEnrollments(
          f.token,
          org,
          f.server,
          receipt.enrollment_id,
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        f.service.identityEnrollments(
          f.token,
          foreignOrg,
          other.server,
          receipt.enrollment_id,
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  }));
