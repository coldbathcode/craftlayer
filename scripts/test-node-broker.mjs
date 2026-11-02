import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConstrainedDockerBroker } from "../apps/minecraft-node/dist/broker.js";
import { BrokerEngine } from "../apps/minecraft-node/dist/broker-engine.js";
import { BrokerPolicy } from "../apps/minecraft-node/dist/broker-policy.js";
import { NodeCommandExecutor } from "../apps/minecraft-node/dist/executor.js";
import {
  generateNodeKey,
  nodeDigest,
  nodeTimeWindow,
  signNodeValue,
  verifyNodeValue,
} from "../packages/node-protocol/dist/index.js";
import { pinLocalDocker } from "./lib/local-docker.mjs";

// Explicit local, non-Minecraft fixture. Never uses .env, SSH, game images or real worlds.
pinLocalDocker();
const docker = (args) =>
  spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
const output = (args) => {
  const result = docker(args);
  if (result.status !== 0)
    throw new Error("LOCAL_BROKER_FIXTURE_DOCKER_COMMAND_FAILED");
  return result.stdout.trim();
};
const ids = (kind) =>
  output(
    kind === "container" ? ["ps", "-aq", "--no-trunc"] : ["volume", "ls", "-q"],
  )
    .split("\n")
    .filter(Boolean);
const running = (id) =>
  output(["inspect", "--format", "{{.State.Running}}", id]) === "true";
const baseline = new Map(ids("container").map((id) => [id, running(id)])),
  baselineVolumes = ids("volume");
const image = JSON.parse(
  await readFile(new URL("../infra/images.lock.json", import.meta.url), "utf8"),
).redis.image;
// Do not pull implicitly: the ordinary local prototype/DB fixture already uses this pin.
output(["image", "inspect", "--format", "{{.Id}}", image]);
const root = await mkdtemp(join(tmpdir(), "craftlayer-real-broker-")),
  control = generateNodeKey(),
  node = generateNodeKey();
console.log(
  `Disposable non-Minecraft broker fixture; private ownership ledger: ${root}`,
);
const policy = {
  schema_version: 1,
  organization_id: randomUUID(),
  project_id: randomUUID(),
  node_id: randomUUID(),
  control_id: nodeDigest(control.public_key),
  credential_version: 1,
  control_public_key: control.public_key,
  node_public_key: node.public_key,
  policy_revision: 1,
  policy_hash: nodeDigest("local-broker-fixture-policy-v1"),
  enabled: true,
  allowed_actions: ["provision", "start", "stop", "restart", "rollback"],
};
const localPolicy = new BrokerPolicy({
  organization_id: policy.organization_id,
  project_id: policy.project_id,
  node_id: policy.node_id,
  policy_hash: policy.policy_hash,
  policy_revision: 1,
  allowed_images: [image],
  allowed_profiles: ["disposable_fixture"],
  max_cpu_milli: 100,
  max_memory_mb: 64,
  max_disk_mb: 1,
});
const manifests = new Map(),
  fences = new Map(),
  resources = [];
const manifest = () => {
  const m = {
    organization_id: policy.organization_id,
    project_id: policy.project_id,
    node_id: policy.node_id,
    deployment_id: randomUUID(),
    server_id: randomUUID(),
    world_id: randomUUID(),
    reservation_id: randomUUID(),
    plan_hash: nodeDigest(randomUUID()),
    template_hash: nodeDigest("local-redis-fixture-v1"),
    policy_hash: policy.policy_hash,
    profile: "disposable_fixture",
    image,
    cpu_milli: 100,
    memory_mb: 64,
    disk_mb: 1,
    identity_proof_hash: null,
    restore_proof_hash: null,
    eula_acceptance_hash: null,
    quota_proof_hash: null,
  };
  manifests.set(m.deployment_id, m);
  return m;
};
const command = (m, action) => {
  const fence = (fences.get(m.deployment_id) ?? 0) + 1;
  fences.set(m.deployment_id, fence);
  return {
    schema_version: 1,
    purpose: "node.command.v1",
    organization_id: policy.organization_id,
    project_id: policy.project_id,
    node_id: policy.node_id,
    control_id: policy.control_id,
    credential_version: 1,
    deployment_id: m.deployment_id,
    server_id: m.server_id,
    world_id: m.world_id,
    reservation_id: m.reservation_id,
    plan_hash: m.plan_hash,
    template_hash: m.template_hash,
    policy_revision: 1,
    policy_hash: policy.policy_hash,
    authorization_hash: nodeDigest("fake-local-authority-only"),
    approval_hash: nodeDigest("fake-local-adult-approval-only"),
    command_id: randomUUID(),
    operation_id: randomUUID(),
    action,
    attempt: 1,
    fence,
    stop_generation: 0,
    ...nodeTimeWindow(),
  };
};
const owned = async (kind, id, plan) => {
  resources.push({ kind, id, plan });
  await writeFile(
    join(root, "fixture-ownership.json"),
    JSON.stringify(
      resources.map((r) => ({
        kind: r.kind,
        id: r.id,
        manifest: r.plan.manifest,
        owner_nonce: r.plan.owner_nonce,
      })),
    ),
    { mode: 0o600 },
  );
};
const socket = process.env.DOCKER_HOST.slice("unix://".length),
  native = new BrokerEngine(socket);
let loseNetworkFor = null,
  failPostconditionFor = null,
  failOnce = false;
class FixtureEngine extends BrokerEngine {
  async createNetwork(plan, guard, signal) {
    const id = await super.createNetwork(plan, guard, signal);
    await owned("network", id, plan);
    if (plan.manifest.deployment_id === loseNetworkFor)
      throw new Error("FIXTURE_LOST_NATIVE_ACK");
    return id;
  }
  async createContainer(plan, guard, signal) {
    const id = await super.createContainer(plan, guard, signal);
    await owned("container", id, plan);
    if (plan.manifest.deployment_id === failPostconditionFor) failOnce = true;
    return id;
  }
  async container(plan, signal, id) {
    const c = await super.container(plan, signal, id);
    if (c && failOnce && plan.manifest.deployment_id === failPostconditionFor) {
      failOnce = false;
      return { ...c, running: true };
    }
    return c;
  }
}
const engine = new FixtureEngine(socket),
  brokerOptions = {
    directory: join(root, "broker"),
    executionPolicy: policy,
    policy: localPolicy,
    engine,
    catalog: {
      resolve: async (v) => {
        const m = manifests.get(v.deployment_id);
        if (!m) throw new Error("FIXTURE_MANIFEST_ABSENT");
        return m;
      },
    },
  };
let authorityAllowed = true;
const authority = {
  authorize: async (v, nonce) => {
    if (!authorityAllowed) throw new Error("FIXTURE_AUTHORITY_REVOKED");
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
    return { payload, signature: signNodeValue(payload, control.private_key) };
  },
};
let broker,
  executor,
  failure,
  passed = false;
const open = async () => {
  broker = new ConstrainedDockerBroker(brokerOptions);
  await broker.open();
  executor = new NodeCommandExecutor({
    directory: join(root, "execution"),
    policy,
    signingKey: node.private_key,
    authority,
    broker,
  });
  await executor.open();
};
const close = async () => {
  await executor?.close();
  executor = undefined;
  await broker?.close();
  broker = undefined;
};
const signed = (v) => ({
  payload: v,
  signature: signNodeValue(v, control.private_key),
});
const send = async (m, action, state = "succeeded") => {
  const v = command(m, action),
    receipt = await executor.execute(signed(v));
  assert.equal(receipt.payload.state, state);
  assert(verifyNodeValue(receipt.payload, receipt.signature, node.public_key));
  return { v, receipt };
};
try {
  const signal = new AbortController().signal;
  await native.supportsLimits(signal);
  await open();
  const m = manifest(),
    first = command(m, "provision");
  await assert.rejects(
    executor.execute({
      payload: first,
      signature: signNodeValue(first, generateNodeKey().private_key),
    }),
  );
  assert.equal(resources.length, 0);
  const receipt = await executor.execute(signed(first));
  assert.equal(receipt.payload.state, "succeeded");
  assert(verifyNodeValue(receipt.payload, receipt.signature, node.public_key));
  const container = resources.find(
      (r) =>
        r.kind === "container" &&
        r.plan.manifest.deployment_id === m.deployment_id,
    ),
    network = resources.find(
      (r) =>
        r.kind === "network" &&
        r.plan.manifest.deployment_id === m.deployment_id,
    );
  assert(container && network);
  assert.equal(running(container.id), false);
  const inspected = await native.container(
    container.plan,
    signal,
    container.id,
  );
  assert.deepEqual(inspected, {
    id: container.id,
    owned: true,
    specification_matches: true,
    running: false,
  });
  assert.deepEqual(await executor.execute(signed(first)), receipt);
  assert.equal(resources.length, 2);
  authorityAllowed = false;
  await assert.rejects(executor.execute(signed(first)));
  authorityAllowed = true;
  await send(m, "start");
  let ready = false;
  for (let n = 0; n < 40; n++) {
    const ping = docker([
      "exec",
      container.id,
      "redis-cli",
      "-h",
      "127.0.0.1",
      "PING",
    ]);
    if (ping.status === 0 && ping.stdout.trim() === "PONG") {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(ready, "FIXTURE_REDIS_READINESS_TIMEOUT");
  // Static harness-only scratch write, never a product exec port or persistent world proof.
  assert.notEqual(
    docker([
      "exec",
      container.id,
      "dd",
      "if=/dev/zero",
      "of=/data/quota-probe",
      "bs=65536",
      "count=32",
    ]).status,
    0,
  );
  const bytes = Number(
    output(["exec", container.id, "wc", "-c", "/data/quota-probe"]).split(
      /\s+/,
    )[0],
  );
  assert(bytes > 0 && bytes <= 1048576);
  await send(m, "restart");
  assert.equal(running(container.id), true);
  output(["stop", "--signal", "SIGTERM", "--timeout", "-1", container.id]);
  await close();
  await open();
  assert.equal(running(container.id), false);
  await send(m, "restart", "not_dispatched");
  assert.equal(running(container.id), false);
  await send(m, "start");
  await send(m, "stop");
  await send(m, "rollback");
  assert.equal(
    await native.container(container.plan, signal, container.id),
    null,
  );
  assert.equal(await native.network(network.plan, signal, network.id), null);
  await assert.rejects(executor.execute(signed(command(m, "start"))));
  console.log(
    "PASS signed real create/stopped postconditions/replay/revocation/start/PING/scratch quota/restart/manual-stop persistence/retained-storage rollback",
  );

  const preexisting = manifest(),
    preexistingCommand = command(preexisting, "provision"),
    preexistingPlan = localPolicy.compile(
      preexisting,
      preexistingCommand,
      randomUUID(),
    );
  const sentinel = await native.createContainer(
    preexistingPlan,
    async () => {},
    signal,
  );
  await owned("container", sentinel, preexistingPlan);
  const rejected = await executor.execute(signed(preexistingCommand));
  assert.equal(rejected.payload.state, "uncertain");
  assert.deepEqual(await native.container(preexistingPlan, signal, sentinel), {
    id: sentinel,
    owned: true,
    specification_matches: true,
    running: false,
  });
  console.log(
    "PASS preexisting matching-name container preserved in place; not adopted or removed",
  );

  const compensated = manifest();
  failPostconditionFor = compensated.deployment_id;
  await send(compensated, "provision", "rolled_back");
  const compensatedResources = resources.filter(
    (r) => r.plan.manifest.deployment_id === compensated.deployment_id,
  );
  assert.equal(compensatedResources.length, 2);
  for (const r of compensatedResources)
    assert.equal(
      r.kind === "container"
        ? await native.container(r.plan, signal, r.id)
        : await native.network(r.plan, signal, r.id),
      null,
    );
  console.log(
    "PASS actual known-new-resource compensation produces signed rolled_back receipt",
  );

  const uncertain = manifest();
  loseNetworkFor = uncertain.deployment_id;
  await send(uncertain, "provision", "uncertain");
  const unknown = resources.find(
    (r) =>
      r.kind === "network" &&
      r.plan.manifest.deployment_id === uncertain.deployment_id,
  );
  assert(unknown);
  assert((await native.network(unknown.plan, signal, unknown.id))?.owned);
  const journal = JSON.parse(
    await readFile(join(root, "broker", "broker.json"), "utf8"),
  );
  assert.equal(
    journal.deployments[uncertain.deployment_id].intent,
    "network_create",
  );
  assert.equal(journal.deployments[uncertain.deployment_id].network_id, null);
  await close();
  await open();
  await assert.rejects(
    executor.execute(signed(command(uncertain, "rollback"))),
  );
  assert((await native.network(unknown.plan, signal, unknown.id))?.owned);
  console.log(
    "PASS real lost-ack network stays unknown across reopen; no automatic retry/adoption/rollback",
  );
  const current = new Set(ids("container"));
  for (const [id, state] of baseline) {
    assert(current.has(id));
    assert.equal(running(id), state);
  }
  const volumes = new Set(ids("volume"));
  for (const name of baselineVolumes) assert(volumes.has(name));
  assert.deepEqual(ids("volume").sort(), baselineVolumes.sort());
  console.log(
    "PASS preexisting containers/running state/volumes preserved; no ports, game image, world, EULA or remote host used",
  );
  passed = true;
} catch (error) {
  failure = error;
} finally {
  try {
    await close();
  } catch (error) {
    failure ??= error;
  }
  // Harness owns exact returned IDs separately. Never infer provenance from a label/name scan.
  // This explicit disposal is not a product unknown-effect reconciliation implementation.
  const cleanupSignal = AbortSignal.timeout(20000);
  let clean = true;
  for (const r of [...resources].reverse()) {
    try {
      assert.equal(r.plan.manifest.profile, "disposable_fixture");
      if (r.kind === "container") {
        const c = await native.container(r.plan, cleanupSignal, r.id);
        if (c) {
          assert(c.owned && c.specification_matches);
          if (c.running)
            await native.stop(r.plan, r.id, async () => {}, cleanupSignal);
          await native.removeStopped(
            r.plan,
            r.id,
            async () => {},
            cleanupSignal,
          );
          assert.equal(
            await native.container(r.plan, cleanupSignal, r.id),
            null,
          );
        }
      } else {
        if (await native.network(r.plan, cleanupSignal, r.id))
          await native.removeEmptyNetwork(
            r.plan,
            r.id,
            async () => {},
            cleanupSignal,
          );
        assert.equal(await native.network(r.plan, cleanupSignal, r.id), null);
      }
    } catch {
      clean = false;
    }
  }
  if (!clean)
    failure ??= new Error(
      `FIXTURE_CLEANUP_INCOMPLETE: preserve private ownership ledger for review at ${root}`,
    );
  if (passed && clean && !failure) {
    await rm(root, { recursive: true });
    console.log(
      "PASS exact owned fixture cleanup; temporary journals removed after verified disposal",
    );
  }
}

if (failure) throw failure;
