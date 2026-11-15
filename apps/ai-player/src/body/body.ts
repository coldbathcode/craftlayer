import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import mineflayer, { type Bot, type BotOptions } from "mineflayer";
import pathfinderPackage from "mineflayer-pathfinder";
import {
  CorrectionGuard,
  type CorrectionGuardOptions,
  defaultCorrectionGuard,
} from "./correction-guard.js";
import { installTickEndShim, type PacketWriter } from "./protocol.js";

const { pathfinder, Movements, goals } = pathfinderPackage;
export type Goal = InstanceType<typeof goals.GoalBlock>;
export { goals };

export interface BodyConnection {
  host: string;
  port: number;
  username: string;
  /** Protocol the bot speaks; the server may translate (ViaBackwards). */
  version: string;
  auth: "offline" | "microsoft";
  /** Extra client options (for example the Microsoft session cache). */
  client?: Partial<BotOptions>;
  spawnTimeoutMs?: number;
}

export type MoveFailure = "stuck" | "no_path" | "timeout" | "stopped";
export type MoveResult =
  | { ok: true; attempts: number; corrections: number }
  | { ok: false; reason: MoveFailure; attempts: number; corrections: number };

export interface MoveOptions {
  deadlineMs?: number;
  signal?: AbortSignal;
  /** Allow breaking blocks on the way (the pathfinder digs through). */
  canDig?: boolean;
  maxRecoveries?: number;
}

export interface BodyEvents {
  chat: [username: string, message: string];
  whisper: [username: string, message: string];
  ended: [reason: string];
  kicked: [reason: string];
  died: [];
}

/**
 * The AI player's body: one Mineflayer session with the protocol fixes and the
 * stuck-loop recovery applied. It has no operator rights and sends no commands.
 */
export class MinecraftBody extends EventEmitter<BodyEvents> {
  readonly bot: Bot;
  readonly #guard: CorrectionGuard;
  #ended = false;
  private constructor(bot: Bot, guard: CorrectionGuardOptions) {
    super();
    this.bot = bot;
    this.#guard = new CorrectionGuard(guard);
    bot.on("forcedMove", () => this.#guard.record(Date.now()));
    bot.on("chat", (username, message) => {
      if (username !== bot.username) this.emit("chat", username, message);
    });
    bot.on("whisper", (username, message) => {
      if (username !== bot.username) this.emit("whisper", username, message);
    });
    bot.on("death", () => {
      this.emit("died");
    });
    bot.on("kicked", (reason) => {
      this.emit("kicked", describeReason(reason));
    });
    bot.on("end", (reason) => {
      this.#ended = true;
      this.emit("ended", String(reason));
    });
  }

  static async connect(
    connection: BodyConnection,
    guard: CorrectionGuardOptions = defaultCorrectionGuard,
  ): Promise<MinecraftBody> {
    const bot = mineflayer.createBot({
      ...connection.client,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      version: connection.version,
      auth: connection.auth,
      hideErrors: true,
    });
    installTickEndShim(bot._client as unknown as PacketWriter);
    matchServerHitbox(bot);
    bot.loadPlugin(pathfinder);
    const body = new MinecraftBody(bot, guard);
    const timeout = connection.spawnTimeoutMs ?? 60000;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("SPAWN_TIMEOUT")),
          timeout,
        );
        bot.once("spawn", () => {
          clearTimeout(timer);
          resolve();
        });
        bot.once("kicked", (reason) => {
          clearTimeout(timer);
          reject(new Error(`KICKED: ${describeReason(reason)}`));
        });
        bot.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        bot.once("end", (reason) => {
          clearTimeout(timer);
          reject(new Error(`ENDED: ${String(reason)}`));
        });
      });
      await body.#waitForGround(45000);
    } catch (error) {
      bot.quit();
      throw error;
    }
    return body;
  }

  get connected(): boolean {
    return !this.#ended;
  }
  get corrections(): number {
    return this.#guard.total;
  }

  async #waitForGround(ms: number): Promise<void> {
    const start = Date.now();
    while (!this.bot.blockAt(this.bot.entity.position.offset(0, -1, 0))) {
      if (Date.now() - start > ms) throw new Error("WORLD_NOT_LOADED");
      await delay(250);
    }
  }

  /** Release every control and cancel any path. Safe to call at any time. */
  halt(): void {
    this.bot.pathfinder?.stop();
    this.bot.pathfinder?.setGoal(null);
    this.bot.clearControlStates();
  }

  /**
   * Walk to a goal. Recovers from the server correction loop by letting go of
   * the controls so the bot settles, then retrying, at most `maxRecoveries` times.
   */
  async move(goal: Goal, options: MoveOptions = {}): Promise<MoveResult> {
    const movements = new Movements(this.bot);
    movements.canDig = options.canDig ?? false;
    movements.allowParkour = false;
    this.bot.pathfinder.setMovements(movements);
    const deadline = Date.now() + (options.deadlineMs ?? 60000);
    const maxRecoveries = options.maxRecoveries ?? 3;
    const startCorrections = this.#guard.total;
    let attempts = 0;
    const result = (
      outcome: { ok: true } | { ok: false; reason: MoveFailure },
    ): MoveResult => ({
      ...outcome,
      attempts,
      corrections: this.#guard.total - startCorrections,
    });
    while (attempts <= maxRecoveries) {
      attempts++;
      this.#guard.reset();
      const outcome = await this.#attempt(goal, deadline, options.signal);
      if (outcome === "reached") return result({ ok: true });
      this.halt();
      if (outcome !== "stuck") return result({ ok: false, reason: outcome });
      if (Date.now() >= deadline)
        return result({ ok: false, reason: "timeout" });
      // Let the bot fall and settle before trying again.
      await delay(1200);
      this.#guard.reset();
    }
    return result({ ok: false, reason: "stuck" });
  }

  async #attempt(
    goal: Goal,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<"reached" | MoveFailure> {
    let settle: (value: "reached" | MoveFailure) => void = () => {};
    const done = new Promise<"reached" | MoveFailure>((resolve) => {
      settle = resolve;
    });
    const watch = setInterval(() => {
      const now = Date.now();
      if (signal?.aborted || this.#ended) settle("stopped");
      else if (this.#guard.looping(now)) settle("stuck");
      else if (now >= deadline) settle("timeout");
    }, 100);
    this.bot.pathfinder
      .goto(goal)
      .then(() => settle("reached"))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        settle(/no path|NoPath/i.test(message) ? "no_path" : "stopped");
      });
    try {
      return await done;
    } finally {
      clearInterval(watch);
    }
  }

  say(text: string): void {
    this.bot.chat(text);
  }

  quit(reason = "CraftLayer stopped the AI player"): void {
    this.halt();
    if (!this.#ended) this.bot.quit(reason);
  }
}

/**
 * The game's player width is the float 0.6F, so the server's half-width is
 * (double) 0.6F / 2 = 0.30000001192092896, not 0.3. With 0.3 the bot can stand
 * flush against a block that the server's box overlaps by ~1.2e-8, and every
 * jump from there is corrected (mineflayer issue #3911). Applied once physics
 * exists; `bot.physics` is created by the physics plugin at login.
 */
export const SERVER_PLAYER_HALF_WIDTH = Math.fround(0.6) / 2;
function matchServerHitbox(bot: Bot): void {
  const apply = () => {
    const physics = (
      bot as unknown as { physics?: { playerHalfWidth: number } }
    ).physics;
    if (physics) physics.playerHalfWidth = SERVER_PLAYER_HALF_WIDTH;
  };
  apply();
  bot.once("login", apply);
  bot.once("spawn", apply);
}

function describeReason(reason: unknown): string {
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason).slice(0, 300);
  } catch {
    return "unknown";
  }
}
