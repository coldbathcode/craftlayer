import type { Bot } from "mineflayer";
import type { Observation } from "../api/client.js";

/** Names people (and models) use for groups of blocks and items. */
const GROUPS: Record<string, (name: string) => boolean> = {
  log: (n) => n.endsWith("_log") && !n.startsWith("stripped_"),
  wood: (n) => n.endsWith("_log") && !n.startsWith("stripped_"),
  tree: (n) => n.endsWith("_log") && !n.startsWith("stripped_"),
  plank: (n) => n.endsWith("_planks"),
  leaves: (n) => n.endsWith("_leaves"),
  wool: (n) => n.endsWith("_wool"),
  bed: (n) => n.endsWith("_bed"),
  sapling: (n) => n.endsWith("_sapling"),
  stone: (n) => n === "stone" || n === "cobblestone",
  cobble: (n) => n === "cobblestone",
  dirt: (n) => n === "dirt" || n === "grass_block",
  coal: (n) => n === "coal_ore" || n === "deepslate_coal_ore" || n === "coal",
  iron: (n) =>
    n === "iron_ore" || n === "deepslate_iron_ore" || n === "raw_iron",
  copper: (n) =>
    n === "copper_ore" || n === "deepslate_copper_ore" || n === "raw_copper",
  sand: (n) => n === "sand",
  gravel: (n) => n === "gravel",
  crop: (n) => ["wheat", "carrots", "potatoes", "beetroots"].includes(n),
};

export function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(/[\s-]+/g, "_");
}

/** Resolves a requested block name or group to concrete block names this version knows. */
export function resolveBlocks(bot: Bot, requested: string): string[] {
  const name = normalise(requested);
  const known = bot.registry.blocksByName;
  if (known[name]) return [name];
  const singular = name.replace(/s$/, "").replace(/_blocks?$/, "");
  if (known[singular]) return [singular];
  const group = GROUPS[singular] ?? GROUPS[name];
  if (group) return Object.keys(known).filter(group);
  return Object.keys(known).filter(
    (n) => n.endsWith(`_${singular}`) || n === singular,
  );
}
export function resolveItems(bot: Bot, requested: string): string[] {
  const name = normalise(requested);
  const known = bot.registry.itemsByName;
  if (known[name]) return [name];
  const singular = name.replace(/s$/, "");
  if (known[singular]) return [singular];
  const group = GROUPS[singular] ?? GROUPS[name];
  if (group) return Object.keys(known).filter(group);
  return Object.keys(known).filter((n) => n.endsWith(`_${singular}`));
}

export function inventorySummary(bot: Bot): string[] {
  const counts = new Map<string, number>();
  for (const item of bot.inventory.items())
    counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 36)
    .map(([name, count]) => `${name} x${count}`);
}
export function countItems(bot: Bot, names: string[]): number {
  return bot.inventory
    .items()
    .filter((i) => names.includes(i.name))
    .reduce((sum, i) => sum + i.count, 0);
}
export function timeOfDay(bot: Bot): "day" | "night" {
  const t = bot.time?.timeOfDay ?? 0;
  return t >= 12542 && t <= 23460 ? "night" : "day";
}
const round = (v: number) => Math.round(v * 10) / 10;
export function observe(bot: Bot, activity: string): Observation {
  const p = bot.entity?.position;
  return {
    position: p ? { x: round(p.x), y: round(p.y), z: round(p.z) } : null,
    health: typeof bot.health === "number" ? bot.health : null,
    food: typeof bot.food === "number" ? bot.food : null,
    dimension:
      typeof bot.game?.dimension === "string"
        ? bot.game.dimension.slice(0, 40)
        : null,
    time_of_day: bot.time ? timeOfDay(bot) : null,
    activity: activity.slice(0, 160),
    inventory: inventorySummary(bot).map((s) => s.slice(0, 48)),
    nearby_players: Object.values(bot.players)
      .filter((pl) => pl.entity && pl.username !== bot.username)
      .map((pl) => pl.username.slice(0, 32))
      .slice(0, 16),
    sign_in: null,
    error: null,
  };
}

/** A short plain-text picture of the surroundings, for the model. */
export function describeSurroundings(bot: Bot): string {
  const p = bot.entity.position;
  const lines = [
    `Position x=${Math.floor(p.x)} y=${Math.floor(p.y)} z=${Math.floor(p.z)} in ${bot.game.dimension}; it is ${timeOfDay(bot)} (time ${bot.time.timeOfDay}).`,
    `Health ${bot.health}/20, food ${bot.food}/20.`,
  ];
  const notable: Record<string, (n: string) => boolean> = {
    logs: GROUPS.log ?? (() => false),
    stone: (n) => n === "stone",
    "coal ore": (n) => n.includes("coal_ore"),
    "iron ore": (n) => n.includes("iron_ore"),
    water: (n) => n === "water",
    lava: (n) => n === "lava",
    "crafting tables": (n) => n === "crafting_table",
    chests: (n) => n === "chest",
    beds: (n) => n.endsWith("_bed"),
    crops: GROUPS.crop ?? (() => false),
  };
  const found: string[] = [];
  for (const [label, test] of Object.entries(notable)) {
    const ids = Object.values(bot.registry.blocksByName)
      .filter((b) => test(b.name))
      .map((b) => b.id);
    if (!ids.length) continue;
    const spots = bot.findBlocks({ matching: ids, maxDistance: 32, count: 64 });
    if (!spots.length) continue;
    const nearest = spots.reduce((a, b) =>
      a.distanceTo(p) <= b.distanceTo(p) ? a : b,
    );
    found.push(
      `${label}: ${spots.length >= 64 ? "64+" : spots.length} (nearest at ${nearest.x},${nearest.y},${nearest.z}, ${Math.round(nearest.distanceTo(p))} blocks)`,
    );
  }
  lines.push(
    found.length
      ? `Within 32 blocks: ${found.join("; ")}.`
      : "Nothing notable within 32 blocks.",
  );
  const creatures = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position.distanceTo(p) < 24)
    .map((e) => {
      const name =
        e.type === "player"
          ? `player ${e.username ?? "?"}`
          : (e.name ?? e.type);
      return `${name}${e.type === "hostile" ? " (hostile)" : ""} ${Math.round(e.position.distanceTo(p))}m`;
    })
    .slice(0, 12);
  if (creatures.length) lines.push(`Nearby: ${creatures.join(", ")}.`);
  const inv = inventorySummary(bot);
  lines.push(
    inv.length ? `Inventory: ${inv.join(", ")}.` : "Inventory: empty.",
  );
  return lines.join("\n");
}
