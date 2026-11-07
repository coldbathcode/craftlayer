import { z } from "zod";
import { nodeHash } from "./nodes.js";

const id = z.uuid().refine((v) => v === v.toLowerCase());
// The caller names the exact review they saw; everything else is server-derived.
export const deploymentApprovalDecisionRequest = z.strictObject({
  request_id: id,
  review_hash: nodeHash,
  decision: z.enum(["approved", "rejected"]),
});
export const deploymentApprovalRevocationRequest = z.strictObject({
  decision_id: id,
});
export const deploymentApprovalDecisionView = z.strictObject({
  operation_id: id,
  request_id: id,
  review_hash: nodeHash,
  decision: z.enum(["approved", "rejected"]),
  state: z.enum(["approved", "rejected", "revoked", "expired"]),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  revoked_at: z.iso.datetime().nullable(),
  execution_enabled: z.literal(false),
  qualification: z.literal("unverified"),
});
// Revalidated evidence for later composition. It is not a grant or a qualifier result.
export const deploymentApprovalEvidence = z.strictObject({
  decision_id: id,
  request_id: id,
  intent_id: id,
  approval_hash: nodeHash,
  review_hash: nodeHash,
  expires_at: z.iso.datetime(),
  execution_enabled: z.literal(false),
  qualification: z.literal("unverified"),
});
