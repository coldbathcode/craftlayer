import { AuthError } from "@craftlayer/auth";
import {
  connectionCreateSchema,
  connectionSchema,
  errorSchema,
  itemsSchema,
} from "@craftlayer/contracts";
import type { ConnectionService } from "@craftlayer/providers";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export type ConnectionApi = Pick<ConnectionService, keyof ConnectionService>;
export async function registerProviders(
  app: FastifyInstance,
  providers: ConnectionApi,
) {
  const api = app.withTypeProvider<ZodTypeProvider>(),
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
}
