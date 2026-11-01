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
  environment_id: z.uuid(),
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
  agent_id: z.uuid().nullable(),
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
export const runtimeLimitsSchema = z.strictObject({
  active_missions: z.number().int().min(0).max(4),
  active_agents: z.number().int().min(0).max(8),
  hourly_tool_calls: z.number().int().min(0).max(10000),
  hourly_runtime_ms: z.number().int().min(0).max(3600000),
  storage_bytes: z.number().int().min(0).max(268435456),
});
export const defaultRuntimeLimits = {
  active_missions: 2,
  active_agents: 4,
  hourly_tool_calls: 500,
  hourly_runtime_ms: 600000,
  storage_bytes: 67108864,
} as const;
export const runtimeQuotaView = z.strictObject({
  accounting: z.literal("reserved_estimates"),
  version: z.number().int().positive(),
  limits: runtimeLimitsSchema,
  active_missions: z.number().int().nonnegative(),
  active_agents: z.number().int().nonnegative(),
  storage_bytes: z.number().int().nonnegative(),
  hourly_tool_calls: z.number().int().nonnegative(),
  hourly_runtime_ms: z.number().int().nonnegative(),
});
export const workerCreate = z.strictObject({
  environment_id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  protocol: z.literal(1),
});
export const workerCredential = z.strictObject({
  worker_id: z.uuid(),
  organization_id: z.uuid(),
  environment_id: z.uuid(),
  protocol: z.literal(1),
  token: z
    .string()
    .regex(/^v1\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/),
});
export const workerView = z.strictObject({
  id: z.uuid(),
  environment_id: z.uuid(),
  name: z.string(),
  protocol: z.literal(1),
  version: z.number().int().positive(),
  active: z.boolean(),
  expires_at: z.iso.datetime(),
});
export const workerEnrollment = z.strictObject({
  registration: workerView,
  credential: workerCredential,
});
export const attemptHandle = z.strictObject({
  attempt_id: z.uuid(),
  task_id: z.uuid(),
  fence: z.number().int().positive(),
  generation: z.number().int().positive(),
});
export type AttemptHandle = z.infer<typeof attemptHandle>;
export const workerAction = z.discriminatedUnion("kind", [
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
  z.strictObject({ kind: z.literal("fixture.model") }),
  z.strictObject({
    kind: z.literal("fixture.approval"),
    value: z.string().max(512),
  }),
]);
export const workerClaim = attemptHandle.extend({
  attempt_number: z.number().int().min(1).max(3),
  lease_ms: z.number().int().min(1).max(15000),
  deadline_ms: z.number().int().min(1).max(10000),
  action: workerAction,
});
export type WorkerClaim = z.infer<typeof workerClaim>;
export const leaseView = z.strictObject({
  lease_ms: z.number().int().min(1).max(15000),
  deadline_ms: z.number().int().min(1).max(10000),
});
export const actionPermit = z.strictObject({
  receipt_id: z.uuid(),
  cached: z.boolean(),
  value: z.string().max(4096).nullable(),
  lease_ms: z.number().int().min(1).max(15000),
  deadline_ms: z.number().int().min(1).max(10000),
});
export const finishRequest = attemptHandle.extend({
  outcome: z.enum([
    "succeeded",
    "transient",
    "failed",
    "uncertain",
    "cancelled",
  ]),
  value: z.string().max(4096).optional(),
});
export const finishView = z.strictObject({
  ok: z.literal(true),
  state: z.enum(["succeeded", "retry_wait", "blocked", "failed", "cancelled"]),
});
export const runtimeBlocked = z.strictObject({
  blocked: z.literal(true),
  reason: runtimeReason,
});
export const prepareView = z.union([actionPermit, runtimeBlocked]);
export const modelDecision = z.union([
  z.strictObject({
    proposal: fixtureTool,
    lease_ms: z.number().int().min(1).max(15000),
    deadline_ms: z.number().int().min(1).max(10000),
  }),
  runtimeBlocked,
]);

export type RuntimeReason = z.infer<typeof runtimeReason>;
export const approvalView = z.strictObject({
  id: z.uuid(),
  mission_id: z.uuid(),
  task_id: z.uuid(),
  generation: z.number().int().positive(),
  state: z.enum(["pending", "approved", "rejected", "consumed"]),
  action_hash: z.string().regex(/^[a-f0-9]{64}$/),
  action: fixtureTool,
  expires_at: z.iso.datetime(),
});

export const stopRequest = z.strictObject({
  kind: z.enum(["instance", "organization", "environment", "mission"]),
  scope_id: z.uuid(),
  reason: z.string().trim().min(1).max(240),
});
export const stopView = z.strictObject({
  id: z.uuid(),
  kind: stopRequest.shape.kind,
  scope_id: z.uuid(),
  epoch: z.number().int().positive(),
  latched: z.boolean(),
  requested: z.number().int().nonnegative(),
  acknowledged: z.number().int().nonnegative(),
  quiesced: z.number().int().nonnegative(),
  unreachable: z.number().int().nonnegative(),
  created_at: z.iso.datetime(),
  cleared_at: z.iso.datetime().nullable(),
});

export const recoveryEvidence = z.strictObject({
  attempt_id: z.uuid(),
  task_id: z.uuid(),
  worker_id: z.uuid(),
  evidence_hash: z.string().regex(/^[a-f0-9]{64}$/),
  deadline_at: z.iso.datetime(),
  worker_revoked: z.boolean(),
  worker_acknowledged: z.boolean(),
  receipts: z
    .array(
      z.strictObject({
        id: z.uuid(),
        state: z.enum(["prepared", "confirmed", "uncertain"]),
      }),
    )
    .max(10),
  model_calls: z
    .array(
      z.strictObject({
        request_id: z.uuid(),
        state: z.enum([
          "prepared",
          "dispatched",
          "completed",
          "invalid",
          "uncertain",
        ]),
      }),
    )
    .max(3),
});
export const reconcileAttempt = z.strictObject({
  evidence_hash: z.string().regex(/^[a-f0-9]{64}$/),
  quiescent: z.literal(true),
  reason: z.string().trim().min(1).max(240),
});
