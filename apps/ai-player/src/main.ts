import { readFile, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { HostClient } from "./api/client.js";
import { PlayerController } from "./controller.js";

/**
 * The AI player worker host (master plan G4). Reads its one host token, asks
 * CraftLayer which AI players to run, and runs each one's body and brain. It holds
 * no provider keys and no server-control rights; Stop takes effect on the next poll.
 *
 *   CRAFTLAYER_API_URL=http://127.0.0.1:3001 \
 *   CRAFTLAYER_AI_PLAYER_TOKEN_FILE=~/.craftlayer/ai-player-host.token \
 *   CRAFTLAYER_AI_PLAYER_STATE_DIR=~/.craftlayer/ai-player-state \
 *   node apps/ai-player/dist/main.js
 */
const log = (line: string) =>
  console.error(`${new Date().toISOString()} ${line}`);
async function protectedToken(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error(
      "The host token file must be a regular file readable only by its owner (chmod 600).",
    );
  return (await readFile(path, "utf8")).trim();
}

const apiUrl = process.env.CRAFTLAYER_API_URL;
const tokenFile = process.env.CRAFTLAYER_AI_PLAYER_TOKEN_FILE;
const stateDir = process.env.CRAFTLAYER_AI_PLAYER_STATE_DIR;
if (!apiUrl || !tokenFile || !stateDir) {
  console.error(
    "Set CRAFTLAYER_API_URL, CRAFTLAYER_AI_PLAYER_TOKEN_FILE (chmod 600) and CRAFTLAYER_AI_PLAYER_STATE_DIR.",
  );
  process.exit(2);
}
const api = new HostClient(apiUrl, await protectedToken(tokenFile));
const controllers = new Map<string, PlayerController>();
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping all AI players`);
  await Promise.allSettled(
    [...controllers.values()].map((c) =>
      c.stop("The AI player host is shutting down."),
    ),
  );
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

log("AI player host started");
let failures = 0;
while (!stopping) {
  let pollAfter = 2000;
  try {
    const { players, poll_after_ms } = await api.assignments();
    pollAfter = poll_after_ms;
    failures = 0;
    const seen = new Set<string>();
    for (const player of players) {
      seen.add(player.id);
      const existing = controllers.get(player.id);
      if (existing) {
        if (!existing.update(player)) {
          controllers.delete(player.id);
          await existing.stop("Stopped from CraftLayer.");
          log(`stopped ${player.name}`);
        }
      } else if (player.run) {
        const controller = new PlayerController(player, { api, stateDir, log });
        controllers.set(player.id, controller);
        await controller.start();
        log(`started ${player.name}`);
      }
    }
    for (const [id, controller] of controllers)
      if (!seen.has(id)) {
        controllers.delete(id);
        await controller.stop("No longer assigned to this host.");
      }
  } catch (error) {
    failures++;
    log(
      `assignments failed (${failures}): ${error instanceof Error ? error.message : String(error)}`,
    );
    // Without contact for 20 s, stop acting: control must be renewable to continue.
    if (failures * pollAfter >= 20_000)
      for (const [id, controller] of controllers) {
        controllers.delete(id);
        await controller.stop("Lost contact with CraftLayer.");
      }
  }
  await delay(pollAfter);
}
