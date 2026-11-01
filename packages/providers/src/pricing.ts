import {
  decimalPrice,
  type ModelDescriptor,
  priceDimensions,
  pricingSchema,
} from "@craftlayer/contracts";

// All arithmetic is integral at 18 decimal places; fractional micro-USD rounds up.
export function scaledPrice(value: string): bigint {
  decimalPrice.parse(value);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole ?? "0") * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}
export function ceilingMicroUsd(value: string, units: bigint): bigint {
  if (units < 0n) throw new Error("Negative units");
  const numerator = scaledPrice(value) * units;
  return (numerator + 10n ** 12n - 1n) / 10n ** 12n;
}
export function zeroPriceReason(
  model: ModelDescriptor,
  now: number,
): string | null {
  const parsed = pricingSchema.safeParse(model.pricing);
  if (!parsed.success) return "invalid_pricing";
  const p = parsed.data;
  if (
    p.observed_at > now ||
    p.expires_at <= now ||
    p.expires_at <= p.observed_at ||
    p.expires_at - p.observed_at > 300000
  )
    return "stale_pricing";
  if (p.currency !== "USD" || p.unknown_dimensions.length)
    return "unknown_pricing";
  for (const key of priceDimensions) {
    const value = p.dimensions[key];
    if (!value) return "unknown_pricing";
    if (scaledPrice(value.amount) !== 0n) return "nonzero_pricing";
  }
  return model.zero_cost_enforced ? null : "zero_cost_not_enforced";
}
