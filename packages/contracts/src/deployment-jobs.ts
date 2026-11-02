import { z } from "zod";
import { nodeHash } from "./nodes.js";

const id = z.uuid().refine((v) => v === v.toLowerCase());
export const deploymentJobState = z.enum([
  "issued",
  "succeeded",
  "rolled_back",
  "not_dispatched",
  "uncertain",
]);
export const deploymentJobRequest = z.strictObject({ intent_id: id });
export const deploymentJobView = z.strictObject({
  operation_id: id,
  intent_id: id,
  deployment_id: id,
  server_id: id,
  world_id: id,
  node_id: id,
  project_id: id,
  environment_id: id,
  state: deploymentJobState,
  command_hash: nodeHash,
  lease_expires_at: z.iso.datetime(),
  created_at: z.iso.datetime(),
  receipt_state: deploymentJobState.exclude(["issued"]).nullable(),
});
export const nodeJobRequest = z
  .strictObject({
    schema_version: z.literal(1),
    purpose: z.enum([
      "node.command.fetch.v1",
      "node.command.permit.request.v1",
    ]),
    control_id: nodeHash,
    organization_id: id,
    project_id: id,
    node_id: id,
    credential_version: z.number().int().positive(),
    request_id: id,
    job_id: id,
    command_hash: nodeHash,
    permit_nonce: id.nullable(),
    issued_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
  })
  .refine(
    (v) =>
      v.purpose === "node.command.fetch.v1"
        ? v.permit_nonce === null
        : v.permit_nonce !== null,
    "Permit nonce must match purpose",
  );
export const signedNodeJobRequest = z.strictObject({
  payload: nodeJobRequest,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
});
export const deploymentQualification = z.strictObject({
  qualified: z.literal(true),
  request_hash: nodeHash,
  approval_hash: nodeHash,
  policy_hash: nodeHash,
  template_hash: nodeHash,
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
});
export type DeploymentJobState = z.infer<typeof deploymentJobState>;

export type NodeJobRequest = z.infer<typeof nodeJobRequest>;
