import { z } from "zod";
import { nodeHash } from "./nodes.js";

const id = z.uuid().refine((v) => v === v.toLowerCase());
const scope = {
  schema_version: z.literal(1),
  control_id: nodeHash,
  organization_id: id,
  project_id: id,
  node_id: id,
  credential_version: z.number().int().positive(),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
};
export const nodePollRequest = z.strictObject({
  ...scope,
  purpose: z.literal("node.command.poll.v1"),
  request_id: id,
});
export const nodePollResponse = z.strictObject({
  ...scope,
  purpose: z.literal("node.command.poll.response.v1"),
  request_hash: nodeHash,
  jobs: z
    .array(
      z.strictObject({
        operation_id: id,
        command_hash: nodeHash,
        expires_at: z.iso.datetime(),
      }),
    )
    .max(1),
});
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
export const signedNodePollRequest = z.strictObject({
  payload: nodePollRequest,
  signature,
});
export const signedNodePollResponse = z.strictObject({
  payload: nodePollResponse,
  signature,
});
export type NodePollRequest = z.infer<typeof nodePollRequest>;
