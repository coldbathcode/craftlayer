// Opt-in real-server compatibility check for the AI player body (Milestone G1).
// Boots a disposable pinned Paper server (same Paper/Geyser/Floodgate pins as the
// family server) with the pinned ViaVersion/ViaBackwards bridge, on a loopback port,
// in offline mode because it is an isolated local fixture (never a production path).
// A Mineflayer bot speaking the newest protocol it supports joins, observes, moves,
// digs, collects and places a block, and the world is checked. Removes only what it
// created. Requires Docker, network access for the pinned downloads, and:
//   CRAFTLAYER_ACCEPT_EULA=true pnpm test:ai-player-world
// Nothing here touches the VPS or any existing world.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
const lock = JSON.parse(
  await readFile(
    new URL("../infra/minecraft/ai-player-compat.lock.json", import.meta.url),
    "utf8",
  ),
);
const require = createRequire(
  new URL("../apps/ai-player/package.json", import.meta.url),
);
const { Vec3 } = require("vec3");

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
const report = {};
const step = (key, value) => {
  report[key] = value;
  console.error(`step ${key}: ${JSON.stringify(value)}`);
};
function offlineUuid(name) {
  const hash = createHash("md5").update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function download(url, sha256) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error(`sha256 mismatch for ${url}`);
  return bytes;
}
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`${label} timed out after ${ms} ms`);
    }),
  ]);

const gamePort = await freePort(),
  bedrockPort = await freePort();
const input = join(
  process.env.TMPDIR ?? "/tmp",
  `craftlayer-ai-world-${process.pid}.json`,
);
await writeFile(
  input,
  JSON.stringify({
    edition: "crossplay",
    port: gamePort,
    bedrock_port: bedrockPort,
  }),
);
const prepared = run(
  "node",
  ["--import", "tsx", "scripts/minecraft/playtest.ts", "prepare", input],
  { env: { ...process.env } },
);
await rm(input, { force: true });
const directory = JSON.parse(prepared).directory;
if (typeof directory !== "string" || !directory.startsWith("/"))
  throw new Error("Prepared bundle directory missing from preparation output");
const data = join(directory, "data");
const botName = "CL_AIPlayer";
let cleanup = async () => {};
let body;
let exitCode = 1;
try {
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
    `${JSON.stringify([{ uuid: offlineUuid(botName), name: botName }], null, 2)}\n`,
  );
  // Diagnostic only: compare against a server that speaks the bot's own version.
  const native = process.env.AI_PLAYER_NATIVE_SERVER === "1";
  if (native)
    await writeFile(
      join(directory, "runtime", "paper.jar"),
      await download(
        lock.native_diagnostic_server.url,
        lock.native_diagnostic_server.sha256,
      ),
    );
  for (const plugin of native ? [] : lock.server_plugins) {
    await writeFile(
      join(data, "plugins", plugin.filename),
      await download(plugin.url, plugin.sha256),
    );
  }
  step(
    "plugins",
    native ? [] : lock.server_plugins.map((p) => `${p.component} ${p.version}`),
  );
  const project = `craftlayer-aiworld-${process.pid}`;
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
    if (/\]: Done \(/.test(log)) break;
    if (Date.now() - started > 300000)
      throw new Error("Server did not become ready within 300 s");
    await delay(2000);
  }
  step("boot_seconds", Math.round((Date.now() - started) / 1000));
  const bootLog = await readFile(logPath, "utf8");
  step("via_loaded", {
    viaversion: /\[ViaVersion\] .*Enabling ViaVersion/i.test(bootLog),
    viabackwards: /\[ViaBackwards\] .*Enabling ViaBackwards/i.test(bootLog),
    geyser: /\[Geyser-Spigot\] .*Enabling Geyser/i.test(bootLog),
  });

  const { MinecraftBody, goals } = await import(
    "../apps/ai-player/dist/index.js"
  );
  body = await MinecraftBody.connect({
    host: "127.0.0.1",
    port: gamePort,
    username: botName,
    auth: "offline",
    version: lock.bot.protocol_version,
  });
  const bot = body.bot;
  step("spawned", {
    version: bot.version,
    position: bot.entity.position.floored().toString(),
    standing_on: bot.blockAt(bot.entity.position.offset(0, -1, 0))?.name,
    health: bot.health,
    food: bot.food,
    gameMode: bot.game.gameMode,
  });

  const heard = new Promise((resolve) =>
    bot.on("messagestr", (message) => {
      if (message.includes("CraftLayer AI player check")) resolve(message);
    }),
  );
  body.say("CraftLayer AI player check");
  step("chat_echo", await withTimeout(heard, 10000, "chat echo"));

  // Walk a square: four 6-block legs from wherever the bot spawned.
  const legs = [];
  for (const [dx, dz] of [
    [6, 0],
    [0, 6],
    [-6, 0],
    [0, -6],
  ]) {
    const from = bot.entity.position.clone();
    const result = await body.move(
      new goals.GoalNearXZ(from.x + dx, from.z + dz, 1.5),
      { deadlineMs: 45000, canDig: true },
    );
    legs.push({
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      attempts: result.attempts,
      corrections: result.corrections,
      walked: Number(bot.entity.position.distanceTo(from).toFixed(1)),
    });
  }
  step("moves", legs);
  const moved = legs.filter((l) => l.ok).length;
  if (moved < 3) throw new Error(`Only ${moved}/4 moves reached their goal`);

  const soft = ["dirt", "grass_block", "sand", "gravel", "stone"]
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id) => id !== undefined);
  const diggable = bot
    .findBlocks({ matching: soft, maxDistance: 4, count: 20 })
    .map((p) => bot.blockAt(p))
    .find(
      (b) => b && b.position.y < bot.entity.position.y && bot.canDigBlock(b),
    );
  if (!diggable) throw new Error("No diggable block within reach");
  const dugName = diggable.name;
  const dugAt = diggable.position.clone();
  await bot.lookAt(dugAt.offset(0.5, 0.5, 0.5));
  await withTimeout(bot.dig(diggable), 20000, "dig");
  step("dug", {
    block: dugName,
    at: dugAt.toString(),
    now: bot.blockAt(dugAt)?.name,
  });

  const drop = Object.values(bot.entities).find(
    (e) => e.name === "item" && e.position.distanceTo(dugAt) < 3,
  );
  if (drop)
    await body.move(
      new goals.GoalNear(
        drop.position.x,
        drop.position.y,
        drop.position.z,
        0.5,
      ),
      {
        deadlineMs: 10000,
      },
    );
  await delay(1500);
  step(
    "inventory",
    bot.inventory.items().map((i) => `${i.name}x${i.count}`),
  );
  const item = bot.inventory
    .items()
    .find((i) => ["dirt", "sand", "gravel", "cobblestone"].includes(i.name));
  if (!item) throw new Error("Nothing placeable was collected");
  await bot.equip(item, "hand");
  // Place on top of nearby ground, away from where the bot stands.
  const here = bot.entity.position;
  const support = bot
    .findBlocks({ matching: soft, maxDistance: 4, count: 40 })
    .map((p) => bot.blockAt(p))
    .find((b) => {
      if (b?.boundingBox !== "block") return false;
      const above = bot.blockAt(b.position.offset(0, 1, 0));
      const flat = Math.hypot(
        b.position.x + 0.5 - here.x,
        b.position.z + 0.5 - here.z,
      );
      return (
        above?.name === "air" &&
        flat >= 1.8 &&
        flat <= 3.5 &&
        Math.abs(b.position.y + 1 - here.y) <= 1
      );
    });
  if (!support) throw new Error("No free spot to place a block");
  const placeAt = support.position.offset(0, 1, 0);
  await bot.lookAt(placeAt.offset(0.5, 0.5, 0.5));
  await withTimeout(bot.placeBlock(support, new Vec3(0, 1, 0)), 15000, "place");
  await delay(500);
  const placed = bot.blockAt(placeAt);
  step("placed", {
    at: placeAt.toString(),
    block: placed?.name,
    item: item.name,
  });
  if (placed?.name !== item.name) throw new Error("Placed block not observed");
  step("total_server_corrections", body.corrections);
  body.quit("check complete");
  body = undefined;
  report.result = "PASS";
  exitCode = 0;
} catch (error) {
  report.result = "FAIL";
  report.error = String(error?.message ?? error);
  report.server_log_tail = (
    await readFile(join(data, "logs", "latest.log"), "utf8").catch(() => "")
  )
    .split("\n")
    .filter((l) => /CL_AIPlayer|Exception|ERROR/i.test(l))
    .slice(-15);
} finally {
  body?.quit();
  await cleanup();
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode);
}
