import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { pinLocalDocker } from "./lib/local-docker.mjs";

pinLocalDocker();

const root = resolve(import.meta.dirname, ".."),
  directory = resolve(root, ".craftlayer-prototype"),
  project = "craftlayer-family-prototype";
const command = process.argv[2];
if (!["up", "down", "refresh"].includes(command) || process.argv.length !== 3)
  throw new Error("Use prototype:up, prototype:down or prototype:refresh");
const exists = async (path) => {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
function run(cmd, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}
const save = (path, value) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
if (!(await exists(directory))) {
  if (command !== "up") throw new Error("No prototype exists yet");
  await mkdir(directory, { mode: 0o700 });
}
const stat = await lstat(directory);
if (
  !stat.isDirectory() ||
  stat.isSymbolicLink() ||
  stat.uid !== process.getuid() ||
  (stat.mode & 0o077) !== 0
)
  throw new Error("Prototype directory must be private and owned by this user");
const statePath = resolve(directory, "state.json");
let state;
if (await exists(statePath))
  state = JSON.parse(await readFile(statePath, "utf8"));
else {
  if (command !== "up") throw new Error("Prototype has no state");
  if (
    execFileSync(
      "docker",
      ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`],
      { encoding: "utf8" },
    ).trim()
  )
    throw new Error(
      "An existing prototype project has no matching local state; refusing to claim it",
    );
  const socket = createServer();
  await new Promise((accept, reject) => {
    socket.once("error", (e) =>
      e.code === "EADDRINUSE"
        ? socket.listen(0, "127.0.0.1", accept)
        : reject(e),
    );
    socket.listen(3001, "127.0.0.1", accept);
  });
  const port = socket.address().port;
  await new Promise((accept) => socket.close(accept));
  state = {
    schema_version: 1,
    project,
    port,
    namespace: randomUUID(),
    seeded: false,
  };
  await save(statePath, state);
}
if (
  state.schema_version !== 1 ||
  state.project !== project ||
  !Number.isInteger(state.port) ||
  state.port < 1024 ||
  state.port > 65535
)
  throw new Error("Prototype state is invalid");
const origin = `http://127.0.0.1:${state.port}`,
  env = {
    ...process.env,
    CRAFTLAYER_HTTP_PORT: String(state.port),
    CRAFTLAYER_PUBLIC_URL: origin,
  };
if (!(await exists(resolve(directory, ".env")))) {
  if (command !== "up") throw new Error("Missing prototype credentials");
  await writeFile(
    resolve(directory, ".env"),
    `CRAFTLAYER_HTTP_PORT=${state.port}\nCRAFTLAYER_PUBLIC_URL=${origin}\n`,
    { mode: 0o600, flag: "wx" },
  );
  await run(process.execPath, [resolve(root, "scripts/setup-local.mjs")], {
    cwd: directory,
    env,
  });
}
Object.assign(
  env,
  parseEnv(await readFile(resolve(directory, ".env"), "utf8")),
  {
    CRAFTLAYER_HTTP_PORT: String(state.port),
    CRAFTLAYER_PUBLIC_URL: origin,
    CRAFTLAYER_MINECRAFT_CONFIG_DIR: resolve(directory, "inventory"),
    CRAFTLAYER_HOST_UID: String(process.getuid()),
    CRAFTLAYER_HOST_GID: String(process.getgid()),
  },
);
const compose = [
  "compose",
  "-p",
  project,
  "--env-file",
  resolve(directory, ".env"),
  "-f",
  "docker-compose.yml",
  "-f",
  "infra/compose/minecraft-observation.yml",
];
if (command === "down") {
  await run("docker", [...compose, "down"], { env });
  console.log(
    "Prototype stopped; its database and credentials are retained. Existing installation untouched.",
  );
} else {
  const inventoryPath = resolve(directory, "inventory", "inventory.json");
  if (!(await exists(resolve(directory, "inventory"))))
    await mkdir(resolve(directory, "inventory"), { mode: 0o700 });
  if (!(await exists(inventoryPath)))
    await save(inventoryPath, { schema_version: 1, targets: [] });
  async function refresh() {
    if (!state.environment_id || !state.organization_id)
      throw new Error("Prototype has not been seeded");
    const targets = [
      {
        id: "survival",
        name: "Family Survival · Demo",
        state: "online",
        players: [
          { name: "NoraDemo", edition: "java" },
          { name: "LeoDemo", edition: "bedrock" },
        ],
      },
      {
        id: "creative",
        name: "Creative Garden · Demo",
        state: "offline",
        players: [],
      },
    ].map((t) => ({
      id: t.id,
      organization_id: state.organization_id,
      environment_id: state.environment_id,
      label: `SIMULATED · ${t.name}`,
      binding_hash: createHash("sha256")
        .update(`${state.namespace}:${t.id}`)
        .digest("hex"),
      observation: {
        source: "captured_inventory",
        data_kind: "synthetic",
        observed_at: new Date().toISOString(),
        state: t.state,
        java: { host: "java.demo.invalid", port: 25565 },
        bedrock: { host: "bedrock.demo.invalid", port: 19132 },
        players: t.players,
        online_authentication: null,
        allowlist_enabled: null,
        enforce_allowlist: null,
        rcon_public: null,
        backup_verified: false,
        identity_verified: false,
      },
    }));
    await save(inventoryPath, { schema_version: 1, targets });
  }
  if (command === "refresh") {
    await refresh();
    console.log(
      "Simulated capture refreshed. Click Observe approved source in the dashboard to read it.",
    );
  } else {
    await run("docker", [...compose, "up", "-d", "--build", "--wait"], { env });
    const accountsPath = resolve(directory, "accounts.json");
    let accounts;
    if (await exists(accountsPath))
      accounts = JSON.parse(await readFile(accountsPath, "utf8"));
    else {
      accounts = {
        parent: {
          login: "prototype-parent",
          password: randomBytes(24).toString("base64url"),
        },
        viewer: {
          login: "prototype-viewer",
          password: randomBytes(24).toString("base64url"),
        },
        child: {
          login: "prototype-child",
          password: randomBytes(24).toString("base64url"),
        },
      };
      await save(accountsPath, accounts);
    }
    const owner = { cookie: "", csrf: "" };
    async function api(session, method, path, data, organization) {
      const response = await fetch(`${origin}/api/v1${path}`, {
        method,
        headers: {
          origin,
          ...(session.cookie ? { cookie: session.cookie } : {}),
          ...(session.csrf ? { "x-csrf-token": session.csrf } : {}),
          ...(organization
            ? { "x-craftlayer-organization": organization }
            : {}),
          ...(data ? { "content-type": "application/json" } : {}),
          "idempotency-key": randomUUID(),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      if (!response.ok)
        throw new Error(
          `Prototype API ${method} ${path} returned ${response.status}; state is retained for inspection`,
        );
      const cookie = response.headers.get("set-cookie");
      if (cookie) session.cookie = cookie.split(";")[0];
      const result = await response.json();
      if (result.csrf_token) session.csrf = result.csrf_token;
      return result;
    }
    const setup = await api(owner, "GET", "/auth/setup");
    await api(
      owner,
      "POST",
      setup.required ? "/auth/bootstrap" : "/auth/login",
      {
        ...accounts.parent,
        ...(setup.required ? { token: env.CRAFTLAYER_BOOTSTRAP_TOKEN } : {}),
      },
    );
    const me = await api(owner, "GET", "/auth/me");
    state.organization_id ??= me.organizations[0].id;
    if (!state.project_id) {
      state.project_id = (
        await api(
          owner,
          "POST",
          "/projects",
          { name: "Family prototype" },
          state.organization_id,
        )
      ).id;
      await save(statePath, state);
    }
    if (!state.environment_id) {
      state.environment_id = (
        await api(
          owner,
          "POST",
          "/environments",
          {
            projectId: state.project_id,
            name: "Family demo worlds",
            type: "minecraft",
          },
          state.organization_id,
        )
      ).id;
      await save(statePath, state);
    }
    await refresh();
    if (!state.seeded) {
      const targets = JSON.parse(await readFile(inventoryPath, "utf8")).targets;
      state.servers ??= {};
      for (const target of targets) {
        const registered = await api(
          owner,
          "GET",
          `/servers?environment_id=${state.environment_id}`,
          undefined,
          state.organization_id,
        );
        let server = registered.items.find((s) => s.target_id === target.id);
        if (!server) {
          const input = {
            environment_id: state.environment_id,
            target_id: target.id,
            name: target.label.replace("SIMULATED · ", ""),
          };
          const plan = await api(
            owner,
            "POST",
            "/servers/adopt/plan",
            input,
            state.organization_id,
          );
          const receipt = await api(
            owner,
            "POST",
            "/servers/adopt",
            { ...input, plan_hash: plan.plan_hash },
            state.organization_id,
          );
          server = { id: receipt.server_id };
        }
        state.servers[target.id] = server.id;
        await save(statePath, state);
      }
      const roles = await api(
        owner,
        "GET",
        "/roles",
        undefined,
        state.organization_id,
      );
      let members = await api(
        owner,
        "GET",
        "/memberships",
        undefined,
        state.organization_id,
      );
      if (!members.items.some((m) => m.login === accounts.child.login))
        await api(
          owner,
          "POST",
          "/children",
          { ...accounts.child, environmentIds: [state.environment_id] },
          state.organization_id,
        );
      if (!members.items.some((m) => m.login === accounts.viewer.login)) {
        const invitation = await api(
          owner,
          "POST",
          "/invitations",
          { roleId: roles.items.find((r) => r.name === "viewer").id },
          state.organization_id,
        );
        await api({ cookie: "", csrf: "" }, "POST", "/invitations/consume", {
          mode: "new",
          token: invitation.token,
          ...accounts.viewer,
        });
      }
      members = await api(
        owner,
        "GET",
        "/memberships",
        undefined,
        state.organization_id,
      );
      const viewer = members.items.find(
        (m) => m.login === accounts.viewer.login,
      );
      const grants = await api(
        owner,
        "GET",
        "/resource-grants",
        undefined,
        state.organization_id,
      );
      for (const permission of [
        "environment:read",
        "server:read",
        "player:read",
        "operation:read",
      ])
        if (
          !grants.items.some(
            (g) =>
              g.membership_id === viewer.id &&
              g.permission === permission &&
              g.environment_id === state.environment_id,
          )
        )
          await api(
            owner,
            "POST",
            "/resource-grants",
            {
              membershipId: viewer.id,
              permission,
              projectId: state.project_id,
              environmentId: state.environment_id,
            },
            state.organization_id,
          );
      const pending = await api(
        owner,
        "GET",
        `/servers/${state.servers.survival}/identity-enrollments`,
        undefined,
        state.organization_id,
      );
      if (!pending.items.length)
        await api(
          owner,
          "POST",
          `/servers/${state.servers.survival}/identity-enrollments`,
          { edition: "java", requested_name: "AlexDemo" },
          state.organization_id,
        );
      state.seeded = true;
      await save(statePath, state);
    }
    // Synthetic prototype only. Never copy cookies from the existing installation.
    const token = owner.cookie.slice("craftlayer_session=".length);
    await save(resolve(directory, "browser-state.json"), {
      cookies: [
        {
          name: "craftlayer_session",
          value: token,
          domain: "127.0.0.1",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
        },
      ],
      origins: [],
    });
    await writeFile(
      resolve(directory, "START-HERE.md"),
      `# Local family prototype\n\nOpen ${origin}/servers and sign in via ${origin}/account.\n\nParent: ${accounts.parent.login}\nPassword: ${accounts.parent.password}\n\nViewer: ${accounts.viewer.login}\nPassword: ${accounts.viewer.password}\n\nChild: ${accounts.child.login}\nPassword: ${accounts.child.password}\n\nThese generated credentials belong only to this synthetic local prototype. Do not reuse them. No Minecraft server is connected. Requests stay pending and grant no game access.\n\nStop: pnpm prototype:down (data retained). Restart: pnpm prototype:up. Refresh simulated capture: pnpm prototype:refresh then Observe approved source.\n`,
      { mode: 0o600 },
    );
    console.log(
      `Prototype ready: ${origin}/servers\nPrivate sign-in details: .craftlayer-prototype/START-HERE.md\nParent/viewer/child accounts and two simulated servers are available. No game server is connected.`,
    );
  }
}
