import { randomUUID } from "node:crypto";
import { nodeDigest } from "@craftlayer/node-protocol";
import { expect, it } from "vitest";
import { containerSpecification } from "./broker-policy.js";
import { brokerFixture, engineFixture } from "./testing/broker.fixture.js";

it("compiles only pinned approved scoped templates with generated names and no caller Docker fields", () => {
  const f = brokerFixture();
  expect(containerSpecification(f.plan)).toMatchObject({
    User: "10001:10001",
    Env: [],
    HostConfig: {
      Privileged: false,
      ReadonlyRootfs: true,
      NetworkMode: "none",
      PortBindings: {},
      RestartPolicy: { Name: "no" },
      AutoRemove: false,
      Memory: 64 * 1048576,
      NanoCpus: 100000000,
      Mounts: [],
    },
  });
  expect(() =>
    f.policy.compile({ ...f.manifest, image: "redis:latest" }, f.job, f.owner),
  ).toThrow();
  expect(() =>
    f.policy.compile(
      { ...f.manifest, image: `other@sha256:${"d".repeat(64)}` },
      f.job,
      f.owner,
    ),
  ).toThrow();
  for (const field of [
    "env",
    "mounts",
    "host_path",
    "shell",
    "Privileged",
    "network_mode",
    "public_rcon",
  ])
    expect(() =>
      f.policy.compile({ ...f.manifest, [field]: true }, f.job, f.owner),
    ).toThrow();
  expect(() =>
    f.policy.compile({ ...f.manifest, world_id: randomUUID() }, f.job, f.owner),
  ).toThrow();
  expect(() =>
    f.policy.compile({ ...f.manifest, cpu_milli: 3000 }, f.job, f.owner),
  ).toThrow();
  expect(() =>
    f.policy.compile(
      {
        ...f.manifest,
        profile: "minecraft",
        cpu_milli: 2000,
        memory_mb: 6144,
        disk_mb: 20480,
      },
      f.job,
      f.owner,
    ),
  ).toThrow();
  expect(() => {
    (f.plan.manifest as { image: string }).image = "mutated";
  }).toThrow();
});

it("uses fixed guarded Engine verbs, private limits, selected projections and retained-volume deletion flags", () =>
  engineFixture(async (f) => {
    await f.engine.ensureImage(f.plan, f.guard, f.signal);
    const network = await f.engine.createNetwork(f.plan, f.guard, f.signal),
      container = await f.engine.createContainer(f.plan, f.guard, f.signal);
    expect(
      (await f.engine.container(f.plan, f.signal, container))
        ?.specification_matches,
    ).toBe(true);
    await f.engine.start(f.plan, container, f.guard, f.signal);
    expect(
      (await f.engine.container(f.plan, f.signal, container))?.running,
    ).toBe(true);
    await f.engine.stop(f.plan, container, f.guard, f.signal);
    await f.engine.removeStopped(f.plan, container, f.guard, f.signal);
    await f.engine.removeEmptyNetwork(f.plan, network, f.guard, f.signal);
    const writes = f.requests.filter((r) => r.method !== "GET");
    expect(writes).toHaveLength(6);
    expect(f.state.guards).toBe(6);
    expect(
      writes.some(
        (r) => r.path === `/containers/${container}/stop?t=-1&signal=SIGTERM`,
      ),
    ).toBe(true);
    expect(
      writes.some(
        (r) => r.path === `/containers/${container}?force=false&v=false`,
      ),
    ).toBe(true);
    expect(
      writes.some((r) => /volumes|exec|kill|prune|update/.test(r.path)),
    ).toBe(false);
    f.state.container = true;
    expect(
      JSON.stringify(await f.engine.container(f.plan, f.signal)),
    ).not.toContain("BROKER_SECRET_CANARY");
  }));

it.each([
  "labels",
  "mount",
  "public_port",
  "privileged",
  "command",
  "entrypoint",
  "environment",
  "network",
])("blocks %s drift before a lifecycle mutation", (altered) =>
  engineFixture(async (f) => {
    f.state.container = true;
    f.state.altered = altered;
    await expect(
      f.engine.start(f.plan, f.containerId, f.guard, f.signal),
    ).rejects.toThrow("OWNERSHIP_DENIED");
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
    expect(f.state.guards).toBe(0);
  }),
);

it("does not adopt preexisting resources, force-delete running containers or delete attached networks", () =>
  engineFixture(async (f) => {
    f.state.container = true;
    f.state.network = true;
    await expect(
      f.engine.createNetwork(f.plan, f.guard, f.signal),
    ).rejects.toThrow("PREEXISTING");
    await expect(
      f.engine.createContainer(f.plan, f.guard, f.signal),
    ).rejects.toThrow("PREEXISTING");
    f.state.running = true;
    await expect(
      f.engine.removeStopped(f.plan, f.containerId, f.guard, f.signal),
    ).rejects.toThrow("RUNNING_REMOVAL");
    f.state.endpoints = 1;
    await expect(
      f.engine.removeEmptyNetwork(f.plan, f.networkId, f.guard, f.signal),
    ).rejects.toThrow("OWNERSHIP_DENIED");
    await expect(
      f.engine.stop(f.plan, "../unrelated", f.guard, f.signal),
    ).rejects.toThrow();
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
  }));

it("refuses persistent Minecraft storage without a real quota verifier and rejects JSON plan capabilities", () =>
  engineFixture(async (f) => {
    const manifest = {
      ...f.manifest,
      profile: "minecraft",
      cpu_milli: 2000,
      memory_mb: 6144,
      disk_mb: 20480,
      identity_proof_hash: nodeDigest("identity"),
      restore_proof_hash: nodeDigest("restore"),
      eula_acceptance_hash: nodeDigest("test-only-eula-reference"),
      quota_proof_hash: nodeDigest("quota"),
    };
    const plan = f.policy.compile(manifest, f.job, f.owner);
    await expect(
      f.engine.createContainer(plan, f.guard, f.signal),
    ).rejects.toThrow("PERSISTENT_QUOTA_UNAVAILABLE");
    await expect(
      f.engine.createNetwork(
        JSON.parse(JSON.stringify(f.plan)),
        f.guard,
        f.signal,
      ),
    ).rejects.toThrow("POLICY_DENIED");
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
    expect(f.state.guards).toBe(0);
  }));

it("pulls only the approved digest and treats pull errors/unsupported host limits as denial", () =>
  engineFixture(async (f) => {
    f.state.image = false;
    await f.engine.ensureImage(f.plan, f.guard, f.signal);
    expect(
      f.requests.some(
        (r) =>
          r.method === "POST" &&
          r.path ===
            `/images/create?fromImage=${encodeURIComponent(f.manifest.image)}`,
      ),
    ).toBe(true);
    f.state.image = false;
    f.state.pullError = true;
    await expect(
      f.engine.ensureImage(f.plan, f.guard, f.signal),
    ).rejects.toThrow("PULL_DENIED");
    f.state.limits = false;
    await expect(
      f.engine.createContainer(f.plan, f.guard, f.signal),
    ).rejects.toThrow("LIMITS_UNSUPPORTED");
    expect(f.state.container).toBe(false);
  }));

it("requires a guard for every write and honors cancellation without dispatch", () =>
  engineFixture(async (f) => {
    await expect(
      f.engine.createNetwork(
        f.plan,
        async () => {
          throw new Error("REVOKED");
        },
        f.signal,
      ),
    ).rejects.toThrow("REVOKED");
    const abort = new AbortController();
    abort.abort();
    await expect(
      f.engine.createContainer(f.plan, f.guard, abort.signal),
    ).rejects.toThrow("ABORTED");
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
  }));

it("does not retry a write whose acknowledgement was lost or claim the resulting preexisting resource", () =>
  engineFixture(async (f) => {
    f.state.acknowledgementLoss = true;
    await expect(
      f.engine.createNetwork(f.plan, f.guard, f.signal),
    ).rejects.toThrow("OUTCOME_UNKNOWN");
    expect(f.state.network).toBe(true);
    await expect(
      f.engine.createNetwork(f.plan, f.guard, f.signal),
    ).rejects.toThrow("PREEXISTING");
    expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(f.requests.some((r) => r.method === "DELETE")).toBe(false);
  }));
