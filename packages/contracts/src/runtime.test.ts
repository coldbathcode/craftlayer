import { expect, it } from "vitest";
import { fixtureTool, graphSchema } from "./runtime.js";

it("bounds model/task input and excludes arbitrary capabilities and authority fields", () => {
  const node = {
    key: "echo",
    action: { kind: "fixture.echo", value: "bounded" },
  };
  expect(
    graphSchema.safeParse({ schema_version: 1, nodes: [node] }).success,
  ).toBe(true);
  for (const change of [
    { action: { kind: "shell", command: "anything" } },
    { max_attempts: 4 },
    { timeout_ms: 60000 },
    { organization_id: crypto.randomUUID() },
  ])
    expect(
      graphSchema.safeParse({
        schema_version: 1,
        nodes: [{ ...node, ...change }],
      }).success,
    ).toBe(false);
  expect(
    fixtureTool.safeParse({
      tool: "fixture.echo",
      arguments: { value: "safe", admin: true },
    }).success,
  ).toBe(false);
  expect(
    fixtureTool.safeParse({
      tool: "provider.generate",
      arguments: { value: "safe" },
    }).success,
  ).toBe(false);
});
