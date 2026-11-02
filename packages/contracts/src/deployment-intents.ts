import { z } from "zod";

const id = z.uuid().refine((v) => v === v.toLowerCase());
export const deploymentIntentRequest = z.strictObject({
  reservation_id: id,
  dispatch_operation_id: id,
  reservation_version: z.number().int().positive(),
});
export const deploymentIntentAccepted = z.strictObject({
  operation_id: id,
  deployment_id: id,
  reservation_id: id,
  state: z.literal("pending_qualification"),
  effects: z.literal("none"),
  execution_enabled: z.literal(false),
});
export const deploymentIntentView = deploymentIntentAccepted.extend({
  project_id: id,
  environment_id: id,
  node_id: id,
  server_id: id,
  world_id: id,
  created_at: z.iso.datetime(),
});
