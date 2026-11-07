import { z } from "zod";
import { nodeHash } from "./nodes.js";

const id = z.uuid().refine((v) => v === v.toLowerCase());
export const deploymentApprovalRequest = z.strictObject({ intent_id: id });
// Server-derived review material only. Names and digests convey no qualification.
export const deploymentReviewSnapshot = z.strictObject({
  schema_version: z.literal(1),
  project_id: id,
  environment_id: id,
  node_id: id,
  reservation_id: id,
  deployment_id: id,
  server_id: id,
  world_id: id,
  name: z.string().min(1).max(80),
  template_id: z.literal("family-survival-v1"),
  plan_hash: nodeHash,
  policy_hash: nodeHash,
  template_hash: nodeHash,
  node_version: z.number().int().positive(),
  credential_version: z.number().int().positive(),
  reservation_version: z.number().int().positive(),
  cpu_milli: z.literal(2000),
  memory_mb: z.literal(6144),
  disk_mb: z.literal(20480),
  java_port: z.number().int().min(1024).max(65535),
  bedrock_port: z.number().int().min(1024).max(65535),
});
export const deploymentApprovalRequestView = z.strictObject({
  operation_id: id,
  intent_id: id,
  review_hash: nodeHash,
  review: deploymentReviewSnapshot,
  state: z.enum(["awaiting_review", "decided"]),
  decision_id: id.nullable(),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  expired: z.boolean(),
  execution_enabled: z.literal(false),
  qualification: z.literal("unverified"),
});
