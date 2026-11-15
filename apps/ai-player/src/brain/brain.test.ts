import { describe, expect, it } from "vitest";
import {
  type Assignment,
  type HostApi,
  Refused,
  type ThinkRequest,
  type Thought,
} from "../api/client.js";
import { Brain } from "./brain.js";
import {
  addressedText,
  floodgateUuid,
  isOwner,
  looksLikeToolCall,
  relevantMemories,
  safeChat,
  toolCallInText,
} from "./chat.js";
import { MAX_INPUT_BOUND, requestBound } from "./prompt.js";

const player: Assignment = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Pip",
  persona: "Cheerful.",
  rules: "Never break the farm.",
  model_id: "fixture/model",
  game_host: "127.0.0.1",
  game_port: 25565,
  game_version: "26.1",
  mc_username: "PipTheHelper",
  mc_auth: "offline",
  instructors: [{ kind: "name", value: "Owner", label: "" }],
  tasks: [
    {
      id: "t1",
      title: "Stock wood",
      goal: "Keep 64 logs in the wood chest.",
      priority: 50,
      condition: "always",
      enabled: true,
    },
    {
      id: "t2",
      title: "Night watch",
      goal: "Fight mobs near home.",
      priority: 90,
      condition: "night",
      enabled: true,
    },
  ],
  run: true,
  version: 1,
};
const spend = {
  today_micro: "0",
  total_micro: "0",
  daily_limit_micro: "1000000",
  total_limit_micro: "10000000",
  warning: false,
  exhausted: false,
};
const thought = (patch: Partial<Thought>): Thought => ({
  text: "",
  tool_calls: [],
  finish_reason: "stop",
  charged_micro: "10",
  spend,
  ...patch,
});
class FakeApi implements Partial<HostApi> {
  requests: ThinkRequest[] = [];
  answers: Array<Thought | Error> = [];
  async think(_player: string, request: ThinkRequest) {
    this.requests.push(request);
    const next = this.answers.shift();
    if (!next)
      return thought({
        tool_calls: [{ name: "finish", arguments: { summary: "Done." } }],
      });
    if (next instanceof Error) throw next;
    return next;
  }
}
function setup(time: "day" | "night" = "day") {
  let now = 1_000_000;
  const api = new FakeApi();
  const runs: Array<{ skill: string; args: unknown }> = [];
  const said: string[] = [];
  const brain = new Brain({
    player,
    api: api as unknown as HostApi,
    now: () => now,
    senses: {
      inGameName: () => "PipTheHelper",
      surroundings: () => "Position x=1 y=64 z=2.",
      ownerNames: () => ["Owner"],
      ownerOnline: () => true,
      timeOfDay: () => time,
    },
    hands: {
      run: async (skill, args, signal) => {
        runs.push({ skill, args });
        if (skill === "follow_player")
          await new Promise((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          );
        if (skill === "finish")
          return {
            ok: true,
            summary: (args as { summary: string }).summary,
            finished: true,
          };
        return { ok: true, summary: `${skill} ok` };
      },
      say: (text) => said.push(text),
    },
  });
  return { brain, api, runs, said, advance: (ms: number) => (now += ms) };
}

describe("brain", () => {
  it("frames the owner's instruction with persona, rules, game sense and tools", async () => {
    const { brain, api, runs, said } = setup();
    api.answers.push(
      thought({
        text: "On my way!",
        tool_calls: [
          { name: "come_to_player", arguments: { player: "Owner" } },
        ],
      }),
      thought({
        tool_calls: [{ name: "finish", arguments: { summary: "I'm here." } }],
      }),
    );
    brain.instruct("come here", "Owner", "game");
    await brain.tick();
    await brain.tick();
    const first = api.requests[0];
    expect(first?.messages[0]?.content).toContain("You are Pip");
    expect(first?.messages[0]?.content).toContain("Never break the farm.");
    expect(first?.messages[0]?.content).toContain("Minecraft know-how");
    expect(first?.messages[1]?.content).toContain('Owner said: "come here"');
    expect(first?.tools.map((t) => t.name)).toContain("collect_blocks");
    expect(first?.tools.length).toBeLessThanOrEqual(16);
    expect(runs.map((r) => r.skill)).toEqual(["come_to_player", "finish"]);
    expect(said).toEqual(["On my way!", "I'm here."]);
    expect(brain.goal).toBeNull();
    const posted = brain.drain();
    expect(posted.map((m) => m.direction)).toEqual([
      "reply",
      "decision",
      "decision",
      "reply",
    ]);
  });
  it("runs a skill call the model wrote as text, and never says the raw call in game", async () => {
    const { brain, api, runs, said } = setup();
    api.answers.push(
      thought({ text: 'say(text="Hi Owner! 👋")' }),
      thought({ text: "look_around(radius=" }),
      thought({ text: "look_around(this is not a call)" }),
    );
    brain.instruct("say hello to me", "Owner", "game");
    await brain.tick();
    expect(runs).toEqual([{ skill: "say", args: { text: "Hi Owner! 👋" } }]);
    expect(said.some((s) => s.includes("say("))).toBe(false);
    brain.instruct("look", "Owner", "game");
    await brain.tick();
    await brain.tick();
    brain.instruct("look again", "Owner", "game");
    await brain.tick();
    expect(said.some((s) => s.includes("look_around"))).toBe(false);
  });
  it("declares an input bound the provider router accepts, even with a long history", async () => {
    const { brain, api } = setup();
    for (let i = 0; i < 40; i++)
      brain.note(`event ${i} ${"x".repeat(380)}`, false);
    brain.instruct("collect logs ".repeat(100), "Owner", "dashboard");
    await brain.tick();
    const request = api.requests[0];
    if (!request) throw new Error("no request");
    const bound = requestBound(request.messages, request.tools);
    expect(request.max_input_tokens).toBeGreaterThanOrEqual(bound);
    expect(request.max_input_tokens).toBeLessThanOrEqual(MAX_INPUT_BOUND);
  });
  it("refuses unknown tools and bad arguments, and gives up after repeated confusion", async () => {
    const { brain, api, runs } = setup();
    for (let i = 0; i < 3; i++)
      api.answers.push(
        thought({
          tool_calls: [{ name: "run_command", arguments: { cmd: "/op me" } }],
        }),
      );
    brain.instruct("do something", "Owner", "dashboard");
    await brain.tick();
    await brain.tick();
    await brain.tick();
    expect(runs).toEqual([]);
    expect(brain.goal).toBeNull();
    expect(brain.drain().at(-1)?.body).toContain("confused");
    api.answers.push(
      thought({ tool_calls: [{ name: "go_to", arguments: { x: "far" } }] }),
    );
    brain.instruct("go", "Owner", "dashboard");
    await brain.tick();
    expect(runs).toEqual([]);
    expect(api.requests.at(-1)).toBeDefined();
  });
  it("lets a new instruction interrupt a running skill", async () => {
    const { brain, api, runs } = setup();
    api.answers.push(
      thought({
        tool_calls: [{ name: "follow_player", arguments: { player: "Owner" } }],
      }),
    );
    brain.instruct("follow me", "Owner", "game");
    const following = brain.tick();
    await new Promise((r) => setTimeout(r, 10));
    brain.instruct("stop and look around", "Owner", "game");
    await following;
    api.answers.push(
      thought({ tool_calls: [{ name: "look_around", arguments: {} }] }),
    );
    await brain.tick();
    expect(runs.map((r) => r.skill)).toEqual(["follow_player", "look_around"]);
    expect(api.requests.at(-1)?.messages[1]?.content).toContain(
      "New instruction replaced",
    );
  });
  it("stops thinking when out of budget and tells the owner once", async () => {
    const { brain, api, said, advance } = setup();
    api.answers.push(new Refused(409, "AI_PLAYER_OUT_OF_BUDGET", "limit"));
    brain.instruct("build a house", "Owner", "game");
    await brain.tick();
    expect(brain.state).toBe("out_of_budget");
    expect(said.at(-1)).toContain("spending limit");
    brain.instruct("and a farm", "Owner", "game");
    await brain.tick();
    expect(api.requests).toHaveLength(1);
    advance(11 * 60_000);
    brain.instruct("try again", "Owner", "dashboard");
    await brain.tick();
    expect(api.requests).toHaveLength(2);
  });
  it("stops for good when CraftLayer says stopped", async () => {
    const { brain, api } = setup();
    api.answers.push(new Refused(409, "AI_PLAYER_STOPPED", "stopped"));
    brain.instruct("go", "Owner", "dashboard");
    await brain.tick();
    expect(brain.state).toBe("stopped");
    expect(await brain.tick()).toBe("idle");
  });
  it("works on the highest-priority standing task that applies, then cools it down", async () => {
    const day = setup("day");
    await day.brain.tick();
    expect(day.api.requests[0]?.messages[1]?.content).toContain(
      'standing task "Stock wood"',
    );
    day.advance(60_000);
    await day.brain.tick();
    expect(day.api.requests).toHaveLength(1);
    const night = setup("night");
    await night.brain.tick();
    expect(night.api.requests[0]?.messages[1]?.content).toContain(
      'standing task "Night watch"',
    );
  });
});

describe("tool calls written as text", () => {
  const known = (name: string) =>
    ["say", "craft", "look_around"].includes(name);
  it("reads keyword, JSON and empty argument lists for known skills only", () => {
    expect(toolCallInText('say(text="Hello, Owner")', known)).toEqual({
      name: "say",
      arguments: { text: "Hello, Owner" },
    });
    expect(toolCallInText("craft(item='planks', count=4)", known)).toEqual({
      name: "craft",
      arguments: { item: "planks", count: 4 },
    });
    expect(
      toolCallInText('`craft({"item":"stick","count":2})`', known),
    ).toEqual({
      name: "craft",
      arguments: { item: "stick", count: 2 },
    });
    expect(toolCallInText("look_around()", known)).toEqual({
      name: "look_around",
      arguments: {},
    });
    expect(
      toolCallInText(
        '{\n  "tool_name": "look_around",\n  "tool_args": {}\n}',
        known,
      ),
    ).toEqual({ name: "look_around", arguments: {} });
    expect(
      toolCallInText(
        '```json\n{"name":"craft","arguments":{"item":"stick"}}\n```',
        known,
      ),
    ).toEqual({ name: "craft", arguments: { item: "stick" } });
    expect(
      toolCallInText('{"tool_name":"run_command","tool_args":{}}', known),
    ).toBeNull();
    expect(
      toolCallInText('{"tool_name":"say","tool_args":"hi"}', known),
    ).toBeNull();
    expect(toolCallInText('run_command(cmd="/op me")', known)).toBeNull();
    expect(toolCallInText("say(hello there)", known)).toBeNull();
    expect(toolCallInText('I will say(text="x") now', known)).toBeNull();
  });
  it("spots call-shaped text so it is never said in the game", () => {
    expect(looksLikeToolCall("say(hello there)", known)).toBe(true);
    expect(looksLikeToolCall("I'll say hello (nicely)", known)).toBe(false);
    expect(looksLikeToolCall("Sure (on my way)", known)).toBe(false);
    expect(
      looksLikeToolCall('{"tool_name": "look_around", "tool_args": 3', known),
    ).toBe(true);
    expect(looksLikeToolCall('{"note": "a plain object"}', known)).toBe(false);
  });
});

describe("chat safety and owner recognition", () => {
  it("never sends commands and drops blocked words", () => {
    expect(safeChat("/op Pip")).toBe("op Pip");
    expect(safeChat("  //gamemode creative ")).toBe("gamemode creative");
    expect(safeChat("hi\nthere\u0007")).toBe("hi there");
    expect(safeChat("you are a bitch")).toBeNull();
    expect(safeChat("x".repeat(300))?.length).toBe(220);
  });
  it("recognises the owner by name, Java UUID or Bedrock XUID", () => {
    expect(floodgateUuid("2535400000000001")).toBe(
      "00000000-0000-0000-0009-01f4a2e05e01".replace(
        "01f4a2e05e01",
        BigInt("2535400000000001").toString(16).padStart(16, "0").slice(4),
      ),
    );
    const xuid = "2535400000000001";
    const uuid = floodgateUuid(xuid) ?? "";
    expect(
      isOwner([{ kind: "bedrock", value: xuid, label: "" }], ".OwnerTag", uuid),
    ).toBe(true);
    expect(
      isOwner(
        [
          {
            kind: "java",
            value: "AAAAAAAA-0000-4000-8000-000000000000",
            label: "",
          },
        ],
        "Owner",
        "aaaaaaaa-0000-4000-8000-000000000000",
      ),
    ).toBe(true);
    expect(
      isOwner(
        [{ kind: "name", value: "Owner", label: "" }],
        "owner",
        undefined,
      ),
    ).toBe(true);
    expect(
      isOwner([{ kind: "name", value: "Owner", label: "" }], "Alex", undefined),
    ).toBe(false);
  });
  it("treats only messages addressed to the player as instructions", () => {
    expect(addressedText("Pip, come here", ["Pip"])).toBe("come here");
    expect(
      addressedText("@PipTheHelper: chop trees", ["Pip", "PipTheHelper"]),
    ).toBe("chop trees");
    expect(addressedText("pip!", ["Pip"])).toBe("hello");
    expect(addressedText("Pippa is my friend", ["Pip"])).toBeNull();
    expect(addressedText("hi everyone", ["Pip"])).toBeNull();
  });
  it("puts owner notes and related memories first", () => {
    const base = {
      tags: [],
      position: null,
      created_at: "2026-11-15T00:00:00Z",
    };
    const picked = relevantMemories(
      [
        {
          ...base,
          id: "1",
          kind: "fact",
          content: "Alex likes pink sheep.",
          source: "player",
        },
        {
          ...base,
          id: "2",
          kind: "place",
          content: "The wood chest is by the farm.",
          source: "owner",
        },
        {
          ...base,
          id: "3",
          kind: "lesson",
          content: "Logs burn in lava.",
          source: "player",
        },
      ],
      "put the logs in the wood chest",
      2,
    );
    expect(picked.map((m) => m.id)).toEqual(["2", "3"]);
  });
});
