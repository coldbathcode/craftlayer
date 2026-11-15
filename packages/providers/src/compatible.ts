import { createHash } from "node:crypto";
import {
  type GenerateRequest,
  generateRequestSchema,
  generateResultSchema,
  type ModelDescriptor,
  modelSchema,
} from "@craftlayer/contracts";
import { z } from "zod";
import { providerSecret } from "./credentials.js";
import { type ModelProvider, ProviderError } from "./index.js";
import type { CompatibleEndpoint } from "./instance.js";
import { HttpWire, type JsonWire, statusError } from "./wire.js";

const resultSchema = z.object({
  id: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          tool_calls: z
            .array(
              z.object({
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .max(16)
            .optional(),
        }),
        finish_reason: z.enum(["stop", "length", "tool_calls"]),
      }),
    )
    .length(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

const unit = {
  input: "token",
  output: "token",
  cache_read: "token",
  cache_write: "token",
  request: "request",
  image: "image",
  audio: "second",
  reasoning: "token",
  tool: "tool_call",
} as const;

/** Model descriptors come only from the operator's declared table, never the endpoint. */
export function describeCompatible(
  endpoint: CompatibleEndpoint,
  now: number,
): ModelDescriptor[] {
  return endpoint.models.map((entry) =>
    modelSchema.parse({
      id: entry.id,
      provider: "openai_compatible",
      classification: "hosted",
      zero_cost_enforced: false,
      capabilities: {
        text: true,
        tools: entry.tools,
        structured: entry.structured,
        reasoning: null,
      },
      context_tokens: entry.context_tokens,
      output_tokens: entry.output_tokens,
      pricing: {
        currency: "USD",
        dimensions: Object.fromEntries(
          (Object.keys(unit) as Array<keyof typeof unit>).map((key) => [
            key,
            { amount: entry.prices[key], unit: unit[key] },
          ]),
        ),
        unknown_dimensions: [],
        observed_at: now,
        expires_at: now + 300000,
        source: "operator_price_table",
        source_hash: createHash("sha256")
          .update(JSON.stringify([endpoint.id, endpoint.url, entry]))
          .digest("hex"),
      },
    }),
  );
}

function rejectSecret(value: unknown, secret: string) {
  if (JSON.stringify(value).includes(secret))
    throw new ProviderError("malformed_response", true);
}

/**
 * An OpenAI-compatible chat endpoint the instance operator approved, such as
 * Kong AI Gateway. One explicit model per call; no streaming, no fallbacks.
 */
export class CompatibleProvider implements ModelProvider {
  #secret: string | undefined;
  constructor(
    private endpoint: CompatibleEndpoint,
    secret: string | undefined,
    private wire: JsonWire = new HttpWire(),
    private now: () => number = Date.now,
  ) {
    this.#secret =
      secret === undefined ? undefined : providerSecret.parse(secret);
  }
  async discover(): Promise<ModelDescriptor[]> {
    return describeCompatible(this.endpoint, this.now());
  }
  async generate(
    model: ModelDescriptor,
    input: GenerateRequest,
    signal: AbortSignal,
    beforeDispatch?: () => Promise<void>,
  ) {
    const request = generateRequestSchema.parse(input),
      deadline = AbortSignal.any([
        signal,
        AbortSignal.timeout(request.timeout_ms),
      ]);
    const declared = describeCompatible(this.endpoint, this.now()).find(
      (m) => m.id === model.id,
    );
    if (
      !this.#secret ||
      model.provider !== "openai_compatible" ||
      !declared ||
      declared.pricing.source_hash !== model.pricing.source_hash ||
      request.max_input_tokens + request.max_output_tokens >
        (declared.context_tokens ?? 0) ||
      request.max_output_tokens > (declared.output_tokens ?? 0) ||
      (request.tools.length && declared.capabilities.tools !== true) ||
      (request.response_format === "json" &&
        declared.capabilities.structured !== true)
    )
      throw new ProviderError("policy_denied", false);
    const secret = this.#secret;
    try {
      const raw = await this.wire.json({
        target: {
          kind: "compatible",
          url: this.endpoint.url,
          chat_path: this.endpoint.chat_path,
          network: this.endpoint.network,
          addresses: this.endpoint.addresses,
          auth_header: this.endpoint.auth_header,
        },
        path: this.endpoint.chat_path,
        method: "POST",
        secret,
        signal: deadline,
        timeout_ms: request.timeout_ms,
        effectful: true,
        before_dispatch: beforeDispatch,
        body: {
          model: model.id,
          messages: request.messages,
          max_tokens: request.max_output_tokens,
          stream: false,
          ...(request.response_format === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
          ...(request.tools.length
            ? {
                tools: request.tools.map((t) => ({
                  type: "function",
                  function: t,
                })),
                tool_choice: "auto",
              }
            : {}),
        },
      });
      rejectSecret(raw, secret);
      const inBand = z
        .object({ error: z.object({ code: z.number() }) })
        .safeParse(raw);
      if (inBand.success)
        throw statusError(inBand.data.error.code, undefined, true);
      const result = resultSchema.parse(raw),
        choice = result.choices[0];
      if (!choice) throw new ProviderError("malformed_response", true);
      const tools =
        choice.message.tool_calls?.map((t) => ({
          name: t.function.name,
          arguments: z
            .record(z.string(), z.json())
            .parse(JSON.parse(t.function.arguments || "{}")),
        })) ?? [];
      if (
        tools.some(
          (t) => !request.tools.some((allowed) => allowed.name === t.name),
        )
      )
        throw new ProviderError("malformed_response", true);
      if (request.response_format === "json")
        JSON.parse(choice.message.content ?? "");
      return generateResultSchema.parse({
        text: choice.message.content ?? "",
        tool_calls: tools,
        finish_reason: choice.finish_reason,
        usage: {
          input_tokens: result.usage?.prompt_tokens ?? null,
          output_tokens: result.usage?.completion_tokens ?? null,
          quality: result.usage ? "observed" : "unknown",
        },
        provider_request_id: result.id ?? null,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("malformed_response", true);
    }
  }
}
