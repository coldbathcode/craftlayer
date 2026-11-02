import {
  type nodeEnrollmentRequest,
  nodeOperationAccepted,
  nodeOperationView,
  nodePage,
  type nodeRotationRequest,
  nodeView,
} from "@craftlayer/contracts";
import type { z } from "zod";
import { identityRequest } from "./index.js";
export function nodeClient(
  organization: string,
  csrf: string,
  signal?: AbortSignal,
) {
  const context = { organization, csrf, ...(signal ? { signal } : {}) };
  return {
    list: (project: string, cursor?: string) =>
      identityRequest(
        `/api/v1/nodes?project_id=${encodeURIComponent(project)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        nodePage,
        context,
      ),
    get: (id: string) =>
      identityRequest(
        `/api/v1/nodes/${encodeURIComponent(id)}`,
        nodeView,
        context,
      ),
    enroll: (input: z.infer<typeof nodeEnrollmentRequest>, key: string) =>
      identityRequest("/api/v1/nodes/enrollments", nodeOperationAccepted, {
        ...context,
        method: "POST",
        json: input,
        idempotencyKey: key,
      }),
    revoke: (id: string, version: number, key: string) =>
      identityRequest(
        `/api/v1/nodes/${encodeURIComponent(id)}/revoke`,
        nodeOperationAccepted,
        {
          ...context,
          method: "POST",
          json: { expected_version: version },
          idempotencyKey: key,
        },
      ),
    rotate: (
      id: string,
      input: z.infer<typeof nodeRotationRequest>,
      key: string,
    ) =>
      identityRequest(
        `/api/v1/nodes/${encodeURIComponent(id)}/rotate`,
        nodeOperationAccepted,
        { ...context, method: "POST", json: input, idempotencyKey: key },
      ),
    operation: (id: string) =>
      identityRequest(
        `/api/v1/operations/${encodeURIComponent(id)}`,
        nodeOperationView,
        context,
      ),
  };
}
