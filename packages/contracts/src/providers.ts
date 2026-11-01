import { z } from "zod";

export const providerKind = z.enum(["ollama", "openrouter"]);
export const priceDimensions = [
  "input",
  "output",
  "cache_read",
  "cache_write",
  "request",
  "image",
  "audio",
  "reasoning",
  "tool",
] as const;
export const decimalPrice = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,18})?$/);
export const microUsd = z.string().regex(/^(0|[1-9][0-9]{0,23})$/);
const dimension = z
  .strictObject({
    amount: decimalPrice,
    unit: z.enum(["token", "request", "image", "second", "tool_call"]),
  })
  .nullable();
export const pricingSchema = z
  .strictObject({
    currency: z.literal("USD").nullable(),
    dimensions: z.strictObject({
      input: dimension,
      output: dimension,
      cache_read: dimension,
      cache_write: dimension,
      request: dimension,
      image: dimension,
      audio: dimension,
      reasoning: dimension,
      tool: dimension,
    }),
    unknown_dimensions: z.array(z.string().max(80)).max(32),
    observed_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    expires_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    source_hash: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.enum(["provider_catalog", "operator_local", "fixture"]),
  })
  .refine(
    (p) =>
      priceDimensions.every((key) => {
        const value = p.dimensions[key];
        const expected =
          key === "request"
            ? "request"
            : key === "image"
              ? "image"
              : key === "audio"
                ? "second"
                : key === "tool"
                  ? "tool_call"
                  : "token";
        return value === null || value.unit === expected;
      }),
    "Price dimension unit mismatch",
  );
export const modelSchema = z.strictObject({
  id: z.string().min(1).max(180),
  provider: providerKind,
  capabilities: z.strictObject({
    text: z.boolean().nullable(),
    tools: z.boolean().nullable(),
    structured: z.boolean().nullable(),
    reasoning: z.boolean().nullable(),
  }),
  context_tokens: z.number().int().positive().max(2_000_000).nullable(),
  output_tokens: z.number().int().positive().max(1_000_000).nullable(),
  pricing: pricingSchema,
  classification: z.enum(["operator_local", "hosted"]),
  zero_cost_enforced: z.boolean(),
});
export const generateRequestSchema = z.strictObject({
  schema_version: z.literal(1),
  request_id: z.uuid(),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(16384),
      }),
    )
    .min(1)
    .max(16),
  max_input_tokens: z.number().int().min(1).max(131072),
  max_output_tokens: z.number().int().min(1).max(8192),
  timeout_ms: z.number().int().min(100).max(60000),
  response_format: z.enum(["text", "json"]),
  tools: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
        description: z.string().max(512),
        parameters: z.record(z.string(), z.json()),
      }),
    )
    .max(16),
});
export const usageSchema = z
  .strictObject({
    input_tokens: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    output_tokens: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    quality: z.enum(["observed", "estimated", "unknown"]),
  })
  .refine(
    (u) =>
      u.quality !== "observed" ||
      (u.input_tokens !== null && u.output_tokens !== null),
    "Observed usage requires both counters",
  );
export const generateResultSchema = z.strictObject({
  text: z.string().max(262144),
  tool_calls: z
    .array(
      z.strictObject({
        name: z.string().max(64),
        arguments: z.record(z.string(), z.json()),
      }),
    )
    .max(16),
  finish_reason: z.enum(["stop", "length", "tool_calls"]),
  usage: usageSchema,
  provider_request_id: z.string().max(200).nullable(),
});
export const providerErrorCodes = [
  "rate_limited",
  "auth",
  "unavailable",
  "malformed_response",
  "context_exceeded",
  "timeout",
  "aborted",
  "policy_denied",
] as const;
export const providerErrorSchema = z.strictObject({
  code: z.enum(providerErrorCodes),
  dispatched: z.boolean(),
  retry_after_ms: z.number().int().min(0).max(300000).nullable(),
});
export const defaultModelPolicy = {
  allowed_models: null,
  free_only: true,
  allow_paid_fallback: false,
  max_paid_micro_usd: "0",
  allow_hosted: false,
  max_input_tokens: 16384,
  max_output_tokens: 2048,
  max_attempts: 2,
} as const;
export const modelPolicySchema = z.strictObject({
  allowed_models: z
    .array(z.string().min(1).max(180))
    .max(64)
    .nullable()
    .default(null),
  free_only: z.boolean(),
  allow_paid_fallback: z.boolean(),
  max_paid_micro_usd: microUsd,
  allow_hosted: z.boolean(),
  max_input_tokens: z.number().int().min(1).max(131072),
  max_output_tokens: z.number().int().min(1).max(8192),
  max_attempts: z.number().int().min(1).max(3),
});
export type ModelDescriptor = z.infer<typeof modelSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type GenerateResult = z.infer<typeof generateResultSchema>;
export type ModelPolicy = z.infer<typeof modelPolicySchema>;
export type PriceSnapshot = z.infer<typeof pricingSchema>;
export type ProviderErrorCode = (typeof providerErrorCodes)[number];

export const connectionSchema = z.strictObject({
  id: z.uuid(),
  kind: providerKind,
  endpoint_id: z.string().max(40),
  label: z.string().max(80),
  enabled: z.boolean(),
  version: z.number().int().positive(),
  credential_configured: z.boolean(),
  key_id: z.string().nullable(),
});
export const connectionCreateSchema = z.strictObject({
  kind: providerKind,
  endpoint_id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  secret: z
    .string()
    .min(16)
    .max(512)
    .regex(/^[\x21-\x7e]+$/)
    .optional(),
});
