import { AuthError } from "@craftlayer/auth";
import {
  budgetLimitsSchema,
  budgetViewSchema,
  connectionCreateSchema,
  connectionSchema,
  errorSchema,
  itemsSchema,
  modelPolicySchema,
  modelSchema,
  okSchema,
  usageReportSchema,
} from "@craftlayer/contracts";
import type { ProviderGateway } from "@craftlayer/providers";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export type ConnectionApi = Pick<ProviderGateway, keyof ProviderGateway>;
export async function registerProviders(
  app: FastifyInstance,
  providers: ConnectionApi,
) {
  const api = app.withTypeProvider<ZodTypeProvider>(),
    // Provider credentials stay browser-session only; agent bearers are never read here.
    token = (r: FastifyRequest) => r.cookies.craftlayer_session ?? "";
  const org = (r: FastifyRequest) =>
    (() => {
      const result = z.uuid().safeParse(r.headers["x-craftlayer-organization"]);
      if (!result.success)
        throw new AuthError(
          400,
          "ORGANIZATION_REQUIRED",
          "Select an organization.",
        );
      return result.data;
    })();
  const params = z.strictObject({ id: z.uuid() }),
    version = z.number().int().min(1).max(2147483646);
  const responses = {
    200: connectionSchema,
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
    "/api/v1/providers",
    {
      schema: {
        response: { ...responses, 200: itemsSchema(connectionSchema) },
      },
    },
    async (r) => ({ items: await providers.listConnections(token(r), org(r)) }),
  );
  api.post(
    "/api/v1/providers",
    { schema: { body: connectionCreateSchema, response: responses } },
    async (r) => providers.createConnection(token(r), org(r), r.body),
  );
  api.put(
    "/api/v1/providers/:id/status",
    {
      schema: {
        params,
        body: z.strictObject({
          expected_version: version,
          enabled: z.boolean(),
        }),
        response: responses,
      },
    },
    async (r) =>
      providers.setEnabled(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_version,
        r.body.enabled,
      ),
  );
  api.put(
    "/api/v1/providers/:id/credential",
    {
      schema: {
        params,
        body: z.strictObject({
          expected_version: version,
          secret: connectionCreateSchema.shape.secret.unwrap(),
        }),
        response: responses,
      },
    },
    async (r) =>
      providers.changeCredential(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_version,
        r.body.secret,
      ),
  );
  api.delete(
    "/api/v1/providers/:id/credential",
    {
      schema: {
        params,
        body: z.strictObject({ expected_version: version }),
        response: responses,
      },
    },
    async (r) =>
      providers.changeCredential(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_version,
        null,
      ),
  );
  api.post(
    "/api/v1/providers/:id/rewrap",
    {
      schema: {
        params,
        body: z.strictObject({ expected_version: version }),
        response: responses,
      },
    },
    async (r) =>
      providers.changeCredential(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_version,
        null,
        true,
      ),
  );
  const scopes = z.strictObject({
    kind: z.enum(["organization", "user", "project"]),
    id: z.uuid(),
  });
  const policyResponse = z.strictObject({
    version: z.number().int().nonnegative(),
    policy: modelPolicySchema,
  });
  api.get(
    "/api/v1/providers/:id/models",
    {
      schema: {
        params,
        response: { ...responses, 200: itemsSchema(modelSchema) },
      },
    },
    async (r) => ({
      items: await providers.listModels(token(r), org(r), r.params.id),
    }),
  );
  api.post(
    "/api/v1/providers/:id/refresh",
    {
      schema: {
        params,
        body: z.strictObject({}),
        response: { ...responses, 200: itemsSchema(modelSchema) },
      },
    },
    async (r) => ({
      items: await providers.refreshModels(token(r), org(r), r.params.id),
    }),
  );
  api.get(
    "/api/v1/model-policy/:kind/:id",
    {
      schema: {
        params: scopes,
        response: { ...responses, 200: policyResponse },
      },
    },
    async (r) =>
      providers.getPolicy(token(r), org(r), r.params.kind, r.params.id),
  );
  api.put(
    "/api/v1/model-policy/:kind/:id",
    {
      schema: {
        params: scopes,
        body: z.strictObject({
          expected_version: z.number().int().nonnegative().max(2147483646),
          policy: modelPolicySchema,
        }),
        response: { ...responses, 200: policyResponse },
      },
    },
    async (r) =>
      providers.setPolicy(
        token(r),
        org(r),
        r.params.kind,
        r.params.id,
        r.body.expected_version,
        r.body.policy,
      ),
  );
  api.get(
    "/api/v1/providers/stop",
    {
      schema: {
        response: {
          ...responses,
          200: z.strictObject({
            stopped: z.boolean(),
            instance_stopped: z.boolean(),
          }),
        },
      },
    },
    async (r) => providers.stopStatus(token(r), org(r)),
  );
  api.post(
    "/api/v1/providers/stop",
    {
      schema: {
        body: z.strictObject({}),
        response: { ...responses, 200: okSchema },
      },
    },
    async (r) => providers.setStopped(token(r), org(r), true),
  );
  api.post(
    "/api/v1/providers/stop/clear",
    {
      schema: {
        body: z.strictObject({}),
        response: { ...responses, 200: okSchema },
      },
    },
    async (r) => providers.setStopped(token(r), org(r), false),
  );
  api.get(
    "/api/v1/budgets/:kind/:id",
    {
      schema: {
        params: scopes,
        response: { ...responses, 200: budgetViewSchema },
      },
    },
    async (r) =>
      providers.getBudget(token(r), org(r), r.params.kind, r.params.id),
  );
  api.put(
    "/api/v1/budgets/:kind/:id",
    {
      schema: {
        params: scopes,
        body: z.strictObject({
          expected_version: z.number().int().nonnegative().max(2147483646),
          limits: budgetLimitsSchema,
        }),
        response: { ...responses, 200: budgetViewSchema },
      },
    },
    async (r) =>
      providers.setBudget(
        token(r),
        org(r),
        r.params.kind,
        r.params.id,
        r.body.expected_version,
        r.body.limits,
      ),
  );
  api.get(
    "/api/v1/usage",
    { schema: { response: { ...responses, 200: usageReportSchema } } },
    async (r) => providers.usage(token(r), org(r)),
  );
  api.post(
    "/api/v1/usage/:id/reconcile",
    {
      schema: {
        params,
        body: z.strictObject({
          receipt_hash: z.string().regex(/^[a-f0-9]{64}$/),
          confirmed_quiescent: z.literal(true),
        }),
        response: { ...responses, 200: okSchema },
      },
    },
    async (r) =>
      providers.reconcile(
        token(r),
        org(r),
        r.params.id,
        r.body.receipt_hash,
        r.body.confirmed_quiescent,
      ),
  );
}
