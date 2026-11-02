import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeCommand } from "@craftlayer/contracts";
import { nodeTimeWindow } from "@craftlayer/node-protocol";
import { BrokerEngine } from "../broker-engine.js";
import {
  type ApprovedDeployment,
  BrokerPolicy,
  containerSpecification,
  resourceLabels,
} from "../broker-policy.js";

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
export async function engineFixture(
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
export async function setup() {
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
  let networkLabels = resourceLabels(f.plan, "network"),
    containerLabels = resourceLabels(f.plan, "container");
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
        Labels: { ...containerLabels },
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
      NetworkSettings: {
        Ports: { "6379/tcp": null },
        Networks: { none: {} } as Record<string, unknown>,
      },
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
    if (state.altered === "network")
      raw.NetworkSettings.Networks = { none: {}, public: {} };
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
      networkLabels = (body as { Labels: typeof networkLabels }).Labels;
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
            Labels: networkLabels,
            Containers: state.endpoints ? { unrelated: {} } : {},
          })
        : send(404);
    }
    if (path.startsWith("/volumes/")) return send(404);
    if (path.startsWith("/containers/create?")) {
      state.container = true;
      containerLabels = (body as { Labels: typeof containerLabels }).Labels;
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
