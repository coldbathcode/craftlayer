import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeCommand, NodeExecutionPolicy } from "@craftlayer/contracts";
import {
  generateNodeKey,
  nodeDigest,
  signNodeValue,
} from "@craftlayer/node-protocol";
import { expect, it } from "vitest";
import { ConstrainedDockerBroker, type ConstrainedEngine } from "./broker.js";
import { NodeCommandExecutor } from "./executor.js";
import { engineFixture } from "./testing/broker.fixture.js";

type Fixture = Parameters<Parameters<typeof engineFixture>[0]>[0];
async function setup(f: Fixture, engine: ConstrainedEngine = f.engine) {
  const control = generateNodeKey(),
    node = generateNodeKey();
  f.job.control_id = nodeDigest(control.public_key);
  const executionPolicy: NodeExecutionPolicy = {
    schema_version: 1,
    organization_id: f.job.organization_id,
    project_id: f.job.project_id,
    node_id: f.job.node_id,
    control_id: f.job.control_id,
    credential_version: 1,
    control_public_key: control.public_key,
    node_public_key: node.public_key,
    policy_revision: 1,
    policy_hash: f.job.policy_hash,
    enabled: true,
    allowed_actions: ["provision", "start", "stop", "restart", "rollback"],
  };
  const options = {
      directory: join(f.directory, "broker"),
      executionPolicy,
      policy: f.policy,
      engine,
      catalog: { resolve: async () => f.manifest },
    },
    broker = new ConstrainedDockerBroker(options);
  await broker.open();
  const next = (action: NodeCommand["action"], fence: number): NodeCommand => ({
    ...f.job,
    command_id: randomUUID(),
    operation_id: randomUUID(),
    action,
    fence,
  });
  return {
    broker,
    options,
    next,
    control,
    node,
    executionPolicy,
    snapshot: async () =>
      JSON.parse(
        await readFile(join(options.directory, "broker.json"), "utf8"),
      ),
  };
}
function overrideEngine(
  engine: ConstrainedEngine,
  overrides: Partial<ConstrainedEngine>,
): ConstrainedEngine {
  return new Proxy(engine, {
    get(target, key) {
      const override = Reflect.get(overrides, key);
      if (override) return override;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
const writes = (f: Fixture) => f.requests.filter((r) => r.method !== "GET");

it("journals exact creation IDs, replays without effects and supports explicit lifecycle/retained-storage rollback", () =>
  engineFixture(async (f) => {
    const x = await setup(f);
    let broker = x.broker;
    try {
      const proof = await broker.apply(f.job, f.guard, f.signal);
      expect(proof.outcome).toBe("applied");
      expect(f.state.running).toBe(false);
      expect(
        (await x.snapshot()).deployments[f.job.deployment_id],
      ).toMatchObject({
        container_id: f.containerId,
        network_id: f.networkId,
        pending: false,
        intent: null,
        provisioned: true,
      });
      expect(writes(f)).toHaveLength(2);
      expect(await broker.apply(f.job, f.guard, f.signal)).toEqual(proof);
      expect(writes(f)).toHaveLength(2);
      await expect(
        broker.apply({ ...f.job, fence: 2 }, f.guard, f.signal),
      ).rejects.toThrow("IDEMPOTENCY");
      await broker.apply(x.next("start", 2), f.guard, f.signal);
      expect(f.state.running).toBe(true);
      await broker.apply(x.next("restart", 3), f.guard, f.signal);
      expect(f.state.running).toBe(true);
      await broker.apply(x.next("stop", 4), f.guard, f.signal);
      const beforeReopen = writes(f).length;
      await broker.close();
      broker = new ConstrainedDockerBroker(x.options);
      await broker.open();
      expect(writes(f)).toHaveLength(beforeReopen);
      expect(
        (await broker.apply(x.next("restart", 5), f.guard, f.signal)).outcome,
      ).toBe("not_dispatched");
      expect(writes(f)).toHaveLength(beforeReopen);
      await broker.apply(x.next("start", 6), f.guard, f.signal);
      await broker.apply(x.next("stop", 7), f.guard, f.signal);
      await broker.apply(x.next("rollback", 8), f.guard, f.signal);
      expect(f.state.container).toBe(false);
      expect(f.state.network).toBe(false);
      expect(
        writes(f)
          .filter((r) => r.method === "DELETE")
          .map((r) => r.path),
      ).toEqual([
        `/containers/${f.containerId}?force=false&v=false`,
        `/networks/${f.networkId}`,
      ]);
      await expect(
        broker.apply(x.next("start", 9), f.guard, f.signal),
      ).rejects.toThrow("RETIRED");
      await expect(
        broker.apply(
          { ...x.next("provision", 9), deployment_id: randomUUID() },
          f.guard,
          f.signal,
        ),
      ).rejects.toThrow();
    } finally {
      await broker.close();
    }
  }));

it("does not adopt even matching preexisting names or expose a disabled/mismatched catalog", () =>
  engineFixture(async (f) => {
    const x = await setup(f);
    try {
      f.state.container = true;
      await expect(x.broker.apply(f.job, f.guard, f.signal)).rejects.toThrow(
        "PREEXISTING",
      );
      expect(writes(f)).toHaveLength(0);
      f.state.container = false;
      f.manifest.plan_hash = "0".repeat(64);
      await expect(x.broker.apply(f.job, f.guard, f.signal)).rejects.toThrow();
      expect(writes(f)).toHaveLength(0);
      expect((await x.snapshot()).deployments).toEqual({});
    } finally {
      await x.broker.close();
    }
  }));

it("retains lost create acknowledgement across reopen/credential rotation and denies retry/rollback by labels", () =>
  engineFixture(async (f) => {
    const x = await setup(f);
    let broker = x.broker;
    try {
      f.state.acknowledgementLoss = true;
      await expect(broker.apply(f.job, f.guard, f.signal)).rejects.toThrow();
      expect(f.state.network).toBe(true);
      expect(
        (await x.snapshot()).deployments[f.job.deployment_id],
      ).toMatchObject({
        pending: true,
        intent: "network_create",
        network_id: null,
        container_id: null,
      });
      await broker.close();
      broker = new ConstrainedDockerBroker({
        ...x.options,
        executionPolicy: { ...x.executionPolicy, credential_version: 2 },
      });
      await broker.open();
      for (const action of ["provision", "rollback", "start"] as const)
        await expect(
          broker.apply(
            { ...x.next(action, 2), credential_version: 2 },
            f.guard,
            f.signal,
          ),
        ).rejects.toThrow("OUTCOME_UNKNOWN");
      expect(writes(f)).toHaveLength(1);
      expect(f.state.network).toBe(true);
    } finally {
      await broker.close();
    }
  }));

it("rolls back only acknowledged new runtime resources when a read-only postcondition fails", () =>
  engineFixture(async (f) => {
    let reads = 0;
    const engine = overrideEngine(f.engine, {
        container: async (...args) => {
          const c = await f.engine.container(...args);
          reads++;
          return c && reads === 2 ? { ...c, running: true } : c;
        },
      }),
      x = await setup(f, engine);
    try {
      const result = await x.broker.apply(f.job, f.guard, f.signal);
      expect(result.outcome).toBe("rolled_back");
      expect(f.state.container).toBe(false);
      expect(f.state.network).toBe(false);
      expect(
        (await x.snapshot()).deployments[f.job.deployment_id],
      ).toMatchObject({
        pending: false,
        retired: true,
        provisioned: false,
        container_id: null,
        network_id: null,
      });
      expect(writes(f).some((r) => r.path.includes("/volumes/"))).toBe(false);
      expect((await x.broker.apply(f.job, f.guard, f.signal)).outcome).toBe(
        "rolled_back",
      );
    } finally {
      await x.broker.close();
    }
  }));

it("never removes running/drifted resources or clears uncertainty after a rejected rollback", () =>
  engineFixture(async (f) => {
    const x = await setup(f);
    try {
      await x.broker.apply(f.job, f.guard, f.signal);
      await x.broker.apply(x.next("start", 2), f.guard, f.signal);
      await expect(
        x.broker.apply(x.next("rollback", 3), f.guard, f.signal),
      ).rejects.toThrow("RUNNING");
      expect(writes(f).filter((r) => r.method === "DELETE")).toHaveLength(0);
      await expect(
        x.broker.apply(x.next("stop", 4), f.guard, f.signal),
      ).rejects.toThrow("OUTCOME_UNKNOWN");
    } finally {
      await x.broker.close();
    }
  }));

it("records intent before a guard rejection and refuses further work while a broker call is active", () =>
  engineFixture(async (f) => {
    const x = await setup(f);
    let release = () => {};
    const wait = new Promise<void>((done) => {
      release = done;
    });
    let entered = () => {};
    const ready = new Promise<void>((done) => {
      entered = done;
    });
    try {
      const running = x.broker.apply(
        f.job,
        async () => {
          entered();
          await wait;
        },
        f.signal,
      );
      await ready;
      await expect(x.broker.close()).rejects.toThrow("IN_FLIGHT");
      await expect(x.broker.apply(f.job, f.guard, f.signal)).rejects.toThrow(
        "IN_FLIGHT",
      );
      release();
      await running;
      let guards = 0;
      await expect(
        x.broker.apply(
          x.next("start", 2),
          async () => {
            if (++guards === 4) throw new Error("REVOKED");
          },
          f.signal,
        ),
      ).rejects.toThrow("REVOKED");
      expect(
        (await x.snapshot()).deployments[f.job.deployment_id],
      ).toMatchObject({ pending: true, intent: "start" });
      expect(f.state.running).toBe(false);
    } finally {
      release();
      await x.broker.close();
    }
  }));

it.each(["missing", "corrupt", "public", "symlink"])(
  "refuses %s old ownership state without reset",
  (mode) =>
    engineFixture(async (f) => {
      const x = await setup(f);
      await x.broker.close();
      const path = join(x.options.directory, "broker.json");
      if (mode === "missing") await unlink(path);
      if (mode === "corrupt") await writeFile(path, "{}", { mode: 0o600 });
      if (mode === "public") {
        const { chmod } = await import("node:fs/promises");
        await chmod(path, 0o644);
      }
      if (mode === "symlink") {
        const { symlink } = await import("node:fs/promises");
        await unlink(path);
        await symlink(join(f.directory, "missing"), path);
      }
      const reopened = new ConstrainedDockerBroker(x.options);
      await expect(reopened.open()).rejects.toThrow();
      await reopened.close();
      expect(writes(f)).toHaveLength(0);
    }),
);

it.each(["rolled_back", "not_dispatched"] as const)(
  "persists a truthful signed %s executor receipt rather than provisioning success",
  (outcome) =>
    engineFixture(async (f) => {
      const x = await setup(f),
        executor = new NodeCommandExecutor({
          directory: join(f.directory, "execution"),
          policy: x.executionPolicy,
          signingKey: x.node.private_key,
          authority: {
            authorize: async (v, nonce) => {
              const now = Date.now(),
                payload = {
                  schema_version: 1,
                  purpose: "node.command.permit.v1",
                  control_id: v.control_id,
                  organization_id: v.organization_id,
                  project_id: v.project_id,
                  node_id: v.node_id,
                  credential_version: v.credential_version,
                  command_hash: nodeDigest(v),
                  request_nonce: nonce,
                  lease_id: randomUUID(),
                  fence: v.fence,
                  stop_generation: v.stop_generation,
                  policy_revision: v.policy_revision,
                  policy_hash: v.policy_hash,
                  authorization_hash: v.authorization_hash,
                  issued_at: new Date(now).toISOString(),
                  expires_at: new Date(
                    Math.min(now + 5000, Date.parse(v.expires_at)),
                  ).toISOString(),
                  allowed: true,
                };
              return {
                payload,
                signature: signNodeValue(payload, x.control.private_key),
              };
            },
          },
          broker: {
            apply: async () => ({
              verified: true,
              outcome,
              evidence_hash: "1".repeat(64),
            }),
          },
        });
      await executor.open();
      try {
        const receipt = await executor.execute({
          payload: f.job,
          signature: signNodeValue(f.job, x.control.private_key),
        });
        expect(receipt.payload.state).toBe(outcome);
        expect(receipt.payload.evidence_hash).toBe(
          outcome === "rolled_back" ? "1".repeat(64) : null,
        );
        if (outcome === "rolled_back") {
          const v = x.next("provision", 2);
          await expect(
            executor.execute({
              payload: v,
              signature: signNodeValue(v, x.control.private_key),
            }),
          ).rejects.toThrow("BINDING");
        }
      } finally {
        await executor.close();
        await x.broker.close();
      }
    }),
);

it("retains native create intent after actual process death without adopting its labelled result", () =>
  engineFixture(async (f) => {
    const x = await setup(f);
    await x.broker.close();
    const ready = join(f.directory, "child-ready"),
      config = join(f.directory, "child.json");
    await writeFile(
      config,
      JSON.stringify({
        directory: x.options.directory,
        executionPolicy: x.executionPolicy,
        policy: f.value,
        manifest: f.manifest,
        job: f.job,
        socket: f.socket,
        ready,
      }),
      { mode: 0o600 },
    );
    const source = `import{readFile,writeFile}from'node:fs/promises';import{BrokerEngine}from'./apps/minecraft-node/dist/broker-engine.js';import{BrokerPolicy}from'./apps/minecraft-node/dist/broker-policy.js';import{ConstrainedDockerBroker}from'./apps/minecraft-node/dist/broker.js';const c=JSON.parse(await readFile(process.argv[1],'utf8'));class CrashEngine extends BrokerEngine{async createNetwork(...args){await super.createNetwork(...args);await writeFile(c.ready,'acknowledged',{mode:0o600});await new Promise(()=>{});}}const b=new ConstrainedDockerBroker({directory:c.directory,executionPolicy:c.executionPolicy,policy:new BrokerPolicy(c.policy),catalog:{resolve:async()=>c.manifest},engine:new CrashEngine(c.socket)});setInterval(()=>{},1000);await b.open();await b.apply(c.job,async()=>{},new AbortController().signal);`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", source, config],
      { cwd: process.cwd(), stdio: "ignore" },
    );
    const exited = new Promise<void>((done) =>
      child.once("exit", () => done()),
    );
    try {
      let observed = false;
      for (let n = 0; n < 200; n++) {
        try {
          observed = (await readFile(ready, "utf8")) === "acknowledged";
        } catch {}
        if (observed) break;
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(observed).toBe(true);
      child.kill("SIGKILL");
      await exited;
      expect(f.state.network).toBe(true);
      expect(
        (await x.snapshot()).deployments[f.job.deployment_id],
      ).toMatchObject({
        pending: true,
        intent: "network_create",
        network_id: null,
      });
      const blocked = new ConstrainedDockerBroker(x.options);
      await expect(blocked.open()).rejects.toThrow();
      await blocked.close();
      // Test-only operator lock review after the process is confirmed dead; ownership file retained.
      await unlink(join(x.options.directory, "agent.lock"));
      const reopened = new ConstrainedDockerBroker(x.options);
      await reopened.open();
      try {
        await expect(
          reopened.apply(x.next("rollback", 2), f.guard, f.signal),
        ).rejects.toThrow("OUTCOME_UNKNOWN");
        expect(writes(f)).toHaveLength(1);
      } finally {
        await reopened.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
  }));
