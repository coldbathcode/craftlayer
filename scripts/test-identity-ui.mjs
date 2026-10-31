import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Never claim the user's installation or reuse its owner/recovery credentials.
const root = resolve(import.meta.dirname, ".."),
  directory = await mkdtemp(`${tmpdir()}/craftlayer-identity-ui-`),
  project = `craftlayer-identity-ui-${process.pid}`;
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
const compose = ["compose", "-p", project, "--env-file", `${directory}/.env`];
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
  await run("docker", [...compose, "up", "-d", "--build", "--wait"], { env });
  await run(
    "pnpm",
    ["exec", "playwright", "test", "identity.spec.ts", "--project", "desktop"],
    {
      env: {
        ...env,
        CRAFTLAYER_TEST_URL: env.CRAFTLAYER_PUBLIC_URL,
        CRAFTLAYER_IDENTITY_E2E: "1",
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
