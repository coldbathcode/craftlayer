import { createHash } from "node:crypto";
import {
  decimalPrice,
  type GenerateRequest,
  generateRequestSchema,
  generateResultSchema,
  type ModelDescriptor,
  modelSchema,
  priceDimensions,
} from "@craftlayer/contracts";
import { z } from "zod";
import { providerSecret } from "./credentials.js";
import { type ModelProvider, ProviderError } from "./index.js";
import { ceilingMicroUsd } from "./pricing.js";
import { HttpWire, type JsonWire, statusError } from "./wire.js";

const explicitModel = z
  .string()
  .regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?::free)?$/)
  .max(180)
  .refine((id) => !id.startsWith("openrouter/"));
const entrySchema = z.looseObject({
  id: z.string(),
  pricing: z.record(z.string(), z.unknown()).optional(),
  context_length: z.number().optional(),
  top_provider: z
    .object({ max_completion_tokens: z.number().nullable().optional() })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    })
    .optional(),
});
const resultSchema = z.object({
  id: z.string().max(200).optional(),
  model: z.string(),
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
const positive = (value: unknown, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= max
    ? value
    : null;
export function normalizeOpenRouter(
  raw: unknown,
  now: number,
): ModelDescriptor | null {
  const parsed = entrySchema.safeParse(raw);
  if (!parsed.success || !explicitModel.safeParse(parsed.data.id).success)
    return null;
  const entry = parsed.data,
    dimensions = Object.fromEntries(
      priceDimensions.map((key) => [key, null]),
    ) as ModelDescriptor["pricing"]["dimensions"];
  const map = {
    prompt: "input",
    completion: "output",
    request: "request",
    image: "image",
  } as const;
  for (const [key, dimension] of Object.entries(map)) {
    const value = decimalPrice.safeParse(entry.pricing?.[key]);
    if (value.success)
      dimensions[dimension] = {
        amount: value.data,
        unit:
          dimension === "request"
            ? "request"
            : dimension === "image"
              ? "image"
              : "token",
      };
  }
  const unknown = Object.keys(entry.pricing ?? {})
    .filter((key) => !Object.hasOwn(map, key))
    .map((key) =>
      /^[a-z][a-z0-9_]{0,39}$/.test(key) ? key : "unrecognized_field",
    )
    .slice(0, 32);
  const params = entry.supported_parameters,
    architecture = entry.architecture;
  return modelSchema.parse({
    id: entry.id,
    provider: "openrouter",
    classification: "hosted",
    zero_cost_enforced: false,
    capabilities: {
      text:
        architecture?.input_modalities && architecture.output_modalities
          ? architecture.input_modalities.includes("text") &&
            architecture.output_modalities.includes("text")
          : null,
      tools: params ? params.includes("tools") : null,
      structured: params ? params.includes("response_format") : null,
      reasoning: params ? params.includes("reasoning") : null,
    },
    context_tokens: positive(entry.context_length, 2_000_000),
    output_tokens: positive(
      entry.top_provider?.max_completion_tokens,
      1_000_000,
    ),
    pricing: {
      currency: "USD",
      dimensions,
      unknown_dimensions: unknown,
      observed_at: now,
      expires_at: now + 300000,
      source: "provider_catalog",
      source_hash: createHash("sha256")
        .update(JSON.stringify(raw))
        .digest("hex"),
    },
  });
}
function rejectSecrets(value: unknown, secret: string | undefined) {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item) break;
    if (item.depth > 32 || ++count > 50000)
      throw new ProviderError("malformed_response", true);
    if (typeof item.value === "string" && secret && item.value.includes(secret))
      throw new ProviderError("malformed_response", true);
    if (item.value && typeof item.value === "object")
      for (const [key, child] of Object.entries(item.value)) {
        if (secret && key.includes(secret))
          throw new ProviderError("malformed_response", true);
        pending.push({ value: child, depth: item.depth + 1 });
      }
  }
}
export class OpenRouterProvider implements ModelProvider {
  #secret: string | undefined;
  private models: string[];
  constructor(
    secret: string | undefined,
    models: string[],
    private wire: JsonWire = new HttpWire(),
    private now: () => number = Date.now,
  ) {
    this.#secret =
      secret === undefined ? undefined : providerSecret.parse(secret);
    this.models = z.array(explicitModel).max(32).parse(models);
  }
  async discover(
    signal: AbortSignal,
    selected?: string,
  ): Promise<ModelDescriptor[]> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(4000)]),
      models: ModelDescriptor[] = [];
    try {
      for (const id of this.models.filter(
        (id) => !selected || id === selected,
      )) {
        const raw = await this.wire.json({
          target: { kind: "hosted", url: "https://openrouter.ai/api/v1" },
          path: `models?limit=100&q=${encodeURIComponent(id)}`,
          method: "GET",
          signal: deadline,
          timeout_ms: 4000,
          effectful: false,
        });
        rejectSecrets(raw, this.#secret);
        const entries = z
          .object({ data: z.array(z.unknown()).max(100) })
          .parse(raw);
        for (const entry of entries.data) {
          const model = normalizeOpenRouter(entry, this.now());
          if (model?.id === id && !models.some((m) => m.id === id))
            models.push(model);
        }
      }
      return models;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("malformed_response", false);
    }
  }
  async generate(
    model: ModelDescriptor,
    input: GenerateRequest,
    signal: AbortSignal,
  ) {
    const request = generateRequestSchema.parse(input),
      deadline = AbortSignal.any([
        signal,
        AbortSignal.timeout(request.timeout_ms),
      ]);
    if (
      !this.#secret ||
      !this.models.includes(model.id) ||
      model.provider !== "openrouter"
    )
      throw new ProviderError("policy_denied", false);
    const fresh = (await this.discover(deadline, model.id)).find(
      (m) => m.id === model.id,
    );
    if (
      !fresh ||
      fresh.pricing.source_hash !== model.pricing.source_hash ||
      fresh.capabilities.text !== true ||
      fresh.capabilities.reasoning !== false ||
      request.max_input_tokens + request.max_output_tokens >
        (fresh.context_tokens ?? 0) ||
      request.max_output_tokens > (fresh.output_tokens ?? 0) ||
      (request.tools.length && fresh.capabilities.tools !== true) ||
      (request.response_format === "json" &&
        fresh.capabilities.structured !== true)
    )
      throw new ProviderError("policy_denied", false);
    const prices = fresh.pricing.dimensions;
    if (!prices.input || !prices.output || !prices.request || !prices.image)
      throw new ProviderError("policy_denied", false);
    const max_price = {
      prompt: Number(ceilingMicroUsd(prices.input.amount, 1n)),
      completion: Number(ceilingMicroUsd(prices.output.amount, 1n)),
      request: Number(ceilingMicroUsd(prices.request.amount, 1n)) / 1e6,
      image: Number(ceilingMicroUsd(prices.image.amount, 1n)) / 1e6,
    };
    try {
      const raw = await this.wire.json({
        target: { kind: "hosted", url: "https://openrouter.ai/api/v1" },
        path: "chat/completions",
        method: "POST",
        secret: this.#secret,
        signal: deadline,
        timeout_ms: request.timeout_ms,
        effectful: true,
        body: {
          model: model.id,
          messages: request.messages,
          max_tokens: request.max_output_tokens,
          stream: false,
          plugins: [],
          transforms: [],
          provider: {
            allow_fallbacks: false,
            require_parameters: true,
            data_collection: "deny",
            max_price,
          },
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
      rejectSecrets(raw, this.#secret);
      const inBand = z
        .object({ error: z.object({ code: z.number() }) })
        .safeParse(raw);
      if (inBand.success)
        throw statusError(inBand.data.error.code, undefined, true);
      const result = resultSchema.parse(raw),
        choice = result.choices[0];
      if (!choice || result.model !== model.id)
        throw new ProviderError("malformed_response", true);
      const tools =
        choice.message.tool_calls?.map((t) => ({
          name: t.function.name,
          arguments: z
            .record(z.string(), z.json())
            .parse(JSON.parse(t.function.arguments)),
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
