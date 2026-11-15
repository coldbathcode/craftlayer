import { expect, it } from "vitest";
import { CompatibleProvider, describeCompatible } from "./compatible.js";
import { FakeClock, fixtureRequest } from "./fixtures.js";
import { ProviderError } from "./index.js";
import { compatibleEndpointSchema, instancePolicySchema } from "./instance.js";
import { maximumCost } from "./router.js";
import type { JsonWire, WireRequest } from "./wire.js";

const prices = {
  input: "0.000003",
  output: "0.000015",
  cache_read: "0",
  cache_write: "0",
  request: "0",
  image: "0",
  audio: "0",
  reasoning: "0",
  tool: "0",
};
const kong = compatibleEndpointSchema.parse({
  id: "kong",
  label: "Kong AI Gateway",
  flavor: "kong_ai_gateway",
  url: "https://ai.example.test/llm",
  chat_path: "v1/chat/completions",
  auth_header: "apikey",
  network: "public",
  models: [
    {
      id: "claude-sonnet-fixture",
      context_tokens: 200000,
      output_tokens: 8192,
      tools: true,
      structured: false,
      prices,
      price_source: "Provider price page",
      price_checked_on: "2026-11-15",
    },
  ],
});
class KongWire implements JsonWire {
  calls: WireRequest[] = [];
  response: unknown = {
    id: "kong-result",
    model: "claude-sonnet-upstream-name",
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              type: "function",
              function: { name: "fixture_tool", arguments: '{"a":1}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  };
  async json(request: WireRequest) {
    this.calls.push(request);
    return structuredClone(this.response);
  }
}
const toolRequest = () => ({
  ...fixtureRequest(),
  tools: [
    {
      name: "fixture_tool",
      description: "Synthetic tool",
      parameters: { type: "object", properties: { a: { type: "number" } } },
    },
  ],
});

it("describes declared models with the full operator price table", () => {
  const clock = new FakeClock(),
    [model] = describeCompatible(kong, clock.now);
  if (!model) throw new Error("Missing model");
  expect(model.provider).toBe("openai_compatible");
  expect(model.pricing.source).toBe("operator_price_table");
  expect(model.pricing.expires_at - model.pricing.observed_at).toBe(300000);
  const request = {
    ...fixtureRequest(),
    max_input_tokens: 1000,
    max_output_tokens: 100,
  };
  // 1000 input at 3 µUSD + 100 output at 15 µUSD; zero for every other dimension.
  expect(maximumCost(model, request)).toBe(4500n);
});
it("posts one explicit model to the declared path with Kong's apikey header", async () => {
  const clock = new FakeClock(),
    wire = new KongWire(),
    provider = new CompatibleProvider(
      kong,
      "synthetic-kong-key-canary",
      wire,
      () => clock.now,
    ),
    [model] = await provider.discover();
  if (!model) throw new Error("Missing model");
  const result = await provider.generate(
    model,
    toolRequest(),
    AbortSignal.timeout(1000),
  );
  expect(result.tool_calls).toEqual([
    { name: "fixture_tool", arguments: { a: 1 } },
  ]);
  expect(result.usage).toEqual({
    input_tokens: 120,
    output_tokens: 30,
    quality: "observed",
  });
  const call = wire.calls[0];
  expect(call?.target).toMatchObject({
    kind: "compatible",
    auth_header: "apikey",
  });
  expect(call?.path).toBe("v1/chat/completions");
  expect(call?.body).toMatchObject({
    model: "claude-sonnet-fixture",
    stream: false,
  });
});
it("refuses undeclared models, missing keys, changed prices and unknown tools", async () => {
  const clock = new FakeClock(),
    wire = new KongWire(),
    provider = new CompatibleProvider(
      kong,
      "synthetic-kong-key-canary",
      wire,
      () => clock.now,
    ),
    [model] = await provider.discover();
  if (!model) throw new Error("Missing model");
  const signal = AbortSignal.timeout(1000);
  await expect(
    provider.generate({ ...model, id: "other-model" }, toolRequest(), signal),
  ).rejects.toMatchObject({ code: "policy_denied" });
  await expect(
    new CompatibleProvider(kong, undefined, wire).generate(
      model,
      toolRequest(),
      signal,
    ),
  ).rejects.toMatchObject({ code: "policy_denied" });
  await expect(
    provider.generate(
      { ...model, pricing: { ...model.pricing, source_hash: "0".repeat(64) } },
      toolRequest(),
      signal,
    ),
  ).rejects.toMatchObject({ code: "policy_denied" });
  wire.response = {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { type: "function", function: { name: "rm_rf", arguments: "{}" } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
  await expect(
    provider.generate(model, toolRequest(), signal),
  ).rejects.toBeInstanceOf(ProviderError);
  expect(wire.calls.filter((c) => c.effectful)).toHaveLength(1);
});
it("rejects unsafe endpoint declarations", () => {
  const base = { ...kong, models: kong.models };
  expect(() =>
    compatibleEndpointSchema.parse({ ...base, url: "http://ai.example.test" }),
  ).toThrow();
  expect(() =>
    compatibleEndpointSchema.parse({
      ...base,
      network: "private",
      addresses: ["8.8.8.8"],
    }),
  ).toThrow();
  expect(
    compatibleEndpointSchema.parse({
      ...base,
      url: "http://kong.tailnet.test:8000",
      network: "private",
      addresses: ["100.101.102.103"],
    }).network,
  ).toBe("private");
  expect(() =>
    compatibleEndpointSchema.parse({ ...base, chat_path: "../admin" }),
  ).toThrow();
  expect(
    instancePolicySchema.parse({
      version: 1,
      openrouter_enabled: false,
      allow_paid: false,
      max_paid_micro_usd: "0",
      stopped: false,
      ollama: [],
    }).openai_compatible,
  ).toEqual([]);
});
it("keeps the compatible wire on the declared path and addresses", async () => {
  const { HttpWire } = await import("./wire.js");
  const resolver = (async () => [{ address: "10.0.0.5", family: 4 }]) as never;
  const wire = new HttpWire(resolver);
  const target = {
    kind: "compatible" as const,
    url: "http://kong.lan.test:8000/llm",
    chat_path: "v1/chat/completions",
    network: "private" as const,
    addresses: ["10.0.0.9"],
    auth_header: "apikey" as const,
  };
  const call = (path: string, t = target) =>
    wire.json({
      target: t,
      path,
      method: "POST",
      body: {},
      secret: "synthetic-kong-key-canary",
      signal: AbortSignal.timeout(1000),
      timeout_ms: 1000,
      effectful: false,
    });
  await expect(call("v1/admin")).rejects.toMatchObject({
    code: "policy_denied",
  });
  // Resolves to a LAN address that is not the declared one.
  await expect(call("v1/chat/completions")).rejects.toMatchObject({
    code: "policy_denied",
  });
  // A public endpoint that resolves to a private address is refused.
  await expect(
    call("v1/chat/completions", {
      ...target,
      url: "https://ai.example.test/llm",
      network: "public",
      addresses: [],
    } as never),
  ).rejects.toMatchObject({ code: "policy_denied" });
});
