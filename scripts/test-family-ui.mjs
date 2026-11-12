// Family screens in a real browser (master plan B2/B3). Starts only the web app; the
// API is a stand-in inside the browser whose answers are checked against the real
// contracts, so no database, Docker or secrets are needed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
const run = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
const port = await freePort();
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  // Nothing may reach a real API: this port is closed.
  CRAFTLAYER_API_ORIGIN: "http://127.0.0.1:9",
};
await run("pnpm", ["--filter", "@craftlayer/web", "build"], { env });
const web = spawn(
  "pnpm",
  [
    "--filter",
    "@craftlayer/web",
    "exec",
    "next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env, stdio: ["ignore", "ignore", "inherit"] },
);
try {
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    const ok = await fetch(`${origin}/health/live`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    if (attempt > 120 || web.exitCode !== null)
      throw new Error("The web app did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
  await run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
    env: { ...env, CRAFTLAYER_TEST_URL: origin, CRAFTLAYER_FAMILY_E2E: "1" },
  });
  console.log("PASS: family screens");
} finally {
  web.kill("SIGTERM");
}
