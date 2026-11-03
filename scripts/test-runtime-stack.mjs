import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { pinLocalDocker } from "./lib/local-docker.mjs";

pinLocalDocker();

const root = resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(`${tmpdir()}/craftlayer-runtime-stack-`),
  project = `craftlayer-runtime-stack-${process.pid}`;
const socket = createServer();
await new Promise((accept) => socket.listen(0, "127.0.0.1", accept));
const port = socket.address().port;
await new Promise((accept) => socket.close(accept));
const origin = `http://127.0.0.1:${port}`,
  env = {
    ...process.env,
    CRAFTLAYER_HTTP_PORT: String(port),
    CRAFTLAYER_PUBLIC_URL: origin,
  },
  base = [
    "compose",
    "--project-directory",
    root,
    "-p",
    project,
    "--env-file",
    `${directory}/.env`,
    "-f",
    `${root}/docker-compose.yml`,
  ];
let phase = "setup";
let configured = [],
  cookie = "",
  csrf = "",
  organization = "";
const visible = [];
function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const capture = options.capture === true;
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: capture ? ["pipe", "pipe", "pipe"] : "inherit",
      ...options,
    });
    let output = "";
    if (capture) {
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      child.stdin.end(options.input ?? "");
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? accept(output)
        : reject(
            new Error(
              `${command} failed during ${phase} with ${code}; captured values omitted`,
            ),
          ),
    );
  });
}
async function api(path, method = "GET", body, secret = false) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "x-craftlayer-organization": organization,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(
    response.status,
    200,
    `API denied ${method} ${path}; body omitted`,
  );
  const text = await response.text();
  if (!secret) visible.push(text);
  return { response, data: JSON.parse(text) };
}
async function cli(args, input = "") {
  return JSON.parse(
    await run(
      process.execPath,
      ["--import", "tsx", "apps/cli/src/main.ts", ...args],
      {
        capture: true,
        input,
        env: { ...env, CRAFTLAYER_CLI_SESSION_FILE: `${directory}/session` },
      },
    ),
  );
}
async function waitFor(read, check, message, iterations = 150) {
  for (let i = 0; i < iterations; i++) {
    const value = await read();
    if (check(value)) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${message}; fixture values omitted`);
}
async function simpleMission(
  group,
  world,
  name,
  action = { kind: "fixture.echo", value: "verified" },
) {
  const template = (
    await api("/mission-templates", "POST", {
      environment_id: world,
      name,
      adapter: "simulation",
      graph: {
        schema_version: 1,
        nodes: [{ key: "fault", timeout_ms: 10000, action }],
      },
    })
  ).data;
  const mission = (
    await api("/missions", "POST", {
      name,
      group_id: group,
      template_id: template.id,
    })
  ).data;
  await api(`/missions/${mission.id}/execute`, "POST", { expected_version: 1 });
  return mission.id;
}
async function receiptCount(mission) {
  assert.match(mission, /^[a-f0-9-]{36}$/);
  const result = await run(
    "docker",
    [
      ...configured,
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      'PGPASSWORD="$RUNTIME_PASSWORD" exec psql -h 127.0.0.1 -U craftlayer_runtime -d craftlayer -At -v ON_ERROR_STOP=1 -v org="$1" -v mission="$2"',
      "fixture-read",
      organization,
      mission,
    ],
    {
      capture: true,
      input:
        "BEGIN;\nSELECT set_config('app.organization_id',:'org',true);\nSELECT count(*) FROM runtime_action_receipts WHERE mission_id=:'mission'::uuid;\nROLLBACK;\n",
    },
  );
  return Number(result.split("\n").find((line) => /^\d+$/.test(line)) ?? "0");
}
try {
  await run(process.execPath, [`${root}/scripts/setup-local.mjs`], {
    cwd: directory,
  });
  Object.assign(env, parseEnv(await readFile(`${directory}/.env`, "utf8")), {
    CRAFTLAYER_HTTP_PORT: String(port),
    CRAFTLAYER_PUBLIC_URL: origin,
  });
  await run(process.execPath, [`${root}/scripts/setup-worker.mjs`], {
    cwd: directory,
  });
  Object.assign(
    env,
    parseEnv(
      await readFile(`${directory}/.worker-secrets/compose.env`, "utf8"),
    ),
  );
  configured = [
    ...base,
    "--env-file",
    `${directory}/.worker-secrets/compose.env`,
    "-f",
    `${root}/infra/compose/worker.yml`,
    "-f",
    `${directory}/mount.yml`,
  ];
  await writeFile(
    `${directory}/mount.yml`,
    `services:\n  worker:\n    volumes:\n      - ${JSON.stringify(`${directory}/.worker-secrets:/run/secrets/worker:ro`)}\n`,
  );
  await run("docker", [...base, "up", "-d", "--build", "--wait"]);
  const password = "Disposable runtime fixture 42!",
    bootstrap = await api("/auth/bootstrap", "POST", {
      token: env.CRAFTLAYER_BOOTSTRAP_TOKEN,
      login: "runtime-stack-owner",
      password,
    });
  cookie = bootstrap.response.headers.get("set-cookie").split(";")[0];
  csrf = bootstrap.data.csrf_token;
  organization = (await api("/auth/me")).data.organizations[0].id;
  const projectRow = (
      await api("/projects", "POST", { name: "Runtime stack project" })
    ).data,
    world = (
      await api("/environments", "POST", {
        projectId: projectRow.id,
        name: "Simulation fixture",
        type: "simulation",
      })
    ).data;
  const agents = [];
  for (const name of ["One", "Two"])
    agents.push(
      (
        await api("/agents", "POST", {
          environment_id: world.id,
          name,
          adapter: "simulation",
        })
      ).data.id,
    );
  const group = (
      await api("/groups", "POST", {
        environment_id: world.id,
        name: "Two agents",
        agent_ids: agents,
      })
    ).data,
    template = (
      await api("/mission-templates", "POST", {
        environment_id: world.id,
        name: "Parallel finite DAG",
        adapter: "simulation",
        graph: {
          schema_version: 1,
          nodes: [
            {
              key: "one",
              timeout_ms: 5000,
              action: { kind: "fixture.wait", duration_ms: 800, value: "one" },
            },
            {
              key: "two",
              action: { kind: "fixture.wait", duration_ms: 800, value: "two" },
            },
            {
              key: "verify",
              dependencies: [{ key: "one" }, { key: "two" }],
              action: { kind: "fixture.echo", value: "verified" },
            },
          ],
        },
      })
    ).data;
  phase = "CLI login";
  await cli(["login", origin, "runtime-stack-owner"], password);
  phase = "worker enrollment";
  const enrollment = await cli([
    "worker",
    "enroll",
    organization,
    world.id,
    `${directory}/.worker-secrets/credential.json`,
  ]);
  visible.push(JSON.stringify(enrollment));
  assert.equal(
    (await stat(`${directory}/.worker-secrets/credential.json`)).mode & 0o777,
    0o600,
  );
  const credential = JSON.parse(
    await readFile(`${directory}/.worker-secrets/credential.json`, "utf8"),
  );
  await run("docker", [...configured, "config", "--quiet"]);
  await run("docker", [
    ...configured,
    "up",
    "-d",
    "--no-build",
    "--wait",
    "worker",
  ]);
  await writeFile(
    `${directory}/mission.json`,
    JSON.stringify({
      name: "CLI execution",
      group_id: group.id,
      template_id: template.id,
    }),
    { mode: 0o600 },
  );
  phase = "mission creation";
  const mission = await cli([
    "mission",
    "create",
    organization,
    `${directory}/mission.json`,
    randomUUID(),
  ]);
  phase = "mission execution";
  await cli([
    "mission",
    "execute",
    organization,
    mission.id,
    "1",
    randomUUID(),
  ]);
  let view;
  for (let i = 0; i < 150; i++) {
    view = (await api(`/missions/${mission.id}`)).data;
    if (view.state === "succeeded") break;
    await new Promise((accept) => setTimeout(accept, 200));
  }
  assert.equal(view.state, "succeeded", "Simulation mission did not complete");
  assert(view.tasks.every((task) => task.verified));
  assert.equal(
    new Set(
      view.tasks
        .filter((task) => ["one", "two"].includes(task.key))
        .map((task) => task.agent_id),
    ).size,
    2,
    "Parallel tasks must use distinct agents",
  );

  phase = "SSE through web proxy";
  const events = (await api(`/events?environment_id=${world.id}`)).data;
  assert(
    events.snapshot.some(
      (row) => row.id === mission.id && row.state === "succeeded",
    ),
  );
  const streamAbort = new AbortController(),
    stream = await fetch(
      `${origin}/api/v1/events/stream?environment_id=${world.id}`,
      {
        headers: { origin, cookie, "x-craftlayer-organization": organization },
        signal: streamAbort.signal,
      },
    );
  assert.equal(stream.status, 200);
  assert(stream.headers.get("content-type").startsWith("text/event-stream"));
  const reader = stream.body.getReader(),
    first = await reader.read();
  assert(new TextDecoder().decode(first.value).includes("event: snapshot"));
  streamAbort.abort();
  await reader.cancel().catch(() => {});
  reader.releaseLock();

  phase = "persistent stop and API restart";
  await run("docker", [...configured, "stop", "worker"]);
  const paused = await simpleMission(group.id, world.id, "Restart with stop");
  const stop = (
    await api("/emergency-stop", "POST", {
      kind: "environment",
      scope_id: world.id,
      reason: "Disposable restart proof",
    })
  ).data;
  await run("docker", [...configured, "restart", "api"]);
  await run("docker", [
    ...configured,
    "up",
    "-d",
    "--no-build",
    "--wait",
    "api",
    "worker",
  ]);
  assert.equal((await api(`/stop-operations/${stop.id}`)).data.latched, true);
  assert.equal((await api(`/missions/${paused}`)).data.state, "paused");
  await api(`/emergency-stop/${stop.id}/clear`, "POST", {
    expected_epoch: stop.epoch,
    reason: "Fixture restart checked",
  });
  await new Promise((r) => setTimeout(r, 1200));
  const stillPaused = (await api(`/missions/${paused}`)).data;
  assert.equal(stillPaused.state, "paused");
  assert(stillPaused.tasks.every((t) => t.attempt_count === 0));
  await cli([
    "mission",
    "resume",
    organization,
    paused,
    String(stillPaused.version),
    randomUUID(),
  ]);
  await waitFor(
    async () => (await api(`/missions/${paused}`)).data,
    (m) => m.state === "succeeded",
    "Explicit resume failed",
  );

  phase = "Redis queue loss and reconnect without API restart";
  await run("docker", [...configured, "stop", "worker"]);
  const redisMission = await simpleMission(group.id, world.id, "Redis repair");
  const waitKey = `bull:craftlayer-${organization}-${world.id}:wait`;
  await waitFor(
    async () =>
      Number(
        (
          await run(
            "docker",
            [
              ...configured,
              "exec",
              "-T",
              "redis",
              "redis-cli",
              "LLEN",
              waitKey,
            ],
            { capture: true },
          )
        ).trim(),
      ),
    (n) => n > 0,
    "No disposable queued job",
  );
  await run(
    "docker",
    [...configured, "exec", "-T", "redis", "redis-cli", "FLUSHDB"],
    { capture: true },
  );
  const apiId = (
    await run("docker", [...configured, "ps", "-q", "api"], { capture: true })
  ).trim();
  await run("docker", [...configured, "stop", "redis"]);
  await waitFor(
    async () => {
      try {
        return (await fetch(`${origin}/api/v1/system/status`)).status;
      } catch {
        return 0;
      }
    },
    (code) => code === 503,
    "API did not detect Redis loss",
  );
  assert.equal((await api(`/missions/${redisMission}`)).data.state, "queued");
  await run("docker", [...configured, "start", "redis"]);
  await waitFor(
    async () => {
      try {
        return (await fetch(`${origin}/api/v1/system/status`)).status;
      } catch {
        return 0;
      }
    },
    (code) => code === 200,
    "API Redis health did not reconnect",
  );
  await run("docker", [...configured, "start", "worker"]);
  await waitFor(
    async () => (await api(`/missions/${redisMission}`)).data,
    (m) => m.state === "succeeded",
    "Database dispatch repair failed",
  );
  assert.equal(
    (
      await run("docker", [...configured, "ps", "-q", "api"], { capture: true })
    ).trim(),
    apiId,
  );

  phase = "worker crash after prepared effect";
  const crashed = await simpleMission(group.id, world.id, "Prepared crash", {
    kind: "fixture.wait",
    duration_ms: 8000,
    value: "crash fixture",
  });
  await waitFor(
    () => receiptCount(crashed),
    (n) => n === 1,
    "Worker never prepared crash receipt",
  );
  await run("docker", [...configured, "kill", "-s", "SIGKILL", "worker"]);
  await run("docker", [...configured, "start", "worker"]);
  await waitFor(
    async () => (await api(`/missions/${crashed}`)).data,
    (m) => m.state === "blocked" && m.reason === "uncertain",
    "Prepared crash did not hold uncertainty",
  );

  phase = "control-plane partition watchdog";
  const partitioned = await simpleMission(group.id, world.id, "API partition", {
    kind: "fixture.wait",
    duration_ms: 8000,
    value: "partition fixture",
  });
  await waitFor(
    () => receiptCount(partitioned),
    (n) => n === 1,
    "Worker never prepared partition receipt",
  );
  const partitionStart = Date.now();
  await run("docker", [...configured, "stop", "api"]);
  const stopped = await waitFor(
    async () => {
      const logs = await run(
        "docker",
        [
          ...configured,
          "logs",
          "--no-color",
          "--since",
          new Date(partitionStart).toISOString(),
          "worker",
        ],
        { capture: true },
      );
      for (const line of logs.split("\n")) {
        try {
          const entry = JSON.parse(line.slice(line.indexOf("{")));
          if (entry.code === "WORKER_TASK_STATE" && entry.state === "blocked")
            return entry.time;
        } catch {}
      }
      return 0;
    },
    (at) => at >= partitionStart,
    "Worker did not report bounded control-loss stop",
    100,
  );
  const partitionMs = stopped - partitionStart;
  assert(partitionMs <= 20000, "Simulation control-loss bound exceeded");
  await run("docker", [...configured, "start", "api"]);
  await run("docker", [
    ...configured,
    "up",
    "-d",
    "--no-build",
    "--wait",
    "api",
  ]);
  await waitFor(
    async () => (await api(`/missions/${partitioned}`)).data,
    (m) => m.state === "blocked" && m.reason === "uncertain",
    "Partition uncertainty was lost",
  );
  phase = "conservative uncertainty review";
  await cli(["worker", "revoke", organization, credential.worker_id, "1"]);
  const pending = [];
  for (const id of [crashed, partitioned]) {
    const evidence = (await api(`/missions/${id}/recovery`)).data.items[0];
    assert(evidence);
    pending.push({ id, evidence });
  }
  const safeAfter =
    Math.max(...pending.map((p) => Date.parse(p.evidence.deadline_at))) + 15001;
  await waitFor(
    async () => Date.now(),
    (at) => at >= safeAfter,
    "Lease quiescence wait exceeded",
    200,
  );
  for (const { id } of pending) {
    const evidence = (await api(`/missions/${id}/recovery`)).data.items[0];
    const result = (
      await api(`/missions/${id}/recovery/${evidence.attempt_id}`, "POST", {
        evidence_hash: evidence.evidence_hash,
        quiescent: true,
        reason:
          "Disposable process stopped/revoked; in-memory simulation outcome not asserted",
      })
    ).data;
    assert.equal(result.state, "failed");
    assert(result.tasks.every((t) => !t.verified));
  }
  const budget = (await api(`/runtime-budgets/organization/${organization}`))
    .data;
  assert.equal(budget.active_agents, 0);
  assert.equal(budget.active_missions, 0);
  console.log(
    `Simulation partition stop acknowledgement: ${partitionMs} ms (target <=20000 ms; no physical adapter qualification).`,
  );
  const ids = (
      await run("docker", [...configured, "ps", "-q"], { capture: true })
    )
      .trim()
      .split("\n"),
    containers = JSON.parse(
      await run("docker", ["inspect", ...ids], { capture: true }),
    );
  for (const container of containers) {
    const service = container.Config.Labels["com.docker.compose.service"],
      mounts = container.Mounts.filter((mount) =>
        mount.Destination.startsWith("/run/secrets/worker"),
      );
    if (service === "worker") {
      assert(
        !container.Config.Env.some((value) =>
          /^(DATABASE_URL|AUTH_DATABASE_URL|MIGRATION_DATABASE_URL|PROVISION_DATABASE_URL|CRAFTLAYER_(BOOTSTRAP_TOKEN|RECOVERY_TOKEN|CSRF_SECRET|PROVIDER_KEY_FILE))=/.test(
            value,
          ),
        ),
        "Worker received forbidden authority",
      );
      assert.equal(
        container.Config.User,
        `${process.getuid()}:${process.getgid()}`,
      );
      assert.equal(mounts.length, 1);
      assert.equal(mounts[0].RW, false);
    } else assert.equal(mounts.length, 0);
  }
  visible.push(
    await run(
      "docker",
      [...configured, "logs", "--no-color", "api", "worker"],
      { capture: true },
    ),
  );
  for (const secret of [
    credential.token,
    credential.token.split(".").at(-1),
    env.CRAFTLAYER_CSRF_SECRET,
    env.POSTGRES_PASSWORD,
  ])
    assert(
      !visible.some((text) => text.includes(secret)),
      "Credential canary found; values omitted",
    );
  console.log(
    "Isolated runtime stack PASS: CLI + API + real registered worker, parallel two-agent DAG, scoped SSE, persistent stop/restart, Redis loss/reconnect, prepared worker crash, control-loss watchdog, conservative reconciliation and token/log redaction. No model/catalog/game calls.",
  );
} finally {
  try {
    await run("docker", [
      ...base,
      "down",
      "--volumes",
      "--remove-orphans",
      "--rmi",
      "local",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
