import {
  type GenerateRequest,
  type GenerateResult,
  type ModelDescriptor,
  type ProviderErrorCode,
  providerErrorSchema,
} from "@craftlayer/contracts";
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly dispatched: boolean,
    public readonly retry_after_ms: number | null = null,
  ) {
    super(`Provider operation failed: ${code}`);
    this.name = "ProviderError";
    providerErrorSchema.parse({ code, dispatched, retry_after_ms });
  }
}
export interface ModelProvider {
  discover(signal: AbortSignal): Promise<ModelDescriptor[]>;
  generate(
    model: ModelDescriptor,
    request: GenerateRequest,
    signal: AbortSignal,
    beforeDispatch?: () => Promise<void>,
  ): Promise<GenerateResult>;
}
export * from "./connections.js";
export * from "./control.js";
export * from "./instance.js";
export * from "./ollama.js";
export * from "./openrouter.js";
export * from "./pricing.js";
export * from "./router.js";
export * from "./wire.js";
