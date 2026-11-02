import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Never claim the user's installation or reuse its owner/recovery credentials.
const root = resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(`${tmpdir()}/craftlayer-server-ui-`),
  project = `craftlayer-server-ui-${process.pid}`;
function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
const socket = createServer();
await new Promise((accept) => socket.listen(0, "127.0.0.1", accept));
const port = socket.address().port;
await new Promise((accept) => socket.close(accept));
const env = {
  ...process.env,
  CRAFTLAYER_HTTP_PORT: String(port),
  CRAFTLAYER_PUBLIC_URL: `http://127.0.0.1:${port}`,
};
const compose = [
  "compose",
  "-p",
  project,
  "--env-file",
  `${directory}/.env`,
  "-f",
  "docker-compose.yml",
  "-f",
  "infra/compose/minecraft-observation.yml",
];
try {
  await run(process.execPath, [resolve(root, "scripts/setup-local.mjs")], {
    cwd: directory,
    env,
  });
  const credentials = parseEnv(await readFile(`${directory}/.env`, "utf8"));
  // Explicit child environment wins over inherited personal installation settings.
  Object.assign(env, credentials, {
    CRAFTLAYER_HTTP_PORT: String(port),
    CRAFTLAYER_PUBLIC_URL: `http://127.0.0.1:${port}`,
  });
  await mkdir(`${directory}/inventory`, { mode: 0o700 });
  await writeFile(
    `${directory}/inventory/inventory.json`,
    JSON.stringify({ schema_version: 1, targets: [] }),
    { mode: 0o600 },
  );
  Object.assign(env, {
    CRAFTLAYER_MINECRAFT_CONFIG_DIR: `${directory}/inventory`,
    CRAFTLAYER_HOST_UID: String(process.getuid()),
    CRAFTLAYER_HOST_GID: String(process.getgid()),
  });
  await run("docker", [...compose, "up", "-d", "--build", "--wait"], { env });
  // Inspect in memory: never print container environment or credentials.
  const inspect = (args) =>
    execFileSync("docker", args, { cwd: root, env, encoding: "utf8" });
  for (const service of ["api", "web", "worker"]) {
    const id = inspect([...compose, "ps", "-q", service]).trim();
    const [container] = JSON.parse(inspect(["inspect", id]));
    const inventory = container.Mounts.filter(
      (m) => m.Destination === "/run/secrets/minecraft",
    );
    if (
      container.Mounts.some((m) =>
        /docker\.sock|minecraft-java|\/world(?:s)?(?:\/|$)/.test(m.Destination),
      )
    )
      throw new Error("Unexpected control/world mount");
    if (
      service === "api"
        ? inventory.length !== 1 || inventory[0].RW
        : inventory.length !== 0
    )
      throw new Error("Inventory mount isolation failed");
    if (
      service !== "api" &&
      container.Config.Env.some((e) =>
        e.startsWith("CRAFTLAYER_MINECRAFT_INVENTORY_FILE="),
      )
    )
      throw new Error("Inventory configuration leaked");
    if (
      service === "web" &&
      container.Config.Env.some((e) =>
        /^(AUTH_DATABASE_URL|DATABASE_URL|CRAFTLAYER_CSRF_SECRET|CRAFTLAYER_BOOTSTRAP_TOKEN)=/.test(
          e,
        ),
      )
    )
      throw new Error("Server credentials leaked to web");
  }
  console.log("PASS: inventory mount and server credential isolation");
  await run(
    "pnpm",
    ["exec", "playwright", "test", "servers.spec.ts", "--project", "desktop"],
    {
      env: {
        ...env,
        CRAFTLAYER_TEST_URL: env.CRAFTLAYER_PUBLIC_URL,
        CRAFTLAYER_SERVER_E2E: "1",
        CRAFTLAYER_E2E_INVENTORY_PATH: `${directory}/inventory/inventory.json`,
        CRAFTLAYER_E2E_BOOTSTRAP_TOKEN: credentials.CRAFTLAYER_BOOTSTRAP_TOKEN,
      },
    },
  );
} finally {
  try {
    await run(
      "docker",
      [...compose, "down", "--volumes", "--remove-orphans", "--rmi", "local"],
      {
        env,
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
