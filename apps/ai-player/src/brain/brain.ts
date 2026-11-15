import { randomUUID } from "node:crypto";
import type {
  Assignment,
  HostApi,
  MasterTask,
  Memory,
  Thought,
  WorkerMessage,
} from "../api/client.js";
import { Refused } from "../api/client.js";
import {
  type SkillResult,
  skillsByName,
  toolSchemas,
} from "../skills/skills.js";
import { relevantMemories } from "./chat.js";
import {
  MAX_INPUT_BOUND,
  requestBound,
  systemPrompt,
  turnPrompt,
} from "./prompt.js";

/** What the brain can sense; the controller backs this with the live game. */
export interface Senses {
  inGameName(): string;
  surroundings(): string;
  ownerNames(): string[];
  ownerOnline(): boolean;
  timeOfDay(): "day" | "night";
}
/** What the brain can do; every game effect goes through a validated skill. */
export interface Hands {
  run(skill: string, args: unknown, signal: AbortSignal): Promise<SkillResult>;
  say(text: string): void;
}
export type BrainState = "idle" | "working" | "out_of_budget" | "stopped";
interface Goal {
  text: string;
  source: string;
  channel: "game" | "dashboard" | "mcp" | "player";
  task?: string;
  turns: number;
  repairs: number;
  failures: number;
}

const MAX_TURNS = 12;
const MAX_CALLS_PER_TURN = 3;
const MAX_EVENTS = 16;
const IDLE_GAP_MS = 30_000;
const TASK_COOLDOWN_MS = 5 * 60_000;
const BUDGET_RETRY_MS = 10 * 60_000;
const short = (value: unknown, max = 120) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

export class Brain {
  #player: Assignment;
  readonly #api: HostApi;
  readonly #senses: Senses;
  readonly #hands: Hands;
  readonly #now: () => number;
  #queue: Array<{ text: string; author: string; channel: Goal["channel"] }> =
    [];
  #goal: Goal | null = null;
  #events: string[] = [];
  #outbox: WorkerMessage[] = [];
  #memories: Memory[] = [];
  #abort = new AbortController();
  #state: BrainState = "idle";
  #activity = "Idle";
  #nextIdleAt = 0;
  #cooldown = new Map<string, number>();
  #retryAt = 0;
  #pauseUntil = 0;
  #warned = false;
  constructor(options: {
    player: Assignment;
    api: HostApi;
    senses: Senses;
    hands: Hands;
    now?: () => number;
  }) {
    this.#player = options.player;
    this.#api = options.api;
    this.#senses = options.senses;
    this.#hands = options.hands;
    this.#now = options.now ?? Date.now;
  }
  get state(): BrainState {
    return this.#state;
  }
  get activity(): string {
    return this.#activity;
  }
  set activity(text: string) {
    this.#activity = text.slice(0, 160);
  }
  get goal(): string | null {
    return this.#goal?.text ?? null;
  }
  setAssignment(player: Assignment) {
    this.#player = player;
  }
  setMemories(memories: Memory[]) {
    this.#memories = memories;
  }
  /** Something worth a line in the model's recent events and in the transcript. */
  note(event: string, post = true) {
    this.#remember(event);
    if (post)
      this.#outbox.push({
        direction: "event",
        channel: "player",
        author: this.#player.name,
        body: event,
      });
  }
  /** Takes the queued transcript entries for the controller to send. */
  drain(): WorkerMessage[] {
    return this.#outbox.splice(0, this.#outbox.length);
  }
  /** An instruction from the owner. It interrupts whatever the player is doing. */
  instruct(text: string, author: string, channel: Goal["channel"]) {
    this.#queue.push({ text: text.slice(0, 2000), author, channel });
    this.#abort.abort();
  }
  stop() {
    this.#state = "stopped";
    this.#abort.abort();
  }

  /** One step: start a queued instruction, take one turn on the goal, or pick a standing task. */
  async tick(): Promise<"busy" | "idle"> {
    if (this.#state === "stopped") return "idle";
    if (this.#now() < this.#pauseUntil && !this.#queue.length) return "idle";
    const next = this.#queue.shift();
    if (next) {
      if (this.#goal)
        this.#remember(
          `New instruction replaced the goal "${short(this.#goal.text, 80)}".`,
        );
      this.#abort = new AbortController();
      this.#goal = {
        text: next.text,
        source: `instruction from ${next.author} via ${next.channel}`,
        channel: next.channel,
        turns: 0,
        repairs: 0,
        failures: 0,
      };
      this.#remember(`${next.author} said: "${short(next.text, 300)}"`);
      if (this.#state === "out_of_budget" && this.#now() < this.#retryAt) {
        this.#reply(
          "I've reached my spending limit for now, so I can't think about that yet.",
        );
        this.#goal = null;
        return "idle";
      }
    }
    if (!this.#goal) {
      const task = this.#pickTask();
      if (!task) {
        this.#activity = "Idle";
        if (this.#state === "working") this.#state = "idle";
        return "idle";
      }
      this.#abort = new AbortController();
      this.#goal = {
        text: `${task.goal} Do a useful chunk of work (a few minutes), then call finish.`,
        source: `standing task "${task.title}"`,
        channel: "player",
        task: task.id,
        turns: 0,
        repairs: 0,
        failures: 0,
      };
    }
    if (this.#state === "out_of_budget" && this.#now() < this.#retryAt) {
      this.#goal = null;
      return "idle";
    }
    this.#state = "working";
    await this.#turn(this.#goal);
    return "busy";
  }

  #pickTask(): MasterTask | null {
    const now = this.#now();
    if (now < this.#nextIdleAt) return null;
    const online = this.#senses.ownerOnline(),
      time = this.#senses.timeOfDay();
    const task =
      this.#player.tasks
        .filter((t) => t.enabled && (this.#cooldown.get(t.id) ?? 0) <= now)
        .filter(
          (t) =>
            t.condition === "always" ||
            (t.condition === "owner_online" && online) ||
            t.condition === time,
        )
        .sort((a, b) => b.priority - a.priority)[0] ?? null;
    this.#nextIdleAt = now + IDLE_GAP_MS;
    return task;
  }

  async #turn(goal: Goal) {
    goal.turns++;
    const trigger =
      goal.turns === 1
        ? goal.task
          ? "Nobody is instructing you. Work on this standing task."
          : "Your owner just gave you the instruction above. Decide what to do."
        : "Continue with the goal, using the results of your last actions above.";
    const system = systemPrompt(this.#player, this.#senses.inGameName()).slice(
      0,
      6000,
    );
    const tools = toolSchemas();
    const surroundings = this.#senses.surroundings().slice(0, 1800);
    const memories = relevantMemories(this.#memories, goal.text);
    // Keep the request inside the router's byte-counted bound: drop the oldest events first.
    let events = this.#events.slice(),
      content = "",
      messages: Array<{ role: "system" | "user"; content: string }> = [];
    for (;;) {
      content = turnPrompt({
        goal: { text: goal.text.slice(0, 1500), source: goal.source },
        trigger,
        surroundings,
        events,
        memories,
        tasks: this.#player.tasks.filter((t) => t.enabled).slice(0, 12),
        ownerNames: this.#senses.ownerNames(),
        ownerOnline: this.#senses.ownerOnline(),
        idle: !!goal.task,
      });
      messages = [
        { role: "system", content: system },
        { role: "user", content },
      ];
      if (requestBound(messages, tools) <= MAX_INPUT_BOUND || !events.length)
        break;
      events = events.slice(1);
    }
    if (requestBound(messages, tools) > MAX_INPUT_BOUND) {
      messages[1] = { role: "user", content: content.slice(0, 4000) };
    }
    let thought: Thought;
    this.#activity =
      goal.turns === 1 ? "Thinking about what to do" : this.#activity;
    try {
      thought = await this.#api.think(this.#player.id, {
        request_id: randomUUID(),
        messages,
        max_input_tokens: Math.min(
          MAX_INPUT_BOUND,
          requestBound(messages, tools) + 64,
        ),
        max_output_tokens: 700,
        tools,
      });
    } catch (error) {
      this.#refused(goal, error);
      return;
    }
    goal.failures = 0;
    if (thought.spend.warning && !this.#warned) {
      this.#warned = true;
      this.#outbox.push({
        direction: "event",
        channel: "system",
        author: this.#player.name,
        body: "I've used 80% of a spending limit.",
      });
    }
    const reply = thought.text.trim();
    if (reply) this.#reply(reply, goal.channel === "game");
    if (!thought.tool_calls.length) {
      this.#finish(goal, null);
      return;
    }
    for (const call of thought.tool_calls.slice(0, MAX_CALLS_PER_TURN)) {
      if (this.#goal !== goal || this.#queue.length) return;
      const skill = skillsByName.get(call.name);
      const parsed = skill?.args.safeParse(call.arguments);
      if (!skill || !parsed?.success) {
        goal.repairs++;
        const why = !skill
          ? `there is no tool called ${call.name}`
          : `invalid arguments (${parsed?.error?.issues[0]?.message ?? "rejected"})`;
        this.#remember(
          `Your call ${call.name}(${short(call.arguments)}) was refused: ${why}.`,
        );
        if (goal.repairs > 2) {
          this.#finish(
            goal,
            "I got confused about how to do that. Could you say it another way?",
          );
          return;
        }
        continue;
      }
      let result: SkillResult;
      try {
        result = await this.#hands.run(
          skill.name,
          parsed.data,
          this.#abort.signal,
        );
      } catch (error) {
        result = {
          ok: false,
          summary: `Failed: ${error instanceof Error ? error.message : "unknown"}.`,
        };
      }
      const line = `${call.name}(${short(call.arguments, 80)}) -> ${result.ok ? "" : "FAILED: "}${result.summary}`;
      this.#remember(line, call.name === "look_around" ? 1500 : 400);
      this.#outbox.push({
        direction: "decision",
        channel: "player",
        author: this.#player.name,
        body: line.slice(0, 2000),
      });
      if (result.finished) {
        this.#finish(goal, result.summary);
        return;
      }
    }
    if (goal.turns >= MAX_TURNS)
      this.#finish(
        goal,
        "I've done what I can for now; tell me what to do next.",
      );
  }

  #refused(goal: Goal, error: unknown) {
    if (error instanceof Refused) {
      if (error.code === "AI_PLAYER_OUT_OF_BUDGET") {
        this.#state = "out_of_budget";
        this.#retryAt = this.#now() + BUDGET_RETRY_MS;
        this.#reply(
          "I've reached my spending limit, so I'll wait here for now.",
          goal.channel === "game",
        );
        this.#goal = null;
        return;
      }
      if (
        error.code === "AI_PLAYER_STOPPED" ||
        error.code === "AI_PLAYER_STANDING_REVOKED"
      ) {
        this.stop();
        this.#goal = null;
        return;
      }
      if (error.code === "AI_PLAYER_RATE_LIMITED") {
        // Keep the goal; try again after a minute.
        this.#pauseUntil = this.#now() + 60_000;
        goal.turns--;
        this.note("I'm thinking too often; pausing for a minute.");
        return;
      }
    }
    goal.failures++;
    this.note(
      `I couldn't think just now (${error instanceof Error ? error.message : "unknown"}).`,
    );
    if (goal.failures >= 3) {
      this.#finish(
        goal,
        "My thinking isn't working right now; I'll stop this for the moment.",
      );
      this.#nextIdleAt = this.#now() + 5 * 60_000;
    }
  }
  #finish(goal: Goal, summary: string | null) {
    if (summary) this.#reply(summary, goal.channel === "game");
    if (goal.task)
      this.#cooldown.set(goal.task, this.#now() + TASK_COOLDOWN_MS);
    this.#remember(
      `Goal finished: ${short(goal.text, 100)}${summary ? ` (${short(summary, 160)})` : ""}`,
    );
    if (this.#goal === goal) this.#goal = null;
    this.#nextIdleAt = Math.max(this.#nextIdleAt, this.#now() + IDLE_GAP_MS);
    this.#state = "idle";
    this.#activity = "Idle";
  }
  #reply(text: string, inGame = false) {
    this.#outbox.push({
      direction: "reply",
      channel: inGame ? "game" : "player",
      author: this.#player.name,
      body: text.slice(0, 2000),
    });
    this.#remember(`You replied: "${short(text, 200)}"`);
    if (inGame) this.#hands.say(text);
  }
  #remember(event: string, max = 400) {
    this.#events.push(short(event, max));
    if (this.#events.length > MAX_EVENTS)
      this.#events.splice(0, this.#events.length - MAX_EVENTS);
  }
}
