import { createHash } from "node:crypto";
import {
  type GenerateRequest,
  type GenerateResult,
  type ModelDescriptor,
  priceDimensions,
} from "@craftlayer/contracts";
import type { ModelProvider } from "./index.js";

export class FakeClock {
  constructor(public now = 1800000000000) {}
  advance(ms: number) {
    this.now += ms;
  }
}
export function fixtureModel(
  now: number,
  patch: Partial<ModelDescriptor> = {},
): ModelDescriptor {
  return {
    id: "fixture-local",
    provider: "ollama",
    classification: "operator_local",
    zero_cost_enforced: true,
    context_tokens: 32768,
    output_tokens: 8192,
    capabilities: {
      text: true,
      tools: true,
      structured: true,
      reasoning: false,
    },
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
      ) as ModelDescriptor["pricing"]["dimensions"],
      unknown_dimensions: [],
      observed_at: now,
      expires_at: now + 300000,
      source: "fixture",
      source_hash: createHash("sha256")
        .update("synthetic-catalog")
        .digest("hex"),
    },
    ...patch,
  };
}
export function fixtureRequest(
  patch: Partial<GenerateRequest> = {},
): GenerateRequest {
  return {
    schema_version: 1,
    request_id: crypto.randomUUID(),
    messages: [{ role: "user", content: "Synthetic test input" }],
    max_input_tokens: 1024,
    max_output_tokens: 64,
    timeout_ms: 1000,
    response_format: "text",
    tools: [],
    ...patch,
  };
}
export class FakeProvider implements ModelProvider {
  calls: Array<{ model: string; request_id: string }> = [];
  constructor(
    public models: ModelDescriptor[],
    private outcomes: Array<GenerateResult | Error> = [
      {
        text: "Synthetic result",
        tool_calls: [],
        finish_reason: "stop",
        usage: { input_tokens: 20, output_tokens: 3, quality: "observed" },
        provider_request_id: null,
      },
    ],
  ) {}
  async discover() {
    return this.models;
  }
  async generate(
    model: ModelDescriptor,
    request: GenerateRequest,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    this.calls.push({ model: model.id, request_id: request.request_id });
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    if (!outcome) throw new Error("Fake exhausted");
    return outcome;
  }
}
