import type { ModelDescriptor } from "@craftlayer/contracts";
import { expect, it } from "vitest";
import { FakeClock, fixtureRequest } from "./fixtures.js";
import { ProviderError } from "./index.js";
import { normalizeOpenRouter, OpenRouterProvider } from "./openrouter.js";
import { zeroPriceReason } from "./pricing.js";
import type { JsonWire, WireRequest } from "./wire.js";

const entry = {
  id: "fixture/model:free",
  pricing: { prompt: "0", completion: "0", request: "0", image: "0" },
  context_length: 32768,
  top_provider: { max_completion_tokens: 8192 },
  supported_parameters: ["max_tokens", "tools", "response_format"],
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
};
class RouterWire implements JsonWire {
  calls: WireRequest[] = [];
  entry: unknown = structuredClone(entry);
  response: unknown = {
    id: "fixture-result",
    model: entry.id,
    choices: [
      {
        message: { content: "Synthetic hosted result" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 4 },
  };
  failure: ProviderError | undefined;
  async json(request: WireRequest) {
    this.calls.push(request);
    if (request.effectful && this.failure) throw this.failure;
    return request.effectful
      ? structuredClone(this.response)
      : { data: [structuredClone(this.entry)] };
  }
}
it("keeps omitted/malformed/extra pricing unknown and never infers free enforcement", () => {
  const clock = new FakeClock(),
    model = normalizeOpenRouter(entry, clock.now);
  if (!model) throw new Error("Missing fixture");
  expect(model.pricing.dimensions.cache_read).toBeNull();
  expect(model.zero_cost_enforced).toBe(false);
  expect(zeroPriceReason(model, clock.now)).toBe("unknown_pricing");
  expect(
    normalizeOpenRouter({ ...entry, id: "openrouter/free" }, clock.now),
  ).toBeNull();
  expect(
    normalizeOpenRouter({ ...entry, id: "fixture/model:online" }, clock.now),
  ).toBeNull();
  const extra = normalizeOpenRouter(
    {
      ...entry,
      pricing: { ...entry.pricing, prompt: "-1", unmodeled_charge: "1" },
    },
    clock.now,
  );
  expect(extra?.pricing.dimensions.input).toBeNull();
  expect(extra?.pricing.unknown_dimensions).toEqual(["unmodeled_charge"]);
});
it("uses one explicit model with upstream fallbacks/plugins disabled and known price bounds", async () => {
  const clock = new FakeClock(),
    wire = new RouterWire(),
    provider = new OpenRouterProvider(
      "synthetic-api-key-canary",
      [entry.id],
      wire,
      () => clock.now,
    ),
    signal = AbortSignal.timeout(1000),
    model = (await provider.discover(signal))[0];
  if (!model) throw new Error("Missing fixture");
  expect(
    (await provider.generate(model, fixtureRequest(), signal)).usage.quality,
  ).toBe("observed");
  const calls = wire.calls.filter((c) => c.effectful);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.body).toMatchObject({
    model: entry.id,
    stream: false,
    plugins: [],
    provider: {
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    },
  });
  expect(calls[0]?.body).not.toHaveProperty("models");
  expect(
    wire.calls.filter((c) => !c.effectful).every((c) => c.secret === undefined),
  ).toBe(true);
});
for (const code of ["rate_limited", "auth", "timeout", "unavailable"] as const)
  it(`does not retry ${code} inside the adapter`, async () => {
    const wire = new RouterWire(),
      provider = new OpenRouterProvider(
        "synthetic-api-key-canary",
        [entry.id],
        wire,
      ),
      signal = AbortSignal.timeout(1000),
      model = (await provider.discover(signal))[0] as ModelDescriptor;
    wire.failure = new ProviderError(code, true);
    await expect(
      provider.generate(model, fixtureRequest(), signal),
    ).rejects.toMatchObject({ code });
    expect(wire.calls.filter((c) => c.effectful)).toHaveLength(1);
  });
it("rejects changed pricing before dispatch and suppresses provider credential echoes", async () => {
  const wire = new RouterWire(),
    provider = new OpenRouterProvider(
      "synthetic-api-key-canary",
      [entry.id],
      wire,
    ),
    signal = AbortSignal.timeout(1000),
    model = (await provider.discover(signal))[0] as ModelDescriptor;
  wire.entry = { ...entry, pricing: { ...entry.pricing, completion: "0.1" } };
  await expect(
    provider.generate(model, fixtureRequest(), signal),
  ).rejects.toMatchObject({ code: "policy_denied", dispatched: false });
  expect(wire.calls.filter((c) => c.effectful)).toHaveLength(0);
  wire.entry = entry;
  wire.response = {
    model: entry.id,
    choices: [
      {
        message: { content: "synthetic-api-key-canary" },
        finish_reason: "stop",
      },
    ],
  };
  await expect(
    provider.generate(model, fixtureRequest(), signal),
  ).rejects.toMatchObject({ code: "malformed_response", dispatched: true });
});
