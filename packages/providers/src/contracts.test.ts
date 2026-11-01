import {
  generateRequestSchema,
  modelSchema,
  priceDimensions,
  providerErrorCodes,
  providerErrorSchema,
} from "@craftlayer/contracts";
import { expect, it } from "vitest";
import { FakeClock, fixtureModel, fixtureRequest } from "./fixtures.js";
import { ProviderError } from "./index.js";
import { ceilingMicroUsd, scaledPrice, zeroPriceReason } from "./pricing.js";

for (const code of providerErrorCodes)
  it(`normalizes ${code} without upstream content`, () => {
    const error = new ProviderError(
      code,
      true,
      code === "rate_limited" ? 1000 : null,
    );
    expect(
      providerErrorSchema.parse({
        code: error.code,
        dispatched: error.dispatched,
        retry_after_ms: error.retry_after_ms,
      }).code,
    ).toBe(code);
  });
it("rejects request authority, unsafe capabilities and malformed prices", () => {
  const model = fixtureModel(new FakeClock().now);
  expect(
    generateRequestSchema.safeParse({
      ...fixtureRequest(),
      credential_id: crypto.randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    modelSchema.safeParse({
      ...model,
      capabilities: { ...model.capabilities, arbitrary_tools: true },
    }).success,
  ).toBe(false);
  expect(
    modelSchema.safeParse({
      ...model,
      capabilities: { ...model.capabilities, text: "yes" },
    }).success,
  ).toBe(false);
  for (const value of [
    "-1",
    "NaN",
    "Infinity",
    "1e10",
    "1000000000",
    "0.0000000000000000001",
  ]) {
    expect(() => scaledPrice(value)).toThrow();
  }
  expect(ceilingMicroUsd("0.000000000000000001", 1n)).toBe(1n);
  expect(ceilingMicroUsd("0.0000015", 3n)).toBe(5n);
});
it("requires every fresh zero dimension and enforcement, independently of model suffix", () => {
  const clock = new FakeClock(),
    model = fixtureModel(clock.now, { id: "synthetic/paid:free" });
  expect(zeroPriceReason(model, clock.now)).toBeNull();
  for (const dimension of priceDimensions) {
    const p = structuredClone(model);
    p.pricing.dimensions[dimension] = null;
    expect(zeroPriceReason(p, clock.now)).toBe("unknown_pricing");
    p.pricing.dimensions[dimension] = {
      amount: "0.000000000000000001",
      unit: model.pricing.dimensions[dimension]?.unit ?? "token",
    };
    expect(zeroPriceReason(p, clock.now)).toBe("nonzero_pricing");
  }
  expect(
    zeroPriceReason({ ...model, zero_cost_enforced: false }, clock.now),
  ).toBe("zero_cost_not_enforced");
  clock.advance(300000);
  expect(zeroPriceReason(model, clock.now)).toBe("stale_pricing");
});
