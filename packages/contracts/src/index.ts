import { z } from "zod";
export const healthSchema = z.strictObject({
  status: z.enum(["ok", "not_ready"]),
  service: z.enum(["api", "worker", "web"]),
  version: z.literal("0.0.0"),
});
export type Health = z.infer<typeof healthSchema>;
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
  }),
});

export * from "./backups.js";
export * from "./deployment-admissions.js";
export * from "./deployment-approval-decisions.js";
export * from "./deployment-approval-requests.js";
export * from "./deployment-intents.js";
export * from "./deployment-jobs.js";
export * from "./execution-authority.js";
export * from "./identity.js";
export * from "./minecraft.js";
export * from "./minecraft-identity.js";
export * from "./node-actions.js";
export * from "./node-backups.js";
export * from "./node-execution.js";
export * from "./node-poll.js";
export * from "./node-reservations.js";
export * from "./nodes.js";
export * from "./providers.js";
export * from "./provisioning.js";
export * from "./runtime.js";
export * from "./server-actions.js";
