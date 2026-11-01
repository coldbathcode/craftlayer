import {
  defaultModelPolicy,
  type GenerateRequest,
  type ModelPolicy,
  modelPolicySchema,
} from "@craftlayer/contracts";
import { expect, it } from "vitest";
import {
  FakeClock,
  FakeProvider,
  fixtureModel,
  fixtureRequest,
} from "./fixtures.js";
import { ProviderError } from "./index.js";
import {
  type Candidate,
  ModelRouter,
  type Outcome,
  type Reservation,
  type RouterPort,
  type RoutingSnapshot,
} from "./router.js";

class FakePort implements RouterPort {
  state: RoutingSnapshot;
  events: string[] = [];
  outcomes: Outcome[] = [];
  providers = new Map<string, FakeProvider>();
  beforeDispatch: (() => void) | undefined;
  constructor(
    readonly clock: FakeClock,
    candidates: Candidate[],
    policies: ModelPolicy[] = [modelPolicySchema.parse(defaultModelPolicy)],
  ) {
    this.state = {
      epoch: "one",
      stopped: false,
      policies,
      allow_paid: false,
      max_paid_micro_usd: "0",
      candidates,
    };
  }
  async snapshot() {
    return structuredClone(this.state);
  }
  async begin() {
    this.events.push("begin");
    return true;
  }
  async reserve() {
    this.events.push("reserve");
    return { id: crypto.randomUUID() };
  }
  async dispatch() {
    this.events.push("dispatch");
  }
  async complete(_r: Reservation, outcome: Outcome) {
    this.events.push("complete");
    this.outcomes.push(outcome);
  }
  async cooldown(connection: string, delay: number) {
    this.events.push("cooldown");
    for (const c of this.state.candidates)
      if (c.connection_id === connection)
        c.cooldown_until = this.clock.now + delay;
  }
  async provider(candidate: Candidate) {
    this.beforeDispatch?.();
    const provider = this.providers.get(candidate.connection_id);
    if (!provider) throw new Error("Missing fake");
    return provider;
  }
}
const candidate = (
  clock: FakeClock,
  patch: Partial<Candidate["model"]> = {},
): Candidate => ({
  connection_id: crypto.randomUUID(),
  version: 1,
  model: fixtureModel(clock.now, patch),
  cooldown_until: 0,
});
it("dispatches no paid, unknown, stale, non-enforced or incompatible candidate", async () => {
  const clock = new FakeClock(),
    paid = candidate(clock),
    unknown = candidate(clock),
    stale = candidate(clock),
    unproved = candidate(clock, {
      provider: "openrouter",
      classification: "hosted",
      zero_cost_enforced: false,
    }),
    incompatible = candidate(clock, {
      capabilities: {
        text: null,
        tools: null,
        structured: null,
        reasoning: null,
      },
    });
  paid.model.pricing.dimensions.input = { amount: "1", unit: "token" };
  unknown.model.pricing.dimensions.cache_read = null;
  stale.model.pricing.expires_at = clock.now;
  const port = new FakePort(clock, [
    paid,
    unknown,
    stale,
    unproved,
    incompatible,
  ]);
  await expect(
    new ModelRouter(port, () => clock.now).run(
      fixtureRequest(),
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ name: "RouterBlocked" });
  expect(port.events).toEqual([]);
});
it("reserves each attempt and falls back after synthetic free 429 only to eligible local", async () => {
  const clock = new FakeClock(),
    hosted = candidate(clock, {
      provider: "openrouter",
      classification: "hosted",
      zero_cost_enforced: true,
    }),
    local = candidate(clock),
    paid = candidate(clock);
  paid.model.pricing.dimensions.output = { amount: "0.01", unit: "token" };
  const policy = modelPolicySchema.parse({
    ...defaultModelPolicy,
    allow_hosted: true,
  });
  const port = new FakePort(clock, [hosted, paid, local], [policy]);
  const failed = new FakeProvider(
      [hosted.model],
      [new ProviderError("rate_limited", true, 30000)],
    ),
    success = new FakeProvider([local.model]);
  port.providers.set(hosted.connection_id, failed);
  port.providers.set(local.connection_id, success);
  expect(
    (
      await new ModelRouter(port, () => clock.now).run(
        fixtureRequest(),
        AbortSignal.timeout(1000),
      )
    ).attempts,
  ).toBe(2);
  expect(failed.calls).toHaveLength(1);
  expect(success.calls).toHaveLength(1);
  expect(port.events).toEqual([
    "begin",
    "reserve",
    "dispatch",
    "complete",
    "cooldown",
    "reserve",
    "dispatch",
    "complete",
  ]);
  expect(port.state.candidates[0]?.cooldown_until).toBe(clock.now + 30000);
});
it("intersects all scopes and rechecks tightened policy/stop before dispatch", async () => {
  const clock = new FakeClock(),
    local = candidate(clock),
    port = new FakePort(clock, [local]);
  port.providers.set(local.connection_id, new FakeProvider([local.model]));
  port.beforeDispatch = () => {
    port.state.stopped = true;
    port.state.epoch = "changed";
  };
  await expect(
    new ModelRouter(port, () => clock.now).run(
      fixtureRequest(),
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ reasons: ["policy_denied"] });
  expect(port.events).toEqual(["begin", "reserve", "complete"]);
  expect(port.providers.get(local.connection_id)?.calls).toHaveLength(0);
  const denied = new FakePort(
    clock,
    [local],
    [
      modelPolicySchema.parse(defaultModelPolicy),
      modelPolicySchema.parse({ ...defaultModelPolicy, allowed_models: [] }),
    ],
  );
  await expect(
    new ModelRouter(denied, () => clock.now).run(
      fixtureRequest(),
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ reasons: ["model_not_allowed"] });
  expect(denied.events).toEqual([]);
});
it("rejects forged controls, insufficient input bounds and persistent cooldown candidates", async () => {
  const clock = new FakeClock(),
    local = candidate(clock),
    port = new FakePort(clock, [local]);
  local.cooldown_until = clock.now + 30000;
  const router = new ModelRouter(port, () => clock.now);
  await expect(
    router.run(
      { ...fixtureRequest(), models: ["paid/fallback"] } as GenerateRequest,
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ reasons: ["invalid_request"] });
  await expect(
    router.run(
      fixtureRequest({ max_input_tokens: 1 }),
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ reasons: ["input_bound"] });
  await expect(
    router.run(fixtureRequest(), AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({ reasons: ["cooldown"] });
  expect(port.events).toEqual([]);
});

it("cannot relax the instance zero-spend boundary through organization configuration", async () => {
  const clock = new FakeClock(),
    hosted = candidate(clock, {
      classification: "hosted",
      provider: "openrouter",
      zero_cost_enforced: false,
    });
  const port = new FakePort(
    clock,
    [hosted],
    [
      modelPolicySchema.parse({
        ...defaultModelPolicy,
        free_only: false,
        allow_hosted: true,
      }),
    ],
  );
  await expect(
    new ModelRouter(port, () => clock.now).run(
      fixtureRequest(),
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ reasons: ["zero_cost_not_enforced"] });
  expect(port.events).toEqual([]);
});
