import { z } from "zod";
import { nodeHash } from "./nodes.js";

export const serverTemplate = z.strictObject({
  id: z.literal("family-survival-v1"),
  name: z.literal("Family Survival"),
  description: z.string(),
  profile_id: z.string(),
  qualification: z.literal("unqualified"),
  java_major: z.literal(25),
  java_image: z.string().regex(/^[a-z0-9.:/-]+@sha256:[a-f0-9]{64}$/),
  server_image: z.null(),
  artifacts: z
    .array(
      z.strictObject({
        component: z.enum(["paper", "geyser", "floodgate"]),
        version: z.string(),
        build: z.number().int().positive(),
        sha256: nodeHash,
      }),
    )
    .length(3),
  resources: z.strictObject({
    cpu_count: z.literal(2),
    java_heap_mb: z.literal(4096),
    memory_limit_mb: z.literal(6144),
    system_headroom_mb: z.literal(2048),
    disk_limit_mb: z.literal(20480),
  }),
  security: z.strictObject({
    online_authentication: z.literal(true),
    enforce_allowlist: z.literal(true),
    public_rcon: z.literal(false),
    pvp: z.literal(false),
    command_blocks: z.literal(false),
    initial_operators: z.literal(0),
    initial_allowlist_entries: z.literal(0),
  }),
  backups: z.strictObject({
    enabled: z.literal(true),
    schedule: z.literal("daily"),
    retention_days: z.literal(14),
    encrypted_off_host: z.literal("weekly"),
    restore_verified: z.literal(false),
  }),
  eula_accepted: z.literal(false),
});
export const serverTemplatePage = z.strictObject({
  items: z.array(serverTemplate).max(10),
});
export const provisionPlanRequest = z.strictObject({
  node_id: z.uuid(),
  environment_id: z.uuid(),
  template_id: z.literal("family-survival-v1"),
  name: z.string().trim().min(1).max(80),
  java_port: z.number().int().min(1024).max(65535),
  bedrock_port: z.number().int().min(1024).max(65535),
});
export const provisionGate = z.strictObject({
  id: z.enum([
    "node_connection",
    "inventory_fresh",
    "architecture",
    "cpu_capacity",
    "memory_headroom",
    "game_ports",
    "storage_quota",
    "runtime_image",
    "player_identity",
    "backup_recovery",
    "private_network",
    "eula",
    "broker",
  ]),
  state: z.enum(["passed", "failed", "unverified"]),
  title: z.string(),
  detail: z.string(),
});
export const provisionPlan = z.strictObject({
  schema_version: z.literal(1),
  plan_hash: nodeHash,
  template_hash: nodeHash,
  organization_id: z.uuid(),
  project_id: z.uuid(),
  request: provisionPlanRequest,
  node_version: z.number().int().positive(),
  credential_version: z.number().int().positive(),
  authorization_hash: nodeHash,
  template: serverTemplate,
  calculated_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  gates: z.array(provisionGate).length(13),
  port_conflicts: z
    .array(
      z.strictObject({
        port: z.number().int(),
        protocol: z.enum(["tcp", "udp"]),
      }),
    )
    .max(2),
  dispatch_available: z.literal(false),
  effects: z.literal("none"),
  reservations_created: z.literal(false),
});
export type ServerTemplate = z.infer<typeof serverTemplate>;
export type ProvisionPlan = z.infer<typeof provisionPlan>;
