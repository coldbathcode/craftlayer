import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeCommand } from "@craftlayer/contracts";
import { nodeDigest, nodeTimeWindow } from "@craftlayer/node-protocol";
import { expect, it } from "vitest";
import { BrokerEngine } from "./broker-engine.js";
import {
  type ApprovedDeployment,
  BrokerPolicy,
  containerSpecification,
  resourceLabels,
} from "./broker-policy.js";

export function brokerFixture() {
  const manifest: ApprovedDeployment = {
    organization_id: randomUUID(),
    project_id: randomUUID(),
    node_id: randomUUID(),
    deployment_id: randomUUID(),
    server_id: randomUUID(),
    world_id: randomUUID(),
    reservation_id: randomUUID(),
    plan_hash: "a".repeat(64),
    template_hash: "b".repeat(64),
    policy_hash: "c".repeat(64),
    profile: "disposable_fixture",
    image: `redis:8-alpine@sha256:${"d".repeat(64)}`,
    cpu_milli: 100,
    memory_mb: 64,
    disk_mb: 1,
    identity_proof_hash: null,
    restore_proof_hash: null,
    eula_acceptance_hash: null,
    quota_proof_hash: null,
  };
  const job: NodeCommand = {
    ...manifest,
    schema_version: 1,
    purpose: "node.command.v1",
    command_id: randomUUID(),
    operation_id: randomUUID(),
    credential_version: 1,
    control_id: "f".repeat(64),
    action: "provision",
    attempt: 1,
    fence: 1,
    stop_generation: 0,
    policy_revision: 1,
    authorization_hash: "e".repeat(64),
    approval_hash: "f".repeat(64),
    ...nodeTimeWindow(),
  };
  // Job references never carry image, profile or Docker parameters.
  for (const key of [
    "profile",
    "image",
    "cpu_milli",
    "memory_mb",
    "disk_mb",
    "identity_proof_hash",
    "restore_proof_hash",
    "eula_acceptance_hash",
    "quota_proof_hash",
  ] as const)
    delete (job as unknown as Record<string, unknown>)[key];
  const value = {
    organization_id: manifest.organization_id,
    project_id: manifest.project_id,
    node_id: manifest.node_id,
    policy_hash: manifest.policy_hash,
    policy_revision: 1,
    allowed_images: [manifest.image],
    allowed_profiles: ["disposable_fixture", "minecraft"],
    max_cpu_milli: 2000,
    max_memory_mb: 6144,
    max_disk_mb: 20480,
  };
  const policy = new BrokerPolicy(value),
    owner = randomUUID(),
    plan = policy.compile(manifest, job, owner);
  return { manifest, job, value, policy, owner, plan };
}
async function engineFixture(
  fn: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const f = await setup();
  try {
    await fn(f);
  } finally {
    await new Promise<void>((done) => f.server.close(() => done()));
    await rm(f.directory, { recursive: true, force: true });
  }
}
async function setup() {
  const f = brokerFixture(),
    directory = await mkdtemp(join(tmpdir(), "craftlayer-broker-")),
    socket = join(directory, "engine.sock"),
    containerId = "1".repeat(64),
    networkId = "2".repeat(64),
    imageId = `sha256:${"3".repeat(64)}`;
  const state = {
    container: false,
    network: false,
    image: true,
    running: false,
    endpoints: 0,
    altered: "",
    limits: true,
    pullError: false,
    acknowledgementLoss: false,
    guards: 0,
  };
  const requests: { method: string; path: string; body: unknown }[] = [];
  const rawContainer = () => {
    const spec = containerSpecification(f.plan),
      h = {
        ...spec.HostConfig,
        Tmpfs: Object.fromEntries(
          Object.entries(spec.HostConfig.Tmpfs).reverse(),
        ),
      };
    const raw = {
      Id: containerId,
      Name: `/${f.plan.names.container}`,
      Image: imageId,
      State: { Running: state.running },
      Config: {
        Image: spec.Image,
        User: spec.User,
        Labels: resourceLabels(f.plan, "container"),
        Env: ["SECRET=BROKER_SECRET_CANARY"],
        Cmd: spec.Cmd ?? null,
        Entrypoint: ["docker-entrypoint.sh"],
        WorkingDir: "/data",
      },
      HostConfig: h,
      Mounts: [
        { Type: "tmpfs", Destination: "/data", RW: true },
        { Type: "tmpfs", Destination: "/tmp", RW: true },
      ],
      NetworkSettings: { Ports: { "6379/tcp": null } },
    };
    if (state.altered === "labels")
      raw.Config.Labels["com.craftlayer.owner"] = randomUUID();
    if (state.altered === "mount")
      raw.Mounts.push({
        Type: "bind",
        Destination: "/var/run/docker.sock",
        RW: true,
      });
    if (state.altered === "public_port")
      h.PortBindings = {
        "25575/tcp": [{ HostIp: "0.0.0.0", HostPort: "25575" }],
      };
    if (state.altered === "privileged") h.Privileged = true;
    if (state.altered === "command") raw.Config.Cmd = ["sh"];
    if (state.altered === "entrypoint") raw.Config.Entrypoint = ["sh"];
    if (state.altered === "environment") raw.Config.Env = ["ONLINE_MODE=false"];
    return raw;
  };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const b of req) chunks.push(b as Buffer);
    const path = (req.url ?? "").replace(/^\/v1\.50/, ""),
      body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown)
        : null;
    requests.push({ method: req.method ?? "", path, body });
    res.setHeader("content-type", "application/json");
    const send = (code: number, value?: unknown) => {
      res.statusCode = code;
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    if (path === "/info")
      return send(200, {
        MemoryLimit: state.limits,
        SwapLimit: true,
        CpuCfsQuota: true,
        PidsLimit: true,
        SecurityOptions: ["name=seccomp,profile=builtin"],
      });
    if (path.startsWith("/images/create")) {
      if (state.pullError) return send(200, { error: "BROKER_SECRET_CANARY" });
      state.image = true;
      return send(200, { status: "done" });
    }
    if (path.startsWith("/images/"))
      return state.image
        ? send(200, {
            Id: imageId,
            RepoDigests: [`redis@sha256:${"d".repeat(64)}`],
            Config: {
              Cmd: ["redis-server"],
              Entrypoint: ["docker-entrypoint.sh"],
              WorkingDir: "/data",
              Env: ["SECRET=BROKER_SECRET_CANARY"],
            },
            ContainerConfig: { Env: ["BROKER_SECRET_CANARY"] },
          })
        : send(404);
    if (path === "/networks/create") {
      state.network = true;
      if (state.acknowledgementLoss) {
        res.destroy();
        return;
      }
      return send(201, { Id: networkId });
    }
    if (path.startsWith("/networks/")) {
      if (req.method === "DELETE") {
        state.network = false;
        return send(204);
      }
      return state.network
        ? send(200, {
            Id: networkId,
            Name: f.plan.names.network,
            Driver: "bridge",
            Internal: true,
            Labels: resourceLabels(f.plan, "network"),
            Containers: state.endpoints ? { unrelated: {} } : {},
          })
        : send(404);
    }
    if (path.startsWith("/volumes/")) return send(404);
    if (path.startsWith("/containers/create?")) {
      state.container = true;
      return send(201, { Id: containerId });
    }
    if (path.endsWith("/start")) {
      state.running = true;
      return send(204);
    }
    if (path.includes("/stop?")) {
      state.running = false;
      return send(204);
    }
    if (path.startsWith("/containers/") && req.method === "DELETE") {
      state.container = false;
      return send(204);
    }
    if (path.startsWith("/containers/"))
      return state.container ? send(200, rawContainer()) : send(404);
    return send(404);
  });
  await new Promise<void>((done) => server.listen(socket, done));
  const engine = new BrokerEngine(socket),
    signal = new AbortController().signal,
    guard = async () => {
      state.guards++;
    };
  return {
    ...f,
    directory,
    server,
    socket,
    state,
    requests,
    engine,
    signal,
    guard,
    containerId,
    networkId,
  };
}

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
