import { AuthError } from "@craftlayer/auth";
import {
  errorSchema,
  knockAllowed,
  knockPage,
  knockView,
  serverLiveView,
} from "@craftlayer/contracts";
import type { ServerLive } from "@craftlayer/minecraft-control";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requestToken } from "./auth-routes.js";

/** Reading what the host reports, and deciding each knock. Recording a report belongs
 * to the node path and has no HTTP surface here by design. */
export type ServerLiveApi = Pick<
  ServerLive,
  "live" | "knocks" | "allowKnock" | "ignoreKnock"
>;
export async function registerServerLive(
  app: FastifyInstance,
  live: ServerLiveApi,
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
    422: errorSchema,
    429: errorSchema,
    500: errorSchema,
    503: errorSchema,
  };
  api.get(
    "/api/v1/servers/:id/live",
    { schema: { params, response: { 200: serverLiveView, ...errors } } },
    (r) => live.live(token(r), org(r), r.params.id),
  );
  api.get(
    "/api/v1/servers/:id/knocks",
    { schema: { params, response: { 200: knockPage, ...errors } } },
    (r) => live.knocks(token(r), org(r), r.params.id),
  );
  api.post(
    "/api/v1/server-knocks/:id/allow",
    { schema: { params, response: { 202: knockAllowed, ...errors } } },
    async (r, reply) =>
      reply
        .code(202)
        .send(await live.allowKnock(token(r), org(r), r.params.id, key(r))),
  );
  api.post(
    "/api/v1/server-knocks/:id/ignore",
    { schema: { params, response: { 200: knockView, ...errors } } },
    (r) => live.ignoreKnock(token(r), org(r), r.params.id),
  );
}
