import { AuthError } from "@craftlayer/auth";
import {
  agentCreate,
  agentView,
  approvalView,
  attemptHandle,
  dispatchReference,
  errorSchema,
  finishRequest,
  finishView,
  groupCreate,
  groupView,
  itemsSchema,
  leaseView,
  missionCreate,
  missionView,
  modelDecision,
  okSchema,
  prepareView,
  reconcileAttempt,
  recoveryEvidence,
  runtimeLimitsSchema,
  runtimeQuotaView,
  stopRequest,
  stopView,
  templateCreate,
  templateView,
  versionRequest,
  workerClaim,
  workerCreate,
  workerEnrollment,
  workerView,
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
  for (const command of ["pause", "cancel"] as const)
    api.post(
      `/api/v1/missions/:id/${command}`,
      {
        schema: {
          params,
          body: versionRequest,
          response: { ...errors, 200: missionView },
        },
      },
      (r) =>
        runtime.missionControl(
          token(r),
          org(r),
          r.params.id,
          command,
          r.body.expected_version,
          key(r),
        ),
    );
  api.post(
    "/api/v1/missions/:id/resume",
    {
      schema: {
        params,
        body: versionRequest,
        response: { ...errors, 200: missionView },
      },
    },
    (r) =>
      runtime.resumeMission(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_version,
        key(r),
      ),
  );
  api.post(
    "/api/v1/emergency-stop",
    { schema: { body: stopRequest, response: { ...errors, 200: stopView } } },
    (r) => runtime.requestStop(token(r), org(r), r.body),
  );
  api.get(
    "/api/v1/stop-operations/:id",
    { schema: { params, response: { ...errors, 200: stopView } } },
    (r) => runtime.getStop(token(r), org(r), r.params.id),
  );
  api.post(
    "/api/v1/emergency-stop/:id/clear",
    {
      schema: {
        params,
        body: z.strictObject({
          expected_epoch: z.number().int().positive(),
          reason: z.string().trim().min(1).max(240),
        }),
        response: { ...errors, 200: stopView },
      },
    },
    (r) =>
      runtime.clearStop(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_epoch,
        r.body.reason,
      ),
  );
  api.get(
    "/api/v1/missions/:id/recovery",
    {
      schema: {
        params,
        response: { ...errors, 200: itemsSchema(recoveryEvidence) },
      },
    },
    async (r) => ({
      items: await runtime.recovery(token(r), org(r), r.params.id),
    }),
  );
  api.post(
    "/api/v1/missions/:id/recovery/:attempt",
    {
      schema: {
        params: params.extend({ attempt: z.uuid() }),
        body: reconcileAttempt,
        response: { ...errors, 200: missionView },
      },
    },
    (r) =>
      runtime.reconcileRuntime(
        token(r),
        org(r),
        r.params.id,
        r.params.attempt,
        r.body,
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
  api.post(
    "/api/v1/workers",
    {
      schema: {
        body: workerCreate,
        response: { ...errors, 200: workerEnrollment },
      },
    },
    (r) => runtime.enrollWorker(token(r), org(r), r.body),
  );
  api.get(
    "/api/v1/workers",
    {
      schema: {
        querystring: query,
        response: { ...errors, 200: itemsSchema(workerView) },
      },
    },
    async (r) => ({
      items: await runtime.listWorkers(
        token(r),
        org(r),
        r.query.environment_id,
      ),
    }),
  );
  api.post(
    "/api/v1/workers/:id/revoke",
    {
      schema: {
        params,
        body: versionRequest,
        response: { ...errors, 200: workerView },
      },
    },
    (r) =>
      runtime.revokeWorker(
        token(r),
        org(r),
        r.params.id,
        r.body.expected_version,
      ),
  );
  const bearer = (r: FastifyRequest) => {
    const v = r.headers.authorization;
    if (!v?.startsWith("Bearer "))
      throw new AuthError(401, "WORKER_DENIED", "Worker credentials required.");
    return v.slice(7);
  };
  const protocol = (r: FastifyRequest) =>
    r.headers["x-craftlayer-worker-protocol"] === "1" ? 1 : 0;
  api.post(
    "/api/v1/worker/claim",
    {
      schema: {
        body: dispatchReference,
        response: {
          ...errors,
          200: z.strictObject({ claim: workerClaim.nullable() }),
        },
      },
    },
    (r) => runtime.claim(bearer(r), protocol(r), r.body),
  );
  api.post(
    "/api/v1/worker/heartbeat",
    {
      schema: { body: attemptHandle, response: { ...errors, 200: leaseView } },
    },
    (r) => runtime.heartbeat(bearer(r), protocol(r), r.body),
  );
  api.post(
    "/api/v1/worker/prepare",
    {
      schema: {
        body: attemptHandle,
        response: { ...errors, 200: prepareView },
      },
    },
    (r) => runtime.prepareAction(bearer(r), protocol(r), r.body),
  );
  api.post(
    "/api/v1/worker/finish",
    {
      schema: { body: finishRequest, response: { ...errors, 200: finishView } },
    },
    (r) => runtime.finish(bearer(r), protocol(r), r.body),
  );
  api.post(
    "/api/v1/worker/stopped",
    { schema: { body: attemptHandle, response: { ...errors, 200: okSchema } } },
    (r) => runtime.acknowledgeStopped(bearer(r), protocol(r), r.body),
  );
  api.get(
    "/api/v1/approvals",
    {
      schema: {
        querystring: query,
        response: { ...errors, 200: itemsSchema(approvalView) },
      },
    },
    async (r) => ({
      items: await runtime.listApprovals(
        token(r),
        org(r),
        r.query.environment_id,
      ),
    }),
  );
  api.post(
    "/api/v1/approvals/:id/decision",
    {
      schema: {
        params,
        body: z.strictObject({ decision: z.enum(["approve", "reject"]) }),
        response: { ...errors, 200: approvalView },
      },
    },
    (r) =>
      runtime.decideApproval(token(r), org(r), r.params.id, r.body.decision),
  );
  api.post(
    "/api/v1/worker/decide",
    {
      schema: {
        body: attemptHandle,
        response: { ...errors, 200: modelDecision },
      },
    },
    async (r, reply) => {
      const controller = new AbortController(),
        abort = () => controller.abort();
      reply.raw.once("close", abort);
      try {
        return await runtime.decide(
          bearer(r),
          protocol(r),
          r.body,
          controller.signal,
        );
      } finally {
        reply.raw.off("close", abort);
      }
    },
  );
}
