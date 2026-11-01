import {
  type GenerateRequest,
  type GenerateResult,
  generateRequestSchema,
  type ModelDescriptor,
  type ModelPolicy,
  modelSchema,
} from "@craftlayer/contracts";
import { type ModelProvider, ProviderError } from "./index.js";
import { ceilingMicroUsd, zeroPriceReason } from "./pricing.js";

export interface Candidate {
  connection_id: string;
  version: number;
  model: ModelDescriptor;
  cooldown_until: number;
}
export interface RoutingSnapshot {
  epoch: string;
  stopped: boolean;
  policies: ModelPolicy[];
  allow_paid: boolean;
  max_paid_micro_usd: string;
  candidates: Candidate[];
}
export interface Reservation {
  id: string;
}
export type Outcome =
  | { result: GenerateResult; dispatched: true }
  | { error: ProviderError; dispatched: boolean };
export interface RouterPort {
  snapshot(): Promise<RoutingSnapshot>;
  begin(request: GenerateRequest): Promise<boolean>;
  reserve(
    candidate: Candidate,
    request: GenerateRequest,
    attempt: number,
    epoch: string,
    cost: bigint,
  ): Promise<Reservation>;
  dispatch(reservation: Reservation, epoch: string): Promise<void>;
  complete(reservation: Reservation, outcome: Outcome): Promise<void>;
  cooldown(connection: string, delay: number): Promise<void>;
  provider(candidate: Candidate): Promise<ModelProvider>;
}
export class RouterBlocked extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Model request blocked: ${[...new Set(reasons)].join(", ")}`);
    this.name = "RouterBlocked";
  }
}
export function maximumCost(
  model: ModelDescriptor,
  request: GenerateRequest,
): bigint | null {
  if (
    !modelSchema.safeParse(model).success ||
    model.pricing.currency !== "USD" ||
    model.pricing.unknown_dimensions.length
  )
    return null;
  const units = {
    input: request.max_input_tokens,
    output: request.max_output_tokens,
    cache_read: request.max_input_tokens,
    cache_write: request.max_input_tokens,
    request: 1,
    image: 0,
    audio: 0,
    reasoning: request.max_output_tokens,
    tool: request.tools.length ? 16 : 0,
  };
  let total = 0n;
  for (const key of Object.keys(units) as Array<keyof typeof units>) {
    const price = model.pricing.dimensions[key];
    if (!price) return null;
    total += ceilingMicroUsd(price.amount, 1n) * BigInt(units[key]);
  }
  return total;
}
export function eligibility(
  snapshot: RoutingSnapshot,
  candidate: Candidate,
  request: GenerateRequest,
  now: number,
  attempt: number,
): string | null {
  if (snapshot.stopped) return "stopped";
  if (!snapshot.policies.length) return "missing_policy";
  const model = candidate.model;
  if (!modelSchema.safeParse(model).success) return "invalid_model";
  if (candidate.cooldown_until > now) return "cooldown";
  for (const policy of snapshot.policies) {
    if (policy.allowed_models && !policy.allowed_models.includes(model.id))
      return "model_not_allowed";
    if (
      request.max_input_tokens > policy.max_input_tokens ||
      request.max_output_tokens > policy.max_output_tokens
    )
      return "request_limit";
    if (model.classification === "hosted" && !policy.allow_hosted)
      return "hosted_denied";
  }
  if (
    model.capabilities.text !== true ||
    (request.tools.length && model.capabilities.tools !== true) ||
    (request.response_format === "json" &&
      model.capabilities.structured !== true)
  )
    return "capability_unknown_or_unsupported";
  if (
    request.max_input_tokens + request.max_output_tokens >
      (model.context_tokens ?? 0) ||
    request.max_output_tokens > (model.output_tokens ?? 0)
  )
    return "context_limit";
  const p = model.pricing;
  if (
    p.observed_at > now ||
    p.expires_at <= now ||
    p.expires_at <= p.observed_at ||
    p.expires_at - p.observed_at > 300000
  )
    return "stale_pricing";
  const zero = zeroPriceReason(model, now);
  if (
    (!snapshot.allow_paid ||
      BigInt(snapshot.max_paid_micro_usd) === 0n ||
      snapshot.policies.some(
        (p) => p.free_only || BigInt(p.max_paid_micro_usd) === 0n,
      )) &&
    zero
  )
    return zero;
  if (model.classification === "operator_local" && zero) return zero;
  const cost = maximumCost(model, request);
  if (cost === null) return "unknown_pricing";
  if (
    cost > 0n &&
    (!snapshot.allow_paid ||
      snapshot.policies.some(
        (p) => p.free_only || (attempt > 0 && !p.allow_paid_fallback),
      ))
  )
    return "paid_denied";
  if (
    cost > BigInt(snapshot.max_paid_micro_usd) ||
    snapshot.policies.some((p) => cost > BigInt(p.max_paid_micro_usd))
  )
    return "spend_limit";
  return null;
}
export class ModelRouter {
  constructor(
    private port: RouterPort,
    private now: () => number = Date.now,
  ) {}
  async run(
    input: GenerateRequest,
    signal: AbortSignal,
  ): Promise<{ result: GenerateResult; attempts: number }> {
    const parsed = generateRequestSchema.safeParse(input);
    if (!parsed.success) throw new RouterBlocked(["invalid_request"]);
    const request = parsed.data;
    const inputBound =
      request.messages.reduce(
        (sum, message) => sum + Buffer.byteLength(message.content) + 32,
        0,
      ) +
      Buffer.byteLength(JSON.stringify(request.tools)) +
      256;
    if (
      inputBound > request.max_input_tokens ||
      Buffer.byteLength(JSON.stringify(request.tools)) > 16384
    )
      throw new RouterBlocked(["input_bound"]);
    const deadline = AbortSignal.any([
        signal,
        AbortSignal.timeout(request.timeout_ms),
      ]),
      seen = new Set<string>(),
      reasons: string[] = [];
    let begun = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (deadline.aborted) throw new RouterBlocked(["aborted_or_timeout"]);
      const snapshot = await this.port.snapshot();
      if (snapshot.stopped) throw new RouterBlocked(["stopped"]);
      const ceiling = Math.min(
        3,
        ...snapshot.policies.map((p) => p.max_attempts),
      );
      if (attempt >= ceiling) break;
      const candidate = snapshot.candidates.find((c) => {
        const key = `${c.connection_id}/${c.model.id}`;
        if (seen.has(key)) return false;
        const reason = eligibility(snapshot, c, request, this.now(), attempt);
        if (reason) {
          reasons.push(reason);
          return false;
        }
        return true;
      });
      if (!candidate)
        throw new RouterBlocked(reasons.length ? reasons : ["no_candidate"]);
      seen.add(`${candidate.connection_id}/${candidate.model.id}`);
      if (!begun) {
        if (!(await this.port.begin(request)))
          throw new RouterBlocked(["request_replayed"]);
        begun = true;
      }
      const cost = maximumCost(candidate.model, request);
      if (cost === null) throw new RouterBlocked(["unknown_pricing"]);
      const reservation = await this.port.reserve(
        candidate,
        request,
        attempt,
        snapshot.epoch,
        cost,
      );
      let dispatched = false;
      try {
        const provider = await this.port.provider(candidate);
        const result = await provider.generate(
          candidate.model,
          request,
          deadline,
          async () => {
            if (dispatched || deadline.aborted)
              throw new ProviderError("aborted", false);
            const current = await this.port.snapshot();
            const latest = current.candidates.find(
              (c) =>
                c.connection_id === candidate.connection_id &&
                c.model.id === candidate.model.id &&
                c.version === candidate.version,
            );
            if (
              !latest ||
              latest.model.pricing.source_hash !==
                candidate.model.pricing.source_hash ||
              current.epoch !== snapshot.epoch ||
              current.stopped ||
              eligibility(current, latest, request, this.now(), attempt)
            )
              throw new ProviderError("policy_denied", false);
            await this.port.dispatch(reservation, snapshot.epoch);
            dispatched = true;
          },
        );
        if (!dispatched) throw new ProviderError("policy_denied", true);
        await this.port.complete(reservation, { result, dispatched: true });
        return { result, attempts: attempt + 1 };
      } catch (error) {
        const normalized =
          error instanceof ProviderError
            ? error
            : new ProviderError("unavailable", dispatched);
        await this.port.complete(reservation, {
          error: normalized,
          dispatched: dispatched || normalized.dispatched,
        });
        reasons.push(normalized.code);
        if (
          ["rate_limited", "unavailable", "timeout", "auth"].includes(
            normalized.code,
          )
        )
          await this.port.cooldown(
            candidate.connection_id,
            normalized.retry_after_ms ?? Math.min(300000, 5000 * 2 ** attempt),
          );
        if (
          deadline.aborted ||
          normalized.code === "aborted" ||
          normalized.code === "policy_denied"
        )
          throw new RouterBlocked(reasons);
      }
    }
    throw new RouterBlocked(reasons.length ? reasons : ["attempt_limit"]);
  }
}
