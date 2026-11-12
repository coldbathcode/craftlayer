import { lookup } from "node:dns/promises";
import type { NodeActionOffer } from "@craftlayer/contracts";
import {
  privateNodeAddress,
  protectedNodeFile,
} from "@craftlayer/node-protocol";
import { z } from "zod";
import type { ActionSettlement } from "./action-journal.js";
import {
  FileWhitelistStore,
  GameActions,
  openRcon,
  RconError,
  type RconSession,
  type WhitelistStore,
} from "./game-control/index.js";

/** One game server this node holds a private control channel for. Written by the
 * operator into the agent's read-only configuration; callers never choose any of it. */
export const gameServerConfig = z.strictObject({
  server_id: z.uuid(),
  /** A private address or a name on the internal control network. */
  rcon_host: z
    .string()
    .regex(/^[A-Za-z0-9]([A-Za-z0-9.:-]{0,61}[A-Za-z0-9])?$/),
  rcon_port: z.number().int().min(1).max(65535),
  rcon_password_file: z.string().startsWith("/"),
  whitelist_file: z.string().startsWith("/").endsWith("/whitelist.json"),
  floodgate_prefix: z.string().max(4).optional(),
  replace_spaces: z.boolean().optional(),
});
export type GameServerConfig = z.infer<typeof gameServerConfig>;
export interface GameChannel {
  open(): Promise<RconSession>;
  whitelist: WhitelistStore;
  options: { floodgatePrefix?: string; replaceSpaces?: boolean };
}
/** The real channel: RCON on a private address only, password read at use and never kept. */
export function gameChannel(config: GameServerConfig): GameChannel {
  return {
    async open() {
      const { address } = await lookup(config.rcon_host).catch(() => {
        throw new RconError("RCON_UNREACHABLE");
      });
      // The password travels in clear text, so the channel must stay off public networks.
      if (!privateNodeAddress(address)) throw new RconError("RCON_UNREACHABLE");
      const password = (
        await protectedNodeFile(config.rcon_password_file)
      ).trim();
      if (!password) throw new RconError("RCON_AUTH_FAILED");
      return openRcon({ host: address, port: config.rcon_port, password });
    },
    whitelist: new FileWhitelistStore(config.whitelist_file),
    options: {
      ...(config.floodgate_prefix !== undefined
        ? { floodgatePrefix: config.floodgate_prefix }
        : {}),
      ...(config.replace_spaces !== undefined
        ? { replaceSpaces: config.replace_spaces }
        : {}),
    },
  };
}
const flat = (detail: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(detail).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null ||
        ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
/**
 * Runs exactly one offered action through the typed game-control library and returns
 * the server's own words. Nothing here builds console text from caller input: the
 * request was validated by the controller, again by the offer schema, and each verb
 * validates its arguments once more. Failures are reported, never retried.
 */
export async function runServerAction(
  offer: NodeActionOffer,
  channel: GameChannel,
  now = Date.now(),
): Promise<ActionSettlement> {
  const request = offer.request;
  if (Date.parse(offer.expires_at) <= now)
    return {
      outcome: { ok: false, evidence: "Arrived after its deadline; not run." },
      failure: "interrupted",
    };
  if (
    request.kind === "start" ||
    request.kind === "stop" ||
    request.kind === "restart"
  )
    return {
      outcome: {
        ok: false,
        evidence: "This host cannot turn the server on or off yet.",
      },
      failure: "node_unavailable",
    };
  let session: RconSession | undefined;
  try {
    session = await channel.open();
    const game = new GameActions(session, channel.whitelist, channel.options);
    const result =
      request.kind === "allow_player"
        ? await game.allow(request.player)
        : request.kind === "revoke_player"
          ? await game.revoke(request.name)
          : request.kind === "kick_player"
            ? await game.kick(request.name, request.reason)
            : request.kind === "say"
              ? await game.say(request.message)
              : await game.saveAll();
    return {
      outcome: {
        ok: result.ok,
        evidence: result.evidence.slice(0, 2000),
        detail: flat(result.detail),
      },
      failure: result.ok
        ? null
        : request.kind === "kick_player"
          ? "refused_by_server"
          : "not_verified",
    };
  } catch (error) {
    if (error instanceof RconError)
      return {
        outcome: {
          ok: false,
          evidence: `The server's control channel did not answer (${error.code}).`,
        },
        failure: "server_unreachable",
      };
    const changed =
      error instanceof Error && error.message === "WHITELIST_CHANGED_MEANWHILE";
    return {
      outcome: {
        ok: false,
        evidence: changed
          ? "The allowlist changed while it was being updated; nothing was written."
          : "The action stopped unexpectedly on the host; check the server before trying again.",
      },
      failure: "interrupted",
    };
  } finally {
    await session?.close().catch(() => {});
  }
}
