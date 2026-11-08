import { AuthError } from "@craftlayer/auth";
import {
  adoptionCommit,
  adoptionPlan,
  adoptionRequest,
  deploymentAdmissionView,
  deploymentJobView,
  errorSchema,
  identityEnrollmentAccepted,
  identityEnrollmentPage,
  identityEnrollmentRequest,
  itemsSchema,
  nodeOperationView,
  operationAccepted,
  operationView,
  playersView,
  serverActivity,
  serverPage,
  serverView,
  targetView,
} from "@craftlayer/contracts";
import {
  type MinecraftControl,
  withManagementRequest,
} from "@craftlayer/minecraft-control";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requestToken } from "./auth-routes.js";
import type { DeploymentApi } from "./deployment-routes.js";
import type { NodeApi } from "./node-routes.js";
export type MinecraftApi = Pick<MinecraftControl, keyof MinecraftControl>;
export async function registerMinecraft(
  app: FastifyInstance,
  control: MinecraftApi,
  publicUrl: string,
  nodes?: NodeApi,
  deployments?: DeploymentApi,
  remoteQualified = false,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  // Server management is local-only unless the deployment is private HTTPS with
  // required two-factor sign-in (ADR 0042), which the entry point attests.
  const enabled =
    remoteQualified ||
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(publicUrl).hostname);
  app.addHook("onRequest", async (r, reply) => {
    reply.header("X-Request-Id", r.id);
    const path = r.routeOptions.url ?? r.url.split("?")[0] ?? "";
    if (
      !enabled &&
      ["/api/v1/servers", "/api/v1/server-targets", "/api/v1/operations"].some(
        (p) => path === p || path.startsWith(`${p}/`),
      )
    )
      throw new AuthError(
        503,
        "MANAGEMENT_REMOTE_UNQUALIFIED",
        "Remote management is unavailable until private entry and privileged MFA are qualified.",
      );
  });
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
  const params = z.strictObject({ id: z.uuid() }),
    scope = z.strictObject({ environment_id: z.uuid() }),
    expected = z.strictObject({
      expected_version: z.number().int().min(1).max(2147483646),
    });
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
  api.get(
    "/api/v1/server-targets",
    {
      schema: {
        querystring: scope,
        response: { 200: itemsSchema(targetView), ...errors },
      },
    },
    async (r) => ({
      items: await control.targets(token(r), org(r), r.query.environment_id),
    }),
  );
  api.post(
    "/api/v1/servers/adopt/plan",
    {
      schema: {
        body: adoptionRequest,
        response: { 200: adoptionPlan, ...errors },
      },
    },
    async (r) => control.plan(token(r), org(r), r.body),
  );
  api.post(
    "/api/v1/servers/adopt",
    {
      schema: {
        body: adoptionCommit,
        response: { 202: operationAccepted, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(
          await withManagementRequest(r.id, () =>
            control.adopt(token(r), org(r), r.body, key(r)),
          ),
        ),
  );
  api.get(
    "/api/v1/servers",
    {
      schema: {
        querystring: scope.extend({ cursor: z.uuid().optional() }),
        response: { 200: serverPage, ...errors },
      },
    },
    async (r) =>
      control.list(token(r), org(r), r.query.environment_id, r.query.cursor),
  );
  for (const path of ["/api/v1/servers/:id", "/api/v1/servers/:id/status"])
    api.get(
      path,
      { schema: { params, response: { 200: serverView, ...errors } } },
      async (r) => control.get(token(r), org(r), r.params.id),
    );
  api.get(
    "/api/v1/servers/:id/players",
    { schema: { params, response: { 200: playersView, ...errors } } },
    async (r) => control.players(token(r), org(r), r.params.id),
  );
  api.get(
    "/api/v1/servers/:id/activity",
    { schema: { params, response: { 200: serverActivity, ...errors } } },
    async (r) => control.activity(token(r), org(r), r.params.id),
  );
  api.get(
    "/api/v1/servers/:id/identity-enrollments",
    {
      schema: {
        params,
        querystring: z.strictObject({ cursor: z.uuid().optional() }),
        response: { 200: identityEnrollmentPage, ...errors },
      },
    },
    async (r) =>
      control.identityEnrollments(
        token(r),
        org(r),
        r.params.id,
        r.query.cursor,
      ),
  );
  api.post(
    "/api/v1/servers/:id/identity-enrollments",
    {
      schema: {
        params,
        body: identityEnrollmentRequest,
        response: { 202: identityEnrollmentAccepted, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(
          await withManagementRequest(r.id, () =>
            control.enrollIdentity(
              token(r),
              org(r),
              r.params.id,
              r.body,
              key(r),
            ),
          ),
        ),
  );
  api.get(
    "/api/v1/operations/:id",
    {
      schema: {
        params,
        response: {
          200: z.union([
            operationView,
            nodeOperationView,
            deploymentAdmissionView,
            deploymentJobView,
          ]),
          ...errors,
        },
      },
    },
    async (r) => {
      const lookups = [
        () => control.operation(token(r), org(r), r.params.id),
        ...(nodes
          ? [() => nodes.operation(token(r), org(r), r.params.id)]
          : []),
        ...(deployments
          ? [() => deployments.operation(token(r), org(r), r.params.id)]
          : []),
      ];
      for (const lookup of lookups) {
        try {
          return await lookup();
        } catch (e) {
          if (!(e instanceof AuthError) || e.status !== 404) throw e;
        }
      }
      throw new AuthError(404, "NOT_FOUND", "Operation not found.");
    },
  );
  for (const action of ["observe", "unregister"] as const)
    api.post(
      `/api/v1/servers/:id/${action}`,
      {
        schema: {
          params,
          body: expected,
          response: { 202: operationAccepted, ...errors },
        },
      },
      async (r, reply) =>
        reply
          .code(202)
          .send(
            await withManagementRequest(r.id, () =>
              control[action](
                token(r),
                org(r),
                r.params.id,
                r.body.expected_version,
                key(r),
              ),
            ),
          ),
    );
}
