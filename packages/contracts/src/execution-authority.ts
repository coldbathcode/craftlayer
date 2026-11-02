import { z } from "zod";

const id = z.uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const executionAuthorityRequest = z.strictObject({
  schema_version: z.literal(1),
  purpose: z.literal("identity.execution.check.v1"),
  control_id: hash,
  organization_id: id,
  request_nonce: id,
  grants_hash: hash,
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export const executionAuthorityProof = z.strictObject({
  schema_version: z.literal(1),
  purpose: z.literal("identity.execution.proof.v1"),
  authority_id: hash,
  control_id: hash,
  organization_id: id,
  request_nonce: id,
  grants_hash: hash,
  user_id: id,
  session_id: id,
  user_version: z.number().int().positive(),
  account_type: z.literal("adult"),
  authority_expires_at: z.iso.datetime(),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export const signedExecutionAuthorityProof = z.strictObject({
  payload: executionAuthorityProof,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
