import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type NodeCommand,
  type NodeExecutionPolicy,
  nodeAgentRequest,
  signedNodeCommandReceipt,
} from "@craftlayer/contracts";
import {
  generateNodeKey,
  nodeDigest,
  signNodeValue,
  verifyNodeValue,
} from "@craftlayer/node-protocol";
import { expect, it } from "vitest";
import {
  type CommandBroker,
  type ExecutionAuthority,
  NodeCommandExecutor,
} from "./executor.js";

async function fixture(
  fn: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const f = await setup();
  try {
    await fn(f);
  } finally {
    for (const executor of f.executors) await executor.close();
    await rm(f.root, { recursive: true, force: true });
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "craftlayer-command-")),
    control = generateNodeKey(),
    node = generateNodeKey();
  const policy: NodeExecutionPolicy = {
    schema_version: 1,
    organization_id: randomUUID(),
    project_id: randomUUID(),
    node_id: randomUUID(),
    control_id: nodeDigest(control.public_key),
    control_public_key: control.public_key,
    node_public_key: node.public_key,
    credential_version: 1,
    policy_revision: 1,
    policy_hash: "a".repeat(64),
    enabled: true,
    allowed_actions: ["provision", "start", "stop", "restart", "rollback"],
  };
  let wall = Date.now(),
    mono = 100,
    effects = 0,
    allowed = true;
  const seed = {
    deployment_id: randomUUID(),
    server_id: randomUUID(),
    world_id: randomUUID(),
    reservation_id: randomUUID(),
  };
  const make = (changes: Partial<NodeCommand> = {}): NodeCommand => ({
    schema_version: 1,
    purpose: "node.command.v1",
    organization_id: policy.organization_id,
    project_id: policy.project_id,
    node_id: policy.node_id,
    control_id: policy.control_id,
    credential_version: 1,
    ...seed,
    command_id: randomUUID(),
    operation_id: randomUUID(),
    action: "provision",
    attempt: 1,
    fence: 1,
    stop_generation: 0,
    policy_revision: 1,
    policy_hash: policy.policy_hash,
    plan_hash: "b".repeat(64),
    template_hash: "c".repeat(64),
    authorization_hash: "d".repeat(64),
    approval_hash: "e".repeat(64),
    issued_at: new Date(wall).toISOString(),
    expires_at: new Date(wall + 30000).toISOString(),
    ...changes,
  });
  const signed = (v: NodeCommand, key = control.private_key) => ({
    payload: v,
    signature: signNodeValue(v, key),
  });
  const authorize: ExecutionAuthority["authorize"] = async (v, nonce) => {
    if (!allowed) throw new Error("CURRENT_AUTHORITY_REVOKED");
    const payload = {
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
      issued_at: new Date(wall).toISOString(),
      expires_at: new Date(
        Math.min(wall + 5000, Date.parse(v.expires_at)),
      ).toISOString(),
      allowed: true,
    };
    return { payload, signature: signNodeValue(payload, control.private_key) };
  };
  const broker: CommandBroker = {
    apply: async (_v, guard) => {
      await guard();
      effects++;
      return { verified: true, evidence_hash: "f".repeat(64) };
    },
  };
  const executors: NodeCommandExecutor[] = [];
  const create = (
    changes: {
      policy?: NodeExecutionPolicy;
      authority?: ExecutionAuthority;
      broker?: CommandBroker;
      signingKey?: string;
      directory?: string;
    } = {},
  ) => {
    const executor = new NodeCommandExecutor({
      directory: join(root, "journal"),
      policy,
      signingKey: node.private_key,
      authority: { authorize },
      broker,
      clock: () => wall,
      monotonic: () => mono,
      ...changes,
    });
    executors.push(executor);
    return executor;
  };
  return {
    root,
    policy,
    node,
    control,
    make,
    signed,
    authorize,
    broker,
    create,
    executors,
    effects: () => effects,
    revoke: () => {
      allowed = false;
    },
    advance: (ms: number) => {
      wall += ms;
      mono += ms;
    },
    advanceMono: (ms: number) => {
      mono += ms;
    },
  };
}

it("persists signed receipt/fence before replay; rejects altered identity and stale logical targets", () =>
  fixture(async (f) => {
    const executor = f.create();
    await executor.open();
    const v = f.make(),
      signed = f.signed(v),
      first = await executor.execute(signed);
    expect(first.payload.state).toBe("succeeded");
    expect(
      signedNodeCommandReceipt.safeParse({
        ...first,
        payload: { ...first.payload, evidence_hash: null },
      }).success,
    ).toBe(false);
    expect(
      verifyNodeValue(first.payload, first.signature, f.node.public_key),
    ).toBe(true);
    expect(await executor.execute(signed)).toEqual(first);
    expect(f.effects()).toBe(1);
    await executor.close();
    const again = f.create();
    await again.open();
    expect(await again.execute(signed)).toEqual(first);
    expect(f.effects()).toBe(1);
    await expect(
      again.execute(f.signed({ ...v, action: "stop" })),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(
      again.execute(f.signed(f.make({ action: "stop", fence: 1 }))),
    ).rejects.toThrow("STALE_FENCE");
    await expect(
      again.execute(
        f.signed(f.make({ action: "stop", fence: 2, world_id: randomUUID() })),
      ),
    ).rejects.toThrow("RESOURCE_BINDING");
    await expect(
      again.execute(
        f.signed(f.make({ deployment_id: randomUUID(), fence: 2 })),
      ),
    ).rejects.toThrow("RESOURCE_BINDING");
    await expect(
      again.execute(
        f.signed(
          f.make({
            action: "start",
            deployment_id: randomUUID(),
            server_id: randomUUID(),
            world_id: randomUUID(),
          }),
        ),
      ),
    ).rejects.toThrow("NOT_OWNED");
    const stop = await again.execute(
      f.signed(f.make({ action: "stop", fence: 2 })),
    );
    expect(stop.payload.state).toBe("succeeded");
    expect(f.effects()).toBe(2);
  }));

it("denies forged, expired, future, cross-scope, disabled and arbitrary command envelopes before effects", () =>
  fixture(async (f) => {
    const executor = f.create();
    await executor.open();
    const v = f.make();
    await expect(
      executor.execute(f.signed(v, generateNodeKey().private_key)),
    ).rejects.toThrow("COMMAND_DENIED");
    for (const changes of [
      { node_id: randomUUID() },
      { organization_id: randomUUID() },
      { project_id: randomUUID() },
      { credential_version: 2 },
      { policy_revision: 2 },
      { policy_hash: "0".repeat(64) },
    ])
      await expect(executor.execute(f.signed(f.make(changes)))).rejects.toThrow(
        "SCOPE_DENIED",
      );
    for (const field of [
      "shell",
      "command",
      "host_path",
      "world_path",
      "image",
      "env",
      "approved",
    ])
      await expect(
        executor.execute({
          payload: { ...v, [field]: "FORBIDDEN_CANARY" },
          signature: f.signed(v).signature,
        }),
      ).rejects.toThrow();
    await expect(
      executor.execute(
        f.signed(
          f.make({
            issued_at: new Date(Date.parse(v.issued_at) + 1).toISOString(),
          }),
        ),
      ),
    ).rejects.toThrow("FROM_FUTURE");
    f.advance(30001);
    await expect(executor.execute(f.signed(v))).rejects.toThrow(
      "PROOF_EXPIRED",
    );
    expect(f.effects()).toBe(0);
    expect(nodeAgentRequest.safeParse(v).success).toBe(false); // Existing transport remains inventory-only.
    await executor.close();
    const disabled = f.create({ policy: { ...f.policy, enabled: false } });
    await disabled.open();
    await expect(disabled.execute(f.signed(f.make()))).rejects.toThrow(
      "COMMAND_DENIED",
    );
  }));

it("requires a fresh nonce-bound current permit for every dispatch, including replay", () =>
  fixture(async (f) => {
    let captured: unknown;
    const executor = f.create({
      authority: {
        authorize: async (v, nonce, signal) => {
          captured ??= await f.authorize(v, nonce, signal);
          return captured;
        },
      },
    });
    await executor.open();
    const receipt = await executor.execute(f.signed(f.make()));
    expect(receipt.payload.state).toBe("not_dispatched");
    expect(f.effects()).toBe(0);
    await executor.close();
    const current = f.create();
    await current.open();
    const v = f.make({ fence: 2 });
    await current.execute(f.signed(v));
    f.revoke();
    await expect(current.execute(f.signed(v))).rejects.toThrow("REVOKED");
    expect(f.effects()).toBe(1);
  }));

it("records uncertain effects and blocks conflicting work after lost acknowledgement and rotation", () =>
  fixture(async (f) => {
    const executor = f.create({
      broker: {
        apply: async (v, guard, signal) => {
          await f.broker.apply(v, guard, signal);
          throw new Error("ACK_LOST");
        },
      },
    });
    await executor.open();
    const v = f.make(),
      receipt = await executor.execute(f.signed(v));
    expect(receipt.payload.state).toBe("uncertain");
    expect(f.effects()).toBe(1);
    await expect(
      executor.execute(f.signed(f.make({ fence: 2 }))),
    ).rejects.toThrow("UNCERTAIN");
    await executor.close();
    const replacement = generateNodeKey(),
      policy = {
        ...f.policy,
        credential_version: 2,
        policy_revision: 2,
        node_public_key: replacement.public_key,
      };
    const rotated = f.create({ policy, signingKey: replacement.private_key });
    await rotated.open();
    await expect(
      rotated.execute(
        f.signed(
          f.make({ credential_version: 2, policy_revision: 2, fence: 3 }),
        ),
      ),
    ).rejects.toThrow("UNCERTAIN");
    await rotated.close();
    await expect(f.create().open()).rejects.toThrow("BINDING_DENIED");
    expect(f.effects()).toBe(1);
  }));

it("durably latches stop during an effect, blocks later verbs and does not clear on reopen", () =>
  fixture(async (f) => {
    let executor: NodeCommandExecutor;
    executor = f.create({
      broker: {
        apply: async (v, guard, signal) => {
          await f.broker.apply(v, guard, signal);
          await executor.latchStop();
          await guard();
          return { verified: true, evidence_hash: "f".repeat(64) };
        },
      },
    });
    await executor.open();
    expect((await executor.execute(f.signed(f.make()))).payload.state).toBe(
      "uncertain",
    );
    await executor.close();
    const reopened = f.create();
    await reopened.open();
    await expect(
      reopened.execute(f.signed(f.make({ fence: 2, stop_generation: 1 }))),
    ).rejects.toThrow("STOPPED");
    expect(f.effects()).toBe(1);
  }));

it("does not dispatch a higher fence concurrently and refuses close while effects are active", () =>
  fixture(async (f) => {
    let enter = () => {},
      release = () => {};
    const entered = new Promise<void>((done) => {
        enter = done;
      }),
      held = new Promise<void>((done) => {
        release = done;
      });
    const executor = f.create({
      broker: {
        apply: async (v, guard, signal) => {
          enter();
          await held;
          return f.broker.apply(v, guard, signal);
        },
      },
    });
    await executor.open();
    const pending = executor.execute(f.signed(f.make()));
    await entered;
    try {
      await expect(executor.close()).rejects.toThrow("IN_FLIGHT");
      await expect(
        executor.execute(f.signed(f.make({ fence: 2 }))),
      ).rejects.toThrow("UNCERTAIN");
    } finally {
      release();
    }
    expect((await pending).payload.state).toBe("succeeded");
    expect(f.effects()).toBe(1);
  }));

it("uses monotonic deadline and persistent wall-clock floor, never extends a lease on rollback", () =>
  fixture(async (f) => {
    const executor = f.create({
      broker: {
        apply: async (_v, guard) => {
          f.advanceMono(30001);
          await guard();
          return { verified: true, evidence_hash: "f".repeat(64) };
        },
      },
    });
    await executor.open();
    expect((await executor.execute(f.signed(f.make()))).payload.state).toBe(
      "uncertain",
    );
    expect(f.effects()).toBe(0);
    await executor.close();
    f.advance(-1);
    const reopened = f.create();
    await reopened.open();
    await expect(
      reopened.execute(
        f.signed(
          f.make({
            deployment_id: randomUUID(),
            server_id: randomUUID(),
            world_id: randomUUID(),
          }),
        ),
      ),
    ).rejects.toThrow("CLOCK_ROLLBACK");
  }));

it("bounds a hanging broker and prevents a late callback from dispatching another verb", () =>
  fixture(async (f) => {
    let release = () => {},
      lateGuard: (() => Promise<void>) | undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const executor = f.create({
      broker: {
        apply: async (_v, guard) => {
          lateGuard = guard;
          await held;
          return { verified: true, evidence_hash: "f".repeat(64) };
        },
      },
    });
    await executor.open();
    const v = f.make();
    v.expires_at = new Date(Date.parse(v.issued_at) + 150).toISOString();
    const receipt = await executor.execute(f.signed(v));
    expect(receipt.payload.state).toBe("uncertain");
    if (!lateGuard) throw new Error("Broker not reached");
    await expect(lateGuard()).rejects.toThrow("LEASE_EXPIRED");
    release();
    expect(f.effects()).toBe(0);
  }));

it("refuses missing/corrupt safety state and duplicate ownership without silently resetting", () =>
  fixture(async (f) => {
    const executor = f.create();
    await executor.open();
    await expect(f.create().open()).rejects.toThrow();
    await executor.close();
    const path = join(f.root, "journal", "execution.json");
    await unlink(path);
    await expect(f.create().open()).rejects.toThrow();
    await writeFile(path, "corrupt", { mode: 0o600 });
    await expect(f.create().open()).rejects.toThrow();
    expect(f.effects()).toBe(0);
  }));

it("survives a real process kill after dispatch intent; an operator lock review cannot erase uncertainty", () =>
  fixture(async (f) => {
    const directory = join(f.root, "crash-journal"),
      ready = join(f.root, "effect-observed"),
      path = join(f.root, "child.json"),
      v = f.make();
    await writeFile(
      path,
      JSON.stringify({
        directory,
        ready,
        policy: f.policy,
        signingKey: f.node.private_key,
        control: f.control.private_key,
        job: f.signed(v),
        module: pathToFileURL(
          join(process.cwd(), "apps/minecraft-node/dist/executor.js"),
        ).href,
      }),
      { mode: 0o600 },
    );
    const source = `import{readFile,writeFile}from'node:fs/promises';import{randomUUID}from'node:crypto';import{nodeDigest,signNodeValue}from'./packages/node-protocol/dist/index.js';const c=JSON.parse(await readFile(process.argv[1],'utf8'));const{NodeCommandExecutor}=await import(c.module);const e=new NodeCommandExecutor({directory:c.directory,policy:c.policy,signingKey:c.signingKey,authority:{authorize:async(v,nonce)=>{const n=Date.now(),p={schema_version:1,purpose:'node.command.permit.v1',control_id:v.control_id,organization_id:v.organization_id,project_id:v.project_id,node_id:v.node_id,credential_version:v.credential_version,command_hash:nodeDigest(v),request_nonce:nonce,lease_id:randomUUID(),fence:v.fence,stop_generation:v.stop_generation,policy_revision:v.policy_revision,policy_hash:v.policy_hash,authorization_hash:v.authorization_hash,issued_at:new Date(n).toISOString(),expires_at:new Date(Math.min(n+5000,Date.parse(v.expires_at))).toISOString(),allowed:true};return{payload:p,signature:signNodeValue(p,c.control)}}},broker:{apply:async(_v,guard)=>{await guard();await writeFile(c.ready,'one simulated effect',{mode:0o600});await new Promise(()=>{})}}});await e.open();await e.execute(c.job);`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", source, path],
      { cwd: process.cwd(), stdio: "ignore" },
    );
    const exited = new Promise<void>((done) =>
      child.once("exit", () => done()),
    );
    try {
      let observed = false;
      for (let n = 0; n < 200; n++) {
        try {
          observed = (await readFile(ready, "utf8")) === "one simulated effect";
        } catch {}
        if (observed) break;
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(observed).toBe(true);
      child.kill("SIGKILL");
      await exited;
      f.advance(Math.max(0, Date.now() - Date.parse(v.issued_at)));
      const reopened = f.create({ directory });
      await expect(reopened.open()).rejects.toThrow();
      // Explicit test operator review: process is dead and dispatching intent is retained.
      const state = JSON.parse(
        await readFile(join(directory, "execution.json"), "utf8"),
      );
      expect(state.commands[v.command_id].state).toBe("dispatching");
      await unlink(join(directory, "agent.lock"));
      await reopened.open();
      await expect(
        reopened.execute(f.signed(f.make({ fence: 2 }))),
      ).rejects.toThrow("UNCERTAIN");
      expect(f.effects()).toBe(0);
      expect(await readFile(ready, "utf8")).toBe("one simulated effect");
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  }));
