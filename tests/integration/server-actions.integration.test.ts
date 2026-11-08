import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../packages/auth/src/index.js";
import {
  MinecraftControl,
  ServerActions,
} from "../../packages/minecraft-control/src/index.js";

const identityUrl = process.env.TEST_ACTIONS_IDENTITY_DATABASE_URL;
const runtimeUrl = process.env.TEST_ACTIONS_DATABASE_URL;
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
  project = randomUUID(),
  environment = randomUUID(),
  otherEnvironment = randomUUID(),
  server = randomUUID(),
  otherServer = randomUUID();
let now = Date.parse("2026-11-08T18:00:00Z");
const actions = new ServerActions({
  databaseUrl: runtimeUrl,
  auth,
  clock: () => now,
});
const control = new MinecraftControl({
  databaseUrl: runtimeUrl,
  auth,
  clock: () => now,
});
let adult = "",
  viewer = "",
  child = "",
  playersOnly = "",
  agentToken = "";
let app: Awaited<ReturnType<typeof buildApp>>;
async function tx<T>(
  pool: pg.Pool,
  fn: (c: pg.PoolClient) => Promise<T>,
  scope = org,
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
async function member(
  role: string,
  type = "adult",
  grants: Array<[string, string | null]> = [],
) {
  const user = randomUUID(),
    membership = randomUUID(),
    session = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await tx(identity, async (c) => {
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,$3,'synthetic-unused-hash')",
      [user, `sa-${user}`, type],
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
    for (const [permission, env] of grants)
      await c.query(
        "insert into resource_grants(id,organization_id,membership_id,permission,project_id,environment_id) values($1,$2,$3,$4,$5,$6)",
        [randomUUID(), org, membership, permission, project, env],
      );
  });
  return { token, user, membership };
}
const headers = (token: string) => ({
  cookie: `craftlayer_session=${token}`,
  origin: "http://127.0.0.1:3000",
  "x-csrf-token": auth.csrfToken(token),
  "x-craftlayer-organization": org,
  "idempotency-key": randomUUID(),
});
beforeAll(async () => {
  await auth.initialize();
  await tx(identity, async (c) => {
    await c.query(
      "insert into organizations(id,name) values($1,'Actions fixture')",
      [org],
    );
    await c.query(
      "insert into projects(id,organization_id,name) values($1,$2,'Family')",
      [project, org],
    );
    for (const id of [environment, otherEnvironment])
      await c.query(
        "insert into environments(id,organization_id,project_id,name,type) values($1,$2,$3,'World','minecraft')",
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
  await tx(identity, async (c) => {
    // Resource grants scope a role's permissions; they cannot exceed the role. A custom
    // "players" role carries player:manage so it can be scoped to one environment.
    const role = randomUUID();
    await c.query(
      "insert into roles(id,organization_id,name,built_in) values($1,$2,'players',false)",
      [role, org],
    );
    for (const permission of [
      "player:manage",
      "server:read",
      "organization:read",
      "project:read",
      "environment:read",
    ])
      await c.query(
        "insert into role_permissions(organization_id,role_id,permission) values($1,$2,$3)",
        [org, role, permission],
      );
  });
  adult = (await member("org_admin")).token;
  viewer = (await member("viewer", "adult", [["server:read", environment]]))
    .token;
  child = (await member("child", "child")).token;
  // An operator granted only player management in this environment: can allow, cannot stop.
  playersOnly = (
    await member("players", "adult", [
      ["player:manage", environment],
      ["server:read", environment],
    ])
  ).token;
  await tx(runtime, async (c) => {
    for (const [id, env, target] of [
      [server, environment, "family"],
      [otherServer, otherEnvironment, "other"],
    ] as const)
      await c.query(
        "insert into minecraft_servers(id,organization_id,project_id,environment_id,name,target_id,binding_hash) values($1,$2,$3,$4,'Family Survival',$5,$6)",
        [
          id,
          org,
          project,
          env,
          target,
          createHash("sha256").update(target).digest("hex"),
        ],
      );
  });
  app = await buildApp({
    auth,
    actions,
    minecraft: control,
    publicUrl: "http://127.0.0.1:3000",
    readiness: async () => true,
  });
  agentToken = (
    await auth.createAgentToken(adult, org, {
      name: "reader",
      permissions: ["organization:read", "server:read"],
      projectId: project,
      environmentId: environment,
    })
  ).token;
});
afterAll(async () => {
  await app?.close();
  await actions.close();
  await control.close();
  await auth.close();
  await identity.end();
  await runtime.end();
});
describe("server action intake", () => {
  let allowId = "",
    allowOperation = "";
  it("accepts a typed request from an adult, fences it, audits it and replays by key", async () => {
    const key = randomUUID();
    const accepted = await actions.request(
      adult,
      org,
      server,
      {
        kind: "allow_player",
        player: {
          edition: "bedrock",
          gamertag: "Big Crazy Pickle",
          xuid: "2535400000000001",
        },
      },
      key,
    );
    expect(accepted).toMatchObject({
      server_id: server,
      state: "pending",
      awaiting_node: true,
    });
    allowId = accepted.action_id;
    allowOperation = accepted.operation_id;
    expect(
      (
        await actions.request(
          adult,
          org,
          server,
          {
            kind: "allow_player",
            player: {
              edition: "bedrock",
              gamertag: "Big Crazy Pickle",
              xuid: "2535400000000001",
            },
          },
          key,
        )
      ).action_id,
    ).toBe(allowId);
    await expect(
      actions.request(
        adult,
        org,
        server,
        { kind: "say", message: "hello" },
        key,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const view = await actions.get(viewer, org, allowId);
    expect(view).toMatchObject({
      kind: "allow_player",
      fence: 1,
      state: "pending",
      can_cancel: true,
      awaiting_node: true,
      evidence: null,
    });
    expect((await control.operation(adult, org, allowOperation)).kind).toBe(
      "server_action",
    );
    const second = await actions.request(
      adult,
      org,
      server,
      { kind: "say", message: "Dinner in five" },
      randomUUID(),
    );
    expect((await actions.get(adult, org, second.action_id)).fence).toBe(2);
  });
  it("refuses free text, bad names, children, agents, viewers and the wrong permission", async () => {
    for (const bad of [
      { kind: "say", message: "/op me" },
      { kind: "kick_player", name: "has space" },
      {
        kind: "allow_player",
        player: { edition: "java", name: "x".repeat(17) },
      },
      {
        kind: "allow_player",
        player: { edition: "bedrock", gamertag: "Big  Crazy", xuid: "1" },
      },
      { kind: "run", command: "stop" },
    ])
      await expect(
        actions.request(adult, org, server, bad, randomUUID()),
      ).rejects.toThrow();
    await expect(
      actions.request(child, org, server, { kind: "save" }, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actions.request(viewer, org, server, { kind: "save" }, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actions.request(agentToken, org, server, { kind: "save" }, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    // player:manage lets the operator allow players but not control the server.
    expect(
      (
        await actions.request(
          playersOnly,
          org,
          server,
          { kind: "kick_player", name: ".Someone", reason: "Bedtime" },
          randomUUID(),
        )
      ).state,
    ).toBe("pending");
    await expect(
      actions.request(playersOnly, org, server, { kind: "stop" }, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actions.request(
        playersOnly,
        org,
        otherServer,
        { kind: "kick_player", name: "x" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(actions.list(viewer, org, otherServer)).rejects.toMatchObject({
      status: 403,
    });
    expect((await actions.list(agentToken, org, server)).items).toHaveLength(3);
    const http = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${server}/actions`,
      headers: headers(adult),
      payload: { kind: "say", message: "x\ny" },
    });
    expect(http.statusCode).toBe(400);
  });
  it("refuses a lifecycle action while work is open, cancels pending work, and keeps SQL honest", async () => {
    await expect(
      actions.request(adult, org, server, { kind: "stop" }, randomUUID()),
    ).rejects.toMatchObject({ code: "ACTIONS_STILL_OPEN" });
    const cancelled = await actions.cancel(
      playersOnly,
      org,
      (await actions.list(adult, org, server)).items.find(
        (a) => a.kind === "kick_player",
      )?.id ?? "",
    );
    expect(cancelled).toMatchObject({
      state: "cancelled",
      failure_code: "cancelled",
      can_cancel: false,
    });
    await expect(
      actions.cancel(adult, org, cancelled.id),
    ).rejects.toMatchObject({ code: "ACTION_NOT_PENDING" });
    await expect(
      tx(runtime, (c) =>
        c.query("delete from minecraft_server_actions where id=$1", [
          cancelled.id,
        ]),
      ),
    ).rejects.toMatchObject({ code: /23514|42501/ });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "update minecraft_server_actions set state='pending',version=version+1 where id=$1",
          [cancelled.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "update minecraft_server_actions set request='{}'::jsonb,version=version+1 where id=$1",
          [allowId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "update minecraft_server_actions set state='succeeded',version=version+1 where id=$1",
          [allowId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "insert into minecraft_server_actions(id,organization_id,project_id,environment_id,server_id,operation_id,actor_id,session_id,kind,request,request_hash,fence,created_at,expires_at) select $1,organization_id,project_id,environment_id,server_id,operation_id,actor_id,session_id,kind,request,request_hash,99,created_at,expires_at from minecraft_server_actions where id=$2",
          [randomUUID(), allowId],
        ),
      ),
    ).rejects.toMatchObject({ code: /23514|23505/ });
  });
  it("dispatches in fence order, records the server's words, and expires stale work without retrying", async () => {
    const claimed = await actions.claimNext(org, server);
    expect(claimed).toMatchObject({
      id: allowId,
      state: "dispatched",
      awaiting_node: false,
      can_cancel: false,
    });
    await expect(actions.cancel(adult, org, allowId)).rejects.toMatchObject({
      code: "ACTION_NOT_PENDING",
    });
    const done = await actions.recordResult(org, allowId, {
      ok: true,
      evidence: "Reloaded the whitelist",
      detail: { name: ".Big_Crazy_Pickle" },
    });
    expect(done).toMatchObject({ state: "succeeded", failure_code: "none" });
    expect((await control.operation(adult, org, allowOperation)).state).toBe(
      "succeeded",
    );
    await expect(
      actions.recordResult(org, allowId, { ok: true, evidence: "again" }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_DISPATCHED" });
    const say = await actions.claimNext(org, server);
    expect(say?.kind).toBe("say");
    const failed = await actions.recordResult(
      org,
      String(say?.id),
      { ok: false, evidence: "connection refused" },
      "server_unreachable",
    );
    expect(failed).toMatchObject({
      state: "failed",
      failure_code: "server_unreachable",
    });
    expect(await actions.claimNext(org, server)).toBeNull();
    // Now the lifecycle action is allowed, and it expires if no node picks it up in time.
    const stop = await actions.request(
      adult,
      org,
      server,
      { kind: "stop" },
      randomUUID(),
    );
    now += 11 * 60_000;
    expect(await actions.expireStale(org)).toBe(1);
    expect((await actions.get(adult, org, stop.action_id)).state).toBe(
      "expired",
    );
    expect(
      await control.operation(adult, org, stop.operation_id),
    ).toMatchObject({ state: "failed" });
    const events = await tx(runtime, (c) =>
      c.query<{ event: string }>(
        "select event from minecraft_server_action_outbox where organization_id=$1",
        [org],
      ),
    );
    expect(events.rows.map((e) => e.event).sort()).toEqual([
      "cancelled",
      "dispatched",
      "dispatched",
      "expired",
      "finished",
      "finished",
      "requested",
      "requested",
      "requested",
      "requested",
    ]);
    const audit = await auth.listAudit(adult, org);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "server.action_requested",
        "server.action_cancelled",
      ]),
    );
  });
});
