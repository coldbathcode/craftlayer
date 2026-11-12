import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { buildNodeAgentApp } from "../../apps/api/src/node-agent-app.js";
import { ActionJournal } from "../../apps/minecraft-node/src/action-journal.js";
import {
  type GameChannel,
  runServerAction,
} from "../../apps/minecraft-node/src/action-runner.js";
import { ActionWorker } from "../../apps/minecraft-node/src/action-worker.js";
import { NodeTransport } from "../../apps/minecraft-node/src/client.js";
import { MemoryWhitelistStore } from "../../apps/minecraft-node/src/game-control/index.js";
import { AuthService } from "../../packages/auth/src/index.js";
import type { NodeActionOffer } from "../../packages/contracts/src/index.js";
import {
  ActionDispatch,
  MinecraftControl,
  NodeControl,
  ServerActions,
} from "../../packages/minecraft-control/src/index.js";
import {
  nodeDigest,
  nodeTimeWindow,
  signNodeValue,
} from "../../packages/node-protocol/src/index.js";
import { createNodeFixture } from "../../scripts/minecraft/node-fixtures.js";

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

describe("node dispatch of server actions", () => {
  const dispatchServer = randomUUID();
  let root = "",
    nodeId = "",
    sequence = 0,
    runs: string[] = [],
    sent: string[] = [];
  let pki: Awaited<ReturnType<typeof createNodeFixture>>;
  let nodes: NodeControl;
  let gatewayActions: ServerActions;
  let gateway: Awaited<ReturnType<typeof buildNodeAgentApp>>;
  let transport: NodeTransport;
  let journal: ActionJournal;
  let worker: ActionWorker;
  let agentKey = "";
  const whitelist = new MemoryWhitelistStore();
  /** A scripted private console standing in for the real server's RCON. */
  const channel: GameChannel = {
    whitelist,
    options: {},
    async open() {
      return {
        async command(text) {
          sent.push(text);
          const body = text.startsWith("say ")
            ? ""
            : text === "whitelist reload"
              ? "Reloaded the whitelist"
              : text === "whitelist list"
                ? `There are ${whitelist.entries.length} whitelisted player(s): ${whitelist.entries.map((e) => e.name).join(", ")}`
                : text === "save-all flush"
                  ? "Saved the game"
                  : "Unknown command";
          return { body, truncated: false };
        },
        async close() {},
      };
    },
  };
  const base = () => ({
    schema_version: 1 as const,
    control_id: nodeDigest(pki.control_public_key),
    organization_id: org,
    node_id: nodeId,
    credential_version: 1,
    ...nodeTimeWindow(),
  });
  const poll = (server_ids: string[]) =>
    transport.actionPoll({
      ...base(),
      purpose: "node.actions.poll.v1",
      sequence: ++sequence,
      server_ids,
    });
  const ask = async (input: unknown) =>
    (await actions.request(adult, org, dispatchServer, input, randomUUID()))
      .action_id;
  beforeAll(async () => {
    // The transport proofs use the real clock, so the action clock joins it here.
    now = Date.now();
    root = await mkdtemp(join(tmpdir(), "craftlayer-dispatch-"));
    pki = await createNodeFixture(join(root, "pki"));
    const file = (name: string) => readFile(join(root, "pki", name), "utf8");
    agentKey = await file("agent.key");
    nodes = new NodeControl({
      databaseUrl: String(runtimeUrl),
      auth,
      controlPrivateKey: await file("control.key"),
      credentialDays: 30,
    });
    gatewayActions = new ServerActions({
      databaseUrl: String(runtimeUrl),
      clock: () => now,
    });
    gateway = await buildNodeAgentApp({
      control: nodes,
      actions: new ActionDispatch({ nodes, actions: gatewayActions }),
      key: await file("server.key"),
      cert: await file("server.crt"),
      ca: await file("ca.crt"),
    });
    await gateway.listen({ host: "127.0.0.1", port: 0 });
    const address = gateway.server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    transport = new NodeTransport({
      url: `https://127.0.0.1:${address.port}`,
      ca: await file("ca.crt"),
      cert: await file("client.crt"),
      key: await file("client.key"),
      private_key: agentKey,
      control_public_key: pki.control_public_key,
      server_certificate_sha256: pki.server_certificate_sha256,
    });
    await tx(runtime, (c) =>
      c.query(
        "insert into minecraft_servers(id,organization_id,project_id,environment_id,name,target_id,binding_hash) values($1,$2,$3,$4,'Dispatch fixture','dispatch',$5)",
        [
          dispatchServer,
          org,
          project,
          environment,
          createHash("sha256").update("dispatch").digest("hex"),
        ],
      ),
    );
    nodeId = (
      await nodes.enroll(
        adult,
        org,
        {
          project_id: project,
          name: "Family host",
          public_key: pki.public_key,
          certificate_sha256: pki.certificate_sha256,
        },
        randomUUID(),
      )
    ).node_id;
    journal = new ActionJournal(join(root, "pki"), nodeId);
    worker = new ActionWorker({
      serverIds: [dispatchServer],
      journal,
      poll,
      report: (result) =>
        transport.actionResult({
          ...base(),
          purpose: "node.actions.result.v1",
          sequence: ++sequence,
          ...result,
        }),
      run: (offer: NodeActionOffer) => {
        runs.push(offer.id);
        return runServerAction(offer, channel);
      },
    });
  }, 30000);
  afterAll(async () => {
    await gateway?.close();
    await gatewayActions?.close();
    await nodes?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("lets an operator choose a longer credential lifetime, within limits", async () => {
    const view = await nodes.get(adult, org, nodeId);
    const days =
      (Date.parse(view.credential_expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect(
      () =>
        new NodeControl({
          databaseUrl: String(runtimeUrl),
          credentialDays: 401,
        }),
    ).toThrow();
    await expect(
      tx(runtime, (c) =>
        c.query(
          "insert into minecraft_node_credentials(organization_id,node_id,version,public_key,certificate_sha256,created_at,expires_at) values($1,$2,2,$3,$4,now(),now()+interval '401 days')",
          [org, nodeId, `${"A".repeat(58)}B`, "a".repeat(64)],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("binds a server only to an active host, for an adult who may control both", async () => {
    expect(await actions.nodeBinding(viewer, org, dispatchServer)).toEqual({
      server_id: dispatchServer,
      node_id: null,
      bound_at: null,
      can_change: false,
    });
    await expect(
      actions.bindNode(adult, org, dispatchServer, { node_id: nodeId }),
    ).rejects.toMatchObject({ code: "NODE_NOT_ACTIVE" });
    await transport.send({ ...base(), purpose: "node.enroll.v1", sequence: 0 });
    for (const token of [viewer, child, playersOnly, agentToken])
      await expect(
        actions.bindNode(token, org, dispatchServer, { node_id: nodeId }),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      actions.bindNode(adult, org, dispatchServer, { node_id: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    const waiting = await ask({ kind: "say", message: "Dinner in five" });
    expect((await actions.get(adult, org, waiting)).awaiting_node).toBe(true);
    // Before a host is bound, nothing is handed out, whatever the node asks for.
    expect(await poll([dispatchServer])).toBeNull();
    const http = await app.inject({
      method: "PUT",
      url: `/api/v1/servers/${dispatchServer}/node`,
      headers: headers(adult),
      payload: { node_id: nodeId },
    });
    expect(http.statusCode).toBe(200);
    expect(http.json()).toMatchObject({ node_id: nodeId, can_change: true });
    const again = await actions.bindNode(adult, org, dispatchServer, {
      node_id: nodeId,
    });
    expect(again.bound_at).toBe(http.json().bound_at);
    expect((await actions.get(adult, org, waiting)).awaiting_node).toBe(false);
    await expect(
      tx(runtime, (c) =>
        c.query(
          "delete from minecraft_server_nodes where organization_id=$1 and server_id=$2",
          [org, dispatchServer],
        ),
      ),
    ).rejects.toMatchObject({ code: /23514|42501/ });
  });
  it("carries an action to the node over mTLS and records the server's own words", async () => {
    const say = (await actions.list(adult, org, dispatchServer)).items[0];
    const allow = await ask({
      kind: "allow_player",
      player: {
        edition: "bedrock",
        gamertag: "Big Crazy Pickle",
        xuid: "2535400000000001",
      },
    });
    expect(await worker.tick()).toBe(true);
    expect(await actions.get(adult, org, String(say?.id))).toMatchObject({
      state: "succeeded",
      failure_code: "none",
      evidence: { ok: true },
    });
    expect(sent).toContain("say Dinner in five");
    expect(await worker.tick()).toBe(true);
    const allowed = await actions.get(adult, org, allow);
    expect(allowed).toMatchObject({
      state: "succeeded",
      evidence: {
        ok: true,
        evidence: "Reloaded the whitelist",
        detail: { name: ".Big_Crazy_Pickle" },
      },
    });
    expect(whitelist.entries).toHaveLength(1);
    expect(await worker.tick()).toBe(false);
    expect(runs).toEqual([say?.id, allow]);
    expect((await journal.read()).fences[dispatchServer]).toBe(allowed.fence);
    const audit = await tx(runtime, (c) =>
      c.query<{ details: { service_actor: string; state: string } }>(
        "select details from audit_events where organization_id=$1 and action='server.action_finished' and target_id=$2",
        [org, dispatchServer],
      ),
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0]?.details).toMatchObject({
      service_actor: nodeId,
      state: "succeeded",
    });
  });
  it("offers a lost action again but never runs anything twice", async () => {
    runs = [];
    const save = await ask({ kind: "save" });
    // The offer is claimed but its reply is "lost": the node never saw it.
    const lost = await poll([dispatchServer]);
    expect(lost?.id).toBe(save);
    expect((await actions.get(adult, org, save)).state).toBe("dispatched");
    expect(await worker.tick()).toBe(true);
    expect(runs).toEqual([save]);
    expect((await actions.get(adult, org, save)).state).toBe("succeeded");
    // A repeated answer changes nothing and reports what is recorded.
    expect(
      await gatewayActions.recordNodeResult(org, nodeId, {
        action_id: save,
        server_id: dispatchServer,
        fence: lost?.fence ?? 0,
        outcome: { ok: false, evidence: "again" },
        failure: "not_verified",
      }),
    ).toBe("succeeded");
    for (const wrong of [
      { node: randomUUID(), fence: lost?.fence ?? 0 },
      { node: nodeId, fence: (lost?.fence ?? 0) + 1 },
    ])
      await expect(
        gatewayActions.recordNodeResult(org, wrong.node, {
          action_id: save,
          server_id: dispatchServer,
          fence: wrong.fence,
          outcome: { ok: true, evidence: "forged" },
          failure: null,
        }),
      ).rejects.toMatchObject({ code: "ACTION_RESULT_DENIED" });
  });
  it("reports an action interrupted by a restart instead of running it again", async () => {
    runs = [];
    const say = await ask({ kind: "say", message: "Back soon" });
    const offer = await poll([dispatchServer]);
    expect(offer?.id).toBe(say);
    // The node journalled the action and then stopped before recording an answer.
    await journal.begin(offer as NodeActionOffer);
    await expect(
      actions.unbindNode(adult, org, dispatchServer),
    ).rejects.toMatchObject({ code: "ACTIONS_STILL_OPEN" });
    expect(await worker.tick()).toBe(true);
    expect(runs).toEqual([]);
    expect(await actions.get(adult, org, say)).toMatchObject({
      state: "failed",
      failure_code: "interrupted",
      evidence: { ok: false },
    });
    expect((await journal.read()).open).toBeNull();
  });
  it("refuses replayed proofs and requests it cannot verify", async () => {
    const payload = {
      ...base(),
      purpose: "node.actions.poll.v1" as const,
      sequence,
      server_ids: [dispatchServer],
    };
    const peer = {
      certificate_sha256: pki.certificate_sha256,
      certificate_expires_at: Date.now() + 3600_000,
    };
    await expect(
      nodes.admit(payload, signNodeValue(payload, agentKey), peer),
    ).rejects.toMatchObject({ code: "NODE_REPLAY_DENIED" });
    const fresh = { ...payload, sequence: sequence + 1000 };
    await expect(
      nodes.admit(fresh, signNodeValue(payload, agentKey), peer),
    ).rejects.toMatchObject({ code: "NODE_CREDENTIAL_DENIED" });
    await expect(
      nodes.admit(fresh, signNodeValue(fresh, agentKey), {
        ...peer,
        certificate_sha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "NODE_CREDENTIAL_DENIED" });
  });
  it("dispatches nothing under an emergency stop and cancels work whose author has left", async () => {
    const held = await ask({ kind: "say", message: "Held" });
    const latch = (latched: boolean) =>
      tx(runtime, (c) =>
        latched
          ? c.query(
              "insert into runtime_stop_latches(kind,scope_id,organization_id,epoch,latched,operation_id,reason) values('environment',$1,$2,1,true,$3,'Dispatch test stop')",
              [environment, org, randomUUID()],
            )
          : c.query(
              "update runtime_stop_latches set latched=false,epoch=epoch+1 where kind='environment' and scope_id=$1",
              [environment],
            ),
      );
    await latch(true);
    try {
      expect(await poll([dispatchServer])).toBeNull();
      expect((await actions.get(adult, org, held)).state).toBe("pending");
    } finally {
      await latch(false);
    }
    await actions.cancel(adult, org, held);
    const leaver = await member("org_admin");
    const orphan = (
      await actions.request(
        leaver.token,
        org,
        dispatchServer,
        { kind: "save" },
        randomUUID(),
      )
    ).action_id;
    await tx(identity, (c) =>
      c.query("update memberships set disabled_at=now() where id=$1", [
        leaver.membership,
      ]),
    );
    expect(await poll([dispatchServer])).toBeNull();
    expect(await actions.get(adult, org, orphan)).toMatchObject({
      state: "cancelled",
      failure_code: "cancelled",
    });
  });
  it("answers a power action truthfully and stops serving a released server", async () => {
    runs = [];
    const stop = await ask({ kind: "stop" });
    expect(await worker.tick()).toBe(true);
    expect(await actions.get(adult, org, stop)).toMatchObject({
      state: "failed",
      failure_code: "node_unavailable",
      evidence: { ok: false },
    });
    expect(sent).not.toContain("stop");
    expect(
      (await actions.unbindNode(adult, org, dispatchServer)).node_id,
    ).toBeNull();
    const after = await ask({ kind: "save" });
    expect((await actions.get(adult, org, after)).awaiting_node).toBe(true);
    expect(await worker.tick()).toBe(false);
    const audit = await auth.listAudit(adult, org);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["server.node_bound", "server.node_unbound"]),
    );
  });
});
