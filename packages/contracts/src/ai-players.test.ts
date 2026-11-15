import { expect, it } from "vitest";
import { aiPlayerInput, aiPlayerThink, aiPlayerUpdate } from "./ai-players.js";

it("applies defaults on create but never on update", () => {
  const created = aiPlayerInput.parse({
    name: "Pip",
    project_id: "00000000-0000-4000-8000-000000000001",
    connection_id: "00000000-0000-4000-8000-000000000002",
    model_id: "fixture/model",
    game_host: "127.0.0.1",
    game_port: 25565,
    mc_username: "PipTheHelper",
    mc_auth: "offline",
    daily_limit_micro: "1000000",
    total_limit_micro: "10000000",
  });
  expect(created).toMatchObject({
    persona: "",
    calls_per_hour: 120,
    game_version: "26.1",
  });
  // A partial update must not reset unnamed fields to their defaults.
  expect(aiPlayerUpdate.parse({ host_id: null, expected_version: 3 })).toEqual({
    host_id: null,
    expected_version: 3,
  });
  expect(() =>
    aiPlayerUpdate.parse({
      project_id: created.project_id,
      expected_version: 3,
    }),
  ).toThrow();
});
it("bounds what a worker may ask the model for", () => {
  const base = {
    request_id: "00000000-0000-4000-8000-000000000003",
    messages: [{ role: "user", content: "hi" }],
    max_input_tokens: 4096,
    max_output_tokens: 512,
    tools: [],
  };
  expect(aiPlayerThink.parse(base).max_output_tokens).toBe(512);
  expect(() =>
    aiPlayerThink.parse({ ...base, max_output_tokens: 9000 }),
  ).toThrow();
  expect(() => aiPlayerThink.parse({ ...base, timeout_ms: 1 })).toThrow();
});
