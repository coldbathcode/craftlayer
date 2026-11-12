import { z } from "zod";
import { nodeHash } from "./nodes.js";
import {
  serverActionEvidence,
  serverActionKind,
  serverActionRequest,
  serverActionState,
} from "./server-actions.js";

/** Typed server actions carried to a bound node over the private mTLS transport
 * (master plan A2, ADR 0044). The node asks; the controller offers at most one action;
 * the node answers with the server's own words. No console text travels either way. */
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
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
export const nodeActionPollRequest = z.strictObject({
  ...proof,
  purpose: z.literal("node.actions.poll.v1"),
  /** Servers this node holds a private control channel for. */
  server_ids: z.array(z.uuid()).min(1).max(8),
});
export const nodeActionOffer = z
  .strictObject({
    id: z.uuid(),
    server_id: z.uuid(),
    kind: serverActionKind,
    request: serverActionRequest,
    fence: z.number().int().positive().max(2147483646),
    expires_at: z.iso.datetime(),
  })
  .refine((v) => v.kind === v.request.kind, "Kind must match the request");
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
export const nodeActionPollResponse = z.strictObject({
  ...reply,
  purpose: z.literal("node.actions.offer.v1"),
  action: nodeActionOffer.nullable(),
});
/** Why an action did not succeed, as the node saw it. */
export const nodeActionFailure = z.enum([
  "node_unavailable",
  "server_unreachable",
  "refused_by_server",
  "not_verified",
  "interrupted",
]);
export const nodeActionResultRequest = z.strictObject({
  ...proof,
  purpose: z.literal("node.actions.result.v1"),
  action_id: z.uuid(),
  server_id: z.uuid(),
  fence: z.number().int().positive().max(2147483646),
  outcome: serverActionEvidence,
  failure: nodeActionFailure.nullable(),
});
export const nodeActionResultResponse = z.strictObject({
  ...reply,
  purpose: z.literal("node.actions.ack.v1"),
  action_id: z.uuid(),
  state: serverActionState,
});
export const signedNodeActionPollRequest = z.strictObject({
  payload: nodeActionPollRequest,
  signature,
});
export const signedNodeActionPollResponse = z.strictObject({
  payload: nodeActionPollResponse,
  signature,
});
export const signedNodeActionResultRequest = z.strictObject({
  payload: nodeActionResultRequest,
  signature,
});
export const signedNodeActionResultResponse = z.strictObject({
  payload: nodeActionResultResponse,
  signature,
});
/** Which node, if any, executes actions for a server. */
export const serverNodeBindingRequest = z.strictObject({ node_id: z.uuid() });
export const serverNodeBinding = z.strictObject({
  server_id: z.uuid(),
  node_id: z.uuid().nullable(),
  bound_at: z.iso.datetime().nullable(),
  can_change: z.boolean(),
});
export type NodeActionPollRequest = z.infer<typeof nodeActionPollRequest>;
export type NodeActionOffer = z.infer<typeof nodeActionOffer>;
export type NodeActionResultRequest = z.infer<typeof nodeActionResultRequest>;
export type NodeActionFailure = z.infer<typeof nodeActionFailure>;
