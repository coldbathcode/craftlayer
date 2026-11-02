import { readFile } from "node:fs/promises";
import { nodeView, provisionPlanRequest } from "@craftlayer/contracts";
import { expect, it } from "vitest";
import { calculateProvisionPlan, familyTemplate } from "./provisioning.js";

const now = Date.parse("2026-11-02T12:00:00Z"),
  uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = {
  node_id: uuid(1),
  environment_id: uuid(2),
  template_id: "family-survival-v1",
  name: "Family Survival",
  java_port: 25565,
  bedrock_port: 19132,
};
function fixture() {
  return {
    organization: uuid(3),
    project: uuid(4),
    authorizationHash: "a".repeat(64),
    now,
    input,
    node: nodeView.parse({
      id: uuid(1),
      project_id: uuid(4),
      name: "Disposable host",
      version: 2,
      credential_version: 1,
      state: "active",
      connection: "online",
      enrollment_expires_at: new Date(now).toISOString(),
      credential_expires_at: new Date(now + 3600000).toISOString(),
      last_seen_at: new Date(now).toISOString(),
      can_rotate: true,
      can_revoke: true,
      can_plan: true,
      control_public_key: null,
      capacity: {
        observed_at: new Date(now).toISOString(),
        docker_api: "1.50",
        architecture: "amd64",
        cpu_count: 4,
        memory_total_mb: 16384,
        memory_reserved_mb: 2048,
        unbounded_containers: 0,
        container_count: 1,
        occupied_ports: [
          { host_ip: "127.0.0.1", port: 25565, protocol: "tcp" },
        ],
        network_inventory_complete: false,
        disk_quota_verified: false,
        provisioning_qualified: false,
      },
    }),
  };
}
const gate = (plan: ReturnType<typeof calculateProvisionPlan>, id: string) =>
  plan.gates.find((g) => g.id === id)?.state;
it("keeps the candidate template exactly pinned to the existing unqualified artifact manifest", async () => {
  const candidate = JSON.parse(
      await readFile(
        new URL(
          "../../../infra/minecraft/identity-candidate.lock.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    template = familyTemplate();
  expect(template.profile_id).toBe(candidate.id);
  expect(template.java_image).toBe(candidate.java_image);
  expect(template.artifacts).toEqual(
    candidate.artifacts.map(
      ({
        component,
        version,
        build,
        sha256,
      }: {
        component: string;
        version: string;
        build: number;
        sha256: string;
      }) => ({ component, version, build, sha256 }),
    ),
  );
  expect(template).toMatchObject({
    qualification: "unqualified",
    server_image: null,
    eula_accepted: false,
    backups: { restore_verified: false },
  });
});
it("detects conflicts across addresses and rejects plans from another node/project", () => {
  const context = fixture(),
    before = JSON.stringify(context),
    plan = calculateProvisionPlan(context);
  expect(gate(plan, "game_ports")).toBe("failed");
  expect(plan.port_conflicts).toEqual([{ port: 25565, protocol: "tcp" }]);
  expect(plan).toMatchObject({
    effects: "none",
    dispatch_available: false,
    reservations_created: false,
  });
  expect(JSON.stringify(context)).toBe(before);
  expect(() =>
    calculateProvisionPlan({ ...context, project: uuid(9) }),
  ).toThrow("SCOPE_MISMATCH");
  expect(() =>
    calculateProvisionPlan({
      ...context,
      input: { ...input, node_id: uuid(9) },
    }),
  ).toThrow("SCOPE_MISMATCH");
  const other = calculateProvisionPlan({
    ...context,
    input: { ...input, java_port: 25566, bedrock_port: 25565 },
  });
  expect(other.port_conflicts).toEqual([]); // UDP does not conflict with TCP.
  expect(gate(other, "game_ports")).toBe("unverified"); // Native ports/reservations unknown.
});
it("does not turn stale, future, disconnected or unbounded inventory into available capacity", () => {
  const context = fixture();
  expect(gate(calculateProvisionPlan(context), "memory_headroom")).toBe(
    "passed",
  );
  const capacity = context.node.capacity;
  if (!capacity) throw new Error("Fixture missing");
  context.node.capacity = { ...capacity, memory_total_mb: 4096 };
  expect(gate(calculateProvisionPlan(context), "memory_headroom")).toBe(
    "failed",
  );
  context.node.capacity = { ...capacity, unbounded_containers: 1 };
  expect(gate(calculateProvisionPlan(context), "memory_headroom")).toBe(
    "unverified",
  );
  for (const offset of [-30001, 1]) {
    context.node.capacity = {
      ...capacity,
      observed_at: new Date(now + offset).toISOString(),
    };
    const plan = calculateProvisionPlan(context);
    expect(gate(plan, "inventory_fresh")).toBe("unverified");
    expect(gate(plan, "game_ports")).toBe("unverified");
    expect(gate(plan, "memory_headroom")).toBe("unverified");
  }
  context.node.capacity = capacity;
  context.node.connection = "offline";
  expect(gate(calculateProvisionPlan(context), "node_connection")).toBe(
    "failed",
  );
  expect(gate(calculateProvisionPlan(context), "memory_headroom")).toBe(
    "unverified",
  );
});
it("binds scope, request, policy, credential, capacity and expiry without authorizing effects", () => {
  const context = fixture(),
    first = calculateProvisionPlan(context);
  expect(calculateProvisionPlan(context).plan_hash).toBe(first.plan_hash);
  for (const changed of [
    { ...context, organization: uuid(9) },
    { ...context, authorizationHash: "b".repeat(64) },
    { ...context, now: now + 1 },
    { ...context, input: { ...input, name: "Another world" } },
    { ...context, node: { ...context.node, credential_version: 2 } },
    { ...context, node: { ...context.node, capacity: null } },
  ])
    expect(calculateProvisionPlan(changed).plan_hash).not.toBe(first.plan_hash);
  expect(Date.parse(first.expires_at) - Date.parse(first.calculated_at)).toBe(
    30000,
  );
  for (const id of [
    "runtime_image",
    "player_identity",
    "backup_recovery",
    "storage_quota",
    "private_network",
    "eula",
    "broker",
  ])
    expect(gate(first, id)).toBe("unverified");
  for (const field of [
    "image",
    "host_path",
    "world_path",
    "env",
    "shell",
    "commands",
    "eula_accepted",
    "approved",
    "public_rcon",
  ])
    expect(
      provisionPlanRequest.safeParse({ ...input, [field]: true }).success,
    ).toBe(false);
});
