import { AuthError, type IdentityService } from "@craftlayer/auth";
import { newRequestId } from "@craftlayer/config";
import { healthSchema } from "@craftlayer/contracts";
import { ProviderError } from "@craftlayer/providers";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyBaseLogger } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { registerAuth } from "./auth-routes.js";
import { type ConnectionApi, registerProviders } from "./provider-routes.js";
export async function buildApp(options: {
  readiness: () => Promise<boolean>;
  logger?: FastifyBaseLogger;
  auth?: IdentityService;
  providers?: ConnectionApi;
  publicUrl?: string;
}) {
  const app = Fastify({
    bodyLimit: 16384,
    requestTimeout: 5000,
    connectionTimeout: 5000,
    genReqId: newRequestId,
    requestIdHeader: false,
    logger: false,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { info: { title: "CraftLayer Core", version: "0.0.0" } },
    transform: jsonSchemaTransform,
  });
  app.addHook("onResponse", async (request, reply) => {
    options.logger?.info(
      {
        request_id: request.id,
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        status: reply.statusCode,
      },
      "Request complete",
    );
  });
  app.setErrorHandler(async (error, request, reply) => {
    options.logger?.warn(
      { request_id: request.id, code: "REQUEST_FAILED" },
      "Request failed",
    );
    if (error instanceof ProviderError) {
      options.logger?.warn(
        { request_id: request.id, provider_code: error.code },
        "Provider operation denied",
      );
      void reply
        .code(
          error.code === "policy_denied"
            ? 403
            : error.code === "auth"
              ? 503
              : error.code === "rate_limited"
                ? 429
                : 502,
        )
        .send({
          error: {
            code: `PROVIDER_${error.code.toUpperCase()}`,
            message:
              "Provider configuration or policy denied this operation; values omitted.",
            request_id: request.id,
          },
        });
      return;
    }
    if (error instanceof AuthError) {
      if ([401, 403, 404].includes(error.status))
        await options.auth
          ?.recordDenied(request.cookies?.craftlayer_session ?? "", request.ip)
          .catch(() => {});
      void reply.code(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: request.id,
        },
      });
      return;
    }
    const candidate =
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : 500;
    const status =
      typeof candidate === "number" && candidate >= 400 && candidate < 500
        ? candidate
        : 500;
    void reply.code(status).send({
      error: {
        code: "REQUEST_FAILED",
        message: "Request could not be processed.",
        request_id: request.id,
      },
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        request_id: request.id,
      },
    }),
  );
  const payload = { service: "api" as const, version: "0.0.0" as const };
  app.get(
    "/health/live",
    { schema: { response: { 200: healthSchema } } },
    async () => ({ status: "ok" as const, ...payload }),
  );
  for (const path of ["/health/ready", "/api/v1/system/status"])
    app.get(
      path,
      { schema: { response: { 200: healthSchema, 503: healthSchema } } },
      async (_request, reply) => {
        let ready = false;
        try {
          ready = await options.readiness();
        } catch {}
        return reply
          .code(ready ? 200 : 503)
          .send({ status: ready ? "ok" : "not_ready", ...payload });
      },
    );
  app.get("/api/v1/openapi.json", async () => app.swagger());
  if (options.auth)
    await registerAuth(
      app,
      options.auth,
      options.publicUrl ?? "http://127.0.0.1:3000",
    );
  if (options.providers && options.auth)
    await registerProviders(app, options.providers);
  await app.ready();
  return app;
}
