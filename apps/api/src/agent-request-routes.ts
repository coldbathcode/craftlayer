import { AuthError } from "@craftlayer/auth";
import {
  agentRequestAccepted,
  agentRequestDecision,
  agentRequestInputSchema,
  agentRequestPage,
  agentRequestView,
  errorSchema,
} from "@craftlayer/contracts";
import type { AgentRequests } from "@craftlayer/minecraft-control";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requestToken } from "./auth-routes.js";

export type AgentRequestApi = Pick<
  AgentRequests,
  "request" | "list" | "decide" | "cancel"
>;
export async function registerAgentRequests(
  app: FastifyInstance,
  requests: AgentRequestApi,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const token = requestToken;
  const org = (r: FastifyRequest) => {
    const v = z.uuid().safeParse(r.headers["x-craftlayer-organization"]);
    if (!v.success)
      throw new AuthError(
        400,
        "ORGANIZATION_REQUIRED",
        "Select an organization.",
      );
    return v.data;
  };
  const key = (r: FastifyRequest) => {
    const v = z.uuid().safeParse(r.headers["idempotency-key"]);
    if (!v.success)
      throw new AuthError(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Provide a UUID idempotency key.",
      );
    return v.data;
  };
  const params = z.strictObject({ id: z.uuid() });
  const errors = {
    400: errorSchema,
    401: errorSchema,
    403: errorSchema,
    404: errorSchema,
    409: errorSchema,
    429: errorSchema,
    500: errorSchema,
    503: errorSchema,
  };
  api.post(
    "/api/v1/servers/:id/agent-requests",
    {
      schema: {
        params,
        body: agentRequestInputSchema,
        response: { 202: agentRequestAccepted, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(
          await requests.request(token(r), org(r), r.params.id, r.body, key(r)),
        ),
  );
  api.get(
    "/api/v1/servers/:id/agent-requests",
    { schema: { params, response: { 200: agentRequestPage, ...errors } } },
    (r) => requests.list(token(r), org(r), r.params.id),
  );
  api.post(
    "/api/v1/agent-requests/:id/decide",
    {
      schema: {
        params,
        body: agentRequestDecision,
        response: { 200: agentRequestView, ...errors },
      },
    },
    (r) => requests.decide(token(r), org(r), r.params.id, r.body),
  );
  api.post(
    "/api/v1/agent-requests/:id/cancel",
    { schema: { params, response: { 200: agentRequestView, ...errors } } },
    (r) => requests.cancel(token(r), org(r), r.params.id),
  );
}
