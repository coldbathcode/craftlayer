import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../packages/auth/src/index.js";
import type { InventoryTarget } from "../../packages/contracts/src/minecraft.js";
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
  it("upgrades an existing tenant role and removes migration-only discovery policy", async () => {
    await tx(identity, "00000000-0000-4000-8000-00000000f101", async (c) => {
      const rows = (
        await c.query<{ permission: string }>(
          "select permission from role_permissions where role_id='00000000-0000-4000-8000-00000000f102' order by permission",
        )
      ).rows.map((r) => r.permission);
      expect(rows).toEqual(["operation:read", "player:read", "server:read"]);
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
          "select 1 from pg_policies where policyname='f1_migration_discovery'",
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
