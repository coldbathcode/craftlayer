import {
  type AiPlayerInput,
  type AiPlayerMemoryInput,
  type AiPlayerTaskInput,
  type AiPlayerUpdate,
  aiPlayerHostCreated,
  aiPlayerHostList,
  aiPlayerList,
  aiPlayerMemory,
  aiPlayerMemoryList,
  aiPlayerSpendHistory,
  aiPlayerTranscript,
  aiPlayerView,
  type BudgetLimits,
  budgetViewSchema,
  connectionSchema,
  itemsSchema,
  type ModelPolicy,
  modelPolicySchema,
  modelSchema,
  projectSchema,
  providerEndpointsSchema,
} from "@craftlayer/contracts";
import { z } from "zod";
import { identityRequest } from "./index.js";

export type SpendScope = "organization" | "user" | "project";
const policyView = z.strictObject({
  version: z.number().int().nonnegative(),
  policy: modelPolicySchema,
});

/** Master plan G8: the owner's AI player screens. Same-origin, session and CSRF. */
export function aiPlayerClient(
  organization: string,
  csrf: string,
  signal?: AbortSignal,
) {
  const context = { organization, csrf, ...(signal ? { signal } : {}) };
  const send = (method: string, json?: unknown) => ({
    ...context,
    method,
    ...(json === undefined ? {} : { json }),
  });
  const player = (id: string, rest = "") =>
    `/api/v1/ai-players/${encodeURIComponent(id)}${rest ? `/${rest}` : ""}`;
  return {
    list: () => identityRequest("/api/v1/ai-players", aiPlayerList, context),
    get: (id: string) => identityRequest(player(id), aiPlayerView, context),
    create: (input: AiPlayerInput) =>
      identityRequest("/api/v1/ai-players", aiPlayerView, send("POST", input)),
    update: (id: string, input: AiPlayerUpdate) =>
      identityRequest(player(id), aiPlayerView, send("PATCH", input)),
    remove: (id: string) =>
      identityRequest(
        player(id),
        z.strictObject({ removed: z.literal(true) }),
        send("DELETE"),
      ),
    setTasks: (id: string, tasks: AiPlayerTaskInput[]) =>
      identityRequest(
        player(id, "tasks"),
        aiPlayerView,
        send("PUT", { tasks }),
      ),
    start: (id: string) =>
      identityRequest(player(id, "start"), aiPlayerView, send("POST")),
    stop: (id: string) =>
      identityRequest(player(id, "stop"), aiPlayerView, send("POST")),
    clearStop: (id: string) =>
      identityRequest(player(id, "clear-stop"), aiPlayerView, send("POST")),
    instruct: (id: string, body: string) =>
      identityRequest(
        player(id, "instructions"),
        z.strictObject({ id: z.uuid() }),
        send("POST", { body }),
      ),
    transcript: (id: string, after = 0) =>
      identityRequest(
        player(id, `transcript?after=${after}`),
        aiPlayerTranscript,
        context,
      ),
    spendHistory: (id: string, days = 30) =>
      identityRequest(
        player(id, `spend-history?days=${days}`),
        aiPlayerSpendHistory,
        context,
      ),
    memories: (id: string) =>
      identityRequest(player(id, "memories"), aiPlayerMemoryList, context),
    addMemory: (id: string, input: AiPlayerMemoryInput) =>
      identityRequest(
        player(id, "memories"),
        aiPlayerMemory,
        send("POST", input),
      ),
    forgetMemory: (id: string, memory: string) =>
      identityRequest(
        player(id, `memories/${encodeURIComponent(memory)}`),
        z.strictObject({ forgotten: z.literal(true) }),
        send("DELETE"),
      ),
    hosts: () =>
      identityRequest("/api/v1/ai-player-hosts", aiPlayerHostList, context),
    createHost: (label: string) =>
      identityRequest(
        "/api/v1/ai-player-hosts",
        aiPlayerHostCreated,
        send("POST", { label }),
      ),
    revokeHost: (id: string) =>
      identityRequest(
        `/api/v1/ai-player-hosts/${encodeURIComponent(id)}/revoke`,
        z.strictObject({ revoked: z.literal(true) }),
        send("POST"),
      ),
    projects: () =>
      identityRequest("/api/v1/projects", itemsSchema(projectSchema), context),
    /** Model connections and their models, for the model picker. */
    connections: () =>
      identityRequest(
        "/api/v1/providers",
        itemsSchema(connectionSchema),
        context,
      ),
    models: (connection: string) =>
      identityRequest(
        `/api/v1/providers/${encodeURIComponent(connection)}/models`,
        itemsSchema(modelSchema),
        context,
      ),
    refreshModels: (connection: string) =>
      identityRequest(
        `/api/v1/providers/${encodeURIComponent(connection)}/refresh`,
        itemsSchema(modelSchema),
        send("POST", {}),
      ),
    /** Services the operator approved, and the instance's paid-model switch. */
    endpoints: () =>
      identityRequest(
        "/api/v1/provider-endpoints",
        providerEndpointsSchema,
        context,
      ),
    connect: (input: {
      kind: "ollama" | "openrouter" | "openai_compatible";
      endpoint_id: string;
      label: string;
      secret?: string;
    }) =>
      identityRequest(
        "/api/v1/providers",
        connectionSchema,
        send("POST", input),
      ),
    setConnectionEnabled: (id: string, version: number, enabled: boolean) =>
      identityRequest(
        `/api/v1/providers/${encodeURIComponent(id)}/status`,
        connectionSchema,
        send("PUT", { expected_version: version, enabled }),
      ),
    policy: (kind: SpendScope, id: string) =>
      identityRequest(
        `/api/v1/model-policy/${kind}/${encodeURIComponent(id)}`,
        policyView,
        context,
      ),
    setPolicy: (
      kind: SpendScope,
      id: string,
      version: number,
      policy: ModelPolicy,
    ) =>
      identityRequest(
        `/api/v1/model-policy/${kind}/${encodeURIComponent(id)}`,
        policyView,
        send("PUT", { expected_version: version, policy }),
      ),
    budget: (kind: SpendScope, id: string) =>
      identityRequest(
        `/api/v1/budgets/${kind}/${encodeURIComponent(id)}`,
        budgetViewSchema,
        context,
      ),
    setBudget: (
      kind: SpendScope,
      id: string,
      version: number,
      limits: BudgetLimits,
    ) =>
      identityRequest(
        `/api/v1/budgets/${kind}/${encodeURIComponent(id)}`,
        budgetViewSchema,
        send("PUT", { expected_version: version, limits }),
      ),
  };
}
