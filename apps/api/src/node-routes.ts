import { AuthError } from "@craftlayer/auth";
import {
  errorSchema,
  nodeEnrollmentRequest,
  nodeOperationAccepted,
  nodeOperationView,
  nodePage,
  nodeRotationRequest,
  nodeView,
  provisionPlan,
  provisionPlanRequest,
  serverTemplatePage,
} from "@craftlayer/contracts";
import type { NodeControl } from "@craftlayer/minecraft-control";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
export type NodeApi = Pick<
  NodeControl,
  | "enroll"
  | "get"
  | "list"
  | "change"
  | "operation"
  | "templates"
  | "provisionPlan"
>;
export async function registerNodes(
  app: FastifyInstance,
  nodes: NodeApi,
  publicUrl: string,
) {
  const api = app.withTypeProvider<ZodTypeProvider>(),
    local = ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(publicUrl).hostname,
    );
  app.addHook("onRequest", async (r, reply) => {
    const path = r.routeOptions.url ?? r.url.split("?")[0] ?? "";
    if (
      path.startsWith("/api/v1/nodes") ||
      path.startsWith("/api/v1/node-operations") ||
      path === "/api/v1/server-templates" ||
      path === "/api/v1/servers/provision/plan"
    ) {
      reply.header("Cache-Control", "no-store");
      reply.header("X-Request-Id", r.id);
      if (!local)
        throw new AuthError(
          503,
          "MANAGEMENT_REMOTE_UNQUALIFIED",
          "Remote administration requires qualified private entry and MFA.",
        );
    }
  });
  function selector(r: FastifyRequest, name: string) {
    const value = z.uuid().safeParse(r.headers[name]);
    if (!value.success)
      throw new AuthError(
        400,
        "NODE_CONTEXT_REQUIRED",
        "Select a valid organization and UUID idempotency key.",
      );
    return value.data;
  }
  const token = (r: FastifyRequest) => r.cookies.craftlayer_session ?? "",
    org = (r: FastifyRequest) => selector(r, "x-craftlayer-organization"),
    key = (r: FastifyRequest) => z.uuid().parse(r.headers["idempotency-key"]),
    params = z.strictObject({ id: z.uuid() }),
    errors = {
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      409: errorSchema,
      429: errorSchema,
      500: errorSchema,
      503: errorSchema,
    };
  api.get(
    "/api/v1/nodes",
    {
      schema: {
        querystring: z.strictObject({
          project_id: z.uuid(),
          cursor: z.uuid().optional(),
        }),
        response: { 200: nodePage, ...errors },
      },
    },
    (r) => nodes.list(token(r), org(r), r.query.project_id, r.query.cursor),
  );
  api.post(
    "/api/v1/nodes/enrollments",
    {
      schema: {
        body: nodeEnrollmentRequest,
        response: { 202: nodeOperationAccepted, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(await nodes.enroll(token(r), org(r), r.body, key(r), r.id)),
  );
  for (const path of ["/api/v1/nodes/:id", "/api/v1/nodes/:id/capacity"])
    api.get(
      path,
      { schema: { params, response: { 200: nodeView, ...errors } } },
      (r) => nodes.get(token(r), org(r), r.params.id),
    );
  for (const action of ["revoke", "rotate"] as const)
    api.post(
      `/api/v1/nodes/:id/${action}`,
      {
        schema: {
          params,
          body:
            action === "rotate"
              ? nodeRotationRequest
              : z.strictObject({
                  expected_version: z.number().int().positive(),
                }),
          response: { 202: nodeOperationAccepted, ...errors },
        },
      },
      async (r, reply) =>
        reply
          .code(202)
          .send(
            await nodes.change(
              token(r),
              org(r),
              r.params.id,
              action,
              r.body,
              key(r),
              r.id,
            ),
          ),
    );
  api.get(
    "/api/v1/node-operations/:id",
    { schema: { params, response: { 200: nodeOperationView, ...errors } } },
    (r) => nodes.operation(token(r), org(r), r.params.id),
  );
  api.get(
    "/api/v1/server-templates",
    {
      schema: {
        querystring: z.strictObject({ node_id: z.uuid() }),
        response: { 200: serverTemplatePage, ...errors },
      },
    },
    (r) => nodes.templates(token(r), org(r), r.query.node_id),
  );
  api.post(
    "/api/v1/servers/provision/plan",
    {
      schema: {
        body: provisionPlanRequest,
        response: { 200: provisionPlan, ...errors },
      },
    },
    (r) => nodes.provisionPlan(token(r), org(r), r.body),
  );
}
