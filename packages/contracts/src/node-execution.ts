import { z } from "zod";
import { nodeHash, nodePublicKey } from "./nodes.js";

const id = z
  .uuid()
  .refine((v) => v === v.toLowerCase(), "Canonical UUID required");
export const nodeAction = z.enum([
  "provision",
  "start",
  "stop",
  "restart",
  "rollback",
]);
const generation = z.number().int().min(1).max(2147483646);
const target = {
  organization_id: id,
  project_id: id,
  node_id: id,
  credential_version: generation,
  control_id: nodeHash,
};
export const nodeCommand = z.strictObject({
  schema_version: z.literal(1),
  purpose: z.literal("node.command.v1"),
  ...target,
  command_id: id,
  operation_id: id,
  deployment_id: id,
  server_id: id,
  world_id: id,
  reservation_id: id,
  action: nodeAction,
  attempt: generation,
  fence: generation,
  stop_generation: z.number().int().min(0).max(2147483646),
  policy_revision: generation,
  policy_hash: nodeHash,
  plan_hash: nodeHash,
  template_hash: nodeHash,
  authorization_hash: nodeHash,
  approval_hash: nodeHash,
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export const signedNodeCommand = z.strictObject({
  payload: nodeCommand,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export const nodeCommandPermit = z.strictObject({
  schema_version: z.literal(1),
  purpose: z.literal("node.command.permit.v1"),
  ...target,
  command_hash: nodeHash,
  request_nonce: id,
  lease_id: id,
  fence: generation,
  stop_generation: z.number().int().min(0).max(2147483646),
  policy_revision: generation,
  policy_hash: nodeHash,
  authorization_hash: nodeHash,
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  allowed: z.literal(true),
});
export const signedNodeCommandPermit = z.strictObject({
  payload: nodeCommandPermit,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export const nodeExecutionPolicy = z.strictObject({
  schema_version: z.literal(1),
  ...target,
  control_public_key: nodePublicKey,
  node_public_key: nodePublicKey,
  policy_revision: generation,
  policy_hash: nodeHash,
  enabled: z.boolean().default(false),
  allowed_actions: z.array(nodeAction).max(5),
});
export const nodeCommandReceipt = z
  .strictObject({
    schema_version: z.literal(1),
    purpose: z.literal("node.command.receipt.v1"),
    ...target,
    command_id: id,
    operation_id: id,
    deployment_id: id,
    server_id: id,
    world_id: id,
    command_hash: nodeHash,
    action: nodeAction,
    fence: generation,
    state: z.enum(["succeeded", "not_dispatched", "uncertain"]),
    evidence_hash: nodeHash.nullable(),
    finished_at: z.iso.datetime(),
  })
  .refine(
    (v) =>
      v.state === "succeeded"
        ? v.evidence_hash !== null
        : v.evidence_hash === null,
    "Receipt evidence must match state",
  );
export const signedNodeCommandReceipt = z.strictObject({
  payload: nodeCommandReceipt,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export type NodeCommand = z.infer<typeof nodeCommand>;
export type NodeExecutionPolicy = z.infer<typeof nodeExecutionPolicy>;
export type SignedNodeCommandReceipt = z.infer<typeof signedNodeCommandReceipt>;
