import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  type NodeCommand,
  type NodeExecutionPolicy,
  nodeExecutionPolicy,
  type SignedNodeCommandReceipt,
  signedNodeCommand,
  signedNodeCommandPermit,
  signedNodeCommandReceipt,
} from "@craftlayer/contracts";
import {
  assertNodeTime,
  nodeDigest,
  nodePrivateKey,
  signNodeValue,
  verifyNodeValue,
} from "@craftlayer/node-protocol";
import { z } from "zod";
import { type ExecutionSnapshot, ExecutionStore } from "./execution-store.js";

export interface ExecutionAuthority {
  authorize(
    command: Readonly<NodeCommand>,
    nonce: string,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export interface CommandBroker {
  /** Every physical verb must invoke guard immediately before dispatch; timeouts are uncertain. */
  apply(
    command: Readonly<NodeCommand>,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<unknown>;
}
const proof = z.strictObject({
  verified: z.literal(true),
  outcome: z
    .enum(["applied", "rolled_back", "not_dispatched"])
    .default("applied"),
  evidence_hash: z.string().regex(/^[a-f0-9]{64}$/),
});
function deny(code: string): never {
  throw new Error(code);
}
const intentHash = (v: NodeCommand) => {
  const {
    command_id: _id,
    attempt: _attempt,
    fence: _fence,
    issued_at: _issued,
    expires_at: _expires,
    ...intent
  } = v;
  return nodeDigest(intent);
};

/** Not wired to the inventory agent or HTTP. Authority/broker are private trusted ports. */
export class NodeCommandExecutor {
  #policy: NodeExecutionPolicy;
  #store: ExecutionStore;
  #active = 0;
  #now: () => number;
  #monotonic: () => number;
  constructor(
    private readonly options: {
      directory: string;
      policy: unknown;
      signingKey: string;
      authority: ExecutionAuthority;
      broker: CommandBroker;
      clock?: () => number;
      monotonic?: () => number;
    },
  ) {
    this.#policy = nodeExecutionPolicy.parse(options.policy);
    if (
      nodeDigest(this.#policy.control_public_key) !== this.#policy.control_id ||
      nodePrivateKey(options.signingKey).public_key !==
        this.#policy.node_public_key
    )
      deny("NODE_EXECUTION_KEY_BINDING_DENIED");
    this.#store = new ExecutionStore(options.directory, this.#policy);
    this.#now = options.clock ?? Date.now;
    this.#monotonic = options.monotonic ?? (() => performance.now());
  }
  open() {
    return this.#store.open();
  }
  async close() {
    if (this.#active) deny("NODE_EXECUTION_IN_FLIGHT");
    await this.#store.close();
  }
  async latchStop() {
    await this.#store.transaction((s) => {
      if (s.stop_generation >= 2147483646)
        deny("NODE_STOP_GENERATION_EXHAUSTED");
      s.stopped = true;
      s.stop_generation++;
    });
  }
  #state(state: ExecutionSnapshot, v: NodeCommand, now: number) {
    const p = this.#policy;
    if (
      state.node_id !== p.node_id ||
      state.organization_id !== p.organization_id ||
      state.project_id !== p.project_id ||
      state.control_id !== p.control_id ||
      state.credential_floor !== p.credential_version ||
      state.policy_floor !== p.policy_revision
    )
      deny("NODE_EXECUTION_BINDING_DENIED");
    if (state.stopped || state.stop_generation !== v.stop_generation)
      deny("NODE_EXECUTION_STOPPED");
    if (now < state.last_wall_ms) deny("NODE_CLOCK_ROLLBACK");
    state.last_wall_ms = now;
  }
  #receipt(
    v: NodeCommand,
    digest: string,
    state: "succeeded" | "rolled_back" | "not_dispatched" | "uncertain",
    evidence: string | null,
  ): SignedNodeCommandReceipt {
    const payload = {
      schema_version: 1 as const,
      purpose: "node.command.receipt.v1" as const,
      control_id: v.control_id,
      organization_id: v.organization_id,
      project_id: v.project_id,
      node_id: v.node_id,
      credential_version: v.credential_version,
      command_id: v.command_id,
      operation_id: v.operation_id,
      deployment_id: v.deployment_id,
      server_id: v.server_id,
      world_id: v.world_id,
      command_hash: digest,
      action: v.action,
      fence: v.fence,
      state,
      evidence_hash: evidence,
      finished_at: new Date(this.#now()).toISOString(),
    };
    return signedNodeCommandReceipt.parse({
      payload,
      signature: signNodeValue(payload, this.options.signingKey),
    });
  }
  async execute(input: unknown): Promise<SignedNodeCommandReceipt> {
    this.#active++;
    try {
      return await this.#execute(input);
    } finally {
      this.#active--;
    }
  }
  async #execute(input: unknown) {
    const signed = signedNodeCommand.parse(input),
      v = Object.freeze(signed.payload),
      p = this.#policy;
    if (
      !p.enabled ||
      !p.allowed_actions.includes(v.action) ||
      !verifyNodeValue(v, signed.signature, p.control_public_key)
    )
      deny("NODE_COMMAND_DENIED");
    for (const key of [
      "control_id",
      "organization_id",
      "project_id",
      "node_id",
      "credential_version",
      "policy_revision",
      "policy_hash",
    ] as const)
      if (v[key] !== p[key]) deny("NODE_COMMAND_SCOPE_DENIED");
    const startWall = this.#now(),
      startMono = this.#monotonic(),
      digest = nodeDigest(v),
      expires = Date.parse(v.expires_at);
    assertNodeTime(v.issued_at, v.expires_at, startWall);
    if (Date.parse(v.issued_at) > startWall) deny("NODE_COMMAND_FROM_FUTURE");
    const deadlineMono = startMono + expires - startWall;
    let observedWall = startWall,
      observedMono = startMono,
      cancelled = false;
    const time = () => {
      const wall = this.#now(),
        mono = this.#monotonic();
      if (
        cancelled ||
        !Number.isSafeInteger(wall) ||
        !Number.isFinite(mono) ||
        wall < observedWall ||
        mono < observedMono ||
        wall >= expires ||
        mono >= deadlineMono
      )
        deny("NODE_COMMAND_LEASE_EXPIRED");
      observedWall = wall;
      observedMono = mono;
      return wall;
    };
    const guard = async () => {
      await this.#store.transaction((s) => this.#state(s, v, time()));
      const nonce = randomUUID(),
        abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let raw: unknown;
      try {
        raw = await Promise.race([
          this.options.authority.authorize(v, nonce, abort.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => {
                abort.abort();
                reject(new Error("NODE_AUTHORITY_UNAVAILABLE"));
              },
              Math.min(5000, Math.max(1, expires - time())),
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        abort.abort();
      }
      const permit = signedNodeCommandPermit.parse(raw),
        lease = permit.payload,
        now = time();
      assertNodeTime(lease.issued_at, lease.expires_at, now);
      if (
        Date.parse(lease.issued_at) > now ||
        !verifyNodeValue(lease, permit.signature, p.control_public_key) ||
        lease.command_hash !== digest ||
        lease.request_nonce !== nonce ||
        Date.parse(lease.expires_at) - Date.parse(lease.issued_at) > 5000 ||
        Date.parse(lease.expires_at) > expires
      )
        deny("NODE_EXECUTION_PERMIT_DENIED");
      for (const key of [
        "control_id",
        "organization_id",
        "project_id",
        "node_id",
        "credential_version",
        "fence",
        "policy_revision",
        "policy_hash",
        "stop_generation",
        "authorization_hash",
      ] as const)
        if (lease[key] !== v[key]) deny("NODE_EXECUTION_PERMIT_DENIED");
      const leaseMono = this.#monotonic() + Date.parse(lease.expires_at) - now;
      await this.#store.transaction((s) => this.#state(s, v, time()));
      if (
        time() >= Date.parse(lease.expires_at) ||
        this.#monotonic() >= leaseMono
      )
        deny("NODE_COMMAND_LEASE_EXPIRED");
    };
    await guard();
    const old = await this.#store.transaction((s) => {
      this.#state(s, v, time());
      const previous = s.commands[v.command_id];
      if (previous) {
        if (previous.digest !== digest)
          deny("NODE_COMMAND_IDEMPOTENCY_CONFLICT");
        if (!previous.receipt) deny("NODE_EXECUTION_UNCERTAIN");
        return previous.receipt;
      }
      if (Object.keys(s.commands).length >= 128)
        deny("NODE_EXECUTION_STORE_FULL");
      const resource = s.resources[v.deployment_id];
      if (
        resource &&
        (resource.server_id !== v.server_id ||
          resource.world_id !== v.world_id ||
          resource.retired)
      )
        deny("NODE_RESOURCE_BINDING_DENIED");
      if (resource?.unresolved) deny("NODE_EXECUTION_UNCERTAIN");
      if (resource && v.fence <= resource.fence) deny("NODE_STALE_FENCE");
      if (
        Object.entries(s.resources).some(
          ([id, r]) =>
            id !== v.deployment_id &&
            (r.world_id === v.world_id || r.server_id === v.server_id),
        )
      )
        deny("NODE_RESOURCE_BINDING_DENIED");
      if (
        (!resource && v.action !== "provision") ||
        (["start", "stop", "restart"].includes(v.action) &&
          !resource?.provisioned) ||
        (v.action === "provision" && resource?.provisioned)
      )
        deny("NODE_RESOURCE_NOT_OWNED");
      const logical = intentHash(v),
        attempts = Object.values(s.commands).filter(
          (c) => c.command.operation_id === v.operation_id,
        );
      if (
        attempts.some(
          (c) => c.intent_hash !== logical || c.command.attempt >= v.attempt,
        )
      )
        deny("NODE_OPERATION_INTENT_CHANGED");
      s.resources[v.deployment_id] = {
        server_id: v.server_id,
        world_id: v.world_id,
        fence: v.fence,
        provisioned: resource?.provisioned ?? false,
        retired: false,
        unresolved: v.command_id,
      };
      s.commands[v.command_id] = {
        command: v,
        digest,
        intent_hash: logical,
        state: "prepared",
        receipt: null,
      };
      return null;
    });
    if (old) return old;
    let dispatched = false,
      result: "succeeded" | "rolled_back" | "not_dispatched" | "uncertain" =
        "not_dispatched",
      evidence: string | null = null;
    const abortEffect = new AbortController();
    let effectTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await guard();
      await this.#store.transaction((s) => {
        this.#state(s, v, time());
        const record = s.commands[v.command_id];
        if (record?.digest !== digest || record.state !== "prepared")
          deny("NODE_EXECUTION_UNCERTAIN");
        record.state = "dispatching";
      });
      dispatched = true;
      const verified = proof.parse(
        await Promise.race([
          this.options.broker.apply(v, guard, abortEffect.signal),
          new Promise<never>((_, reject) => {
            effectTimer = setTimeout(
              () => {
                cancelled = true;
                abortEffect.abort();
                reject(new Error("NODE_EFFECT_DEADLINE"));
              },
              Math.max(1, expires - time()),
            );
          }),
        ]),
      );
      await guard();
      if (verified.outcome === "rolled_back" && v.action !== "provision")
        deny("NODE_BROKER_OUTCOME_DENIED");
      result = verified.outcome === "applied" ? "succeeded" : verified.outcome;
      evidence = result === "not_dispatched" ? null : verified.evidence_hash;
    } catch {
      result = dispatched ? "uncertain" : "not_dispatched";
    } finally {
      cancelled = true;
      abortEffect.abort();
      if (effectTimer) clearTimeout(effectTimer);
    }
    const receipt = this.#receipt(v, digest, result, evidence);
    await this.#store.transaction((s) => {
      const record = s.commands[v.command_id],
        resource = s.resources[v.deployment_id];
      if (
        !record ||
        record.digest !== digest ||
        !resource ||
        resource.unresolved !== v.command_id
      )
        deny("NODE_EXECUTION_UNCERTAIN");
      record.state = result;
      record.receipt = receipt;
      if (result !== "uncertain") resource.unresolved = null;
      if (result === "succeeded" && v.action === "provision")
        resource.provisioned = true;
      if (
        result === "rolled_back" ||
        (result === "succeeded" && v.action === "rollback")
      )
        resource.retired = true;
    });
    return receipt;
  }
}
