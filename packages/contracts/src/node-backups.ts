import { z } from "zod";
import { nodeHash } from "./nodes.js";

/** Backups carried to a bound node over the private mTLS transport (master plan D1,
 * ADR 0045). The node asks; the controller offers at most one occurrence; the node
 * answers with hashes of the archive it wrote. No path, command or archive bytes
 * travel either way. */
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const proof = {
  schema_version: z.literal(1),
  control_id: nodeHash,
  organization_id: z.uuid(),
  node_id: z.uuid(),
  credential_version: z.number().int().positive().max(2147483646),
  sequence: z.number().int().min(1).max(2147483646),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
};
const reply = {
  schema_version: z.literal(1),
  control_id: nodeHash,
  organization_id: z.uuid(),
  node_id: z.uuid(),
  credential_version: z.number().int().positive(),
  sequence: z.number().int().positive(),
  request_hash: nodeHash,
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
};
export const nodeBackupPollRequest = z.strictObject({
  ...proof,
  purpose: z.literal("node.backups.poll.v1"),
  /** Servers this node can back up: it holds their data directory and control channel. */
  server_ids: z.array(z.uuid()).min(1).max(8),
});
export const nodeBackupOffer = z.strictObject({
  occurrence_id: z.uuid(),
  server_id: z.uuid(),
  kind: z.enum(["scheduled", "manual"]),
  /** After this the controller records the occurrence as interrupted. */
  expires_at: z.iso.datetime(),
});
export const nodeBackupPollResponse = z.strictObject({
  ...reply,
  purpose: z.literal("node.backups.offer.v1"),
  backup: nodeBackupOffer.nullable(),
});
/** Why a backup did not complete, as the node saw it. */
export const nodeBackupFailure = z.enum([
  "node_unavailable",
  "save_failed",
  "archive_failed",
  "verification_failed",
  "interrupted",
]);
export const nodeBackupOutcome = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    archive_sha256: sha256,
    size_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    manifest_hash: sha256,
    file_count: z.number().int().min(0).max(200000),
    total_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({ ok: z.literal(false), failure: nodeBackupFailure }),
]);
export const nodeBackupResultRequest = z.strictObject({
  ...proof,
  purpose: z.literal("node.backups.result.v1"),
  occurrence_id: z.uuid(),
  server_id: z.uuid(),
  outcome: nodeBackupOutcome,
});
export const nodeBackupResultResponse = z.strictObject({
  ...reply,
  purpose: z.literal("node.backups.ack.v1"),
  occurrence_id: z.uuid(),
  state: z.enum(["pending", "running", "complete", "failed"]),
});
export const signedNodeBackupPollRequest = z.strictObject({
  payload: nodeBackupPollRequest,
  signature,
});
export const signedNodeBackupPollResponse = z.strictObject({
  payload: nodeBackupPollResponse,
  signature,
});
export const signedNodeBackupResultRequest = z.strictObject({
  payload: nodeBackupResultRequest,
  signature,
});
export const signedNodeBackupResultResponse = z.strictObject({
  payload: nodeBackupResultResponse,
  signature,
});
export type NodeBackupPollRequest = z.infer<typeof nodeBackupPollRequest>;
export type NodeBackupOffer = z.infer<typeof nodeBackupOffer>;
export type NodeBackupOutcome = z.infer<typeof nodeBackupOutcome>;
export type NodeBackupFailure = z.infer<typeof nodeBackupFailure>;
export type NodeBackupResultRequest = z.infer<typeof nodeBackupResultRequest>;
