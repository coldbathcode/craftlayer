import { createHash } from "node:crypto";
import {
  type GenerateRequest,
  generateRequestSchema,
  generateResultSchema,
  type ModelDescriptor,
  modelSchema,
  priceDimensions,
} from "@craftlayer/contracts";
import { z } from "zod";
import { type ModelProvider, ProviderError } from "./index.js";
import { type ApprovedLocal, approvedLocalSchema } from "./instance.js";
import { HttpWire, type JsonWire, type WireRequest } from "./wire.js";

const tagsSchema = z.object({
  models: z
    .array(
      z.looseObject({
        name: z.string(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        details: z.looseObject({ format: z.string() }),
      }),
    )
    .max(1000),
});
const showSchema = z.looseObject({
  capabilities: z.array(z.string()).max(32),
  details: z.looseObject({ format: z.string() }),
  model_info: z.record(z.string(), z.json()),
  thinking: z
    .object({ values: z.array(z.union([z.boolean(), z.string()])) })
    .optional(),
});
const chatSchema = z.object({
  model: z.string(),
  message: z.object({
    content: z.string(),
    tool_calls: z
      .array(
        z.object({
          function: z.object({
            name: z.string(),
            arguments: z.record(z.string(), z.json()),
          }),
        }),
      )
      .max(16)
      .optional(),
  }),
  done: z.literal(true),
  done_reason: z.enum(["stop", "length"]),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});
export class OllamaProvider implements ModelProvider {
  private endpoint: ApprovedLocal;
  constructor(
    endpoint: ApprovedLocal,
    private wire: JsonWire = new HttpWire(),
    private now: () => number = Date.now,
  ) {
    this.endpoint = approvedLocalSchema.parse(endpoint);
  }
  private call(
    path: string,
    body: unknown,
    signal: AbortSignal,
    timeout: number,
    effectful = false,
    beforeDispatch?: () => Promise<void>,
  ) {
    const request: WireRequest = {
      target: {
        kind: "operator_local",
        url: this.endpoint.url,
        addresses: this.endpoint.addresses,
      },
      path,
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body }),
      signal,
      timeout_ms: timeout,
      effectful,
      before_dispatch: beforeDispatch,
    };
    return this.wire.json(request);
  }
  async discover(
    signal: AbortSignal,
    selected?: string,
  ): Promise<ModelDescriptor[]> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
    try {
      const tags = tagsSchema.parse(
          await this.call("/api/tags", undefined, deadline, 4000),
        ),
        models: ModelDescriptor[] = [];
      for (const tag of tags.models.filter(
        (t) =>
          this.endpoint.models.includes(t.name) &&
          (!selected || t.name === selected),
      )) {
        if (
          tag.details.format !== "gguf" ||
          "remote_host" in tag ||
          "remote_model" in tag
        )
          continue;
        const show = showSchema.parse(
          await this.call(
            "/api/show",
            { model: tag.name, verbose: false },
            deadline,
            4000,
          ),
        );
        if (
          show.details.format !== "gguf" ||
          "remote_host" in show ||
          "remote_model" in show ||
          typeof show.model_info["general.architecture"] !== "string" ||
          !show.capabilities.includes("completion")
        )
          continue;
        const architecture = String(show.model_info["general.architecture"]),
          context = show.model_info[`${architecture}.context_length`];
        if (
          typeof context !== "number" ||
          !Number.isSafeInteger(context) ||
          context < 1024
        )
          continue;
        if (
          show.capabilities.includes("thinking") &&
          !show.thinking?.values.includes(false)
        )
          continue;
        const now = this.now();
        models.push(
          modelSchema.parse({
            id: tag.name,
            provider: "ollama",
            classification: "operator_local",
            zero_cost_enforced: true,
            capabilities: {
              text: true,
              tools: show.capabilities.includes("tools"),
              structured: show.capabilities.includes("structured_outputs")
                ? true
                : null,
              reasoning: show.capabilities.includes("thinking"),
            },
            context_tokens: Math.min(context, this.endpoint.context_tokens),
            output_tokens: this.endpoint.output_tokens,
            pricing: {
              currency: "USD",
              dimensions: Object.fromEntries(
                priceDimensions.map((key) => [
                  key,
                  {
                    amount: "0",
                    unit:
                      key === "request"
                        ? "request"
                        : key === "image"
                          ? "image"
                          : key === "audio"
                            ? "second"
                            : key === "tool"
                              ? "tool_call"
                              : "token",
                  },
                ]),
              ),
              unknown_dimensions: [],
              observed_at: now,
              expires_at: now + 300000,
              source: "operator_local",
              source_hash: createHash("sha256")
                .update(JSON.stringify([tag, show, this.endpoint]))
                .digest("hex"),
            },
          }),
        );
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
    beforeDispatch?: () => Promise<void>,
  ) {
    const request = generateRequestSchema.parse(input);
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(request.timeout_ms),
    ]);
    if (
      !this.endpoint.models.includes(model.id) ||
      model.provider !== "ollama" ||
      model.classification !== "operator_local" ||
      request.max_input_tokens + request.max_output_tokens >
        (model.context_tokens ?? 0) ||
      request.max_output_tokens > this.endpoint.output_tokens ||
      (request.tools.length && model.capabilities.tools !== true) ||
      (request.response_format === "json" &&
        model.capabilities.structured !== true)
    )
      throw new ProviderError("policy_denied", false);
    try {
      // Verify the exact installed local model immediately before inference; no pull/create API.
      const fresh = (await this.discover(deadline, model.id)).find(
        (m) => m.id === model.id,
      );
      if (
        !fresh ||
        fresh.pricing.source_hash !== model.pricing.source_hash ||
        request.max_input_tokens + request.max_output_tokens >
          (fresh.context_tokens ?? 0) ||
        request.max_output_tokens > (fresh.output_tokens ?? 0)
      )
        throw new ProviderError("policy_denied", false);
      const raw = chatSchema.parse(
        await this.call(
          "/api/chat",
          {
            model: model.id,
            messages: request.messages,
            stream: false,
            think: false,
            keep_alive: 0,
            options: {
              num_ctx: fresh.context_tokens,
              num_predict: request.max_output_tokens,
            },
            ...(request.response_format === "json" ? { format: "json" } : {}),
            ...(request.tools.length
              ? {
                  tools: request.tools.map((t) => ({
                    type: "function",
                    function: t,
                  })),
                }
              : {}),
          },
          deadline,
          request.timeout_ms,
          true,
          beforeDispatch,
        ),
      );
      if (
        raw.model !== model.id ||
        raw.message.tool_calls?.some(
          (t) =>
            !request.tools.some((allowed) => allowed.name === t.function.name),
        )
      )
        throw new ProviderError("malformed_response", true);
      if (request.response_format === "json") JSON.parse(raw.message.content);
      return generateResultSchema.parse({
        text: raw.message.content,
        tool_calls: raw.message.tool_calls?.map((t) => t.function) ?? [],
        finish_reason:
          raw.done_reason === "length"
            ? "length"
            : raw.message.tool_calls?.length
              ? "tool_calls"
              : "stop",
        usage: {
          input_tokens: raw.prompt_eval_count ?? null,
          output_tokens: raw.eval_count ?? null,
          quality:
            raw.prompt_eval_count === undefined || raw.eval_count === undefined
              ? "unknown"
              : "observed",
        },
        provider_request_id: null,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("malformed_response", true);
    }
  }
}
