import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  Assignment,
  HostApi,
  Observation,
  PlayerState,
} from "./api/client.js";
import { MinecraftBody } from "./body/body.js";
import { Brain } from "./brain/brain.js";
import { addressedText, isOwner, safeChat } from "./brain/chat.js";
import { eatBest, nearestHostile, skillsByName } from "./skills/skills.js";
import { describeSurroundings, observe, timeOfDay } from "./skills/world.js";

const RECONNECT_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const STATUS_MS = 5_000;
const PENDING_MS = 2_000;
const MEMORY_MS = 60_000;

export interface ControllerOptions {
  api: HostApi;
  /** Protected directory for Microsoft sign-in caches (mode 0700). */
  stateDir: string;
  log: (line: string) => void;
}

/**
 * Runs one AI player: its body in the game, its brain, the owner's chat, reflexes
 * and status reports. Stops at once when the assignment says not to run.
 */
export class PlayerController {
  #player: Assignment;
  readonly #options: ControllerOptions;
  #body: MinecraftBody | null = null;
  #brain: Brain;
  #running = false;
  #state: PlayerState = "connecting";
  #signIn: Observation["sign_in"] = null;
  #error: string | null = null;
  /** Set when the owner joined with the same account; cleared only by a new assignment version. */
  #pausedForVersion: number | null = null;
  #timers: NodeJS.Timeout[] = [];
  #reflexBusy = false;
  #lastHurt = 0;
  constructor(player: Assignment, options: ControllerOptions) {
    this.#player = player;
    this.#options = options;
    this.#brain = this.#newBrain();
  }
  get id() {
    return this.#player.id;
  }
  #newBrain() {
    return new Brain({
      player: this.#player,
      api: this.#options.api,
      senses: {
        inGameName: () => this.#body?.bot.username ?? this.#player.mc_username,
        surroundings: () =>
          this.#body ? describeSurroundings(this.#body.bot) : "Not connected.",
        ownerNames: () => this.#ownerNames(),
        ownerOnline: () => this.#ownerNames().length > 0,
        timeOfDay: () => (this.#body ? timeOfDay(this.#body.bot) : "day"),
      },
      hands: {
        run: async (name, args, signal) => {
          const body = this.#body;
          const skill = skillsByName.get(name);
          if (!body || !skill)
            return { ok: false, summary: "I'm not in the game right now." };
          return skill.run(
            {
              body,
              signal,
              say: (text) => this.#say(text),
              remember: async (memory) => {
                await this.#options.api.remember(this.#player.id, memory);
                await this.#refreshMemories();
              },
              activity: (text) => {
                this.#brain.activity = text;
              },
            },
            args,
          );
        },
        say: (text) => this.#say(text),
      },
    });
  }
  /** Owner identities currently in the game, by in-game name. */
  #ownerNames(): string[] {
    const bot = this.#body?.bot;
    if (!bot) return [];
    return Object.values(bot.players)
      .filter(
        (p) =>
          p.username !== bot.username &&
          isOwner(this.#player.instructors, p.username, p.uuid),
      )
      .map((p) => p.username);
  }
  #say(text: string) {
    const line = safeChat(text);
    if (line && this.#body?.connected) this.#body.say(line);
  }

  async start() {
    if (this.#running) return;
    this.#running = true;
    this.#timers.push(setInterval(() => void this.#report(), STATUS_MS));
    this.#timers.push(
      setInterval(() => void this.#pollInstructions(), PENDING_MS),
    );
    this.#timers.push(
      setInterval(() => void this.#refreshMemories(), MEMORY_MS),
    );
    this.#timers.push(setInterval(() => void this.#reflexes(), 1000));
    void this.#refreshMemories();
    void this.#lifecycle();
    void this.#think();
  }
  /** Applies a new assignment. Returns false when the player must stop. */
  update(player: Assignment): boolean {
    const versionChanged = player.version !== this.#player.version;
    this.#player = player;
    this.#brain.setAssignment(player);
    if (
      versionChanged &&
      this.#pausedForVersion !== null &&
      this.#pausedForVersion !== player.version
    )
      this.#pausedForVersion = null;
    return player.run;
  }
  async stop(reason = "Stopped by CraftLayer.") {
    if (!this.#running) return;
    this.#running = false;
    this.#brain.stop();
    for (const t of this.#timers) clearInterval(t);
    this.#timers = [];
    this.#body?.quit(reason);
    this.#body = null;
    this.#state = "stopped";
    await this.#flush();
    await this.#options.api
      .report(this.#player.id, "stopped", this.#observation("Stopped"))
      .catch(() => {});
  }

  async #lifecycle() {
    let attempt = 0;
    while (this.#running) {
      if (this.#pausedForVersion !== null) {
        await delay(2000);
        continue;
      }
      try {
        this.#state = "connecting";
        this.#error = null;
        await this.#report();
        const body = await this.#connect();
        if (!this.#running) {
          body.quit();
          return;
        }
        this.#body = body;
        this.#state = "online";
        this.#signIn = null;
        attempt = 0;
        this.#brain.note(`Joined the game as ${body.bot.username}.`);
        await this.#report();
        const reason = await new Promise<string>((resolve) => {
          body.once("kicked", (why) => resolve(`kicked: ${why}`));
          body.once("ended", (why) => resolve(`ended: ${why}`));
        });
        this.#body = null;
        if (!this.#running) return;
        if (/duplicate_login|logged in from another location/i.test(reason)) {
          // The owner is using the account. Never reconnect over them.
          this.#pausedForVersion = this.#player.version;
          this.#state = "offline";
          this.#error =
            "Your account signed in elsewhere. Start me again from CraftLayer when you're done.";
          this.#brain.note(
            "My account was used elsewhere, so I left the game and will wait.",
          );
          await this.#report();
          continue;
        }
        this.#brain.note(`Left the game (${reason.slice(0, 120)}).`);
      } catch (error) {
        this.#error =
          error instanceof Error
            ? error.message.slice(0, 200)
            : "Could not connect.";
        this.#options.log(
          `player ${this.#player.id}: connect failed: ${this.#error}`,
        );
      }
      if (!this.#running) return;
      this.#state = attempt >= RECONNECT_MS.length ? "error" : "offline";
      await this.#report();
      await delay(
        RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)] ?? 120_000,
      );
      attempt++;
    }
  }
  async #connect(): Promise<MinecraftBody> {
    const p = this.#player;
    const client: Record<string, unknown> = {};
    if (p.mc_auth === "microsoft") {
      const dir = join(this.#options.stateDir, "microsoft", p.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      client.profilesFolder = dir;
      client.onMsaCode = (data: {
        user_code: string;
        verification_uri: string;
        expires_in: number;
      }) => {
        this.#state = "sign_in_required";
        this.#signIn = {
          url: data.verification_uri,
          code: data.user_code,
          expires_at: new Date(
            Date.now() + data.expires_in * 1000,
          ).toISOString(),
        };
        void this.#report();
      };
    }
    const body = await MinecraftBody.connect({
      host: p.game_host,
      port: p.game_port,
      username: p.mc_username,
      version: p.game_version,
      auth: p.mc_auth,
      client,
      spawnTimeoutMs: p.mc_auth === "microsoft" ? 15 * 60_000 : 60_000,
    });
    body.on(
      "chat",
      (username, message) => void this.#chat(username, message, false),
    );
    body.on(
      "whisper",
      (username, message) => void this.#chat(username, message, true),
    );
    body.on("died", () => {
      const pos = body.bot.entity?.position;
      this.#brain.note(
        `I died${pos ? ` near ${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}` : ""}.`,
      );
    });
    body.bot.on("entityHurt", (entity) => {
      if (entity === body.bot.entity) this.#lastHurt = Date.now();
    });
    return body;
  }
  async #chat(username: string, message: string, whisper: boolean) {
    const bot = this.#body?.bot;
    if (!bot) return;
    const uuid = bot.players[username]?.uuid;
    if (!isOwner(this.#player.instructors, username, uuid)) return;
    const text = whisper
      ? message.trim()
      : addressedText(message, [
          this.#player.name,
          bot.username,
          this.#player.mc_username,
        ]);
    if (!text) return;
    await this.#options.api
      .ownerChat(this.#player.id, username, text)
      .catch(() => {});
    this.#brain.instruct(text, username, "game");
  }
  async #pollInstructions() {
    if (!this.#running) return;
    try {
      for (const i of await this.#options.api.pending(this.#player.id))
        this.#brain.instruct(
          i.body,
          i.author,
          i.channel === "mcp" ? "mcp" : "dashboard",
        );
    } catch (error) {
      this.#options.log(
        `player ${this.#player.id}: pending failed: ${String(error)}`,
      );
    }
    await this.#flush();
  }
  async #refreshMemories() {
    try {
      this.#brain.setMemories(
        await this.#options.api.memories(this.#player.id),
      );
    } catch {}
  }
  async #think() {
    while (this.#running) {
      if (!this.#body?.connected) {
        await delay(1000);
        continue;
      }
      let outcome: "busy" | "idle" = "idle";
      try {
        outcome = await this.#brain.tick();
      } catch (error) {
        this.#options.log(
          `player ${this.#player.id}: brain error: ${String(error)}`,
        );
      }
      if (this.#brain.state === "stopped") {
        await this.stop("CraftLayer stopped me.");
        return;
      }
      await this.#flush();
      await delay(outcome === "busy" ? 200 : 1000);
    }
  }
  /** Reflexes need no model: eat when hungry, defend when hurt and idle. */
  async #reflexes() {
    const body = this.#body;
    if (!body?.connected || this.#reflexBusy) return;
    this.#reflexBusy = true;
    try {
      const bot = body.bot;
      if (bot.food <= 14 && !bot.usingHeldItem) await eatBest(bot);
      if (!this.#brain.goal && Date.now() - this.#lastHurt < 5000) {
        const target = nearestHostile(bot, 4);
        if (target) bot.attack(target);
      }
    } catch {
    } finally {
      this.#reflexBusy = false;
    }
  }
  #observation(activity: string): Observation {
    const base = this.#body?.connected
      ? observe(this.#body.bot, activity)
      : {
          position: null,
          health: null,
          food: null,
          dimension: null,
          time_of_day: null,
          activity,
          inventory: [],
          nearby_players: [],
          sign_in: null,
          error: null,
        };
    return { ...base, sign_in: this.#signIn, error: this.#error };
  }
  async #report() {
    const state: PlayerState =
      this.#brain.state === "out_of_budget" && this.#state === "online"
        ? "out_of_budget"
        : this.#state;
    await this.#options.api
      .report(this.#player.id, state, this.#observation(this.#brain.activity))
      .catch(() => {});
  }
  async #flush() {
    const messages = this.#brain.drain();
    if (!messages.length) return;
    await this.#options.api.post(this.#player.id, messages).catch((error) => {
      this.#options.log(
        `player ${this.#player.id}: post failed: ${String(error)}`,
      );
    });
  }
}
