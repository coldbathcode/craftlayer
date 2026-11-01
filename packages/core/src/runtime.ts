export interface GraphNode {
  key: string;
  required: boolean;
  dependencies: Array<{ key: string; required: boolean }>;
}
/** Validate identifiers and edges independently of transport or persistence frameworks. */
export function validateDag(nodes: readonly GraphNode[]): string[] {
  if (nodes.length < 1 || nodes.length > 50) throw new Error("GRAPH_SIZE");
  const all = new Map(nodes.map((node) => [node.key, node]));
  if (all.size !== nodes.length) throw new Error("DUPLICATE_NODE");
  const visiting = new Set<string>(),
    done = new Set<string>(),
    order: string[] = [];
  function visit(key: string) {
    if (done.has(key)) return;
    if (visiting.has(key)) throw new Error("GRAPH_CYCLE");
    const node = all.get(key);
    if (!node) throw new Error("MISSING_DEPENDENCY");
    if (
      new Set(node.dependencies.map((edge) => edge.key)).size !==
      node.dependencies.length
    )
      throw new Error("DUPLICATE_EDGE");
    visiting.add(key);
    for (const edge of node.dependencies) visit(edge.key);
    visiting.delete(key);
    done.add(key);
    order.push(key);
  }
  for (const node of nodes) visit(node.key);
  return order;
}
export const missionTransitions: Record<string, readonly string[]> = {
  draft: ["queued", "cancelled"],
  queued: ["running", "paused", "blocked", "cancelling", "cancelled", "failed"],
  running: ["paused", "blocked", "cancelling", "succeeded", "failed"],
  paused: ["queued", "blocked", "cancelling", "cancelled", "failed"],
  blocked: ["queued", "paused", "cancelling", "cancelled", "failed"],
  cancelling: ["cancelled", "blocked"],
  succeeded: [],
  failed: [],
  cancelled: [],
};
export const taskTransitions: Record<string, readonly string[]> = {
  pending: ["ready", "blocked", "skipped", "cancelled"],
  ready: ["leased", "blocked", "cancelled"],
  leased: ["running", "ready", "blocked", "cancel_requested"],
  running: ["succeeded", "failed", "retry_wait", "blocked", "cancel_requested"],
  retry_wait: ["ready", "blocked", "cancelled"],
  blocked: ["pending", "ready", "failed", "cancelled"],
  cancel_requested: ["cancelled", "blocked"],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};
export function assertTransition(
  kind: "mission" | "task",
  from: string,
  to: string,
) {
  if (
    !(kind === "mission" ? missionTransitions : taskTransitions)[
      from
    ]?.includes(to)
  )
    throw new Error("INVALID_TRANSITION");
}
export function dependencyDecision(
  node: GraphNode,
  states: ReadonlyMap<string, string>,
): "wait" | "ready" | "blocked" {
  for (const edge of node.dependencies) {
    const state = states.get(edge.key);
    if (
      !state ||
      !["succeeded", "failed", "skipped", "cancelled"].includes(state)
    )
      return "wait";
    if (edge.required && state !== "succeeded") return "blocked";
  }
  return "ready";
}
export function missionOutcome(
  nodes: readonly GraphNode[],
  states: ReadonlyMap<string, string>,
): "running" | "succeeded" | "failed" {
  if (
    nodes.some(
      (n) =>
        n.required &&
        ["failed", "skipped", "cancelled"].includes(states.get(n.key) ?? ""),
    )
  )
    return "failed";
  if (
    nodes.every((n) =>
      ["succeeded", "failed", "skipped", "cancelled"].includes(
        states.get(n.key) ?? "",
      ),
    )
  )
    return "succeeded";
  return "running";
}
