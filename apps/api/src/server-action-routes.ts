import { AuthError } from "@craftlayer/auth";
import {
  errorSchema,
  serverActionAccepted,
  serverActionPage,
  serverActionRequest,
  serverActionView,
  serverNodeBinding,
  serverNodeBindingRequest,
} from "@craftlayer/contracts";
import type { ServerActions } from "@craftlayer/minecraft-control";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requestToken } from "./auth-routes.js";

/** Request, read, cancel and the choice of executing host are routed. Dispatch and
 * result recording belong to the node path and have no HTTP surface by design. */
export type ServerActionApi = Pick<
  ServerActions,
  | "request"
  | "list"
  | "get"
  | "cancel"
  | "nodeBinding"
  | "bindNode"
  | "unbindNode"
>;
export async function registerServerActions(
  app: FastifyInstance,
  actions: ServerActionApi,
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
    "/api/v1/servers/:id/actions",
    {
      schema: {
        params,
        body: serverActionRequest,
        response: { 202: serverActionAccepted, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(
          await actions.request(token(r), org(r), r.params.id, r.body, key(r)),
        ),
  );
  api.get(
    "/api/v1/servers/:id/actions",
    { schema: { params, response: { 200: serverActionPage, ...errors } } },
    (r) => actions.list(token(r), org(r), r.params.id),
  );
  api.get(
    "/api/v1/servers/:id/node",
    { schema: { params, response: { 200: serverNodeBinding, ...errors } } },
    (r) => actions.nodeBinding(token(r), org(r), r.params.id),
  );
  api.put(
    "/api/v1/servers/:id/node",
    {
      schema: {
        params,
        body: serverNodeBindingRequest,
        response: { 200: serverNodeBinding, ...errors },
      },
    },
    (r) => actions.bindNode(token(r), org(r), r.params.id, r.body),
  );
  api.delete(
    "/api/v1/servers/:id/node",
    { schema: { params, response: { 200: serverNodeBinding, ...errors } } },
    (r) => actions.unbindNode(token(r), org(r), r.params.id),
  );
  api.get(
    "/api/v1/server-actions/:id",
    { schema: { params, response: { 200: serverActionView, ...errors } } },
    (r) => actions.get(token(r), org(r), r.params.id),
  );
  api.post(
    "/api/v1/server-actions/:id/cancel",
    { schema: { params, response: { 200: serverActionView, ...errors } } },
    (r) => actions.cancel(token(r), org(r), r.params.id),
  );
}
