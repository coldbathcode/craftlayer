import { randomUUID } from "node:crypto";
import {
  type NodeCommand,
  type NodeExecutionPolicy,
  nodeExecutionPolicy,
} from "@craftlayer/contracts";
import { nodeDigest } from "@craftlayer/node-protocol";
import type { BrokerEngine } from "./broker-engine.js";
import {
  type BrokerPlan,
  type BrokerPolicy,
  brokerPlanDigest,
} from "./broker-policy.js";
import {
  type BrokerDeployment,
  type BrokerProof,
  BrokerStore,
} from "./broker-store.js";
import type { CommandBroker } from "./executor.js";

export interface DeploymentCatalog {
  /** Operator-private approved immutable manifest; never client/model-provided Docker JSON. */
  resolve(
    command: Readonly<NodeCommand>,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export type ConstrainedEngine = Pick<
  BrokerEngine,
  | "supportsLimits"
  | "image"
  | "ensureImage"
  | "network"
  | "volume"
  | "verifyStorage"
  | "container"
  | "createNetwork"
  | "createContainer"
  | "start"
  | "stop"
  | "removeStopped"
  | "removeEmptyNetwork"
>;
function deny(code: string): never {
  throw new Error(code);
}
/** Private port composition only. The network agent remains inventory-only. */
export class ConstrainedDockerBroker implements CommandBroker {
  #store: BrokerStore;
  #policy: NodeExecutionPolicy;
  #active = false;
  constructor(
    private readonly options: {
      directory: string;
      executionPolicy: unknown;
      policy: BrokerPolicy;
      catalog: DeploymentCatalog;
      engine: ConstrainedEngine;
    },
  ) {
    this.#policy = nodeExecutionPolicy.parse(options.executionPolicy);
    this.#store = new BrokerStore(options.directory, this.#policy);
  }
  open() {
    return this.#store.open();
  }
  async close() {
    if (this.#active) deny("NODE_BROKER_IN_FLIGHT");
    await this.#store.close();
  }
  async apply(
    command: Readonly<NodeCommand>,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<BrokerProof> {
    if (this.#active) deny("NODE_BROKER_IN_FLIGHT");
    this.#active = true;
    try {
      return await this.#apply(command, guard, signal);
    } finally {
      this.#active = false;
    }
  }
  async #apply(
    v: Readonly<NodeCommand>,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    const check = async () => {
      if (signal.aborted) deny("NODE_BROKER_ABORTED");
      await guard();
      if (signal.aborted) deny("NODE_BROKER_ABORTED");
    };
    await check();
    if (
      !this.#policy.enabled ||
      !this.#policy.allowed_actions.includes(v.action)
    )
      deny("NODE_BROKER_DISABLED");
    for (const key of [
      "organization_id",
      "project_id",
      "node_id",
      "control_id",
      "credential_version",
      "policy_revision",
      "policy_hash",
    ] as const)
      if (v[key] !== this.#policy[key]) deny("NODE_BROKER_BINDING_DENIED");
    const raw = await this.options.catalog.resolve(v, signal);
    await check();
    const digest = nodeDigest(v),
      entry = await this.#store.transaction(
        (s) => s.deployments[v.deployment_id] ?? null,
      ),
      plan = this.options.policy.compile(
        raw,
        v,
        entry?.owner_nonce ?? randomUUID(),
      ),
      manifestHash = nodeDigest(plan.manifest);
    if (
      entry?.manifest_hash !== undefined &&
      entry.manifest_hash !== manifestHash
    )
      deny("NODE_BROKER_MANIFEST_CHANGED");
    if (entry?.command_id === v.command_id) {
      if (entry.command_hash !== digest)
        deny("NODE_BROKER_IDEMPOTENCY_CONFLICT");
      if (entry.pending || !entry.proof) deny("NODE_BROKER_OUTCOME_UNKNOWN");
      return entry.proof;
    }
    if (entry?.pending) deny("NODE_BROKER_OUTCOME_UNKNOWN");
    if (entry?.retired || (entry && v.fence <= entry.fence))
      deny("NODE_BROKER_STALE_OR_RETIRED");
    if (
      (!entry && v.action !== "provision") ||
      (entry && v.action === "provision") ||
      (entry && !entry.provisioned && v.action !== "rollback")
    )
      deny("NODE_BROKER_NOT_OWNED");
    // Read-only preflight precedes durable intent and all native writes.
    if (!entry) {
      if (
        (await this.options.engine.container(plan, signal)) ||
        (await this.options.engine.network(plan, signal)) ||
        (plan.manifest.profile === "disposable_fixture" &&
          (await this.options.engine.volume(plan, signal)))
      )
        deny("NODE_PREEXISTING_RESOURCE");
      await this.options.engine.supportsLimits(signal);
      await this.options.engine.verifyStorage(plan, signal);
    }
    await check();
    await this.#store.transaction((s) => {
      if (Object.keys(s.deployments).length >= 128 && !entry)
        deny("NODE_BROKER_STORE_FULL");
      if (
        Object.entries(s.deployments).some(
          ([id, r]) =>
            id !== v.deployment_id &&
            (r.server_id === v.server_id || r.world_id === v.world_id),
        )
      )
        deny("NODE_BROKER_RESOURCE_BOUND");
      s.deployments[v.deployment_id] = entry
        ? {
            ...entry,
            fence: v.fence,
            command_id: v.command_id,
            command_hash: digest,
            pending: true,
            intent: null,
            proof: null,
          }
        : {
            manifest_hash: manifestHash,
            owner_nonce: plan.owner_nonce,
            server_id: v.server_id,
            world_id: v.world_id,
            container_id: null,
            network_id: null,
            provisioned: false,
            retired: false,
            fence: v.fence,
            command_id: v.command_id,
            command_hash: digest,
            pending: true,
            intent: null,
            proof: null,
          };
    });
    const read = () =>
        this.#store.transaction(
          (s) => s.deployments[v.deployment_id] as BrokerDeployment,
        ),
      change = (fn: (r: BrokerDeployment) => void) =>
        this.#store.transaction((s) => {
          const r = s.deployments[v.deployment_id];
          if (!r || r.command_id !== v.command_id || !r.pending)
            deny("NODE_BROKER_OUTCOME_UNKNOWN");
          fn(r);
        }),
      effect = async <T>(
        kind: NonNullable<BrokerDeployment["intent"]>,
        call: (guard: () => Promise<void>) => Promise<T>,
        acknowledged: (r: BrokerDeployment, value: T) => void,
      ) => {
        // Intent is fsynced before the Engine helper can dispatch. Lost ack retains it.
        await change((r) => {
          if (r.intent) deny("NODE_BROKER_OUTCOME_UNKNOWN");
          r.intent = kind;
        });
        const result = await call(check);
        await change((r) => {
          acknowledged(r, result);
          r.intent = null;
        });
        return result;
      };
    let outcome: BrokerProof["outcome"] = "applied";
    try {
      if (v.action === "provision") {
        if (!(await this.options.engine.image(plan, signal)))
          await effect(
            "image",
            (g) => this.options.engine.ensureImage(plan, g, signal),
            () => {},
          );
        await effect(
          "network_create",
          (g) => this.options.engine.createNetwork(plan, g, signal),
          (r, id) => {
            r.network_id = id;
          },
        );
        await effect(
          "container_create",
          (g) => this.options.engine.createContainer(plan, g, signal),
          (r, id) => {
            r.container_id = id;
          },
        );
        const r = await read();
        await this.#verify(plan, r, signal, false);
        await change((r) => {
          r.provisioned = true;
        });
      } else {
        const r = await read();
        if (v.action === "rollback") {
          await this.#rollback(plan, r, signal, effect);
          await change((r) => {
            r.retired = true;
            r.provisioned = false;
          });
        } else {
          const c = await this.#verify(plan, r, signal);
          if (v.action === "restart" && !c.running) outcome = "not_dispatched";
          if (
            outcome === "applied" &&
            (v.action === "stop" || v.action === "restart")
          ) {
            await effect(
              "stop",
              (g) => this.options.engine.stop(plan, c.id, g, signal),
              () => {},
            );
            await this.#verify(plan, await read(), signal, false);
          }
          if (
            outcome === "applied" &&
            (v.action === "start" || v.action === "restart")
          ) {
            await effect(
              "start",
              (g) => this.options.engine.start(plan, c.id, g, signal),
              () => {},
            );
            await this.#verify(plan, await read(), signal, true);
          }
        }
      }
    } catch (error) {
      const r = await read();
      // Never infer creation from labels, replay an unknown write or use rollback to clear it.
      if (v.action !== "provision" || r.intent) throw error;
      await check();
      await this.#rollback(plan, r, signal, effect);
      await change((r) => {
        r.retired = true;
        r.provisioned = false;
      });
      outcome = "rolled_back";
    }
    await check();
    const r = await read(),
      proof: BrokerProof = {
        verified: true,
        outcome,
        evidence_hash: nodeDigest({
          command_hash: digest,
          plan_hash: brokerPlanDigest(plan),
          container_id: r.container_id,
          network_id: r.network_id,
          provisioned: r.provisioned,
          retired: r.retired,
          outcome,
        }),
      };
    await change((r) => {
      r.proof = proof;
      r.pending = false;
    });
    return proof;
  }
  async #verify(
    plan: BrokerPlan,
    r: BrokerDeployment,
    signal: AbortSignal,
    running?: boolean,
  ) {
    if (!r.container_id || !r.network_id) deny("NODE_BROKER_NOT_OWNED");
    const c = await this.options.engine.container(plan, signal, r.container_id),
      n = await this.options.engine.network(plan, signal, r.network_id);
    if (
      !c?.owned ||
      !c.specification_matches ||
      !n?.owned ||
      !n.isolated ||
      n.endpoint_ids.some(
        (id) =>
          plan.manifest.profile === "disposable_fixture" ||
          id !== r.container_id,
      ) ||
      (running !== undefined && c.running !== running)
    )
      deny("NODE_BROKER_POSTCONDITION_DENIED");
    await this.options.engine.verifyStorage(plan, signal);
    return c;
  }
  async #rollback(
    plan: BrokerPlan,
    r: BrokerDeployment,
    signal: AbortSignal,
    effect: <T>(
      kind: NonNullable<BrokerDeployment["intent"]>,
      call: (guard: () => Promise<void>) => Promise<T>,
      acknowledged: (r: BrokerDeployment, value: T) => void,
    ) => Promise<T>,
  ) {
    if (r.intent) deny("NODE_BROKER_OUTCOME_UNKNOWN");
    if (r.container_id) {
      const id = r.container_id;
      await effect(
        "container_remove",
        (g) => this.options.engine.removeStopped(plan, id, g, signal),
        (r) => {
          r.container_id = null;
        },
      );
      if (await this.options.engine.container(plan, signal, id))
        deny("NODE_BROKER_ROLLBACK_UNVERIFIED");
    }
    if (r.network_id) {
      const id = r.network_id;
      await effect(
        "network_remove",
        (g) => this.options.engine.removeEmptyNetwork(plan, id, g, signal),
        (r) => {
          r.network_id = null;
        },
      );
      if (await this.options.engine.network(plan, signal, id))
        deny("NODE_BROKER_ROLLBACK_UNVERIFIED");
    }
    // Deliberately no volume/image/backup deletion or reservation release.
  }
}
