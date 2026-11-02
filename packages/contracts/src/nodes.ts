import { z } from "zod";
export const nodeHash = z.string().regex(/^[a-f0-9]{64}$/);
export const nodePublicKey = z.string().regex(/^[A-Za-z0-9_-]{59}$/);
export const nodeBinding = z.strictObject({
  public_key: nodePublicKey,
  certificate_sha256: nodeHash,
});
export const nodeEnrollmentRequest = nodeBinding.extend({
  project_id: z.uuid(),
  name: z.string().trim().min(1).max(80),
});
export const nodeRotationRequest = nodeBinding.extend({
  expected_version: z.number().int().positive(),
});
export const nodeCapacity = z.strictObject({
  observed_at: z.iso.datetime(),
  docker_api: z.literal("1.50"),
  architecture: z.enum(["amd64", "arm64", "other"]),
  cpu_count: z.number().int().min(1).max(4096),
  memory_total_mb: z.number().int().min(1).max(16777216),
  memory_reserved_mb: z.number().int().min(0).max(16777216),
  unbounded_containers: z.number().int().min(0).max(256),
  container_count: z.number().int().min(0).max(256),
  occupied_ports: z
    .array(
      z.strictObject({
        host_ip: z
          .string()
          .max(45)
          .regex(/^[a-fA-F0-9:.]+$/),
        port: z.number().int().min(1).max(65535),
        protocol: z.enum(["tcp", "udp"]),
      }),
    )
    .max(128),
  network_inventory_complete: z.literal(false),
  disk_quota_verified: z.literal(false),
  provisioning_qualified: z.literal(false),
});
export const nodeView = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  name: z.string(),
  state: z.enum(["enrolling", "active", "revoked"]),
  version: z.number().int().positive(),
  credential_version: z.number().int().positive(),
  enrollment_expires_at: z.iso.datetime(),
  credential_expires_at: z.iso.datetime(),
  last_seen_at: z.iso.datetime().nullable(),
  connection: z.enum([
    "awaiting_enrollment",
    "online",
    "offline",
    "revoked",
    "credential_expired",
  ]),
  capacity: nodeCapacity.nullable(),
  can_rotate: z.boolean(),
  can_revoke: z.boolean(),
  control_public_key: nodePublicKey.nullable(),
});
export const nodePage = z.strictObject({
  items: z.array(nodeView).max(50),
  next_cursor: z.uuid().nullable(),
});
export const nodeOperationView = z.strictObject({
  resource_type: z.literal("node"),
  id: z.uuid(),
  node_id: z.uuid(),
  project_id: z.uuid(),
  kind: z.enum(["enroll", "rotate", "revoke"]),
  state: z.literal("succeeded"),
  created_at: z.iso.datetime(),
});
export const nodeOperationAccepted = z.strictObject({
  operation_id: z.uuid(),
  node_id: z.uuid(),
});
const requestBase = {
  schema_version: z.literal(1),
  control_id: nodeHash,
  organization_id: z.uuid(),
  node_id: z.uuid(),
  credential_version: z.number().int().positive().max(2147483646),
  sequence: z.number().int().min(0).max(2147483646),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
};
export const nodeAgentRequest = z.discriminatedUnion("purpose", [
  z.strictObject({
    ...requestBase,
    purpose: z.literal("node.enroll.v1"),
    sequence: z.literal(0),
  }),
  z.strictObject({
    ...requestBase,
    purpose: z.literal("node.heartbeat.v1"),
    sequence: z.number().int().min(1).max(2147483646),
    capacity: nodeCapacity.nullable(),
  }),
]);
export const signedNodeRequest = z.strictObject({
  payload: nodeAgentRequest,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export const nodeAgentResponse = z.strictObject({
  schema_version: z.literal(1),
  purpose: z.literal("node.ack.v1"),
  control_id: nodeHash,
  organization_id: z.uuid(),
  node_id: z.uuid(),
  credential_version: z.number().int().positive(),
  sequence: z.number().int().nonnegative(),
  request_hash: nodeHash,
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  credential_expires_at: z.iso.datetime(),
  state: z.literal("active"),
  capabilities: z.tuple([z.literal("inventory.read")]),
});
export const signedNodeResponse = z.strictObject({
  payload: nodeAgentResponse,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type NodeAgentRequest = z.infer<typeof nodeAgentRequest>;
export type NodeCapacity = z.infer<typeof nodeCapacity>;
export type NodeView = z.infer<typeof nodeView>;
