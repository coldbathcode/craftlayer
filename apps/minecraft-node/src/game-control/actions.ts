import { z } from "zod";
import { floodgateName, floodgateUuid } from "./floodgate.js";
import { RconError, type RconSession } from "./rcon.js";
import type { WhitelistEntry, WhitelistStore } from "./whitelist.js";

/** Typed game actions. Callers never pass console text; every verb is fixed here and
 * every argument is validated. Results carry the server's own words as evidence. */
export const playerName = z.string().regex(/^\.?[A-Za-z0-9_]{1,16}$/);
const message = z
  .string()
  .trim()
  .min(1)
  .max(256)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: chat must not carry control or formatting characters
  .regex(/^[^\u0000-\u001f\u007f§]+$/)
  .refine((v) => !v.startsWith("/"), "Messages cannot start a command");
export const allowRequest = z.discriminatedUnion("edition", [
  z.strictObject({ edition: z.literal("java"), name: playerName }),
  z.strictObject({
    edition: z.literal("bedrock"),
    gamertag: z.string(),
    xuid: z.string(),
  }),
]);
export type AllowRequest = z.infer<typeof allowRequest>;
export interface ActionResult<T = Record<string, never>> {
  ok: boolean;
  /** Exactly what the server answered, bounded; never a secret. */
  evidence: string;
  detail: T;
}
export interface GameControlOptions {
  floodgatePrefix?: string;
  replaceSpaces?: boolean;
}
export class GameActions {
  constructor(
    private readonly rcon: RconSession,
    private readonly whitelist: WhitelistStore,
    private readonly options: GameControlOptions = {},
  ) {}
  async #run(text: string) {
    const r = await this.rcon.command(text);
    return r.body.replace(/§./g, "").trim().slice(0, 2000);
  }
  /** `list` → "There are 2 of a max of 5 players online: a, b" */
  async players(): Promise<
    ActionResult<{ online: number; max: number; names: string[] }>
  > {
    const evidence = await this.#run("list");
    const m =
      /^There are (\d+) of a max(?: of)? (\d+) players online:?\s*(.*)$/s.exec(
        evidence,
      );
    if (!m) throw new RconError("RCON_PROTOCOL");
    const names = (m[3] ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    return {
      ok: true,
      evidence,
      detail: { online: Number(m[1]), max: Number(m[2]), names },
    };
  }
  /** Java players go through the server's own online lookup; Bedrock players are written
   * with their Floodgate UUID, then the server reloads. Either way the result is verified
   * against `whitelist list`, not assumed from the reply text. */
  async allow(
    input: AllowRequest,
  ): Promise<ActionResult<{ name: string; uuid: string | null }>> {
    const value = allowRequest.parse(input);
    if (value.edition === "java") {
      const evidence = await this.#run(`whitelist add ${value.name}`);
      const listed = await this.#listed(value.name);
      return {
        ok: listed,
        evidence,
        detail: { name: value.name, uuid: null },
      };
    }
    const name = floodgateName(value.gamertag, {
        ...(this.options.floodgatePrefix !== undefined
          ? { prefix: this.options.floodgatePrefix }
          : {}),
        ...(this.options.replaceSpaces !== undefined
          ? { replaceSpaces: this.options.replaceSpaces }
          : {}),
      }),
      uuid = floodgateUuid(value.xuid);
    const previous = await this.whitelist.read();
    const entries: WhitelistEntry[] = [
      ...previous.filter((e) => e.uuid !== uuid),
      { uuid, name },
    ];
    if (!(await this.whitelist.write(previous, entries)))
      throw new Error("WHITELIST_CHANGED_MEANWHILE");
    const reloaded = await this.#reloadUntil(() => this.#listed(name));
    return {
      ok: reloaded.ok,
      evidence: reloaded.evidence,
      detail: { name, uuid },
    };
  }
  /** The server re-reads the file on reload, but a freshly renamed file can lag behind on
   * some mounts (observed on macOS Docker Desktop). Reload and verify a few times rather
   * than trusting one reply. */
  async #reloadUntil(check: () => Promise<boolean>) {
    let evidence = "";
    for (const wait of [0, 300, 700, 1500]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      evidence = await this.#run("whitelist reload");
      if (await check()) return { ok: true, evidence };
    }
    return { ok: false, evidence };
  }
  async revoke(
    name: string,
  ): Promise<ActionResult<{ name: string; removed: boolean }>> {
    const value = playerName.parse(name);
    if (value.startsWith(".")) {
      const previous = await this.whitelist.read();
      const entries = previous.filter(
        (e) => e.name.toLowerCase() !== value.toLowerCase(),
      );
      if (
        entries.length !== previous.length &&
        !(await this.whitelist.write(previous, entries))
      )
        throw new Error("WHITELIST_CHANGED_MEANWHILE");
      const reloaded = await this.#reloadUntil(
        async () => !(await this.#listed(value)),
      );
      return {
        ok: reloaded.ok,
        evidence: reloaded.evidence,
        detail: { name: value, removed: reloaded.ok },
      };
    }
    const evidence = await this.#run(`whitelist remove ${value}`);
    const stillListed = await this.#listed(value);
    return {
      ok: !stillListed,
      evidence,
      detail: { name: value, removed: !stillListed },
    };
  }
  async kick(
    name: string,
    reason = "Removed by a family manager",
  ): Promise<ActionResult<{ name: string; wasOnline: boolean }>> {
    const value = playerName.parse(name),
      why = message.max(100).parse(reason);
    const evidence = await this.#run(`kick ${value} ${why}`);
    const wasOnline = /^Kicked /i.test(evidence);
    // Kicking someone who is not online is a no-op the server reports as an unknown name.
    const ok = wasOnline || /Invalid name|No player was found/i.test(evidence);
    return { ok, evidence, detail: { name: value, wasOnline } };
  }
  async say(text: string): Promise<ActionResult> {
    const value = message.parse(text);
    const evidence = await this.#run(`say ${value}`);
    return { ok: true, evidence, detail: {} };
  }
  /** Flushes the world to disk; the precondition for any consistent backup. */
  async saveAll(): Promise<ActionResult<{ saved: boolean }>> {
    const evidence = await this.#run("save-all flush");
    const saved = /Saved the game/i.test(evidence);
    return { ok: saved, evidence, detail: { saved } };
  }
  async pauseSaving(pause: boolean): Promise<ActionResult> {
    const evidence = await this.#run(pause ? "save-off" : "save-on");
    return { ok: true, evidence, detail: {} };
  }
  /** Graceful stop: the server saves and exits; the socket closes as a result. */
  async stop(): Promise<ActionResult<{ stopping: boolean }>> {
    let evidence = "";
    try {
      evidence = await this.#run("stop");
    } catch (error) {
      if (!(error instanceof RconError && error.code === "RCON_CLOSED"))
        throw error;
      evidence = "(connection closed by the stopping server)";
    }
    return { ok: true, evidence, detail: { stopping: true } };
  }
  async #listed(name: string) {
    const evidence = await this.#run("whitelist list");
    const m = /player(?:s|\(s\))?:\s*(.*)$/s.exec(evidence);
    const names = (m?.[1] ?? "")
      .split(",")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    return names.includes(name.toLowerCase());
  }
}
