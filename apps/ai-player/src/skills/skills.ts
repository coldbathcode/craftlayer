import { setTimeout as delay } from "node:timers/promises";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { z } from "zod";
import type { Memory } from "../api/client.js";
import { type Goal, goals, type MinecraftBody } from "../body/body.js";
import {
  countItems,
  describeSurroundings,
  inventorySummary,
  normalise,
  resolveBlocks,
  resolveItems,
} from "./world.js";

export interface SkillContext {
  body: MinecraftBody;
  signal: AbortSignal;
  say(text: string): void;
  remember(memory: {
    kind: Memory["kind"];
    content: string;
    tags: string[];
    position: Memory["position"];
  }): Promise<void>;
  activity(text: string): void;
}
export interface SkillResult {
  ok: boolean;
  /** Plain words for the model and the transcript. */
  summary: string;
  /** True when the player decided the current goal is finished. */
  finished?: boolean;
}
export interface Skill<A extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  args: A;
  /** JSON schema the model sees (OpenAI function parameters). */
  parameters: Record<string, unknown>;
  run(ctx: SkillContext, args: z.infer<A>): Promise<SkillResult>;
}

type Block = NonNullable<ReturnType<Bot["blockAt"]>>;
type Entity = Bot["entity"];
type Item = ReturnType<Bot["inventory"]["items"]>[number];
const coordinate = z.number().finite().min(-30_000_000).max(30_000_000);
const HOSTILE_NEVER = new Set([
  "player",
  "villager",
  "wandering_trader",
  "iron_golem",
  "wolf",
  "cat",
]);
const at = (bot: Bot, x: number, y: number, z: number): Vec3 =>
  bot.entity.position.clone().set(x, y, z);
const where = (v: { x: number; y: number; z: number }) =>
  `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;
const aborted = (ctx: SkillContext): SkillResult | null =>
  ctx.signal.aborted ? { ok: false, summary: "Interrupted." } : null;
function playerEntity(bot: Bot, name: string): Entity | null {
  const wanted = name.trim().toLowerCase();
  const match = Object.values(bot.players).find(
    (p) => p.username.toLowerCase() === wanted,
  );
  return match?.entity ?? null;
}
async function moveTo(
  ctx: SkillContext,
  goal: Goal,
  options: { deadlineMs?: number; canDig?: boolean } = {},
) {
  return ctx.body.move(goal, {
    deadlineMs: options.deadlineMs ?? 45000,
    canDig: options.canDig ?? false,
    signal: ctx.signal,
  });
}
async function equipBestTool(bot: Bot, block: Block) {
  const tool = bot.pathfinder.bestHarvestTool(block);
  if (tool) await bot.equip(tool, "hand").catch(() => {});
}
async function collectDrops(ctx: SkillContext, near: Vec3) {
  const bot = ctx.body.bot;
  await delay(250);
  const drops = Object.values(bot.entities)
    .filter((e) => e.name === "item" && e.position.distanceTo(near) < 6)
    .slice(0, 6);
  for (const drop of drops) {
    if (ctx.signal.aborted) return;
    await moveTo(
      ctx,
      new goals.GoalNear(
        drop.position.x,
        drop.position.y,
        drop.position.z,
        0.6,
      ),
      {
        deadlineMs: 5000,
      },
    );
  }
}

function skill<A extends z.ZodType>(definition: Skill<A>): Skill<A> {
  return definition;
}

const howToCraft: Skill = skill({
  name: "how_to_craft",
  description:
    "Look up what an item needs to craft and whether you can craft it right now.",
  args: z.object({ item: z.string().min(1).max(48) }).strict(),
  parameters: {
    type: "object",
    properties: { item: { type: "string" } },
    required: ["item"],
    additionalProperties: false,
  },
  async run(ctx, a) {
    const bot = ctx.body.bot;
    const names = resolveItems(bot, a.item).slice(0, 4);
    if (!names.length)
      return {
        ok: false,
        summary: `I don't know an item called "${a.item}".`,
      };
    const table = bot.findBlock({
      matching: bot.registry.blocksByName.crafting_table?.id ?? -1,
      maxDistance: 32,
    });
    const lines: string[] = [];
    for (const name of names) {
      const id = bot.registry.itemsByName[name]?.id;
      if (id === undefined) continue;
      const recipes = bot.recipesAll(id, null, true);
      if (!recipes.length) {
        lines.push(`${name}: cannot be crafted (gather or smelt it).`);
        continue;
      }
      const recipe = recipes[0];
      if (!recipe) continue;
      const needs = new Map<string, number>();
      for (const d of recipe.delta) {
        if (d.count >= 0) continue;
        const n = bot.registry.items[d.id]?.name ?? `item ${d.id}`;
        needs.set(n, (needs.get(n) ?? 0) - d.count);
      }
      const now = bot.recipesFor(id, null, 1, table ?? null).length > 0;
      lines.push(
        `${name}: makes ${recipe.result.count}; needs ${[...needs].map(([n, c]) => `${c} ${n}`).join(", ")}${recipe.requiresTable ? "; needs a crafting table" : ""}. ${now ? "You can craft it now." : "You can't craft it yet."}`,
      );
    }
    return { ok: true, summary: lines.join("\n") };
  },
});

export const skills = [
  skill({
    name: "look_around",
    description:
      "Describe your surroundings: position, time, nearby useful blocks with coordinates, creatures, players and your inventory.",
    args: z.object({}).strict(),
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async run(ctx) {
      return { ok: true, summary: describeSurroundings(ctx.body.bot) };
    },
  }),
  skill({
    name: "go_to",
    description:
      "Walk to coordinates. Use y when you know it; otherwise you go to the x,z column.",
    args: z
      .object({
        x: coordinate,
        y: coordinate.optional(),
        z: coordinate,
        range: z.number().min(0).max(16).optional(),
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
        range: {
          type: "number",
          description: "How close is close enough, in blocks (default 1).",
        },
      },
      required: ["x", "z"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      ctx.activity(`Walking to ${a.x},${a.y ?? "?"},${a.z}`);
      const range = a.range ?? 1;
      const goal =
        a.y === undefined
          ? new goals.GoalNearXZ(a.x, a.z, Math.max(range, 0.5))
          : new goals.GoalNear(a.x, a.y, a.z, range);
      const result = await moveTo(ctx, goal, { deadlineMs: 90000 });
      const p = ctx.body.bot.entity.position;
      return result.ok
        ? { ok: true, summary: `Arrived at ${where(p)}.` }
        : {
            ok: false,
            summary: `Could not get there (${result.reason}); now at ${where(p)}.`,
          };
    },
  }),
  skill({
    name: "follow_player",
    description:
      "Follow a player for a while, staying a few blocks away. Stops when interrupted or time runs out.",
    args: z
      .object({
        player: z.string().min(1).max(32),
        distance: z.number().min(1).max(10).optional(),
        seconds: z.number().int().min(5).max(600).optional(),
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        player: { type: "string" },
        distance: {
          type: "number",
          description: "Blocks to keep between you (default 3).",
        },
        seconds: {
          type: "integer",
          description: "How long to follow (default 120, max 600).",
        },
      },
      required: ["player"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      const bot = ctx.body.bot;
      const target = playerEntity(bot, a.player);
      if (!target)
        return { ok: false, summary: `I can't see ${a.player} nearby.` };
      ctx.activity(`Following ${a.player}`);
      const until = Date.now() + (a.seconds ?? 120) * 1000;
      bot.pathfinder.setGoal(
        new goals.GoalFollow(target, a.distance ?? 3),
        true,
      );
      try {
        while (Date.now() < until && !ctx.signal.aborted) {
          if (!playerEntity(bot, a.player))
            return { ok: false, summary: `I lost sight of ${a.player}.` };
          await delay(500);
        }
      } finally {
        ctx.body.halt();
      }
      return ctx.signal.aborted
        ? { ok: true, summary: `Followed ${a.player} until interrupted.` }
        : {
            ok: true,
            summary: `Followed ${a.player} for ${a.seconds ?? 120} seconds.`,
          };
    },
  }),
  skill({
    name: "come_to_player",
    description: "Walk to a player's current position.",
    args: z.object({ player: z.string().min(1).max(32) }).strict(),
    parameters: {
      type: "object",
      properties: { player: { type: "string" } },
      required: ["player"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      const target = playerEntity(ctx.body.bot, a.player);
      if (!target)
        return { ok: false, summary: `I can't see ${a.player} nearby.` };
      ctx.activity(`Going to ${a.player}`);
      const p = target.position;
      const result = await moveTo(ctx, new goals.GoalNear(p.x, p.y, p.z, 2), {
        deadlineMs: 90000,
      });
      return result.ok
        ? { ok: true, summary: `I'm next to ${a.player}.` }
        : {
            ok: false,
            summary: `I couldn't reach ${a.player} (${result.reason}).`,
          };
    },
  }),
  skill({
    name: "collect_blocks",
    description:
      "Find, mine and pick up blocks of a type, e.g. 'oak_log', 'log' (any tree), 'stone', 'dirt', 'sand', 'coal_ore'. Searches within 48 blocks.",
    args: z
      .object({
        block: z.string().min(1).max(48),
        count: z.number().int().min(1).max(64),
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        block: {
          type: "string",
          description:
            "Block name or group (log, plank, stone, dirt, iron, coal...).",
        },
        count: {
          type: "integer",
          description: "How many blocks to mine (max 64).",
        },
      },
      required: ["block", "count"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      const bot = ctx.body.bot;
      const names = resolveBlocks(bot, a.block);
      if (!names.length)
        return {
          ok: false,
          summary: `I don't know a block called "${a.block}".`,
        };
      const ids = names
        .map((n) => bot.registry.blocksByName[n]?.id)
        .filter((id): id is number => id !== undefined);
      let mined = 0,
        misses = 0;
      const deadline = Date.now() + 240000;
      while (mined < a.count && Date.now() < deadline && misses < 4) {
        const stop = aborted(ctx);
        if (stop)
          return {
            ...stop,
            summary: `Interrupted after mining ${mined} ${a.block}.`,
          };
        const here = bot.entity.position;
        const spots = bot
          .findBlocks({ matching: ids, maxDistance: 48, count: 40 })
          .sort((x, y) => x.distanceTo(here) - y.distanceTo(here));
        const target = spots
          .map((s) => bot.blockAt(s))
          .find((b): b is Block => !!b && b.diggable);
        if (!target) break;
        ctx.activity(`Mining ${target.name} (${mined}/${a.count})`);
        const reach = await moveTo(
          ctx,
          new goals.GoalLookAtBlock(target.position, bot.world),
          {
            deadlineMs: 40000,
            canDig: true,
          },
        );
        const fresh = bot.blockAt(target.position);
        if (
          !reach.ok ||
          !fresh ||
          !ids.includes(fresh.type) ||
          !bot.canDigBlock(fresh)
        ) {
          misses++;
          continue;
        }
        await equipBestTool(bot, fresh);
        try {
          await bot.dig(fresh, true);
          mined++;
          misses = 0;
        } catch {
          misses++;
          continue;
        }
        await collectDrops(ctx, fresh.position);
      }
      await delay(600); // let the last pickups land in the inventory
      const have = inventorySummary(bot).slice(0, 8).join(", ");
      if (mined === 0)
        return {
          ok: false,
          summary: `I couldn't find or reach any ${a.block} within 48 blocks. Inventory: ${have || "empty"}.`,
        };
      return {
        ok: mined >= a.count,
        summary: `Mined ${mined} of ${a.count} ${a.block}. Inventory: ${have}.`,
      };
    },
  }),
  howToCraft,
  skill({
    name: "craft",
    description:
      "Craft an item from your inventory, e.g. 'oak_planks', 'stick', 'crafting_table', 'wooden_pickaxe'. Uses or places a crafting table when the recipe needs one.",
    args: z
      .object({
        item: z.string().min(1).max(48),
        count: z.number().int().min(1).max(64),
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        item: { type: "string" },
        count: {
          type: "integer",
          description: "How many items you want (max 64).",
        },
      },
      required: ["item", "count"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      const bot = ctx.body.bot;
      const tableId = bot.registry.blocksByName.crafting_table?.id;
      let table =
        tableId === undefined
          ? null
          : bot.findBlock({ matching: tableId, maxDistance: 32 });
      for (const name of resolveItems(bot, a.item)) {
        const id = bot.registry.itemsByName[name]?.id;
        if (id === undefined) continue;
        let recipe = bot.recipesFor(id, null, 1, null)[0];
        if (!recipe) {
          if (!table && countItems(bot, ["crafting_table"]) > 0) {
            const placed = await placeNearby(ctx, "crafting_table");
            if (!placed.ok) return placed;
            table =
              tableId === undefined
                ? null
                : bot.findBlock({ matching: tableId, maxDistance: 8 });
          }
          if (table) {
            await moveTo(
              ctx,
              new goals.GoalNear(
                table.position.x,
                table.position.y,
                table.position.z,
                2,
              ),
              {
                deadlineMs: 30000,
              },
            );
            recipe = bot.recipesFor(id, null, 1, table)[0];
          }
        }
        if (!recipe) continue;
        const times = Math.ceil(a.count / Math.max(1, recipe.result.count));
        ctx.activity(`Crafting ${a.count} ${name}`);
        try {
          await bot.craft(
            recipe,
            times,
            recipe.requiresTable ? (table ?? undefined) : undefined,
          );
        } catch (error) {
          return {
            ok: false,
            summary: `Crafting ${name} failed: ${error instanceof Error ? error.message : "unknown"}.`,
          };
        }
        await delay(400); // the server confirms the crafted items a moment later
        return {
          ok: true,
          summary: `Crafted ${name}. Now have ${countItems(bot, [name])}.`,
        };
      }
      const help = await howToCraft.run(ctx, { item: a.item });
      return {
        ok: false,
        summary:
          `I can't craft ${a.item} with what I have${table ? "" : " (no crafting table nearby)"}. ${help?.summary ?? ""}`.trim(),
      };
    },
  }),
  skill({
    name: "place_block",
    description:
      "Place a block from your inventory at coordinates (next to an existing block).",
    args: z
      .object({
        block: z.string().min(1).max(48),
        x: coordinate,
        y: coordinate,
        z: coordinate,
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        block: { type: "string" },
        x: { type: "integer" },
        y: { type: "integer" },
        z: { type: "integer" },
      },
      required: ["block", "x", "y", "z"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      return placeAt(
        ctx,
        a.block,
        Math.floor(a.x),
        Math.floor(a.y),
        Math.floor(a.z),
      );
    },
  }),
  skill({
    name: "store_in_chest",
    description:
      "Put items into the chest at coordinates. Use item 'all' to empty everything except tools and food.",
    args: z
      .object({
        item: z.string().min(1).max(48),
        count: z.number().int().min(1).max(2304).optional(),
        x: coordinate,
        y: coordinate,
        z: coordinate,
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        item: { type: "string" },
        count: {
          type: "integer",
          description: "Omit to store all of that item.",
        },
        x: { type: "integer" },
        y: { type: "integer" },
        z: { type: "integer" },
      },
      required: ["item", "x", "y", "z"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      return withChest(ctx, a.x, a.y, a.z, async (chest, bot) => {
        const keep = (i: Item) =>
          /_(pickaxe|axe|shovel|sword|hoe)$/.test(i.name) ||
          !!bot.registry.foodsByName?.[i.name];
        const names =
          normalise(a.item) === "all" ? null : resolveItems(bot, a.item);
        let moved = 0;
        for (const item of bot.inventory.items()) {
          if (names ? !names.includes(item.name) : keep(item)) continue;
          const amount = Math.min(
            item.count,
            a.count === undefined ? item.count : a.count - moved,
          );
          if (amount <= 0) break;
          await chest.deposit(item.type, null, amount);
          moved += amount;
        }
        return {
          ok: moved > 0,
          summary: moved
            ? `Stored ${moved} item(s) in the chest.`
            : `I had no ${a.item} to store.`,
        };
      });
    },
  }),
  skill({
    name: "take_from_chest",
    description: "Take items out of the chest at coordinates.",
    args: z
      .object({
        item: z.string().min(1).max(48),
        count: z.number().int().min(1).max(2304),
        x: coordinate,
        y: coordinate,
        z: coordinate,
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        item: { type: "string" },
        count: { type: "integer" },
        x: { type: "integer" },
        y: { type: "integer" },
        z: { type: "integer" },
      },
      required: ["item", "count", "x", "y", "z"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      return withChest(ctx, a.x, a.y, a.z, async (chest, bot) => {
        const names = resolveItems(bot, a.item);
        let taken = 0;
        for (const item of chest.containerItems()) {
          if (!names.includes(item.name) || taken >= a.count) continue;
          const amount = Math.min(item.count, a.count - taken);
          await chest.withdraw(item.type, null, amount);
          taken += amount;
        }
        return {
          ok: taken > 0,
          summary: taken
            ? `Took ${taken} ${a.item}.`
            : `The chest has no ${a.item}.`,
        };
      });
    },
  }),
  skill({
    name: "eat",
    description: "Eat the most filling food in your inventory.",
    args: z.object({}).strict(),
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async run(ctx) {
      return eatBest(ctx.body.bot);
    },
  }),
  skill({
    name: "fight_hostile_mobs",
    description:
      "Fight hostile mobs (zombies, skeletons, spiders, creepers...) near you for a while. Never attacks players, pets, villagers or farm animals.",
    args: z
      .object({ seconds: z.number().int().min(5).max(120).optional() })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        seconds: {
          type: "integer",
          description: "How long to keep fighting (default 30).",
        },
      },
      additionalProperties: false,
    },
    async run(ctx, a) {
      const bot = ctx.body.bot;
      const until = Date.now() + (a.seconds ?? 30) * 1000;
      let hits = 0;
      try {
        while (Date.now() < until && !ctx.signal.aborted) {
          const target = nearestHostile(bot, 16);
          if (!target) break;
          ctx.activity(`Fighting ${target.name}`);
          const weapon = bot.inventory
            .items()
            .find((i) => /_(sword|axe)$/.test(i.name));
          if (weapon) await bot.equip(weapon, "hand").catch(() => {});
          bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
          if (target.position.distanceTo(bot.entity.position) < 3.5) {
            await bot.lookAt(
              target.position.offset(0, (target.height ?? 1.6) * 0.8, 0),
              true,
            );
            bot.attack(target);
            hits++;
          }
          await delay(650);
        }
      } finally {
        ctx.body.halt();
      }
      const left = nearestHostile(bot, 16);
      return {
        ok: !left,
        summary: `Fought for a while (${hits} hits). ${left ? `A ${left.name} is still nearby.` : "No hostile mobs nearby now."}`,
      };
    },
  }),
  skill({
    name: "say",
    description: "Say something in the game chat. Keep it short and friendly.",
    args: z.object({ text: z.string().min(1).max(240) }).strict(),
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      ctx.say(a.text);
      return { ok: true, summary: "Said it." };
    },
  }),
  skill({
    name: "remember",
    description:
      "Save something worth remembering for later: a place (use here=true to store your position), a person's preference, a fact, or a lesson.",
    args: z
      .object({
        kind: z.enum(["fact", "place", "person", "lesson", "note"]),
        content: z.string().min(1).max(400),
        tags: z
          .array(z.string().regex(/^[a-z0-9_-]{1,24}$/))
          .max(6)
          .optional(),
        here: z.boolean().optional(),
      })
      .strict(),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["fact", "place", "person", "lesson", "note"],
        },
        content: { type: "string" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Lowercase keywords.",
        },
        here: { type: "boolean", description: "Attach your current position." },
      },
      required: ["kind", "content"],
      additionalProperties: false,
    },
    async run(ctx, a) {
      const p = ctx.body.bot.entity.position;
      await ctx.remember({
        kind: a.kind,
        content: a.content,
        tags: a.tags ?? [],
        position: a.here
          ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
          : null,
      });
      return { ok: true, summary: "Remembered." };
    },
  }),
  skill({
    name: "finish",
    description:
      "Call when the current goal is done (or cannot be done), with a one-sentence summary for the owner.",
    args: z.object({ summary: z.string().min(1).max(300) }).strict(),
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
    async run(_ctx, a) {
      return { ok: true, summary: a.summary, finished: true };
    },
  }),
] as const satisfies readonly Skill[];

export type SkillName = (typeof skills)[number]["name"];
export const skillsByName = new Map<string, Skill>(
  skills.map((s) => [s.name, s as Skill]),
);
export const toolSchemas = () =>
  skills.map((s) => ({
    name: s.name,
    description: s.description,
    parameters: s.parameters,
  }));

export function nearestHostile(bot: Bot, range: number): Entity | null {
  return bot.nearestEntity(
    (e) =>
      e.type === "hostile" &&
      !HOSTILE_NEVER.has(e.name ?? "") &&
      e.position.distanceTo(bot.entity.position) <= range,
  );
}
export async function eatBest(bot: Bot): Promise<SkillResult> {
  const foods = bot.registry.foodsByName ?? {};
  const food = bot.inventory
    .items()
    .filter(
      (i) =>
        foods[i.name] &&
        ![
          "rotten_flesh",
          "spider_eye",
          "poisonous_potato",
          "pufferfish",
        ].includes(i.name),
    )
    .sort(
      (x, y) =>
        (foods[y.name]?.foodPoints ?? 0) - (foods[x.name]?.foodPoints ?? 0),
    )[0];
  if (!food) return { ok: false, summary: "I have nothing safe to eat." };
  if (bot.food >= 20) return { ok: true, summary: "I'm not hungry." };
  try {
    await bot.equip(food, "hand");
    await bot.consume();
    return { ok: true, summary: `Ate ${food.name}; food is ${bot.food}/20.` };
  } catch {
    return { ok: false, summary: `Couldn't eat ${food.name}.` };
  }
}
async function placeAt(
  ctx: SkillContext,
  block: string,
  x: number,
  y: number,
  z: number,
): Promise<SkillResult> {
  const bot = ctx.body.bot;
  const names = resolveItems(bot, block);
  const item = bot.inventory.items().find((i) => names.includes(i.name));
  if (!item) return { ok: false, summary: `I have no ${block} to place.` };
  const target = at(bot, x, y, z);
  const existing = bot.blockAt(target);
  if (
    existing &&
    !["air", "cave_air", "short_grass", "tall_grass", "water"].includes(
      existing.name,
    )
  )
    return {
      ok: false,
      summary: `There is already ${existing.name} at ${x},${y},${z}.`,
    };
  const faces: Array<[number, number, number]> = [
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
  ];
  const reference = faces
    .map(([dx, dy, dz]) => ({
      block: bot.blockAt(target.offset(dx, dy, dz)),
      face: at(bot, -dx, -dy, -dz),
    }))
    .find((r) => r.block && r.block.boundingBox === "block");
  if (!reference?.block)
    return {
      ok: false,
      summary: `Nothing solid next to ${x},${y},${z} to place against.`,
    };
  ctx.activity(`Placing ${item.name}`);
  await moveTo(ctx, new goals.GoalNear(x, y, z, 3), { deadlineMs: 30000 });
  const feet = bot.entity.position.floored();
  if (feet.x === x && feet.z === z && (feet.y === y || feet.y + 1 === y))
    await moveTo(ctx, new goals.GoalInvert(new goals.GoalNear(x, y, z, 1)), {
      deadlineMs: 10000,
    });
  try {
    await bot.equip(item, "hand");
    await bot.placeBlock(reference.block, reference.face);
  } catch (error) {
    return {
      ok: false,
      summary: `Placing failed: ${error instanceof Error ? error.message : "unknown"}.`,
    };
  }
  const placed = bot.blockAt(target);
  return placed?.name === item.name
    ? { ok: true, summary: `Placed ${item.name} at ${x},${y},${z}.` }
    : {
        ok: false,
        summary: `The block at ${x},${y},${z} is ${placed?.name ?? "unknown"} after placing.`,
      };
}
async function placeNearby(
  ctx: SkillContext,
  block: string,
): Promise<SkillResult> {
  const bot = ctx.body.bot;
  const p = bot.entity.position.floored();
  for (const [dx, dz] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [2, 2],
    [-2, -2],
  ] as const) {
    for (const dy of [0, 1, -1]) {
      const spot = p.offset(dx, dy, dz);
      const here = bot.blockAt(spot),
        below = bot.blockAt(spot.offset(0, -1, 0));
      if (here?.name === "air" && below?.boundingBox === "block")
        return placeAt(ctx, block, spot.x, spot.y, spot.z);
    }
  }
  return {
    ok: false,
    summary: `I couldn't find a free spot to put the ${block}.`,
  };
}
async function withChest(
  ctx: SkillContext,
  x: number,
  y: number,
  z: number,
  fn: (
    chest: Awaited<ReturnType<Bot["openContainer"]>>,
    bot: Bot,
  ) => Promise<SkillResult>,
): Promise<SkillResult> {
  const bot = ctx.body.bot;
  const block = bot.blockAt(
    at(bot, Math.floor(x), Math.floor(y), Math.floor(z)),
  );
  if (!block || !["chest", "barrel", "trapped_chest"].includes(block.name))
    return { ok: false, summary: `There is no chest at ${x},${y},${z}.` };
  ctx.activity("Using a chest");
  const reach = await moveTo(
    ctx,
    new goals.GoalGetToBlock(
      block.position.x,
      block.position.y,
      block.position.z,
    ),
    {
      deadlineMs: 45000,
    },
  );
  if (!reach.ok)
    return {
      ok: false,
      summary: `I couldn't reach the chest (${reach.reason}).`,
    };
  const chest = await bot.openContainer(block);
  try {
    return await fn(chest, bot);
  } catch (error) {
    return {
      ok: false,
      summary: `The chest didn't cooperate: ${error instanceof Error ? error.message : "unknown"}.`,
    };
  } finally {
    chest.close();
  }
}
