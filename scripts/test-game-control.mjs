// Opt-in real-server check for the typed game-control library (master plan A2).
// Boots a disposable pinned Paper server locally with RCON on a loopback port, runs
// every typed action against it, then removes only what it created. Requires Docker,
// network access for the pinned Paper download, and an explicit EULA acknowledgement:
//   CRAFTLAYER_ACCEPT_EULA=true pnpm test:game-control
// Nothing here touches the VPS or any existing world.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pinLocalDocker } from "./lib/local-docker.mjs";

pinLocalDocker();
if (process.env.CRAFTLAYER_ACCEPT_EULA !== "true") {
  console.error(
    "Set CRAFTLAYER_ACCEPT_EULA=true to acknowledge https://www.minecraft.net/en-us/eula for this disposable local test server.",
  );
  process.exit(2);
}
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
const report = new Proxy(
  {},
  {
    set(target, key, value) {
      target[key] = value;
      console.error(`step ${String(key)}: ${JSON.stringify(value)}`);
      return true;
    },
  },
);
const gamePort = await freePort(),
  rconPort = await freePort();
const prepared = run(
  "node",
  ["--import", "tsx", "scripts/minecraft/playtest.ts", "prepare"],
  { env: { ...process.env } },
);
const directory = JSON.parse(prepared).directory;
if (typeof directory !== "string" || !directory.startsWith("/"))
  throw new Error("Prepared bundle directory missing from preparation output");
const data = join(directory, "data"),
  password = randomBytes(24).toString("base64url");
let cleanup = async () => {};
try {
  // Enable RCON for the test only, bound to loopback on this machine; the container
  // keeps its read-only root and non-root user from the generated bundle.
  const properties = (await readFile(join(data, "server.properties"), "utf8"))
    .replace("enable-rcon=false", "enable-rcon=true")
    .replace(/^rcon\.password=.*$/m, `rcon.password=${password}`)
    .replace(/^server-port=.*$/m, "server-port=25565")
    .replace(/^level-type=.*$/m, "level-type=minecraft\\:flat");
  await writeFile(
    join(data, "server.properties"),
    properties.includes("rcon.password=")
      ? properties
      : `${properties}\nrcon.password=${password}\n`,
  );
  await writeFile(join(data, "eula.txt"), "eula=true\n");
  await writeFile(
    join(data, "whitelist.json"),
    `${JSON.stringify([{ uuid: "00000000-0000-0000-0009-01f4a2e05e99", name: ".Seeded_Player" }], null, 2)}\n`,
  );
  const compose = JSON.parse(
    await readFile(join(directory, "compose.json"), "utf8"),
  );
  const service = compose.services.minecraft;
  service.ports = [
    {
      target: 25565,
      published: String(gamePort),
      host_ip: "127.0.0.1",
      protocol: "tcp",
    },
    {
      target: 25575,
      published: String(rconPort),
      host_ip: "127.0.0.1",
      protocol: "tcp",
    },
  ];
  await writeFile(
    join(directory, "compose.json"),
    `${JSON.stringify(compose, null, 2)}\n`,
  );
  const project = `craftlayer-gamecontrol-${process.pid}`;
  const composeArgs = [
    "compose",
    "-p",
    project,
    "-f",
    join(directory, "compose.json"),
  ];
  cleanup = async () => {
    spawnSync(
      "docker",
      [...composeArgs, "down", "--remove-orphans", "-t", "30"],
      { stdio: "ignore" },
    );
    await rm(directory, { recursive: true, force: true });
  };
  run("docker", [...composeArgs, "up", "-d"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const logPath = join(data, "logs", "latest.log");
  const started = Date.now();
  for (;;) {
    const log = await readFile(logPath, "utf8").catch(() => "");
    if (/\]: Done \(/.test(log) && /RCON running on/.test(log)) break;
    if (Date.now() - started > 180000)
      throw new Error("Server did not become ready within 180 s");
    await delay(2000);
  }
  report.boot_seconds = Math.round((Date.now() - started) / 1000);
  const { openRcon, GameActions, FileWhitelistStore } = await import(
    "../apps/minecraft-node/dist/game-control/index.js"
  );
  const session = await openRcon({
    host: "127.0.0.1",
    port: rconPort,
    password,
    timeoutMs: 20000,
  });
  const actions = new GameActions(
    session,
    new FileWhitelistStore(join(data, "whitelist.json")),
  );
  report.players = (await actions.players()).detail;
  const allowed = await actions.allow({
    edition: "bedrock",
    gamertag: "Big Crazy Pickle",
    xuid: "2535400000000001",
  });
  report.whitelist_list_raw = (await session.command("whitelist list")).body;
  report.whitelist_file_after_allow = JSON.parse(
    await readFile(join(data, "whitelist.json"), "utf8"),
  );
  report.allow_bedrock = {
    ok: allowed.ok,
    evidence: allowed.evidence,
    detail: allowed.detail,
  };
  const unknownJava = await actions.allow({
    edition: "java",
    name: "nobody_zz_cl",
  });
  report.allow_unknown_java = {
    ok: unknownJava.ok,
    evidence: unknownJava.evidence,
  };
  const kicked = await actions.kick(".Big_Crazy_Pickle", "Test only");
  report.kick_offline = {
    ok: kicked.ok,
    wasOnline: kicked.detail.wasOnline,
    evidence: kicked.evidence,
  };
  report.say = (await actions.say("CraftLayer control check")).evidence;
  report.save = (await actions.saveAll()).detail;
  const revoked = await actions.revoke(".Big_Crazy_Pickle");
  report.revoke_bedrock = { ok: revoked.ok, evidence: revoked.evidence };
  report.whitelist_file = JSON.parse(
    await readFile(join(data, "whitelist.json"), "utf8"),
  ).map((e) => e.name);
  // Wrong password must be refused by the real server.
  try {
    await openRcon({
      host: "127.0.0.1",
      port: rconPort,
      password: "wrong",
      timeoutMs: 5000,
    });
    report.wrong_password = "ACCEPTED (bad)";
  } catch (error) {
    report.wrong_password = error.code;
  }
  const stopped = await actions.stop();
  report.stop = stopped.evidence;
  const stopStarted = Date.now();
  for (;;) {
    const state = run("docker", [
      "inspect",
      "--format",
      "{{.State.Status}} {{.State.ExitCode}}",
      `${project}-minecraft-1`,
    ]);
    if (state.startsWith("exited")) {
      report.exit = state;
      break;
    }
    if (Date.now() - stopStarted > 120000)
      throw new Error("Server did not stop within 120 s");
    await delay(1000);
  }
  report.stop_seconds = Math.round((Date.now() - stopStarted) / 1000);
  const log = await readFile(logPath, "utf8");
  report.log_has_rcon_password = log.includes(password);
  report.saved_on_stop =
    /Saving chunks|All dimensions are saved|ThreadedAnvilChunkStorage/.test(
      log,
    );
  await session.close().catch(() => {});
  console.log(JSON.stringify(report, null, 2));
  const ok =
    report.allow_bedrock.ok &&
    report.allow_unknown_java.ok === false &&
    report.revoke_bedrock.ok &&
    report.save.saved &&
    report.wrong_password === "RCON_AUTH_FAILED" &&
    report.exit.startsWith("exited 0") &&
    !report.log_has_rcon_password;
  process.exitCode = ok ? 0 : 1;
} finally {
  await cleanup();
}
