import { open } from "node:fs/promises";
import type { NodeKnock, ServerPower } from "@craftlayer/contracts";
import type { GameChannel } from "./action-runner.js";
import { GameActions, parseKnocks } from "./game-control/index.js";

export interface ServerStatus {
  power: ServerPower;
  online: number | null;
  max_players: number | null;
  players: string[] | null;
  knocks: NodeKnock[];
}
const NAME = /^\.?[A-Za-z0-9_]{1,16}$/,
  KNOCK_BYTES = 2 * 1024 * 1024;
/** The tail of the Knock plugin's file (ADR 0037), newest twenty accounts. A missing or
 * unreadable file simply means nobody is asking. */
export async function readKnocks(
  path: string,
  now = Date.now(),
): Promise<NodeKnock[]> {
  let text: string;
  try {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat(),
        length = Math.min(size, KNOCK_BYTES),
        buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      text = buffer.toString("utf8");
    } finally {
      await file.close();
    }
  } catch {
    return [];
  }
  return parseKnocks(text, now)
    .slice(-20)
    .map((k) => ({
      account_uuid: k.uuid,
      name: k.name,
      edition: k.edition,
      xuid: k.xuid,
      first_at: new Date(k.first_at).toISOString(),
      last_at: new Date(k.last_at).toISOString(),
      attempts: Math.min(k.attempts, 100000),
    }));
}
/**
 * What this node sees of one server right now (master plan A2, ADR 0046). "On" means
 * the server itself answered and named its players. When it does not answer, the
 * container's state (if this node may see it) tells off from still starting; without
 * that the honest answer is unknown.
 */
export async function readStatus(
  channel: GameChannel,
  knockFile?: string,
  now = Date.now(),
): Promise<ServerStatus> {
  const knocks = knockFile ? await readKnocks(knockFile, now) : [];
  let session: Awaited<ReturnType<GameChannel["open"]>> | undefined;
  try {
    session = await channel.open();
    const { detail } = await new GameActions(
      session,
      channel.whitelist,
      channel.options,
    ).players();
    return {
      power: "on",
      online: detail.online,
      max_players: detail.max,
      // Only names the contract can carry; the count stays the server's own.
      players: detail.names.filter((n) => NAME.test(n)).slice(0, 100),
      knocks,
    };
  } catch {
    let power: ServerPower = "unknown";
    try {
      if (channel.power)
        power = (await channel.power.running()) ? "starting" : "off";
    } catch {
      power = "unknown";
    }
    return { power, online: null, max_players: null, players: null, knocks };
  } finally {
    await session?.close().catch(() => {});
  }
}
