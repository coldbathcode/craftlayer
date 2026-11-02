import {
  type adoptionCommit,
  adoptionPlan,
  type adoptionRequest,
  itemsSchema,
  operationAccepted,
  operationView,
  playersView,
  serverActivity,
  serverPage,
  serverView,
  targetView,
} from "@craftlayer/contracts";
import type { z } from "zod";
import { identityRequest } from "./index.js";
export function minecraftClient(
  organization: string,
  csrf: string,
  signal?: AbortSignal,
) {
  const context = { organization, csrf, ...(signal ? { signal } : {}) };
  return {
    targets: (environment: string) =>
      identityRequest(
        `/api/v1/server-targets?environment_id=${encodeURIComponent(environment)}`,
        itemsSchema(targetView),
        context,
      ),
    list: (environment: string, cursor?: string) =>
      identityRequest(
        `/api/v1/servers?environment_id=${encodeURIComponent(environment)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        serverPage,
        context,
      ),
    get: (id: string) =>
      identityRequest(
        `/api/v1/servers/${encodeURIComponent(id)}`,
        serverView,
        context,
      ),
    players: (id: string) =>
      identityRequest(
        `/api/v1/servers/${encodeURIComponent(id)}/players`,
        playersView,
        context,
      ),
    activity: (id: string) =>
      identityRequest(
        `/api/v1/servers/${encodeURIComponent(id)}/activity`,
        serverActivity,
        context,
      ),
    plan: (input: z.infer<typeof adoptionRequest>) =>
      identityRequest("/api/v1/servers/adopt/plan", adoptionPlan, {
        ...context,
        method: "POST",
        json: input,
      }),
    adopt: (input: z.infer<typeof adoptionCommit>, key: string) =>
      identityRequest("/api/v1/servers/adopt", operationAccepted, {
        ...context,
        method: "POST",
        json: input,
        idempotencyKey: key,
      }),
    operation: (id: string) =>
      identityRequest(
        `/api/v1/operations/${encodeURIComponent(id)}`,
        operationView,
        context,
      ),
    observe: (id: string, version: number, key: string) =>
      identityRequest(
        `/api/v1/servers/${encodeURIComponent(id)}/observe`,
        operationAccepted,
        {
          ...context,
          method: "POST",
          json: { expected_version: version },
          idempotencyKey: key,
        },
      ),
    unregister: (id: string, version: number, key: string) =>
      identityRequest(
        `/api/v1/servers/${encodeURIComponent(id)}/unregister`,
        operationAccepted,
        {
          ...context,
          method: "POST",
          json: { expected_version: version },
          idempotencyKey: key,
        },
      ),
  };
}
