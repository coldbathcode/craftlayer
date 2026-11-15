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
  aiPlayerTranscript,
  aiPlayerView,
  connectionSchema,
  itemsSchema,
  modelSchema,
  projectSchema,
} from "@craftlayer/contracts";
import { z } from "zod";
import { identityRequest } from "./index.js";

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
        send("POST"),
      ),
  };
}
