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
it("prices contained dimensions at zero, keeps malformed/extra pricing unknown and never infers free enforcement", () => {
  const clock = new FakeClock(),
    model = normalizeOpenRouter(entry, clock.now);
  if (!model) throw new Error("Missing fixture");
  // Cached/reasoning tokens sit inside prompt/completion counts; audio, tool fees never apply (ADR 0052).
  expect(model.pricing.dimensions.cache_read).toEqual({
    amount: "0",
    unit: "token",
  });
  expect(model.pricing.dimensions.reasoning).toEqual({
    amount: "0",
    unit: "token",
  });
  expect(model.zero_cost_enforced).toBe(false);
  expect(zeroPriceReason(model, clock.now)).toBe("zero_cost_not_enforced");
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
it("counts a reasoning price only above the output price and ignores zero-valued extras", () => {
  const clock = new FakeClock(),
    paid = normalizeOpenRouter(
      {
        ...entry,
        id: "fixture/paid",
        pricing: {
          prompt: "0.000003",
          completion: "0.000015",
          request: "0",
          image: "0",
          internal_reasoning: "0.00002",
          input_cache_read: "0.0000003",
          web_search: "0.01",
          future_free_thing: "0",
        },
        top_provider: { max_completion_tokens: null },
        supported_parameters: ["max_tokens", "tools", "reasoning"],
      },
      clock.now,
    );
  if (!paid) throw new Error("Missing fixture");
  expect(paid.pricing.dimensions.reasoning?.amount).toBe("0.000005");
  expect(paid.pricing.dimensions.cache_read?.amount).toBe("0");
  expect(paid.pricing.unknown_dimensions).toEqual([]);
  expect(paid.output_tokens).toBe(8192);
  expect(paid.capabilities.reasoning).toBe(true);
  const surprise = normalizeOpenRouter(
    { ...entry, pricing: { ...entry.pricing, per_hour_fee: "0.5" } },
    clock.now,
  );
  expect(surprise?.pricing.unknown_dimensions).toEqual(["per_hour_fee"]);
});
it("prices today's catalog entries, which omit zero request and image fees", () => {
  const clock = new FakeClock(),
    current = normalizeOpenRouter(
      {
        ...entry,
        id: "fixture/current",
        pricing: {
          prompt: "0.00000025",
          completion: "0.000002",
          web_search: "0.01",
          input_cache_read: "0.000000025",
          input_cache_write_1h: "0.0000002",
          input_audio_cache: "0.00000003",
        },
        supported_parameters: ["max_tokens", "tools"],
      },
      clock.now,
    );
  if (!current) throw new Error("Missing fixture");
  expect(current.pricing.unknown_dimensions).toEqual([]);
  expect(current.pricing.dimensions.request?.amount).toBe("0");
  expect(current.pricing.dimensions.image?.amount).toBe("0");
  // A listed request fee is still charged; tiered "overrides" stay unknown.
  const fee = normalizeOpenRouter(
    {
      ...entry,
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        request: "0.001",
        overrides: [{ min_prompt_tokens: 100000, prompt: "0.000002" }],
      },
    },
    clock.now,
  );
  expect(fee?.pricing.dimensions.request?.amount).toBe("0.001");
  expect(fee?.pricing.unknown_dimensions).toEqual(["overrides"]);
});
