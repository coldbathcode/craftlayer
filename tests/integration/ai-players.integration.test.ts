import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import {
  type AiPlayerGateway,
  AiPlayers,
} from "../../packages/ai-players/src/index.js";
import { AuthService } from "../../packages/auth/src/index.js";
import type {
  GenerateRequest,
  GenerateResult,
  ModelDescriptor,
} from "../../packages/contracts/src/index.js";
import {
  FakeProvider,
  fixtureModel,
} from "../../packages/providers/src/fixtures.js";
import {
  ProviderError,
  ProviderFiles,
  ProviderGateway,
} from "../../packages/providers/src/index.js";

const identityUrl = process.env.TEST_AI_PLAYERS_IDENTITY_DATABASE_URL;
const runtimeUrl = process.env.TEST_AI_PLAYERS_DATABASE_URL;
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
  connection = randomUUID();
let now = Date.parse("2026-11-15T12:00:00Z");

/** Priced like a mid-range hosted model: 3 µUSD per input token, 15 per output token. */
const paidModel = (): ModelDescriptor => {
  const model = fixtureModel(now, {
    id: "fixture/paid",
    provider: "openrouter",
    classification: "hosted",
    zero_cost_enforced: false,
  });
  model.pricing.dimensions.input = { amount: "0.000003", unit: "token" };
  model.pricing.dimensions.output = { amount: "0.000015", unit: "token" };
  model.pricing.source_hash = createHash("sha256")
    .update(JSON.stringify(model.pricing.dimensions))
    .digest("hex");
  return model;
};
const answer = (input = 100, output = 10): GenerateResult => ({
  latency_ms: 1,
  text: "On my way.",
  tool_calls: [{ name: "go_to", arguments: { x: 1, y: 64, z: 2 } }],
  finish_reason: "tool_calls",
  usage: { quality: "observed", input_tokens: input, output_tokens: output },
  provider_request_id: null,
});

class FakeGateway implements AiPlayerGateway {
  calls: GenerateRequest[] = [];
  next: Array<GenerateResult | Error> = [];
  model: ModelDescriptor | null = paidModel();
  async generateStanding(_s: unknown, _c: unknown, request: GenerateRequest) {
    this.calls.push(request);
    const outcome = this.next.shift() ?? answer();
    if (outcome instanceof Error) throw outcome;
    return { result: outcome, attempts: 1 };
  }
  async refreshStanding() {
    if (this.model)
      this.model = {
        ...this.model,
        pricing: {
          ...this.model.pricing,
          observed_at: now,
          expires_at: now + 300000,
        },
      };
    return this.model ? [this.model] : [];
  }
  async chosenModel() {
    return this.model;
  }
}

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
async function member(role: string, type = "adult") {
  const user = randomUUID(),
    membership = randomUUID(),
    session = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await tx(identity, async (c) => {
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,$3,'synthetic-unused-hash')",
      [user, `ap-${user}`, type],
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
  });
  return { token, user, membership };
}
const cookie = (token: string) => ({
  cookie: `craftlayer_session=${token}`,
  origin: "http://127.0.0.1:3000",
  "x-csrf-token": auth.csrfToken(token),
  "x-craftlayer-organization": org,
});
const input = (name: string, hostId: string | null) => ({
  name,
  project_id: project,
  persona: "A cheerful helper who loves building.",
  rules: "Never break the farm.",
  connection_id: connection,
  model_id: "fixture/paid",
  host_id: hostId,
  game_host: "127.0.0.1",
  game_port: 25565,
  mc_username: "PipTheHelper",
  mc_auth: "offline" as const,
  instructors: [{ kind: "name" as const, value: "Owner", label: "Me" }],
  daily_limit_micro: "10000",
  total_limit_micro: "15000",
  calls_per_hour: 5,
});
const think = (patch: Record<string, unknown> = {}) => ({
  request_id: randomUUID(),
  messages: [
    { role: "system" as const, content: "You are Pip." },
    { role: "user" as const, content: "Come here" },
  ],
  max_input_tokens: 1000,
  max_output_tokens: 200,
  tools: [
    {
      name: "go_to",
      description: "Walk somewhere",
      parameters: { type: "object", properties: { x: { type: "number" } } },
    },
  ],
  ...patch,
});

let admin: Awaited<ReturnType<typeof member>>,
  viewer: Awaited<ReturnType<typeof member>>,
  child: Awaited<ReturnType<typeof member>>;
const gateway = new FakeGateway();
const players = new AiPlayers({
  databaseUrl: runtimeUrl,
  auth,
  gateway,
  clock: () => now,
});
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await auth.initialize();
  await tx(identity, async (c) => {
    await c.query(
      "insert into organizations(id,name) values($1,'AI player fixture')",
      [org],
    );
    await c.query(
      "insert into projects(id,organization_id,name) values($1,$2,'Family')",
      [project, org],
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
  admin = await member("org_admin");
  viewer = await member("viewer");
  child = await member("child", "child");
  await tx(runtime, (c) =>
    c.query(
      "insert into provider_connections(id,organization_id,kind,endpoint_id,label) values($1,$2,'ollama','fixture-local','Fixture')",
      [connection, org],
    ),
  );
  app = await buildApp({
    auth,
    aiPlayers: players,
    readiness: async () => true,
    publicUrl: "http://127.0.0.1:3000",
  });
});
afterAll(async () => {
  await app?.close();
  await players.close();
  await identity.end();
  await runtime.end();
});

describe("AI players (master plan G3)", () => {
  it("lets only adults with ai_player:manage create and see AI players", async () => {
    for (const who of [viewer, child])
      await expect(
        players.create(who.token, org, input("Nope", null)),
      ).rejects.toMatchObject({
        status: 403,
      });
    const created = await players.create(admin.token, org, input("Pip", null));
    expect(created).toMatchObject({
      name: "Pip",
      desired_state: "stopped",
      stop_latched: false,
      owner_user_id: admin.user,
      spend: { today_micro: "0", total_micro: "0", exhausted: false },
    });
    await expect(
      players.create(admin.token, org, input("Pip", null)),
    ).rejects.toMatchObject({
      status: 409,
    });
    await expect(players.list(viewer.token, org)).rejects.toMatchObject({
      status: 403,
    });
    const http = await app.inject({
      url: "/api/v1/ai-players",
      headers: cookie(admin.token),
    });
    expect(http.statusCode).toBe(200);
    expect(http.json().players.map((p: { name: string }) => p.name)).toEqual([
      "Pip",
    ]);
    // A model without tool support cannot drive a player.
    gateway.model = {
      ...paidModel(),
      capabilities: { ...paidModel().capabilities, tools: false },
    };
    await expect(
      players.create(admin.token, org, input("NoTools", null)),
    ).rejects.toMatchObject({ code: "AI_PLAYER_MODEL_NO_TOOLS" });
    gateway.model = paidModel();
  });

  it("issues a one-time host token, runs only its own players and stops on revoke", async () => {
    const created = await players.createHost(admin.token, org, "Owner's Mac");
    expect(created.token).toMatch(/^clah_/);
    const stored = await tx(runtime, (c) =>
      c.query("select token_hash from ai_player_hosts where id=$1", [
        created.id,
      ]),
    );
    expect(stored.rows[0].token_hash).not.toContain(created.token);
    expect(
      JSON.stringify(await players.listHosts(admin.token, org)),
    ).not.toContain(created.token);
    const host = await players.host(created.token);
    await expect(
      players.host(`${created.token.slice(0, -2)}xx`),
    ).rejects.toMatchObject({
      status: 401,
    });
    const pip = (await players.list(admin.token, org)).players[0];
    if (!pip) throw new Error("missing player");
    // Not assigned yet: the host cannot see or act for it.
    expect((await players.assignments(host)).players).toEqual([]);
    await expect(players.think(host, pip.id, think())).rejects.toMatchObject({
      status: 404,
    });
    await expect(players.start(admin.token, org, pip.id)).rejects.toMatchObject(
      { status: 409 },
    );
    const assigned = await players.update(admin.token, org, pip.id, {
      host_id: created.id,
      expected_version: pip.version,
    });
    // Changing only the host keeps everything else (no defaults on update).
    expect(assigned).toMatchObject({
      calls_per_hour: 5,
      persona: "A cheerful helper who loves building.",
      instructors: [{ kind: "name", value: "Owner", label: "Me" }],
    });
    const started = await players.start(admin.token, org, assigned.id);
    expect(started.desired_state).toBe("running");
    const work = await players.assignments(host);
    expect(work.players).toHaveLength(1);
    expect(work.players[0]).toMatchObject({
      name: "Pip",
      run: true,
      mc_username: "PipTheHelper",
    });
    expect(JSON.stringify(work)).not.toMatch(/connection_id|owner_membership/);
    // HTTP with a bearer host token.
    const http = await app.inject({
      url: "/api/v1/ai-player-host/assignments",
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(http.statusCode).toBe(200);
    const anonymous = await app.inject({
      url: "/api/v1/ai-player-host/assignments",
    });
    // A host POST works with only its bearer (no browser origin or CSRF)...
    const reported = await app.inject({
      method: "POST",
      url: `/api/v1/ai-player-host/players/${assigned.id}/status`,
      headers: { authorization: `Bearer ${created.token}` },
      payload: { state: "connecting", detail: {} },
    });
    expect(reported.statusCode).toBe(200);
    // ...and a browser session cannot use host routes at all.
    const viaCookie = await app.inject({
      method: "POST",
      url: `/api/v1/ai-player-host/players/${assigned.id}/status`,
      headers: cookie(admin.token),
      payload: { state: "connecting", detail: {} },
    });
    expect(viaCookie.statusCode).toBe(401);
    expect(anonymous.statusCode).toBe(401);
  });

  it("reserves the worst case, settles, and stops at the daily and total limits", async () => {
    const pip = (await players.list(admin.token, org)).players[0];
    const hostRow = await tx(runtime, (c) =>
      c.query<{ id: string }>(
        "select id from ai_player_hosts where revoked_at is null limit 1",
      ),
    );
    if (!pip || !hostRow.rows[0]) throw new Error("missing fixtures");
    const host = { org, hostId: hostRow.rows[0].id };
    // Worst case: 1000 in × 3 + 200 out × 15 = 6000 µUSD.
    const first = await players.think(host, pip.id, think());
    expect(first.tool_calls).toEqual([
      { name: "go_to", arguments: { x: 1, y: 64, z: 2 } },
    ]);
    expect(first.charged_micro).toBe("450"); // observed 100 in × 3 + 10 out × 15
    expect(first.spend).toMatchObject({
      today_reserved_micro: "0",
      calls_today: 1,
    });
    expect(gateway.calls[0]?.timeout_ms).toBe(45000);
    // Simulate spend the ledger charged, then the next worst case no longer fits today.
    await tx(runtime, (c) =>
      c.query(
        "update ai_player_spend_days set used_micro=5000 where player_id=$1",
        [pip.id],
      ),
    );
    await expect(players.think(host, pip.id, think())).rejects.toMatchObject({
      code: "AI_PLAYER_OUT_OF_BUDGET",
    });
    // A smaller call still fits the day (5000 + 100×3 + 50×15 = 6050 ≤ 10000).
    await players.think(
      host,
      pip.id,
      think({ max_input_tokens: 256, max_output_tokens: 50 }),
    );
    // Tomorrow the day resets, but the total (15000) is what stops it.
    now += 24 * 3600_000;
    await tx(runtime, (c) =>
      c.query(
        "update ai_player_spend_days set used_micro=12500 where player_id=$1",
        [pip.id],
      ),
    );
    const view = await players.get(admin.token, org, pip.id);
    expect(view.spend.warning).toBe(true);
    await expect(players.think(host, pip.id, think())).rejects.toMatchObject({
      code: "AI_PLAYER_OUT_OF_BUDGET",
    });
    // A failed call that never dispatched releases its reservation.
    await tx(runtime, (c) =>
      c.query(
        "update ai_player_spend_days set used_micro=0 where player_id=$1",
        [pip.id],
      ),
    );
    gateway.next.push(new ProviderError("unavailable", false));
    await expect(players.think(host, pip.id, think())).rejects.toMatchObject({
      code: "AI_PLAYER_MODEL_UNAVAILABLE",
    });
    const calls = await tx(runtime, (c) =>
      c.query<{ state: string }>(
        "select state from ai_player_calls where player_id=$1 order by created_at desc limit 1",
        [pip.id],
      ),
    );
    expect(calls.rows[0]?.state).toBe("released");
    const after = await players.get(admin.token, org, pip.id);
    expect(after.spend.today_reserved_micro).toBe("0");
  });

  it("enforces calls per hour and the stop latch, and hands instructions over once", async () => {
    const pip = (await players.list(admin.token, org)).players[0];
    const hostRow = await tx(runtime, (c) =>
      c.query<{ id: string }>(
        "select id from ai_player_hosts where revoked_at is null limit 1",
      ),
    );
    if (!pip || !hostRow.rows[0]) throw new Error("missing fixtures");
    const host = { org, hostId: hostRow.rows[0].id };
    now += 2 * 3600_000;
    for (let i = 0; i < 5; i++)
      await players.think(
        host,
        pip.id,
        think({ max_input_tokens: 256, max_output_tokens: 10 }),
      );
    await expect(players.think(host, pip.id, think())).rejects.toMatchObject({
      status: 429,
      code: "AI_PLAYER_RATE_LIMITED",
    });
    now += 3600_000;
    await players.instruct(admin.token, org, pip.id, {
      body: "Build a small hut",
    });
    const http = await app.inject({
      method: "POST",
      url: `/api/v1/ai-players/${pip.id}/instructions`,
      headers: cookie(admin.token),
      payload: { body: "Then come back" },
    });
    expect(http.statusCode).toBe(202);
    const handed = await players.pending(host, pip.id);
    expect(handed.instructions.map((i) => i.body)).toEqual([
      "Build a small hut",
      "Then come back",
    ]);
    expect((await players.pending(host, pip.id)).instructions).toEqual([]);
    await players.post(host, pip.id, {
      messages: [
        { direction: "reply", channel: "game", author: "Pip", body: "On it!" },
      ],
    });
    await players.ownerChat(host, pip.id, "Owner", "Stop digging there");
    const transcript = await players.transcript(admin.token, org, pip.id);
    expect(transcript.messages.map((m) => m.direction)).toEqual(
      expect.arrayContaining(["system", "instruction", "reply"]),
    );
    expect(
      transcript.messages.find((m) => m.body === "Stop digging there"),
    ).toMatchObject({
      channel: "game",
      delivered: true,
    });
    // Stop latches: no model calls, no instructions, and start is refused until cleared.
    const stopped = await players.stop(admin.token, org, pip.id);
    expect(stopped).toMatchObject({
      desired_state: "stopped",
      stop_latched: true,
    });
    await players.instruct(admin.token, org, pip.id, {
      body: "Ignored while stopped",
    });
    expect((await players.pending(host, pip.id)).instructions).toEqual([]);
    await expect(players.think(host, pip.id, think())).rejects.toMatchObject({
      code: "AI_PLAYER_STOPPED",
    });
    expect((await players.assignments(host)).players[0]?.run).toBe(false);
    await expect(players.start(admin.token, org, pip.id)).rejects.toMatchObject(
      { status: 409 },
    );
    const cleared = await players.clearStop(admin.token, org, pip.id);
    expect(cleared).toMatchObject({
      stop_latched: false,
      desired_state: "stopped",
    });
  });

  it("keeps memory bounded, editable by the owner, and reports status", async () => {
    const pip = (await players.list(admin.token, org)).players[0];
    const hostRow = await tx(runtime, (c) =>
      c.query<{ id: string }>(
        "select id from ai_player_hosts where revoked_at is null limit 1",
      ),
    );
    if (!pip || !hostRow.rows[0]) throw new Error("missing fixtures");
    const host = { org, hostId: hostRow.rows[0].id };
    const note = await players.addMemory(admin.token, org, pip.id, {
      kind: "place",
      content: "The wood chest is by the farm.",
      tags: ["chest", "wood"],
      position: { x: 10, y: 64, z: -3 },
    });
    await players.remember(host, pip.id, {
      kind: "lesson",
      content: "Creepers near the river at night.",
      tags: ["danger"],
      position: null,
    });
    const memories = await players.memoriesFor(host, pip.id);
    expect(memories.memories.map((m) => m.source).sort()).toEqual([
      "owner",
      "player",
    ]);
    await players.forgetMemory(admin.token, org, pip.id, note.id);
    expect(
      (await players.memories(admin.token, org, pip.id)).memories,
    ).toHaveLength(1);
    await players.report(host, pip.id, {
      state: "online",
      detail: {
        position: { x: 1, y: 64, z: 2 },
        health: 20,
        food: 18,
        activity: "Following Owner",
      },
    });
    const view = await players.get(admin.token, org, pip.id);
    expect(view.status).toMatchObject({ state: "online", stale: false });
    now += 60_000;
    expect((await players.get(admin.token, org, pip.id)).status?.stale).toBe(
      true,
    );
    await players.setTasks(admin.token, org, pip.id, [
      {
        title: "Stock wood",
        goal: "Keep 64 logs in the wood chest.",
        priority: 50,
        condition: "always",
        enabled: true,
      },
    ]);
    expect((await players.assignments(host)).players[0]?.tasks[0]?.title).toBe(
      "Stock wood",
    );
  });

  it("lets an AI agent with ai_player:instruct list, instruct and stop, but never start or reconfigure (G8)", async () => {
    const pip = (await players.list(admin.token, org)).players[0];
    if (!pip) throw new Error("missing player");
    const reader = await auth.createAgentToken(admin.token, org, {
      name: "Reader only",
      permissions: ["organization:read", "project:read"],
      projectId: project,
    });
    const agent = await auth.createAgentToken(admin.token, org, {
      name: "Claude for AI players",
      permissions: ["organization:read", "ai_player:instruct"],
      projectId: project,
    });
    await expect(players.agentList(reader.token, org)).rejects.toMatchObject({
      status: 403,
    });
    const listed = await players.agentList(agent.token, org);
    expect(listed.players.map((p) => p.name)).toContain("Pip");
    // The owner routes stay closed to agents.
    await expect(players.list(agent.token, org)).rejects.toMatchObject({
      status: 403,
    });
    await expect(players.start(agent.token, org, pip.id)).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      players.update(agent.token, org, pip.id, {
        daily_limit_micro: "999999999",
        expected_version: pip.version,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      players.instruct(reader.token, org, pip.id, { body: "dig" }, "mcp"),
    ).rejects.toMatchObject({
      status: 403,
    });
    // Over HTTP with the agent's bearer: no cookie, origin or CSRF involved.
    const sent = await app.inject({
      method: "POST",
      url: `/api/v1/agent/ai-players/${pip.id}/instructions`,
      headers: {
        authorization: `Bearer ${agent.token}`,
        "x-craftlayer-organization": org,
      },
      payload: { body: "Collect two logs please" },
    });
    expect(sent.statusCode).toBe(202);
    const transcript = await players.agentTranscript(agent.token, org, pip.id);
    expect(transcript.messages.at(-1)).toMatchObject({
      direction: "instruction",
      channel: "mcp",
      body: "Collect two logs please",
    });
    expect(transcript.messages.at(-1)?.author).toContain("(via AI agent)");
    const stopped = await players.agentStop(agent.token, org, pip.id);
    expect(stopped).toMatchObject({
      desired_state: "stopped",
      stop_latched: true,
    });
    await expect(
      players.clearStop(agent.token, org, pip.id),
    ).rejects.toMatchObject({ status: 403 });
    await players.clearStop(admin.token, org, pip.id);
  });
  it("revoking a host stops and unassigns its players", async () => {
    const hosts = await players.listHosts(admin.token, org);
    const active = hosts.hosts.find((h) => !h.revoked);
    if (!active) throw new Error("missing host");
    await players.revokeHost(admin.token, org, active.id);
    const pip = (await players.list(admin.token, org)).players[0];
    expect(pip).toMatchObject({ host_id: null, desired_state: "stopped" });
  });
});

describe("AI player model calls through the real provider gateway", () => {
  it("settles the ledger's actual charge and records the owner as the spender", async () => {
    // Standing authority is timed by the identity service's real clock; align with it.
    now = Date.now();
    const directory = await mkdtemp(
      `${tmpdir()}/craftlayer-ai-player-gateway-`,
    );
    try {
      await writeFile(
        `${directory}/keys`,
        JSON.stringify({
          active: "one",
          keys: { one: randomBytes(32).toString("hex") },
        }),
        { mode: 0o600 },
      );
      const big = {
        calls: 1000,
        input_tokens: 10_000_000,
        output_tokens: 1_000_000,
        total_tokens: 11_000_000,
        micro_usd: "100000000",
        concurrent: 4,
      };
      await writeFile(
        `${directory}/policy`,
        JSON.stringify({
          version: 1,
          openrouter_enabled: true,
          openrouter_models: ["fixture/paid"],
          allow_paid: true,
          max_paid_micro_usd: "100000000",
          stopped: false,
          ollama: [],
          limits: big,
        }),
        { mode: 0o600 },
      );
      const fake = new FakeProvider(
        [paidModel()],
        [answer(400, 20), answer(400, 20)],
      );
      const providers = new ProviderGateway({
        databaseUrl: runtimeUrl,
        auth,
        files: new ProviderFiles({
          keys: `${directory}/keys`,
          policy: `${directory}/policy`,
        }),
        clock: () => now,
        providerFactory: () => fake,
      });
      const real = new AiPlayers({
        databaseUrl: runtimeUrl,
        auth,
        gateway: providers,
        clock: () => now,
      });
      try {
        const routerConnection = await providers.createConnection(
          admin.token,
          org,
          {
            kind: "openrouter",
            endpoint_id: "openrouter",
            label: "OpenRouter",
            secret: "synthetic-openrouter-key-canary",
          },
        );
        // The adult allows paid hosted calls for the organization and sets hourly budgets.
        const policy = {
          allowed_models: null,
          free_only: false,
          allow_paid_fallback: false,
          max_paid_micro_usd: "1000000",
          allow_hosted: true,
          max_input_tokens: 16384,
          max_output_tokens: 2048,
          max_attempts: 1,
        };
        await providers.setPolicy(
          admin.token,
          org,
          "organization",
          org,
          0,
          policy,
        );
        for (const [kind, id] of [
          ["organization", org],
          ["user", admin.user],
          ["project", project],
        ] as const) {
          const current = await providers.getBudget(admin.token, org, kind, id);
          await providers.setBudget(
            admin.token,
            org,
            kind,
            id,
            current.version,
            big,
          );
        }
        const host = await real.createHost(admin.token, org, "Gateway host");
        const created = await real.create(admin.token, org, {
          ...input("Gateway", host.id),
          connection_id: routerConnection.id,
          mc_username: "GatewayBot",
          daily_limit_micro: "100000",
          total_limit_micro: "100000",
        });
        await real.start(admin.token, org, created.id);
        const identityOfHost = await real.host(host.token);
        const thought = await real.think(identityOfHost, created.id, think());
        // 400 in × 3 + 20 out × 15 = 1500 µUSD from observed usage; the ledger itself books the reserved 6000 for hourly limits.
        expect(thought.charged_micro).toBe("1500");
        expect(thought.spend).toMatchObject({
          today_micro: "1500",
          today_reserved_micro: "0",
        });
        const call = await tx(runtime, (c) =>
          c.query<{ id: string }>(
            "select id from ai_player_calls where player_id=$1",
            [created.id],
          ),
        );
        const links = await tx(runtime, (c) =>
          c.query<{ scope_kind: string; scope_id: string }>(
            "select l.scope_kind,l.scope_id from reservation_budget_links l join usage_reservations r on r.organization_id=l.organization_id and r.id=l.reservation_id join provider_requests q on q.organization_id=r.organization_id and q.id=r.request_pk where q.request_id=$1",
            [call.rows[0]?.id],
          ),
        );
        expect(links.rows).toContainEqual({
          scope_kind: "user",
          scope_id: admin.user,
        });
        expect(fake.calls).toHaveLength(1);
      } finally {
        await real.close();
        await providers.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
