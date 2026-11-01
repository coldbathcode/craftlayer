import { AuthError } from "@craftlayer/auth";
import {
  agentCreate,
  agentView,
  errorSchema,
  groupCreate,
  groupView,
  itemsSchema,
  missionCreate,
  missionView,
  runtimeLimitsSchema,
  runtimeQuotaView,
  templateCreate,
  templateView,
  versionRequest,
} from "@craftlayer/contracts";
import type { RuntimeService } from "@craftlayer/runtime";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
export type RuntimeApi = Pick<RuntimeService, keyof RuntimeService>;
export async function registerRuntime(
  app: FastifyInstance,
  runtime: RuntimeApi,
) {
  const api = app.withTypeProvider<ZodTypeProvider>(),
    token = (r: FastifyRequest) => r.cookies.craftlayer_session ?? "";
  const org = (r: FastifyRequest) => {
    const id = z.uuid().safeParse(r.headers["x-craftlayer-organization"]);
    if (!id.success)
      throw new AuthError(
        400,
        "ORGANIZATION_REQUIRED",
        "Select an organization.",
      );
    return id.data;
  };
  const key = (r: FastifyRequest) => {
    const id = z.uuid().safeParse(r.headers["idempotency-key"]);
    if (!id.success)
      throw new AuthError(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Provide a UUID Idempotency-Key.",
      );
    return id.data;
  };
  const params = z.strictObject({ id: z.uuid() }),
    query = z.strictObject({ environment_id: z.uuid() }),
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
    "/api/v1/agents",
    { schema: { body: agentCreate, response: { ...errors, 200: agentView } } },
    (r) => runtime.createAgent(token(r), org(r), r.body),
  );
  api.get(
    "/api/v1/agents",
    {
      schema: {
        querystring: query,
        response: { ...errors, 200: itemsSchema(agentView) },
      },
    },
    async (r) => ({
      items: await runtime.listAgents(token(r), org(r), r.query.environment_id),
    }),
  );
  api.put(
    "/api/v1/agents/:id/status",
    {
      schema: {
        params,
        body: versionRequest.extend({ enabled: z.boolean() }),
        response: { ...errors, 200: agentView },
      },
    },
    (r) =>
      runtime.setAgentEnabled(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_version,
        r.body.enabled,
      ),
  );
  api.post(
    "/api/v1/groups",
    { schema: { body: groupCreate, response: { ...errors, 200: groupView } } },
    (r) => runtime.createGroup(token(r), org(r), r.body),
  );
  api.get(
    "/api/v1/groups",
    {
      schema: {
        querystring: query,
        response: { ...errors, 200: itemsSchema(groupView) },
      },
    },
    async (r) => ({
      items: await runtime.listGroups(token(r), org(r), r.query.environment_id),
    }),
  );
  api.post(
    "/api/v1/mission-templates",
    {
      schema: {
        body: templateCreate,
        response: { ...errors, 200: templateView },
      },
    },
    (r) => runtime.createTemplate(token(r), org(r), r.body),
  );
  api.get(
    "/api/v1/mission-templates",
    {
      schema: {
        querystring: query,
        response: { ...errors, 200: itemsSchema(templateView) },
      },
    },
    async (r) => ({
      items: await runtime.listTemplates(
        token(r),
        org(r),
        r.query.environment_id,
      ),
    }),
  );
  api.post(
    "/api/v1/missions",
    {
      schema: {
        body: missionCreate,
        response: { ...errors, 200: missionView },
      },
    },
    (r) => runtime.createMission(token(r), org(r), key(r), r.body),
  );
  api.get(
    "/api/v1/missions",
    {
      schema: {
        querystring: query,
        response: { ...errors, 200: itemsSchema(missionView) },
      },
    },
    async (r) => ({
      items: await runtime.listMissions(
        token(r),
        org(r),
        r.query.environment_id,
      ),
    }),
  );
  api.get(
    "/api/v1/missions/:id",
    { schema: { params, response: { ...errors, 200: missionView } } },
    (r) => runtime.getMission(token(r), org(r), r.params.id),
  );
  api.post(
    "/api/v1/missions/:id/execute",
    {
      schema: {
        params,
        body: versionRequest,
        response: { ...errors, 200: missionView },
      },
    },
    (r) =>
      runtime.executeMission(
        token(r),
        org(r),
        r.params.id,
        key(r),
        r.body.expected_version,
      ),
  );
  const quotaParams = z.strictObject({
    kind: z.enum(["organization", "user", "project"]),
    id: z.uuid(),
  });
  api.get(
    "/api/v1/runtime-budgets/:kind/:id",
    {
      schema: {
        params: quotaParams,
        response: { ...errors, 200: runtimeQuotaView },
      },
    },
    (r) => runtime.runtimeBudget(token(r), org(r), r.params.kind, r.params.id),
  );
  api.put(
    "/api/v1/runtime-budgets/:kind/:id",
    {
      schema: {
        params: quotaParams,
        body: versionRequest.extend({ limits: runtimeLimitsSchema }),
        response: { ...errors, 200: runtimeQuotaView },
      },
    },
    (r) =>
      runtime.setRuntimeBudget(
        token(r),
        org(r),
        r.params.kind,
        r.params.id,
        r.body.expected_version,
        r.body.limits,
      ),
  );
}
