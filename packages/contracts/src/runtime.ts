import { z } from "zod";

export const missionState = z.enum([
  "draft",
  "queued",
  "running",
  "paused",
  "blocked",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
]);
export const taskState = z.enum([
  "pending",
  "ready",
  "leased",
  "running",
  "retry_wait",
  "blocked",
  "cancel_requested",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);
export const agentState = z.enum([
  "provisioning",
  "idle",
  "assigned",
  "busy",
  "stopping",
  "offline",
  "error",
  "disabled",
]);
export const runtimeReason = z.enum([
  "none",
  "dependencies",
  "budget",
  "stop",
  "provider",
  "permission",
  "approval",
  "environment",
  "invalid_plan",
  "lease_lost",
  "uncertain",
  "required_failure",
  "cancel",
  "deadline",
  "retry",
  "capacity",
]);
const nodeKey = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const fixtureTool = z.strictObject({
  tool: z.literal("fixture.echo"),
  arguments: z.strictObject({ value: z.string().max(512) }),
});
export const taskDefinition = z.strictObject({
  key: nodeKey,
  required: z.boolean().default(true),
  dependencies: z
    .array(
      z.strictObject({ key: nodeKey, required: z.boolean().default(true) }),
    )
    .max(49)
    .default([]),
  action: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("fixture.echo"),
      value: z.string().max(512),
    }),
    z.strictObject({
      kind: z.literal("fixture.wait"),
      duration_ms: z.number().int().min(0).max(10000),
      value: z.string().max(512),
    }),
    z.strictObject({
      kind: z.literal("fixture.fail"),
      failure: z.enum(["transient", "permanent", "uncertain"]),
      failures: z.number().int().min(1).max(3),
    }),
    z.strictObject({
      kind: z.literal("fixture.model"),
      prompt: z.string().min(1).max(2048),
    }),
    z.strictObject({
      kind: z.literal("fixture.approval"),
      value: z.string().max(512),
    }),
  ]),
  max_attempts: z.number().int().min(1).max(3).default(3),
  timeout_ms: z.number().int().min(100).max(10000).default(5000),
});
export const graphSchema = z.strictObject({
  schema_version: z.literal(1),
  nodes: z.array(taskDefinition).min(1).max(50),
});
export type MissionGraph = z.infer<typeof graphSchema>;
export const templateCreate = z.strictObject({
  name: z.string().trim().min(1).max(120),
  adapter: z.literal("simulation"),
  graph: graphSchema,
  supersedes: z.uuid().optional(),
});
export const agentCreate = z.strictObject({
  environment_id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  adapter: z.literal("simulation"),
});
export const groupCreate = z.strictObject({
  environment_id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  agent_ids: z.array(z.uuid()).min(1).max(4),
});
export const missionCreate = z.strictObject({
  group_id: z.uuid(),
  template_id: z.uuid(),
  name: z.string().trim().min(1).max(120),
});
export const versionRequest = z.strictObject({
  expected_version: z.number().int().positive().max(2147483646),
});
export const agentView = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  environment_id: z.uuid(),
  name: z.string(),
  adapter: z.literal("simulation"),
  state: agentState,
  version: z.number().int().positive(),
});
export const groupView = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  environment_id: z.uuid(),
  name: z.string(),
  agent_ids: z.array(z.uuid()).max(4),
  version: z.number().int().positive(),
});
export const templateView = z.strictObject({
  id: z.uuid(),
  family_id: z.uuid(),
  version: z.number().int().positive(),
  name: z.string(),
  adapter: z.literal("simulation"),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  graph: graphSchema,
});
export const taskView = z.strictObject({
  id: z.uuid(),
  key: nodeKey,
  state: taskState,
  reason: runtimeReason,
  attempt_count: z.number().int().nonnegative(),
  fence: z.number().int().nonnegative(),
  verified: z.boolean(),
  result: z.strictObject({ value: z.string().max(4096) }).nullable(),
});
export const missionView = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  environment_id: z.uuid(),
  group_id: z.uuid(),
  name: z.string(),
  state: missionState,
  reason: runtimeReason,
  version: z.number().int().positive(),
  generation: z.number().int().positive(),
  template_hash: z.string(),
  created_at: z.iso.datetime(),
  tasks: z.array(taskView).max(50),
});
export const dispatchReference = z.strictObject({
  schema_version: z.literal(1),
  event_id: z.uuid(),
  organization_id: z.uuid(),
  task_id: z.uuid(),
  execution_generation: z.number().int().positive(),
});
export type DispatchReference = z.infer<typeof dispatchReference>;
