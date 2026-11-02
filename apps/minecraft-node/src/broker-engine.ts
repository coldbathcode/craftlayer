import { request } from "node:http";
import { nodeDigest } from "@craftlayer/node-protocol";
import { z } from "zod";
import {
  assertBrokerPlan,
  type BrokerPlan,
  containerSpecification,
  labelsMatch,
  resourceLabels,
} from "./broker-policy.js";

const dockerId = z.string().regex(/^[a-f0-9]{64}$/),
  imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const labels = z.record(z.string(), z.string()).nullable();
export interface WorldQuotaVerifier {
  /** Private host adapter must verify actual persistent quota/ownership; no implementation yet. */
  verify(
    plan: BrokerPlan,
    signal: AbortSignal,
  ): Promise<{
    verified: true;
    world_id: string;
    volume_name: string;
    quota_mb: number;
    proof_hash: string;
  }>;
}
export interface BrokerContainer {
  id: string;
  owned: boolean;
  specification_matches: boolean;
  running: boolean;
}
function deny(code = "NODE_BROKER_ENGINE_DENIED"): never {
  throw new Error(code);
}
function digestReference(input: string) {
  const [name, digest] = input.split("@"),
    base = name ?? "",
    slash = base.lastIndexOf("/"),
    colon = base.lastIndexOf(":");
  let repo = colon > slash ? base.slice(0, colon) : base;
  if (!repo.includes("/")) repo = `docker.io/library/${repo}`;
  else if (
    !/[.:]/.test(repo.split("/")[0] ?? "") &&
    !repo.startsWith("localhost/")
  )
    repo = `docker.io/${repo}`;
  return `${repo}@${digest}`;
}
/** Fixed Engine API 1.50 verbs only; socket access still implies host privilege. */
export class BrokerEngine {
  constructor(
    private readonly socket: string,
    private readonly quota?: WorldQuotaVerifier,
  ) {
    if (!socket.startsWith("/") || socket.includes("\0"))
      deny("NODE_LOCAL_SOCKET_REQUIRED");
  }
  async #request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    signal: AbortSignal,
    body?: unknown,
    timeout = 3000,
  ) {
    if (signal.aborted) deny("NODE_BROKER_ABORTED");
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socket,
          path: `/v1.50${path}`,
          method,
          agent: false,
          signal,
          headers: encoded
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(encoded),
              }
            : {},
          timeout,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (b: Buffer) => {
            size += b.length;
            if (size > 1024 * 1024)
              req.destroy(new Error("NODE_ENGINE_RESPONSE_LIMIT"));
            else chunks.push(b);
          });
          res.on("error", () =>
            reject(new Error("NODE_ENGINE_OUTCOME_UNKNOWN")),
          );
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 500,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      const deadline = setTimeout(
        () => req.destroy(new Error("NODE_ENGINE_DEADLINE")),
        timeout,
      );
      req.once("close", () => clearTimeout(deadline));
      req.once("timeout", () => req.destroy());
      req.once("error", () => reject(new Error("NODE_ENGINE_OUTCOME_UNKNOWN")));
      req.end(encoded);
    });
  }
  #json(response: { status: number; text: string }, allowed: number[]) {
    if (!allowed.includes(response.status)) deny();
    try {
      return response.text ? (JSON.parse(response.text) as unknown) : null;
    } catch {
      deny();
    }
  }
  async #effect(
    method: "POST" | "DELETE",
    path: string,
    guard: () => Promise<void>,
    signal: AbortSignal,
    body?: unknown,
    allowed = [204],
    timeout = 3000,
  ) {
    await guard();
    if (signal.aborted) deny("NODE_BROKER_ABORTED");
    return this.#json(
      await this.#request(method, path, signal, body, timeout),
      allowed,
    );
  }
  async supportsLimits(signal: AbortSignal) {
    const info = z
      .object({
        MemoryLimit: z.boolean(),
        SwapLimit: z.boolean(),
        CpuCfsQuota: z.boolean(),
        PidsLimit: z.boolean(),
        SecurityOptions: z.array(z.string()),
      })
      .parse(this.#json(await this.#request("GET", "/info", signal), [200]));
    if (
      !info.MemoryLimit ||
      !info.SwapLimit ||
      !info.CpuCfsQuota ||
      !info.PidsLimit ||
      !info.SecurityOptions.includes("name=seccomp,profile=builtin")
    )
      deny("NODE_RUNTIME_LIMITS_UNSUPPORTED");
  }
  async image(plan: BrokerPlan, signal: AbortSignal) {
    assertBrokerPlan(plan);
    const r = await this.#request(
      "GET",
      `/images/${encodeURIComponent(plan.manifest.image)}/json`,
      signal,
    );
    if (r.status === 404) return null;
    const value = z
      .object({
        Id: imageId,
        RepoDigests: z.array(z.string()).nullable(),
        Config: z.object({
          Cmd: z.array(z.string()).nullable(),
          Entrypoint: z.array(z.string()).nullable(),
          Env: z.array(z.string()).nullable(),
          WorkingDir: z.string(),
        }),
      })
      .parse(this.#json(r, [200]));
    if (
      !value.RepoDigests?.some(
        (v) => digestReference(v) === digestReference(plan.manifest.image),
      )
    )
      deny("NODE_IMAGE_DIGEST_DENIED");
    return {
      id: value.Id,
      command_hash: nodeDigest(value.Config.Cmd ?? []),
      entrypoint_hash: nodeDigest(value.Config.Entrypoint ?? []),
      environment_hash: nodeDigest(value.Config.Env ?? []),
      working_directory_hash: nodeDigest(value.Config.WorkingDir),
    };
  }
  async ensureImage(
    plan: BrokerPlan,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    if (await this.image(plan, signal)) return;
    await guard();
    const r = await this.#request(
      "POST",
      `/images/create?fromImage=${encodeURIComponent(plan.manifest.image)}`,
      signal,
      undefined,
      20000,
    );
    if (r.status !== 200) deny("NODE_IMAGE_PULL_DENIED");
    try {
      for (const line of r.text.split("\n").filter(Boolean)) {
        const v = JSON.parse(line) as {
          error?: unknown;
          errorDetail?: unknown;
        };
        if (v.error || v.errorDetail) deny("NODE_IMAGE_PULL_DENIED");
      }
    } catch {
      deny("NODE_IMAGE_PULL_DENIED");
    }
    if (!(await this.image(plan, signal))) deny("NODE_IMAGE_PULL_DENIED");
  }
  async network(plan: BrokerPlan, signal: AbortSignal, expectedId?: string) {
    assertBrokerPlan(plan);
    if (expectedId) dockerId.parse(expectedId);
    const r = await this.#request(
      "GET",
      `/networks/${encodeURIComponent(expectedId ?? plan.names.network)}`,
      signal,
    );
    if (r.status === 404) return null;
    const v = z
      .object({
        Id: dockerId,
        Name: z.string(),
        Driver: z.string(),
        Internal: z.boolean(),
        Labels: labels,
        Containers: z.record(z.string(), z.unknown()).nullable(),
      })
      .parse(this.#json(r, [200]));
    return {
      id: v.Id,
      owned:
        v.Name === plan.names.network &&
        labelsMatch(plan, "network", v.Labels) &&
        (!expectedId || v.Id === expectedId),
      isolated: v.Internal && v.Driver === "bridge",
      endpoint_count: Object.keys(v.Containers ?? {}).length,
    };
  }
  async createNetwork(
    plan: BrokerPlan,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    if (await this.network(plan, signal)) deny("NODE_PREEXISTING_RESOURCE");
    const raw = await this.#effect(
      "POST",
      "/networks/create",
      guard,
      signal,
      {
        Name: plan.names.network,
        Driver: "bridge",
        Internal: true,
        Attachable: false,
        EnableIPv6: false,
        Labels: resourceLabels(plan, "network"),
      },
      [201],
    );
    return z.object({ Id: dockerId }).parse(raw).Id;
  }
  async volume(plan: BrokerPlan, signal: AbortSignal) {
    assertBrokerPlan(plan);
    const r = await this.#request(
      "GET",
      `/volumes/${encodeURIComponent(plan.names.volume)}`,
      signal,
    );
    if (r.status === 404) return null;
    const v = z
      .object({ Name: z.string(), Driver: z.string(), Labels: labels })
      .parse(this.#json(r, [200]));
    return {
      owned:
        v.Name === plan.names.volume && labelsMatch(plan, "volume", v.Labels),
      driver: v.Driver,
    };
  }
  async verifyStorage(plan: BrokerPlan, signal: AbortSignal) {
    assertBrokerPlan(plan);
    if (plan.manifest.profile === "disposable_fixture") return;
    if (!this.quota) deny("NODE_PERSISTENT_QUOTA_UNAVAILABLE");
    const p = await this.quota.verify(plan, signal),
      volume = await this.volume(plan, signal);
    if (
      p.verified !== true ||
      p.world_id !== plan.manifest.world_id ||
      p.volume_name !== plan.names.volume ||
      p.quota_mb !== plan.manifest.disk_mb ||
      p.proof_hash !== plan.manifest.quota_proof_hash ||
      !volume?.owned ||
      volume.driver !== "local"
    )
      deny("NODE_PERSISTENT_QUOTA_DENIED");
  }
  async container(
    plan: BrokerPlan,
    signal: AbortSignal,
    expectedId?: string,
  ): Promise<BrokerContainer | null> {
    assertBrokerPlan(plan);
    if (expectedId) dockerId.parse(expectedId);
    const response = await this.#request(
      "GET",
      `/containers/${encodeURIComponent(expectedId ?? plan.names.container)}/json`,
      signal,
    );
    if (response.status === 404) return null;
    const v = z
      .object({
        Id: dockerId,
        Name: z.string(),
        Image: imageId,
        State: z.object({ Running: z.boolean() }),
        Config: z.object({
          Image: z.string(),
          User: z.string(),
          Labels: labels,
          Cmd: z.array(z.string()).nullable(),
          Entrypoint: z.array(z.string()).nullable(),
          Env: z.array(z.string()).nullable(),
          WorkingDir: z.string(),
        }),
        HostConfig: z.object({
          Privileged: z.boolean(),
          ReadonlyRootfs: z.boolean(),
          NanoCpus: z.number(),
          Memory: z.number(),
          MemorySwap: z.number(),
          PidsLimit: z.number(),
          NetworkMode: z.string(),
          PublishAllPorts: z.boolean(),
          PortBindings: z
            .record(z.string(), z.array(z.unknown()).nullable())
            .nullable(),
          AutoRemove: z.boolean(),
          CapDrop: z.array(z.string()).nullable(),
          CapAdd: z.array(z.string()).nullable(),
          SecurityOpt: z.array(z.string()).nullable(),
          RestartPolicy: z.object({ Name: z.string() }),
          Binds: z.array(z.string()).nullable(),
          Devices: z.array(z.unknown()).nullable(),
          DeviceRequests: z.array(z.unknown()).nullable(),
          VolumesFrom: z.array(z.string()).nullable(),
          Tmpfs: z.record(z.string(), z.string()).nullable(),
          PidMode: z.string(),
          IpcMode: z.string(),
          UTSMode: z.string(),
          CgroupnsMode: z.string(),
        }),
        Mounts: z.array(
          z.object({
            Type: z.string(),
            Name: z.string().optional(),
            Destination: z.string(),
            RW: z.boolean(),
          }),
        ),
        NetworkSettings: z.object({
          Ports: z
            .record(z.string(), z.array(z.unknown()).nullable())
            .nullable(),
        }),
      })
      .parse(this.#json(response, [200]));
    const expected = containerSpecification(plan),
      h = v.HostConfig,
      e = expected.HostConfig,
      approvedImage = await this.image(plan, signal),
      fixture = plan.manifest.profile === "disposable_fixture";
    const safeArrays = [
      h.Binds,
      h.Devices,
      h.DeviceRequests,
      h.VolumesFrom,
      h.CapAdd,
    ].every((a) => !a?.length);
    const portsClosed =
      Object.keys(h.PortBindings ?? {}).length === 0 &&
      !Object.values(v.NetworkSettings.Ports ?? {}).some(
        (ports) => ports?.length,
      );
    const mountsMatch = v.Mounts.every((m) =>
      fixture
        ? m.Type === "tmpfs" && ["/tmp", "/data"].includes(m.Destination)
        : (m.Type === "volume" &&
            m.Name === plan.names.volume &&
            m.Destination === "/data" &&
            m.RW) ||
          (m.Type === "tmpfs" && m.Destination === "/tmp"),
    );
    const specification_matches =
      v.Image === approvedImage?.id &&
      v.Config.Image === expected.Image &&
      v.Config.User === expected.User &&
      nodeDigest(v.Config.Cmd ?? []) ===
        (fixture ? nodeDigest(expected.Cmd) : approvedImage?.command_hash) &&
      nodeDigest(v.Config.Entrypoint ?? []) ===
        approvedImage?.entrypoint_hash &&
      nodeDigest(v.Config.Env ?? []) === approvedImage?.environment_hash &&
      nodeDigest(v.Config.WorkingDir) ===
        approvedImage?.working_directory_hash &&
      !h.Privileged &&
      h.ReadonlyRootfs &&
      h.NanoCpus === e.NanoCpus &&
      h.Memory === e.Memory &&
      h.MemorySwap === e.MemorySwap &&
      h.PidsLimit === e.PidsLimit &&
      h.NetworkMode === e.NetworkMode &&
      !h.PublishAllPorts &&
      !h.AutoRemove &&
      h.RestartPolicy.Name === "no" &&
      h.CapDrop?.includes("ALL") === true &&
      h.SecurityOpt?.includes("no-new-privileges:true") === true &&
      h.SecurityOpt.every((o) => o === "no-new-privileges:true") &&
      !h.PidMode &&
      h.IpcMode === "private" &&
      !h.UTSMode &&
      h.CgroupnsMode === "private" &&
      safeArrays &&
      portsClosed &&
      mountsMatch &&
      nodeDigest(h.Tmpfs ?? {}) === nodeDigest(e.Tmpfs) &&
      (fixture ||
        v.Mounts.some(
          (m) =>
            m.Type === "volume" &&
            m.Name === plan.names.volume &&
            m.Destination === "/data",
        ));
    return {
      id: v.Id,
      owned:
        v.Name.replace(/^\//, "") === plan.names.container &&
        labelsMatch(plan, "container", v.Config.Labels) &&
        (!expectedId || expectedId === v.Id),
      specification_matches,
      running: v.State.Running,
    };
  }
  async createContainer(
    plan: BrokerPlan,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    await this.supportsLimits(signal);
    await this.verifyStorage(plan, signal);
    if (await this.container(plan, signal)) deny("NODE_PREEXISTING_RESOURCE");
    const raw = await this.#effect(
      "POST",
      `/containers/create?name=${encodeURIComponent(plan.names.container)}`,
      guard,
      signal,
      containerSpecification(plan),
      [201],
    );
    return z.object({ Id: dockerId }).parse(raw).Id;
  }
  async #ownedContainer(plan: BrokerPlan, id: string, signal: AbortSignal) {
    const container = await this.container(plan, signal, dockerId.parse(id));
    if (!container?.owned || !container.specification_matches)
      deny("NODE_CONTAINER_OWNERSHIP_DENIED");
    return container;
  }
  async start(
    plan: BrokerPlan,
    id: string,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    await this.supportsLimits(signal);
    const c = await this.#ownedContainer(plan, id, signal);
    if (c.running) return;
    await this.verifyStorage(plan, signal);
    await this.#effect(
      "POST",
      `/containers/${id}/start`,
      guard,
      signal,
      undefined,
      [204, 304],
    );
  }
  async stop(
    plan: BrokerPlan,
    id: string,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    const c = await this.#ownedContainer(plan, id, signal);
    if (!c.running) return;
    // No forced kill: slow shutdown becomes uncertain at the outer command deadline.
    await this.#effect(
      "POST",
      `/containers/${id}/stop?t=-1&signal=SIGTERM`,
      guard,
      signal,
      undefined,
      [204, 304],
      15000,
    );
  }
  async removeStopped(
    plan: BrokerPlan,
    id: string,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    const c = await this.#ownedContainer(plan, id, signal);
    if (c.running) deny("NODE_RUNNING_REMOVAL_DENIED");
    await this.#effect(
      "DELETE",
      `/containers/${id}?force=false&v=false`,
      guard,
      signal,
    );
  }
  async removeEmptyNetwork(
    plan: BrokerPlan,
    id: string,
    guard: () => Promise<void>,
    signal: AbortSignal,
  ) {
    const n = await this.network(plan, signal, dockerId.parse(id));
    if (!n?.owned || !n.isolated || n.endpoint_count)
      deny("NODE_NETWORK_OWNERSHIP_DENIED");
    await this.#effect("DELETE", `/networks/${id}`, guard, signal);
  }
}
