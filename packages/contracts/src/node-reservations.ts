import { z } from "zod";
import { nodeHash } from "./nodes.js";
import { provisionPlanRequest } from "./provisioning.js";

export const reservationRequest = provisionPlanRequest.extend({
  plan_hash: nodeHash,
});
export const reservationReceipt = z.strictObject({
  operation_id: z.uuid(),
  reservation_id: z.uuid(),
  deployment_id: z.uuid(),
});
export const reservationView = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  environment_id: z.uuid(),
  node_id: z.uuid(),
  deployment_id: z.uuid(),
  server_id: z.uuid(),
  world_id: z.uuid(),
  name: z.string(),
  state: z.enum(["held", "allocated", "uncertain", "released"]),
  version: z.number().int().positive(),
  cpu_milli: z.literal(2000),
  memory_mb: z.literal(6144),
  disk_mb: z.literal(20480),
  java_port: z.number().int(),
  bedrock_port: z.number().int(),
  plan_hash: nodeHash,
  policy_hash: nodeHash,
  template_hash: nodeHash,
  lease_expires_at: z.iso.datetime(),
  created_at: z.iso.datetime(),
});
// Trusted admission-port result, never a browser/queued assertion of qualification.
export const qualifiedReservationAdmission = z.strictObject({
  request_hash: nodeHash,
  qualified: z.literal(true),
  policy_hash: nodeHash,
  template_hash: nodeHash,
  independent_approval_hash: nodeHash.nullable(),
  cpu_budget_milli: z.number().int().min(2000).max(4096000),
  memory_budget_mb: z.number().int().min(6144).max(16777216),
  disk_budget_mb: z.number().int().min(20480).max(1073741824),
  occupied_ports: z
    .array(
      z.strictObject({
        protocol: z.enum(["tcp", "udp"]),
        port: z.number().int().min(1).max(65535),
      }),
    )
    .max(1024),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export type ReservationRequest = z.infer<typeof reservationRequest>;
