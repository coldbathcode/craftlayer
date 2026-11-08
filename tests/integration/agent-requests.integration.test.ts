import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../packages/auth/src/index.js";
import {
  AgentRequests,
  MinecraftControl,
  ServerActions,
} from "../../packages/minecraft-control/src/index.js";

const identityUrl = process.env.TEST_AGENT_REQUESTS_IDENTITY_DATABASE_URL;
const runtimeUrl = process.env.TEST_AGENT_REQUESTS_DATABASE_URL;
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
  server = randomUUID();
let now = Date.parse("2026-11-08T19:00:00Z");
const actions = new ServerActions({
  databaseUrl: runtimeUrl,
  auth,
  clock: () => now,
});
const requests = new AgentRequests({
  databaseUrl: runtimeUrl,
  auth,
  actions,
  clock: () => now,
});
const control = new MinecraftControl({
  databaseUrl: runtimeUrl,
  auth,
  clock: () => now,
});
let admin = "",
  viewer = "",
  child = "",
  readerAgent = "",
  askingAgent = "",
  askingAgentId = "";
let app: Awaited<ReturnType<typeof buildApp>>;
async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.organization_id',$1,true)", [org]);
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
      [user, `ar-${user}`, type],
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
const bearer = (token: string) => ({
  authorization: `Bearer ${token}`,
  "x-craftlayer-organization": org,
  "idempotency-key": randomUUID(),
});
const cookie = (token: string) => ({
  cookie: `craftlayer_session=${token}`,
  origin: "http://127.0.0.1:3000",
  "x-csrf-token": auth.csrfToken(token),
  "x-craftlayer-organization": org,
  "idempotency-key": randomUUID(),
});
const allowGeorge = {
  action: {
    kind: "allow_player",
    player: {
      edition: "bedrock",
      gamertag: "BigCrazyPickle",
      xuid: "2535400000000001",
    },
  },
  reason: "George knocked twice",
};
beforeAll(async () => {
  await auth.initialize();
  await tx(identity, async (c) => {
    await c.query(
      "insert into organizations(id,name) values($1,'Agent request fixture')",
      [org],
    );
    await c.query(
      "insert into projects(id,organization_id,name) values($1,$2,'Family')",
      [project, org],
    );
    await c.query(
      "insert into environments(id,organization_id,project_id,name,type) values($1,$2,$3,'World','minecraft')",
      [environment, org, project],
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
  admin = (await member("org_admin")).token;
  viewer = (await member("viewer", "adult", [["server:read", environment]]))
    .token;
  child = (await member("child", "child")).token;
  await tx(runtime, (c) =>
    c.query(
      "insert into minecraft_servers(id,organization_id,project_id,environment_id,name,target_id,binding_hash) values($1,$2,$3,$4,'Family Survival','family',$5)",
      [
        server,
        org,
        project,
        environment,
        createHash("sha256").update("family").digest("hex"),
      ],
    ),
  );
  app = await buildApp({
    auth,
    actions,
    agentRequests: requests,
    minecraft: control,
    publicUrl: "http://127.0.0.1:3000",
    readiness: async () => true,
  });
  readerAgent = (
    await auth.createAgentToken(admin, org, {
      name: "reader",
      permissions: ["organization:read", "server:read"],
      projectId: project,
      environmentId: environment,
    })
  ).token;
  const asking = await auth.createAgentToken(admin, org, {
    name: "Claude on the laptop",
    permissions: ["organization:read", "server:read"],
    projectId: project,
    environmentId: environment,
    mayRequest: ["allow_player", "kick_player", "say"],
  });
  askingAgent = asking.token;
  askingAgentId = asking.id;
});
afterAll(async () => {
  await app?.close();
  await requests.close();
  await actions.close();
  await control.close();
  await auth.close();
  await identity.end();
  await runtime.end();
});
describe("agents ask, adults approve", () => {
  let requestId = "";
  it("lets only an agent with that kind ask, replays by key and refuses people and other kinds", async () => {
    const key = randomUUID();
    const accepted = await requests.request(
      askingAgent,
      org,
      server,
      allowGeorge,
      key,
    );
    expect(accepted).toMatchObject({ server_id: server, state: "pending" });
    requestId = accepted.request_id;
    expect(
      (await requests.request(askingAgent, org, server, allowGeorge, key))
        .request_id,
    ).toBe(requestId);
    await expect(
      requests.request(
        askingAgent,
        org,
        server,
        { action: { kind: "say", message: "hi" } },
        key,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      requests.request(
        askingAgent,
        org,
        server,
        { action: { kind: "stop" } },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "AGENT_MAY_NOT_REQUEST" });
    await expect(
      requests.request(readerAgent, org, server, allowGeorge, randomUUID()),
    ).rejects.toMatchObject({ code: "AGENT_MAY_NOT_REQUEST" });
    await expect(
      requests.request(admin, org, server, allowGeorge, randomUUID()),
    ).rejects.toMatchObject({ code: "AGENT_ONLY" });
    await expect(
      requests.request(
        askingAgent,
        org,
        server,
        { action: { kind: "say", message: "/op me" } },
        randomUUID(),
      ),
    ).rejects.toThrow();
    // A creator without the action's permission cannot mint an agent that may request it.
    await expect(
      auth.createAgentToken(viewer, org, {
        name: "over-reach",
        permissions: ["server:read"],
        projectId: project,
        environmentId: environment,
        mayRequest: ["stop"],
      }),
    ).rejects.toMatchObject({ status: 403 });
    // Direct SQL cannot create a request for a kind the token does not carry.
    await expect(
      tx(runtime, (c) =>
        c.query(
          "insert into minecraft_agent_requests(id,organization_id,project_id,environment_id,server_id,agent_id,created_by,request_key,kind,request,request_hash,created_at,expires_at) select $1,organization_id,project_id,environment_id,server_id,agent_id,created_by,$2,'stop','{\"kind\":\"stop\"}',repeat('a',64),created_at,expires_at from minecraft_agent_requests where id=$3",
          [randomUUID(), randomUUID(), requestId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("shows adults every request with can_decide, and the agent only its own", async () => {
    const other = await requests.request(
      askingAgent,
      org,
      server,
      {
        action: { kind: "say", message: "Dinner in five" },
        reason: "Parent asked me to remind them",
      },
      randomUUID(),
    );
    const adultView = await requests.list(admin, org, server);
    expect(adultView.items.map((r) => r.kind).sort()).toEqual([
      "allow_player",
      "say",
    ]);
    expect(adultView.items.every((r) => r.can_decide)).toBe(true);
    expect(adultView.items.find((r) => r.id === requestId)).toMatchObject({
      agent_name: "Claude on the laptop",
      reason: "George knocked twice",
      state: "pending",
    });
    const viewerView = await requests.list(viewer, org, server);
    expect(viewerView.items.every((r) => r.can_decide === false)).toBe(true);
    const readerView = await requests.list(readerAgent, org, server);
    expect(readerView.items).toEqual([]);
    expect((await requests.list(askingAgent, org, server)).items).toHaveLength(
      2,
    );
    await expect(requests.list(child, org, server)).rejects.toMatchObject({
      status: 403,
    });
    const http = await app.inject({
      url: `/api/v1/servers/${server}/agent-requests`,
      headers: bearer(askingAgent),
    });
    expect(http.statusCode).toBe(200);
    expect(http.json().items).toHaveLength(2);
    const cancelled = await requests.cancel(askingAgent, org, other.request_id);
    expect(cancelled.state).toBe("cancelled");
    await expect(
      requests.cancel(readerAgent, org, requestId),
    ).rejects.toMatchObject({ code: "AGENT_REQUEST_NOT_OWN" });
    await expect(requests.cancel(admin, org, requestId)).rejects.toMatchObject({
      code: "AGENT_REQUEST_NOT_OWN",
    });
  });
  it("approval creates the real action as the adult; agents, children and viewers cannot decide", async () => {
    await expect(
      requests.decide(askingAgent, org, requestId, { decision: "approve" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requests.decide(viewer, org, requestId, { decision: "approve" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requests.decide(child, org, requestId, { decision: "approve" }),
    ).rejects.toMatchObject({ status: 403 });
    const http = await app.inject({
      method: "POST",
      url: `/api/v1/agent-requests/${requestId}/decide`,
      headers: cookie(admin),
      payload: { decision: "approve", note: "Welcome George" },
    });
    expect(http.statusCode).toBe(200);
    const decided = http.json();
    expect(decided).toMatchObject({
      state: "approved",
      note: "Welcome George",
      can_decide: false,
    });
    expect(decided.action_id).toBeTruthy();
    const action = await actions.get(admin, org, decided.action_id);
    expect(action).toMatchObject({
      kind: "allow_player",
      state: "pending",
      fence: 1,
      awaiting_node: true,
    });
    expect(action.request).toEqual(allowGeorge.action);
    await expect(
      requests.decide(admin, org, requestId, { decision: "decline" }),
    ).rejects.toMatchObject({ code: "AGENT_REQUEST_NOT_PENDING" });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "update minecraft_agent_requests set state='pending',version=version+1 where id=$1",
          [requestId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query("delete from minecraft_agent_requests where id=$1", [
          requestId,
        ]),
      ),
    ).rejects.toMatchObject({ code: /23514|42501/ });
    const audit = await auth.listAudit(admin, org);
    const created = audit.find(
      (a) => a.action === "server.agent_request_created",
    );
    expect(created?.details).toMatchObject({ agent_id: askingAgentId });
    const approved = audit.find(
      (a) => a.action === "server.agent_request_approved",
    );
    expect(approved?.details).toMatchObject({
      requesting_agent_id: askingAgentId,
      action_id: decided.action_id,
    });
    expect(approved?.details).not.toHaveProperty("agent_id");
  });
  it("declines with a note and expires stale requests without creating actions", async () => {
    const kick = await requests.request(
      askingAgent,
      org,
      server,
      { action: { kind: "kick_player", name: ".Someone" } },
      randomUUID(),
    );
    const declined = await requests.decide(admin, org, kick.request_id, {
      decision: "decline",
      note: "Not tonight",
    });
    expect(declined).toMatchObject({
      state: "declined",
      note: "Not tonight",
      action_id: null,
    });
    const stale = await requests.request(
      askingAgent,
      org,
      server,
      { action: { kind: "say", message: "Still here?" } },
      randomUUID(),
    );
    now += 25 * 3600_000;
    expect(await requests.expireStale(org)).toBe(1);
    expect(
      (await requests.list(admin, org, server)).items.find(
        (r) => r.id === stale.request_id,
      )?.state,
    ).toBe("expired");
    await expect(
      requests.decide(admin, org, stale.request_id, { decision: "approve" }),
    ).rejects.toMatchObject({ code: "AGENT_REQUEST_NOT_PENDING" });
    expect((await actions.list(admin, org, server)).items).toHaveLength(1);
    const events = await tx(runtime, (c) =>
      c.query<{ event: string }>(
        "select event from minecraft_agent_request_outbox where organization_id=$1",
        [org],
      ),
    );
    expect(events.rows.map((e) => e.event).sort()).toEqual([
      "approved",
      "cancelled",
      "declined",
      "expired",
      "requested",
      "requested",
      "requested",
      "requested",
    ]);
  });
});
