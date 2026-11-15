// Opt-in end-to-end check for the AI player (master plan G10, local part).
// Disposable PostgreSQL + the real API services (auth, provider gateway, AI players)
// + a disposable pinned Paper 26.3 world with the ViaVersion/ViaBackwards bridge
// (offline mode, loopback only) + the real worker controller + a local Ollama model.
// The owner instructs the AI player through the owner API; the check reads the
// world, the transcript, memory and spend, then measures how fast Stop takes effect.
//   CRAFTLAYER_ACCEPT_EULA=true pnpm test:ai-player-e2e
// Optional: AI_PLAYER_E2E_MODEL (default gemma4:latest), AI_PLAYER_E2E_OLLAMA
// (default http://[::1]:11434/). Nothing here touches the VPS or any existing world.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { pinLocalDocker } from "./lib/local-docker.mjs";

pinLocalDocker();
if (process.env.CRAFTLAYER_ACCEPT_EULA !== "true") {
  console.error(
    "Set CRAFTLAYER_ACCEPT_EULA=true to acknowledge https://www.minecraft.net/en-us/eula for this disposable local test server.",
  );
  process.exit(2);
}
const MODEL = process.env.AI_PLAYER_E2E_MODEL ?? "gemma4:latest";
const OLLAMA = process.env.AI_PLAYER_E2E_OLLAMA ?? "http://[::1]:11434/";
const OLLAMA_ADDRESS = new URL(OLLAMA).hostname.replace(/^\[|\]$/g, "");
const report = {};
const step = (key, value) => {
  report[key] = value;
  console.error(`step ${key}: ${JSON.stringify(value)}`);
};
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${r.stderr}`);
  return (r.stdout ?? "").trim();
};
async function freePort() {
  const socket = createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  return port;
}
async function until(label, ms, check) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > ms)
      throw new Error(`${label} not reached within ${ms} ms`);
    await delay(1000);
  }
}
async function download(url, sha256) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw new Error(`sha256 mismatch for ${url}`);
  return bytes;
}
function offlineUuid(name) {
  const hash = createHash("md5").update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const cleanups = [];
let exitCode = 1;
try {
  run("pnpm", ["build:server"], { stdio: ["ignore", "ignore", "inherit"] });
  const show = await fetch(new URL("api/show", OLLAMA), {
    method: "POST",
    body: JSON.stringify({ model: MODEL }),
  }).then((r) => r.json());
  step("model", {
    id: MODEL,
    capabilities: show.capabilities,
    format: show.details?.format,
  });

  // 1. Disposable database, migrated.
  const password = randomBytes(24).toString("hex"),
    dbName = `craftlayer-ai-e2e-${process.pid}`;
  run("docker", [
    "build",
    "-q",
    "-t",
    "craftlayer-postgres-test:local",
    "infra/postgres",
  ]);
  run("docker", [
    "run",
    "-d",
    "--name",
    dbName,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    "POSTGRES_USER=craftlayer_admin",
    "-e",
    "POSTGRES_DB=craftlayer",
    "-e",
    `MIGRATOR_PASSWORD=${password}`,
    "-e",
    `RUNTIME_PASSWORD=${password}`,
    "-e",
    `IDENTITY_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    "craftlayer-postgres-test:local",
  ]);
  cleanups.push(async () =>
    spawnSync("docker", ["rm", "-f", "-v", dbName], { stdio: "ignore" }),
  );
  await until(
    "database",
    60000,
    () =>
      spawnSync(
        "docker",
        [
          "exec",
          dbName,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "craftlayer_admin",
          "-d",
          "craftlayer",
        ],
        {
          stdio: "ignore",
        },
      ).status === 0,
  );
  const dbPort = run("docker", ["port", dbName, "5432/tcp"]).split(":").at(-1);
  const url = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${dbPort}/craftlayer`;
  run("pnpm", ["db:migrate"], {
    env: { ...process.env, MIGRATION_DATABASE_URL: url("craftlayer_migrator") },
    stdio: ["ignore", "ignore", "inherit"],
  });

  // 2. Identity fixture: one organization, project and adult owner.
  const { AuthService } = await import("../packages/auth/dist/index.js");
  const { ProviderFiles, ProviderGateway } = await import(
    "../packages/providers/dist/index.js"
  );
  const { AiPlayers } = await import("../packages/ai-players/dist/index.js");
  const { buildApp } = await import("../apps/api/dist/app.js");
  const { HostClient, PlayerController } = await import(
    "../apps/ai-player/dist/index.js"
  );
  const auth = new AuthService({
    databaseUrl: url("craftlayer_identity"),
    bootstrapToken: randomBytes(32).toString("hex"),
    recoveryToken: randomBytes(32).toString("hex"),
    csrfSecret: randomBytes(32).toString("hex"),
  });
  await auth.initialize();
  cleanups.push(() => auth.close());
  const org = randomUUID(),
    project = randomUUID(),
    user = randomUUID(),
    member = randomUUID(),
    token = randomBytes(32).toString("base64url");
  const identity = new pg.Pool({
    connectionString: url("craftlayer_identity"),
    max: 1,
  });
  const c = await identity.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.organization_id',$1,true)", [org]);
    await c.query(
      "insert into organizations(id,name) values($1,'AI player e2e')",
      [org],
    );
    await c.query(
      "insert into projects(id,organization_id,name) values($1,$2,'Family')",
      [project, org],
    );
    for (const { role_name } of (
      await c.query("select distinct role_name from built_in_role_permissions")
    ).rows) {
      const id = randomUUID();
      await c.query(
        "insert into roles(id,organization_id,name,built_in) values($1,$2,$3,true)",
        [id, org, role_name],
      );
      await c.query(
        "insert into role_permissions(organization_id,role_id,permission) select $1,$2,permission from built_in_role_permissions where role_name=$3",
        [org, id, role_name],
      );
    }
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,'owner','adult','unused')",
      [user],
    );
    await c.query(
      "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
      [member, org, user],
    );
    await c.query(
      "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name='org_admin'",
      [org, member],
    );
    await c.query(
      "insert into sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at) values($1,$2,$3,1,now()+interval '2 hours',now()+interval '3 hours')",
      [randomUUID(), user, createHash("sha256").update(token).digest("hex")],
    );
    await c.query("commit");
  } finally {
    c.release();
    await identity.end();
  }

  // 3. Provider gateway with the local Ollama endpoint approved by the operator file.
  const files = await mkdtemp(join(tmpdir(), "craftlayer-ai-e2e-"));
  cleanups.push(() => rm(files, { recursive: true, force: true }));
  const roomy = {
    calls: 2000,
    input_tokens: 50_000_000,
    output_tokens: 5_000_000,
    total_tokens: 55_000_000,
    micro_usd: "0",
    concurrent: 4,
  };
  await writeFile(
    join(files, "keys"),
    JSON.stringify({
      active: "one",
      keys: { one: randomBytes(32).toString("hex") },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(files, "policy"),
    JSON.stringify({
      version: 1,
      openrouter_enabled: false,
      openrouter_models: [],
      allow_paid: false,
      max_paid_micro_usd: "0",
      stopped: false,
      limits: roomy,
      ollama: [
        {
          id: "local",
          url: OLLAMA,
          addresses: [OLLAMA_ADDRESS],
          models: [MODEL],
          cloud_disabled: true,
          context_tokens: 32768,
          output_tokens: 1024,
        },
      ],
    }),
    { mode: 0o600 },
  );
  const gateway = new ProviderGateway({
    databaseUrl: url("craftlayer_runtime"),
    auth,
    files: new ProviderFiles({
      keys: join(files, "keys"),
      policy: join(files, "policy"),
    }),
  });
  cleanups.push(() => gateway.close());
  const connection = await gateway.createConnection(token, org, {
    kind: "ollama",
    endpoint_id: "local",
    label: "Local Ollama",
  });
  const models = await gateway.refreshModels(token, org, connection.id);
  step(
    "models",
    models.map((m) => ({ id: m.id, tools: m.capabilities.tools })),
  );
  for (const [kind, id] of [
    ["organization", org],
    ["user", user],
    ["project", project],
  ]) {
    const current = await gateway.getBudget(token, org, kind, id);
    await gateway.setBudget(token, org, kind, id, current.version, roomy);
  }

  // 4. The API with the AI player service, on a loopback port.
  const players = new AiPlayers({
    databaseUrl: url("craftlayer_runtime"),
    auth,
    gateway,
  });
  cleanups.push(() => players.close());
  const app = await buildApp({
    auth,
    aiPlayers: players,
    readiness: async () => true,
    publicUrl: "http://127.0.0.1:3000",
  });
  cleanups.push(() => app.close());
  const apiPort = await freePort();
  await app.listen({ host: "127.0.0.1", port: apiPort });

  // 5. The disposable world, same pins as the family server plus the bridge.
  const lock = JSON.parse(
    await readFile(
      new URL("../infra/minecraft/ai-player-compat.lock.json", import.meta.url),
      "utf8",
    ),
  );
  const gamePort = await freePort(),
    bedrockPort = await freePort();
  const input = join(files, "world.json");
  await writeFile(
    input,
    JSON.stringify({
      edition: "crossplay",
      port: gamePort,
      bedrock_port: bedrockPort,
    }),
  );
  const directory = JSON.parse(
    run("node", [
      "--import",
      "tsx",
      "scripts/minecraft/playtest.ts",
      "prepare",
      input,
    ]),
  ).directory;
  const data = join(directory, "data");
  const botName = "PipTheHelper";
  const properties = (await readFile(join(data, "server.properties"), "utf8"))
    .replace("online-mode=true", "online-mode=false")
    .replace("enforce-secure-profile=true", "enforce-secure-profile=false")
    .replace("difficulty=normal", "difficulty=peaceful");
  await writeFile(
    join(data, "server.properties"),
    `${properties}level-seed=${lock.test_world.seed}\n`,
  );
  await writeFile(join(data, "eula.txt"), "eula=true\n");
  await writeFile(
    join(data, "whitelist.json"),
    JSON.stringify([{ uuid: offlineUuid(botName), name: botName }]),
  );
  for (const plugin of lock.server_plugins)
    await writeFile(
      join(data, "plugins", plugin.filename),
      await download(plugin.url, plugin.sha256),
    );
  const composeArgs = [
    "compose",
    "-p",
    `craftlayer-aie2e-${process.pid}`,
    "-f",
    join(directory, "compose.json"),
  ];
  cleanups.push(async () => {
    spawnSync(
      "docker",
      [...composeArgs, "down", "--remove-orphans", "-t", "30"],
      { stdio: "ignore" },
    );
    await rm(directory, { recursive: true, force: true });
  });
  run("docker", [...composeArgs, "up", "-d"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  await until("world boot", 300000, async () =>
    /\]: Done \(/.test(
      await readFile(join(data, "logs", "latest.log"), "utf8").catch(() => ""),
    ),
  );
  step("world", { port: gamePort, version: lock.server_minecraft_java });

  // 6. Owner creates the worker host and the AI player.
  const host = await players.createHost(token, org, "E2E host");
  const created = await players.create(token, org, {
    name: "Pip",
    project_id: project,
    persona: "A cheerful, practical helper who loves gathering and building.",
    rules: "Keep chat short. Stay near spawn unless asked to go somewhere.",
    connection_id: connection.id,
    model_id: MODEL,
    host_id: host.id,
    game_host: "127.0.0.1",
    game_port: gamePort,
    game_version: lock.bot.protocol_version,
    mc_username: botName,
    mc_auth: "offline",
    instructors: [],
    daily_limit_micro: "1000000",
    total_limit_micro: "10000000",
    calls_per_hour: 240,
  });
  await players.setTasks(token, org, created.id, []);

  // 7. The real worker controller, polling like apps/ai-player/dist/main.js.
  const api = new HostClient(`http://127.0.0.1:${apiPort}`, host.token);
  const state = await mkdtemp(join(tmpdir(), "craftlayer-ai-state-"));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  let controller = null,
    polling = true;
  const poller = (async () => {
    while (polling) {
      const { players: list } = await api
        .assignments()
        .catch(() => ({ players: [] }));
      const mine = list.find((p) => p.id === created.id);
      if (mine?.run && !controller) {
        controller = new PlayerController(mine, {
          api,
          stateDir: state,
          log: (l) => console.error(`worker ${l}`),
        });
        await controller.start();
      } else if (controller && mine && !controller.update(mine)) {
        await controller.stop("Stopped from CraftLayer.");
        controller = null;
      }
      await delay(1000);
    }
  })();
  cleanups.push(async () => {
    polling = false;
    await controller?.stop("Check finished.");
    await poller;
  });
  await players.start(token, org, created.id);
  const online = await until("player online", 90000, async () => {
    const view = await players.get(token, org, created.id);
    return view.status?.state === "online" ? view : null;
  });
  step("online", {
    position: online.status.detail.position,
    inventory: online.status.detail.inventory,
  });

  // 8. Scenarios, each a plain-language instruction through the owner API.
  const transcriptSince = async (after) =>
    (await players.transcript(token, org, created.id, after)).messages;
  async function scenario(name, instruction, done, ms = 420000) {
    const before = (await transcriptSince(0)).at(-1)?.seq ?? 0;
    const started = Date.now();
    await players.instruct(token, org, created.id, { body: instruction });
    const outcome = await until(name, ms, async () => {
      const view = await players.get(token, org, created.id);
      const messages = await transcriptSince(before);
      const finished = messages.some(
        (m) => m.direction === "decision" && m.body.startsWith("finish("),
      );
      return finished || (await done(view, messages))
        ? { view, messages }
        : null;
    }).catch((error) => ({ error: String(error.message ?? error) }));
    const messages = outcome.messages ?? (await transcriptSince(before));
    const view = outcome.view ?? (await players.get(token, org, created.id));
    const result = {
      ok: !outcome.error && (await done(view, messages)),
      seconds: Math.round((Date.now() - started) / 1000),
      decisions: messages
        .filter((m) => m.direction === "decision")
        .map((m) => m.body.slice(0, 160)),
      replies: messages
        .filter((m) => m.direction === "reply")
        .map((m) => m.body.slice(0, 160)),
      inventory: view.status?.detail.inventory ?? [],
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    step(`scenario_${name}`, result);
    return result;
  }
  const logs = (view) =>
    (view.status?.detail.inventory ?? []).reduce((n, line) => {
      const m = /^(\w+_log) x(\d+)$/.exec(line);
      return n + (m ? Number(m[2]) : 0);
    }, 0);
  const results = [];
  results.push(
    await scenario(
      "look",
      "Look around and tell me in one sentence what you can see.",
      async (_v, m) => m.some((x) => x.body.startsWith("look_around(")),
    ),
  );
  results.push(
    await scenario(
      "collect_logs",
      "Please collect 3 logs from the nearest tree.",
      async (v) => logs(v) >= 3,
    ),
  );
  results.push(
    await scenario(
      "remember",
      "Remember that the place where you are standing right now is called home base.",
      async () =>
        (await players.memories(token, org, created.id)).memories.some((x) =>
          /home/i.test(x.content),
        ),
    ),
  );
  results.push(
    await scenario(
      "craft_planks",
      "Craft some planks from your logs.",
      async (v) =>
        v.status?.detail.inventory.some((i) => /_planks x/.test(i)) ?? false,
    ),
  );

  // 9. Stop latency: from the owner's Stop to the body leaving the game.
  const stopAt = Date.now();
  await players.stop(token, org, created.id);
  await until("stopped", 30000, async () => controller === null);
  step("stop_seconds", Math.round((Date.now() - stopAt) / 100) / 10);
  const final = await players.get(token, org, created.id);
  step("spend", final.spend);
  step(
    "memories",
    (await players.memories(token, org, created.id)).memories.map(
      (m) => `${m.kind}: ${m.content}`,
    ),
  );
  const passed = results.filter((r) => r.ok).length;
  report.result =
    passed === results.length ? "PASS" : `PARTIAL ${passed}/${results.length}`;
  exitCode = passed === results.length ? 0 : 1;
} catch (error) {
  report.result = "FAIL";
  report.error = String(error?.stack ?? error);
} finally {
  for (const cleanup of cleanups.reverse())
    await Promise.resolve(cleanup()).catch(() => {});
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode);
}
