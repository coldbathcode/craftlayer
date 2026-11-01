import { describe, expect, it } from "vitest";
import {
  assertTransition,
  dependencyDecision,
  missionOutcome,
  validateDag,
} from "./runtime.js";

const n = (
  key: string,
  dependencies: Array<{ key: string; required: boolean }> = [],
  required = true,
) => ({ key, dependencies, required });
describe("bounded finite mission domain", () => {
  it("rejects cycles, duplicate nodes/edges, missing references and oversized graphs", () => {
    for (const nodes of [
      [n("a", [{ key: "a", required: true }])],
      [n("a"), n("a")],
      [n("a", [{ key: "b", required: true }])],
      [
        n("a"),
        n("b", [
          { key: "a", required: true },
          { key: "a", required: true },
        ]),
      ],
      Array.from({ length: 51 }, (_, i) => n(`n${i}`)),
      [],
    ])
      expect(() => validateDag(nodes)).toThrow();
  });
  it("completes a deterministic graph only after all required verified outcomes", () => {
    const nodes = [
      n("observe"),
      n("build", [{ key: "observe", required: true }]),
      n("optional", [], false),
    ];
    expect(validateDag(nodes)).toEqual(["observe", "build", "optional"]);
    const states = new Map<string, string>();
    for (const key of validateDag(nodes)) {
      const node = nodes.find((v) => v.key === key);
      if (!node) throw new Error("Missing fixture node");
      expect(dependencyDecision(node, states)).toBe("ready");
      for (const [from, to] of [
        ["pending", "ready"],
        ["ready", "leased"],
        ["leased", "running"],
        ["running", "succeeded"],
      ] as const)
        assertTransition("task", from, to);
      states.set(key, "succeeded");
    }
    expect(missionOutcome(nodes, states)).toBe("succeeded");
    expect(() => assertTransition("task", "succeeded", "ready")).toThrow();
    expect(() => assertTransition("mission", "failed", "queued")).toThrow();
    expect(() => assertTransition("mission", "unknown", "queued")).toThrow();
    states.set("optional", "failed");
    expect(missionOutcome(nodes, states)).toBe("succeeded");
    states.set("observe", "failed");
    expect(
      dependencyDecision(
        n("build", [{ key: "observe", required: true }]),
        states,
      ),
    ).toBe("blocked");
    expect(missionOutcome(nodes, states)).toBe("failed");
  });
});
