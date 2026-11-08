import { AuthError } from "@craftlayer/auth";
import {
  deploymentAdmissionRequest,
  deploymentAdmissionView,
  deploymentJobView,
  errorSchema,
} from "@craftlayer/contracts";
import type { DeploymentAdmissions } from "@craftlayer/minecraft-control";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requestToken } from "./auth-routes.js";
export type DeploymentApi = Pick<
  DeploymentAdmissions,
  "admit" | "get" | "job" | "operation"
>;
/** Human metadata only; this module cannot issue a node command or accept caller approval. */
export async function registerDeployments(
  app: FastifyInstance,
  deployment: DeploymentApi,
  publicUrl: string,
) {
  const api = app.withTypeProvider<ZodTypeProvider>(),
    local = ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(publicUrl).hostname,
    );
  app.addHook("onRequest", async (r, reply) => {
    const path = r.routeOptions.url ?? r.url.split("?")[0] ?? "";
    if (
      path.startsWith("/api/v1/servers/provision/admissions") ||
      path.startsWith("/api/v1/servers/provision/jobs")
    ) {
      reply.header("Cache-Control", "no-store");
      reply.header("X-Request-Id", r.id);
      if (!local)
        throw new AuthError(
          503,
          "MANAGEMENT_REMOTE_UNQUALIFIED",
          "Private entry and privileged MFA require qualification.",
        );
    }
  });
  const selector = (r: FastifyRequest, name: string) => {
      const v = z.uuid().safeParse(r.headers[name]);
      if (!v.success)
        throw new AuthError(
          400,
          "DEPLOYMENT_CONTEXT_REQUIRED",
          "Select an organization and UUID idempotency key.",
        );
      return v.data;
    },
    token = requestToken,
    org = (r: FastifyRequest) => selector(r, "x-craftlayer-organization"),
    params = z.strictObject({ id: z.uuid() }),
    headers = z.object({ "x-craftlayer-organization": z.uuid() }),
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
  api.post(
    "/api/v1/servers/provision/admissions",
    {
      schema: {
        headers: headers.extend({ "idempotency-key": z.uuid() }),
        body: deploymentAdmissionRequest,
        response: { 202: deploymentAdmissionView, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(
          await deployment.admit(
            token(r),
            org(r),
            r.body,
            selector(r, "idempotency-key"),
          ),
        ),
  );
  api.get(
    "/api/v1/servers/provision/admissions/:id",
    {
      schema: {
        headers,
        params,
        response: { 200: deploymentAdmissionView, ...errors },
      },
    },
    (r) => deployment.get(token(r), org(r), r.params.id),
  );
  api.get(
    "/api/v1/servers/provision/jobs/:id",
    {
      schema: {
        headers,
        params,
        response: { 200: deploymentJobView, ...errors },
      },
    },
    (r) => deployment.job(token(r), org(r), r.params.id),
  );
}
