import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Disposable installation only. Synthetic secrets never reach a provider endpoint.
const root = resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(`${tmpdir()}/craftlayer-provider-stack-`),
  project = `craftlayer-provider-stack-${process.pid}`;
function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const capture = options.capture === true;
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
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
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? accept(output)
        : reject(
            new Error(`${command} exited ${code}; captured values omitted`),
          ),
    );
  });
}
const socket = createServer();
await new Promise((accept) => socket.listen(0, "127.0.0.1", accept));
const port = socket.address().port;
await new Promise((accept) => socket.close(accept));
const base = `http://127.0.0.1:${port}`,
  env = {
    ...process.env,
    CRAFTLAYER_HTTP_PORT: String(port),
    CRAFTLAYER_PUBLIC_URL: base,
  },
  compose = [
    "compose",
    "--project-directory",
    root,
    "-p",
    project,
    "--env-file",
    `${directory}/.env`,
    "--env-file",
    `${directory}/.secrets/provider.env`,
    "-f",
    `${root}/docker-compose.yml`,
    "-f",
    `${root}/infra/compose/providers.yml`,
    "-f",
    `${directory}/mount.yml`,
  ],
  secret = `fixture-${randomBytes(24).toString("hex")}`;
let cookie = "",
  csrf = "",
  organization = "";
const visible = [];
async function api(path, method = "GET", body, expected = 200) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
      "x-craftlayer-organization": organization,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const errorCode = response.ok
    ? ""
    : String(JSON.parse(text).error?.code ?? "unknown").replace(
        /[^a-zA-Z_]/g,
        "",
      );
  if (response.status !== expected) {
    const logs = await run(
      "docker",
      [...compose, "logs", "--no-color", "--no-log-prefix", "api"],
      { capture: true },
    );

    for (const line of logs.split("\n")) {
      try {
        const entry = JSON.parse(line);
        if (entry.provider_code)
          console.log(
            JSON.stringify({
              provider_code: entry.provider_code,
            }),
          );
      } catch {}
    }
  }
  assert.equal(
    response.status,
    expected,
    `Unexpected status at ${method} ${path}; code ${errorCode}; body omitted`,
  );
  visible.push(text);
  return { response, data: JSON.parse(text) };
}
async function replace(path, value) {
  await writeFile(`${path}.next`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${path}.next`, path);
  // Docker Desktop bind metadata propagation is asynchronous across the host/VM boundary.
  // Organization stop remains latched while an operator rotates files in real use.
  await new Promise((accept) => setTimeout(accept, 1000));
}
try {
  await run(process.execPath, [`${root}/scripts/setup-local.mjs`], {
    cwd: directory,
  });
  await run(process.execPath, [`${root}/scripts/setup-providers.mjs`], {
    cwd: directory,
  });
  const credentials = parseEnv(await readFile(`${directory}/.env`, "utf8")),
    providerEnv = parseEnv(
      await readFile(`${directory}/.secrets/provider.env`, "utf8"),
    ),
    keyPath = `${directory}/.secrets/provider-keys.json`,
    policyPath = `${directory}/.secrets/provider-policy.json`,
    initial = JSON.parse(await readFile(keyPath, "utf8"));
  Object.assign(env, credentials, providerEnv, {
    CRAFTLAYER_HTTP_PORT: String(port),
    CRAFTLAYER_PUBLIC_URL: base,
  });
  assert.equal(providerEnv.CRAFTLAYER_HOST_UID, String(process.getuid()));
  for (const path of [keyPath, policyPath])
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  await run(process.execPath, [`${root}/scripts/setup-providers.mjs`], {
    cwd: directory,
  });
  assert(
    await readFile(keyPath, "utf8").then(
      (value) => JSON.parse(value).keys.k1 === initial.keys.k1,
    ),
    "Setup must preserve key material",
  );
  // Directory mount is necessary: atomic rename must be visible without API recreation.
  await writeFile(
    `${directory}/mount.yml`,
    `services:\n  api:\n    volumes:\n      - ${JSON.stringify(`${directory}/.secrets:/run/secrets/providers:ro`)}\n`,
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  policy.openrouter_enabled = true;
  await replace(policyPath, policy);
  await run("docker", [...compose, "config", "--quiet"]);
  await run("docker", [...compose, "up", "-d", "--build", "--wait"]);
  const ids = (await run("docker", [...compose, "ps", "-q"], { capture: true }))
    .trim()
    .split("\n");
  const containers = JSON.parse(
    await run("docker", ["inspect", ...ids], { capture: true }),
  );
  for (const container of containers) {
    const service = container.Config.Labels["com.docker.compose.service"];
    const mounts = container.Mounts.filter((mount) =>
      mount.Destination.startsWith("/run/secrets/providers"),
    );
    if (service === "api") {
      assert.equal(
        container.Config.User,
        `${process.getuid()}:${process.getgid()}`,
      );
      assert.equal(mounts.length, 1);
      assert.equal(mounts[0].RW, false);
    } else assert.equal(mounts.length, 0, "Provider files must be API-only");
  }
  const bootstrap = await api("/auth/bootstrap", "POST", {
    token: credentials.CRAFTLAYER_BOOTSTRAP_TOKEN,
    login: "provider-fixture-owner",
    password: "Disposable provider fixture 42!",
  });
  cookie = bootstrap.response.headers.get("set-cookie").split(";")[0];
  csrf = bootstrap.data.csrf_token;
  organization = (await api("/auth/me")).data.organizations[0].id;
  let connection = (
    await api("/providers", "POST", {
      kind: "openrouter",
      endpoint_id: "openrouter",
      label: "Synthetic no-network fixture",
      secret,
    })
  ).data;
  assert.equal(connection.credential_configured, true);
  assert.equal(connection.key_id, "k1");
  const rotated = {
    active: "k2",
    keys: { ...initial.keys, k2: randomBytes(32).toString("hex") },
  };
  await replace(keyPath, rotated);
  connection = (
    await api(`/providers/${connection.id}/rewrap`, "POST", {
      expected_version: connection.version,
    })
  ).data;
  assert.equal(connection.key_id, "k2");
  await replace(keyPath, { active: "k2", keys: { k2: rotated.keys.k2 } });
  connection = (
    await api(`/providers/${connection.id}/rewrap`, "POST", {
      expected_version: connection.version,
    })
  ).data;
  await chmod(policyPath, 0o640);
  await new Promise((accept) => setTimeout(accept, 1000));
  await api(
    "/providers",
    "POST",
    {
      kind: "openrouter",
      endpoint_id: "openrouter",
      label: "Denied unsafe file",
      secret,
    },
    403,
  );
  await chmod(policyPath, 0o600);
  await new Promise((accept) => setTimeout(accept, 1000));
  const budget = (await api(`/budgets/organization/${organization}`)).data;
  assert.equal(budget.limits.micro_usd, "0");
  await api(`/budgets/organization/${organization}`, "PUT", {
    expected_version: budget.version,
    limits: budget.limits,
  });
  await api("/providers/stop", "POST", {});
  await run("docker", [...compose, "restart", "api"]);
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${base}/api/v1/system/status`)).ok) break;
    } catch {}
    assert(attempt < 30, "API did not recover");
    await new Promise((accept) => setTimeout(accept, 500));
  }
  assert.equal((await api("/providers/stop")).data.stopped, true);
  await api("/providers/stop/clear", "POST", {});
  assert.equal((await api("/providers/stop")).data.stopped, false);
  connection = (
    await api(`/providers/${connection.id}/credential`, "DELETE", {
      expected_version: connection.version,
    })
  ).data;
  assert.equal(connection.credential_configured, false);
  assert.equal(connection.enabled, false);
  const usage = (await api("/usage")).data;
  assert.equal(usage.reservations.length, 0);
  await api("/providers/generate", "POST", {}, 404);
  visible.push(
    await run("docker", [...compose, "logs", "--no-color", "api"], {
      capture: true,
    }),
  );
  for (const value of [secret, initial.keys.k1, rotated.keys.k2])
    assert(
      !visible.some((text) => text.includes(value)),
      "Credential canary in response/log; values omitted",
    );
  console.log(
    "Isolated provider stack: protected files, atomic rotation, revocation, zero-spend budget, persistent stop and redaction PASS; zero inference/catalog calls.",
  );
} finally {
  try {
    await run("docker", [
      ...compose,
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
