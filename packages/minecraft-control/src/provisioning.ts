import {
  type NodeView,
  type ProvisionPlan,
  provisionPlan,
  provisionPlanRequest,
  serverTemplate,
} from "@craftlayer/contracts";
import { nodeDigest } from "@craftlayer/node-protocol";

// Reviewed candidate identity, not an approved runnable Minecraft image.
export function familyTemplate() {
  return serverTemplate.parse({
    id: "family-survival-v1",
    name: "Family Survival",
    description:
      "Paper with Java/Bedrock crossplay, adult-managed player access and daily backups.",
    profile_id: "paper-26_3-crossplay-candidate-1",
    qualification: "unqualified",
    java_major: 25,
    java_image:
      "eclipse-temurin:25-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0",
    server_image: null,
    artifacts: [
      {
        component: "paper",
        version: "26.3",
        build: 237,
        sha256:
          "57d8774be83dbe2be6a814e945f26a6b82339af9b1c82b768bbfdf4c23fda56e",
      },
      {
        component: "geyser",
        version: "2.12.1",
        build: 1281,
        sha256:
          "67876ccc117c37bfe58ad2cf2e52c31db7bf3a9c3ff8960aaf0789fd5696bba2",
      },
      {
        component: "floodgate",
        version: "2.2.5",
        build: 141,
        sha256:
          "21570aff9ce17d6983928e8552777760e1ede5050026b04c686b0ae112e6fd7e",
      },
    ],
    resources: {
      cpu_count: 2,
      java_heap_mb: 4096,
      memory_limit_mb: 6144,
      system_headroom_mb: 2048,
      disk_limit_mb: 20480,
    },
    security: {
      online_authentication: true,
      enforce_allowlist: true,
      public_rcon: false,
      pvp: false,
      command_blocks: false,
      initial_operators: 0,
      initial_allowlist_entries: 0,
    },
    backups: {
      enabled: true,
      schedule: "daily",
      retention_days: 14,
      encrypted_off_host: "weekly",
      restore_verified: false,
    },
    eula_accepted: false,
  });
}

/** Pure preview only. The service must supply an authenticated canonical scope. */
export function calculateProvisionPlan(context: {
  organization: string;
  project: string;
  authorizationHash: string;
  node: NodeView;
  input: unknown;
  now: number;
}): ProvisionPlan {
  const request = provisionPlanRequest.parse(context.input),
    node = context.node,
    capacity = node.capacity,
    now = context.now,
    template = familyTemplate(),
    resources = template.resources;
  if (request.node_id !== node.id || context.project !== node.project_id)
    throw new Error("PROVISION_PLAN_SCOPE_MISMATCH");
  const gate = (
    id: ProvisionPlan["gates"][number]["id"],
    state: "passed" | "failed" | "unverified",
    title: string,
    detail: string,
  ) => ({ id, state, title, detail });
  const fresh =
    capacity !== null &&
    Date.parse(capacity.observed_at) <= now &&
    Date.parse(capacity.observed_at) >= now - 30000;
  const connected =
    node.state === "active" &&
    node.connection === "online" &&
    Date.parse(node.credential_expires_at) > now &&
    node.last_seen_at !== null &&
    Date.parse(node.last_seen_at) >= now - 30000 &&
    Date.parse(node.last_seen_at) <= now + 5000;
  const ports = [
    { port: request.java_port, protocol: "tcp" as const },
    { port: request.bedrock_port, protocol: "udp" as const },
  ];
  // Desired game ingress binds all interfaces; any matching address conflicts.
  const conflicts = ports.filter((p) =>
    capacity?.occupied_ports.some(
      (b) => b.port === p.port && b.protocol === p.protocol,
    ),
  );
  const insufficientMemory =
    capacity !== null &&
    capacity.memory_total_mb <
      capacity.memory_reserved_mb +
        resources.memory_limit_mb +
        resources.system_headroom_mb;
  const boundedMemory =
    capacity !== null && capacity.unbounded_containers === 0;
  const body = {
    schema_version: 1 as const,
    organization_id: context.organization,
    project_id: context.project,
    request,
    node_version: node.version,
    credential_version: node.credential_version,
    authorization_hash: context.authorizationHash,
    template_hash: nodeDigest(template),
    template,
    calculated_at: new Date(now).toISOString(),
    expires_at: new Date(now + 30000).toISOString(),
    gates: [
      gate(
        "node_connection",
        connected ? "passed" : "failed",
        "Current host connection",
        connected
          ? "The enrolled host has a recent authenticated connection."
          : "Enroll or reconnect the host with current credentials.",
      ),
      gate(
        "inventory_fresh",
        fresh && connected ? "passed" : "unverified",
        "Recent capacity report",
        fresh && connected
          ? "The stored host report is at most 30 seconds old."
          : "A recent report from the connected host is required; stored capacity is not assumed current.",
      ),
      gate(
        "architecture",
        fresh && connected && capacity
          ? capacity.architecture === "other"
            ? "failed"
            : "passed"
          : "unverified",
        "Supported architecture",
        "amd64/arm64 reporting is supported; a complete runnable image still requires qualification.",
      ),
      gate(
        "cpu_capacity",
        fresh && connected && capacity
          ? capacity.cpu_count < resources.cpu_count
            ? "failed"
            : "unverified"
          : "unverified",
        "CPU allocation",
        `Requires ${resources.cpu_count} CPU cores. Host core count alone does not prove allocation headroom across all workloads.`,
      ),
      gate(
        "memory_headroom",
        !fresh || !connected
          ? "unverified"
          : insufficientMemory
            ? "failed"
            : boundedMemory
              ? "passed"
              : "unverified",
        "Memory and system headroom",
        `Requires ${resources.memory_limit_mb} MiB container memory plus ${resources.system_headroom_mb} MiB system headroom. Unbounded workloads prevent a free-capacity claim.`,
      ),
      gate(
        "game_ports",
        !fresh || !connected
          ? "unverified"
          : conflicts.length
            ? "failed"
            : "unverified",
        "Java and Bedrock ports",
        !fresh || !connected
          ? "Refresh authenticated host inventory before checking ports."
          : conflicts.length
            ? `Conflicts: ${conflicts.map((p) => `${p.port}/${p.protocol}`).join(", ")}. Choose other ports.`
            : "No reported Docker binding conflicts; native services, firewall and transactional reservations still require checks.",
      ),
      gate(
        "storage_quota",
        "unverified",
        "Enforced world storage quota",
        `Requires ${resources.disk_limit_mb} MiB dedicated storage with enforced quota and verified headroom.`,
      ),
      gate(
        "runtime_image",
        "unverified",
        "Approved server and plugin versions",
        "Artifact candidates are pinned. A complete approved Minecraft runtime image and compatibility evidence are still required.",
      ),
      gate(
        "player_identity",
        "unverified",
        "Verified player access",
        "Prove Java/Bedrock identity and default-deny allowlist behavior before enabling ingress.",
      ),
      gate(
        "backup_recovery",
        "unverified",
        "Backup and restore qualification",
        "Daily backups, protected retention and a successful isolated restore must be verified.",
      ),
      gate(
        "private_network",
        "unverified",
        "Private administration and game ingress",
        "Qualify host networking/firewall, private server control and placement policy; only game ports may be public.",
      ),
      gate(
        "eula",
        "unverified",
        "Adult EULA acknowledgement",
        "The Minecraft EULA has not been accepted. This preview cannot accept it or start a game.",
      ),
      gate(
        "broker",
        "unverified",
        "Approved provisioning executor",
        "Signed commands, durable reservations, independent adult approval, effect fencing and ownership-safe rollback are still required.",
      ),
    ],
    port_conflicts: fresh && connected ? conflicts : [],
    dispatch_available: false as const,
    effects: "none" as const,
    reservations_created: false as const,
  };
  // Bind the exact stored report, including failed/unverified capacity and ports.
  return provisionPlan.parse({
    ...body,
    plan_hash: nodeDigest({
      ...body,
      capacity,
      last_seen_at: node.last_seen_at,
    }),
  });
}
