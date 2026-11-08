import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const targetKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const title = z.string().trim().min(1).max(100);
export const gameAddress = z.strictObject({
  host: z
    .string()
    .max(253)
    .regex(/^[a-zA-Z0-9:][a-zA-Z0-9.:-]{0,252}$/),
  port: z.number().int().min(1).max(65535),
});
export const capturedObservation = z.strictObject({
  source: z.enum(["captured_inventory", "java_status"]).optional(),
  data_kind: z.literal("synthetic").optional(),
  reported_player_count: z.number().int().min(0).max(10000).optional(),
  observed_at: z.iso.datetime(),
  state: z.enum(["online", "offline", "unknown", "unavailable"]),
  java: gameAddress.nullable(),
  bedrock: gameAddress.nullable(),
  players: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-zA-Z0-9_. -]{1,32}$/),
        edition: z.enum(["java", "bedrock", "unknown"]),
      }),
    )
    .max(100)
    .nullable(),
  online_authentication: z.boolean().nullable(),
  allowlist_enabled: z.boolean().nullable(),
  enforce_allowlist: z.boolean().nullable(),
  rcon_public: z.boolean().nullable(),
  backup_verified: z.literal(false),
  identity_verified: z.literal(false),
});
export const inventoryTarget = z.strictObject({
  id: targetKey,
  organization_id: z.uuid(),
  environment_id: z.uuid(),
  label: title,
  binding_hash: hash,
  observation: capturedObservation,
  java_status: z
    .strictObject({
      address: z
        .string()
        .max(45)
        .regex(/^[a-fA-F0-9:.]+$/),
      port: z.number().int().min(1024).max(65535),
      protocol_version: z.number().int().min(1).max(100000),
    })
    .optional(),
});
export const inventorySchema = z
  .strictObject({
    schema_version: z.literal(1),
    targets: z.array(inventoryTarget).max(100),
  })
  .superRefine((v, c) => {
    const seen = new Set<string>();
    for (const t of v.targets) {
      const key = `${t.organization_id}:${t.environment_id}:${t.id}`;
      if (seen.has(key))
        c.addIssue({ code: "custom", message: "Duplicate inventory binding" });
      seen.add(key);
    }
  });
export const adoptionRequest = z.strictObject({
  environment_id: z.uuid(),
  target_id: targetKey,
  name: title,
});
export const adoptionCommit = adoptionRequest.extend({ plan_hash: hash });
export const targetView = z.strictObject({
  id: targetKey,
  label: title,
  binding_hash: hash,
  source: z.enum(["captured_inventory", "java_status"]),
  observed_at: z.iso.datetime(),
});
export const adoptionPlan = z.strictObject({
  environment_id: z.uuid(),
  target: targetView,
  name: title,
  plan_hash: hash,
  effects: z.literal("register_only"),
  requires_world_changes: z.literal(false),
});
export const observationView = capturedObservation
  .omit({ players: true })
  .extend({
    source: z.enum(["captured_inventory", "java_status"]),
    freshness: z.enum(["fresh", "stale", "unavailable"]),
    player_count: z.number().int().min(0).max(10000).nullable(),
    family_ready: z.literal(false),
  });
export const serverView = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  environment_id: z.uuid(),
  name: title,
  management_mode: z.literal("adopted_read_only"),
  registered: z.boolean(),
  version: z.number().int().positive(),
  target_id: targetKey,
  observation: observationView.nullable(),
  can_observe: z.boolean(),
  can_unregister: z.boolean(),
});
export const serverPage = z.strictObject({
  items: z.array(serverView).max(50),
  next_cursor: z.uuid().nullable(),
});
export const operationView = z.strictObject({
  id: z.uuid(),
  server_id: z.uuid(),
  environment_id: z.uuid(),
  kind: z.enum([
    "adopt",
    "observe",
    "unregister",
    "identity_enroll",
    "backup_policy",
    "backup_request",
    "server_action",
  ]),
  state: z.enum(["running", "succeeded", "failed"]),
  failure_code: z.enum([
    "source_unavailable",
    "authority_changed",
    "interrupted",
    "none",
  ]),
  created_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
  recovery_required: z.boolean(),
});
export const operationAccepted = z.strictObject({
  operation_id: z.uuid(),
  server_id: z.uuid(),
});
export const playersView = z.strictObject({
  server_id: z.uuid(),
  observed_at: z.iso.datetime().nullable(),
  freshness: z.enum(["fresh", "stale", "unavailable"]),
  supported: z.boolean(),
  players: capturedObservation.shape.players,
});
export type InventoryTarget = z.infer<typeof inventoryTarget>;
export type CapturedObservation = z.infer<typeof capturedObservation>;
export type ServerView = z.infer<typeof serverView>;
export type OperationView = z.infer<typeof operationView>;

export const serverActivity = z.strictObject({
  items: z
    .array(
      z.strictObject({
        action: z.enum([
          "server.adopted_read_only",
          "server.observation_requested",
          "server.observation_recorded",
          "server.observation_failed",
          "server.unregistered",
          "server.identity_enrollment_requested",
          "server.backup_policy_set",
          "server.backup_requested",
          "server.backup_legal_hold_changed",
          "server.action_requested",
          "server.action_cancelled",
          "server.agent_request_created",
          "server.agent_request_approved",
          "server.agent_request_declined",
          "server.agent_request_cancelled",
        ]),
        occurred_at: z.iso.datetime(),
        operation_id: z.uuid(),
        outcome: z.enum(["allowed", "denied"]),
      }),
    )
    .max(30),
});
