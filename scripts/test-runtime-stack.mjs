import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

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
    "Isolated runtime stack PASS: CLI + API + real registered worker, parallel two-agent DAG, protected API-only authority and token/log redaction. No model/catalog/game calls.",
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
