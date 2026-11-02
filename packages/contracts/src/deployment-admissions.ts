import { z } from "zod";

const id = z.uuid().refine((v) => v === v.toLowerCase());
export const deploymentAdmissionRequest = z.strictObject({ intent_id: id });
export const deploymentAdmissionView = z.strictObject({
  operation_id: id,
  intent_id: id,
  deployment_id: id,
  reservation_id: id,
  authorization_state: z.enum(["active", "expired"]),
  expires_at: z.iso.datetime(),
  effects: z.literal("metadata_only"),
  job_id: id.nullable(),
});
