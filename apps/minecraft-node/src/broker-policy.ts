import { type NodeCommand, nodeCommand } from "@craftlayer/contracts";
import { nodeDigest } from "@craftlayer/node-protocol";
import { z } from "zod";

const id = z.uuid().refine((v) => v === v.toLowerCase()),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  image = z.string().regex(/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/);
export const approvedDeployment = z.strictObject({
  organization_id: id,
  project_id: id,
  node_id: id,
  deployment_id: id,
  server_id: id,
  world_id: id,
  reservation_id: id,
  plan_hash: hash,
  template_hash: hash,
  policy_hash: hash,
  profile: z.enum(["minecraft", "disposable_fixture"]),
  image,
  cpu_milli: z.number().int().min(100).max(32000),
  memory_mb: z.number().int().min(32).max(65536),
  disk_mb: z.number().int().min(1).max(1048576),
  identity_proof_hash: hash.nullable(),
  restore_proof_hash: hash.nullable(),
  eula_acceptance_hash: hash.nullable(),
  quota_proof_hash: hash.nullable(),
});
export type ApprovedDeployment = z.infer<typeof approvedDeployment>;
const policySchema = z.strictObject({
  organization_id: id,
  project_id: id,
  node_id: id,
  policy_hash: hash,
  policy_revision: z.number().int().positive(),
  allowed_images: z.array(image).min(1).max(16),
  allowed_profiles: z
    .array(z.enum(["minecraft", "disposable_fixture"]))
    .min(1)
    .max(2),
  max_cpu_milli: z.number().int().min(100).max(32000),
  max_memory_mb: z.number().int().min(32).max(65536),
  max_disk_mb: z.number().int().min(1).max(1048576),
});
export interface BrokerPlan {
  readonly manifest: Readonly<ApprovedDeployment>;
  readonly owner_nonce: string;
  readonly names: {
    readonly container: string;
    readonly network: string;
    readonly volume: string;
  };
}
const plans = new WeakSet<BrokerPlan>();
function deny(): never {
  throw new Error("NODE_BROKER_POLICY_DENIED");
}
export function assertBrokerPlan(plan: BrokerPlan) {
  if (!plans.has(plan)) deny();
}
export function resourceLabels(
  plan: BrokerPlan,
  kind: "container" | "network" | "volume",
) {
  assertBrokerPlan(plan);
  const m = plan.manifest;
  return {
    "com.craftlayer.kind": kind,
    "com.craftlayer.organization": m.organization_id,
    "com.craftlayer.project": m.project_id,
    "com.craftlayer.node": m.node_id,
    "com.craftlayer.deployment": m.deployment_id,
    "com.craftlayer.server": m.server_id,
    "com.craftlayer.world": m.world_id,
    "com.craftlayer.reservation": m.reservation_id,
    "com.craftlayer.plan": m.plan_hash,
    "com.craftlayer.template": m.template_hash,
    "com.craftlayer.policy": m.policy_hash,
    "com.craftlayer.owner": plan.owner_nonce,
  };
}
export function labelsMatch(
  plan: BrokerPlan,
  kind: "container" | "network" | "volume",
  labels: Record<string, string> | null,
) {
  const expected = resourceLabels(plan, kind);
  return (
    labels !== null &&
    Object.entries(expected).every(([key, value]) => labels[key] === value) &&
    Object.keys(labels).every(
      (key) =>
        !key.startsWith("com.craftlayer.") || Object.hasOwn(expected, key),
    )
  );
}
export class BrokerPolicy {
  #value: z.infer<typeof policySchema>;
  constructor(value: unknown) {
    this.#value = policySchema.parse(value);
  }
  compile(
    input: unknown,
    job: Readonly<NodeCommand>,
    ownerNonce: string,
  ): BrokerPlan {
    const m = approvedDeployment.parse(input),
      v = nodeCommand.parse(job),
      p = this.#value;
    id.parse(ownerNonce);
    for (const key of [
      "organization_id",
      "project_id",
      "node_id",
      "policy_hash",
    ] as const)
      if (m[key] !== p[key] || m[key] !== v[key]) deny();
    for (const key of [
      "deployment_id",
      "server_id",
      "world_id",
      "reservation_id",
      "plan_hash",
      "template_hash",
    ] as const)
      if (m[key] !== v[key]) deny();
    if (
      v.policy_revision !== p.policy_revision ||
      !p.allowed_images.includes(m.image) ||
      !p.allowed_profiles.includes(m.profile) ||
      m.cpu_milli > p.max_cpu_milli ||
      m.memory_mb > p.max_memory_mb ||
      m.disk_mb > p.max_disk_mb
    )
      deny();
    if (
      m.profile === "minecraft" &&
      (m.cpu_milli !== 2000 ||
        m.memory_mb !== 6144 ||
        m.disk_mb !== 20480 ||
        !m.identity_proof_hash ||
        !m.restore_proof_hash ||
        !m.eula_acceptance_hash ||
        !m.quota_proof_hash)
    )
      deny();
    if (
      m.profile === "disposable_fixture" &&
      (m.disk_mb > 64 || m.disk_mb > Math.floor(m.memory_mb / 2))
    )
      deny();
    // This capability cannot be reconstructed from a caller's JSON body.
    const plan = Object.freeze({
      manifest: Object.freeze(m),
      owner_nonce: ownerNonce,
      names: Object.freeze({
        container: `craftlayer-server-${m.server_id}`,
        network: `craftlayer-net-${m.deployment_id}`,
        volume: `craftlayer-world-${m.world_id}`,
      }),
    });
    plans.add(plan);
    return plan;
  }
}
export function containerSpecification(plan: BrokerPlan) {
  assertBrokerPlan(plan);
  const m = plan.manifest,
    fixture = m.profile === "disposable_fixture",
    tmpfs = {
      "/tmp": "rw,noexec,nosuid,nodev,size=1048576,uid=10001,gid=10001",
      ...(fixture
        ? {
            "/data": `rw,noexec,nosuid,nodev,size=${m.disk_mb * 1048576},uid=10001,gid=10001`,
          }
        : {}),
    };
  return {
    Image: m.image,
    User: "10001:10001",
    Env: [],
    Labels: resourceLabels(plan, "container"),
    ...(fixture
      ? {
          Cmd: [
            "redis-server",
            "--save",
            "",
            "--appendonly",
            "no",
            "--bind",
            "127.0.0.1",
            "--protected-mode",
            "yes",
          ],
        }
      : {}),
    HostConfig: {
      Privileged: false,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      NanoCpus: m.cpu_milli * 1000000,
      Memory: m.memory_mb * 1048576,
      MemorySwap: m.memory_mb * 1048576,
      PidsLimit: 128,
      NetworkMode: fixture ? "none" : plan.names.network,
      PublishAllPorts: false,
      PortBindings: {},
      RestartPolicy: { Name: "no" },
      AutoRemove: false,
      PidMode: "",
      IpcMode: "private",
      UTSMode: "",
      CgroupnsMode: "private",
      Binds: [],
      Devices: [],
      DeviceRequests: [],
      VolumesFrom: [],
      Tmpfs: tmpfs,
      Mounts: fixture
        ? []
        : [
            {
              Type: "volume",
              Source: plan.names.volume,
              Target: "/data",
              ReadOnly: false,
              VolumeOptions: { NoCopy: true },
            },
          ],
    },
  };
}
export const brokerPlanDigest = (plan: BrokerPlan) => {
  assertBrokerPlan(plan);
  return nodeDigest({
    manifest: plan.manifest,
    names: plan.names,
    owner_nonce: plan.owner_nonce,
  });
};
