import { AuthError } from "@craftlayer/auth";
import {
  backupListView,
  backupPolicyInput,
  backupPolicyView,
  backupRequestAccepted,
  backupStatusView,
  errorSchema,
  legalHoldRequest,
} from "@craftlayer/contracts";
import type { BackupRecords } from "@craftlayer/minecraft-control";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requestToken } from "./auth-routes.js";

/** Only the adult/read methods are routed. The composition-trusted `record*` and
 * `scheduleDue` methods have no HTTP surface by design. */
export type BackupApi = Pick<
  BackupRecords,
  "status" | "setPolicy" | "requestBackup" | "list" | "setLegalHold"
>;
export async function registerBackups(
  app: FastifyInstance,
  backups: BackupApi,
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
  const params = z.strictObject({ id: z.uuid() }),
    backupParams = z.strictObject({ id: z.uuid(), backup: z.uuid() });
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
    "/api/v1/servers/:id/backup-status",
    { schema: { params, response: { 200: backupStatusView, ...errors } } },
    (r) => backups.status(token(r), org(r), r.params.id),
  );
  api.put(
    "/api/v1/servers/:id/backup-policy",
    {
      schema: {
        params,
        body: backupPolicyInput,
        response: { 200: backupPolicyView, ...errors },
      },
    },
    (r) => backups.setPolicy(token(r), org(r), r.params.id, r.body, key(r)),
  );
  api.post(
    "/api/v1/servers/:id/backups",
    { schema: { params, response: { 202: backupRequestAccepted, ...errors } } },
    async (r, reply) =>
      reply
        .code(202)
        .send(
          await backups.requestBackup(token(r), org(r), r.params.id, key(r)),
        ),
  );
  api.get(
    "/api/v1/servers/:id/backups",
    { schema: { params, response: { 200: backupListView, ...errors } } },
    (r) => backups.list(token(r), org(r), r.params.id),
  );
  api.put(
    "/api/v1/servers/:id/backups/:backup/legal-hold",
    {
      schema: {
        params: backupParams,
        body: legalHoldRequest,
        response: {
          200: z.strictObject({ ok: z.literal(true), changed: z.boolean() }),
          ...errors,
        },
      },
    },
    (r) =>
      backups.setLegalHold(
        token(r),
        org(r),
        r.params.id,
        r.params.backup,
        r.body,
      ),
  );
}
