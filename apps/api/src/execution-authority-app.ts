import { X509Certificate } from "node:crypto";
import { TLSSocket } from "node:tls";
import {
  AuthError,
  executionGrantSchema,
  type IdentityService,
} from "@craftlayer/auth";
import {
  executionAuthorityRequest,
  signedExecutionAuthorityProof,
} from "@craftlayer/contracts";
import {
  assertNodeTime,
  certificateHash,
  nodeDigest,
  nodePrivateKey,
  signNodeValue,
  verifyNodeValue,
} from "@craftlayer/node-protocol";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
/** Explicit optional private identity listener. No control private key, Docker or game access. */
export async function buildExecutionAuthorityApp(options: {
  auth: Pick<IdentityService, "guardExecutions">;
  authorityPrivateKey: string;
  controllerPublicKey: string;
  controllerCertificateSha256: string;
  key: string;
  cert: string;
  ca: string;
}) {
  const publicKey = nodePrivateKey(options.authorityPrivateKey).public_key,
    requests = new Map<string, number>();
  if (publicKey === options.controllerPublicKey)
    throw new Error("AUTHORITY_SEPARATE_SIGNING_KEY_REQUIRED");
  let last = 0;
  const app = Fastify({
    https: {
      key: options.key,
      cert: options.cert,
      ca: options.ca,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
    },
    bodyLimit: 16384,
    requestTimeout: 5000,
    connectionTimeout: 5000,
    logger: false,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.server.maxConnections = 64;
  app.setErrorHandler((error, _r, reply) => {
    void reply.code(error instanceof AuthError ? error.status : 400).send({
      error: {
        code:
          error instanceof AuthError
            ? error.code
            : "DEPLOYMENT_AUTHORITY_DENIED",
        message: "Current deployment authority denied; values omitted.",
      },
    });
  });
  app.post(
    "/internal/v1/execution-authority",
    {
      schema: {
        body: z.strictObject({
          payload: executionAuthorityRequest,
          grants: z.array(executionGrantSchema).length(2),
          signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
        }),
        response: { 200: signedExecutionAuthorityProof },
      },
    },
    async (r) => {
      const socket = r.raw.socket,
        v = r.body.payload,
        grants = r.body.grants,
        now = Date.now();
      if (now < last)
        throw new AuthError(
          503,
          "AUTHORITY_CLOCK_ROLLBACK",
          "Authority clock unavailable.",
        );
      last = now;
      if (
        !(socket instanceof TLSSocket) ||
        !socket.authorized ||
        r.headers.cookie !== undefined
      )
        throw new AuthError(
          401,
          "AUTHORITY_MTLS_REQUIRED",
          "Private authenticated transport required.",
        );
      const cert = socket.getPeerCertificate();
      if (
        !cert.raw ||
        certificateHash(cert.raw) !== options.controllerCertificateSha256 ||
        Date.parse(new X509Certificate(cert.raw).validTo) <= now
      )
        throw new AuthError(
          401,
          "AUTHORITY_PEER_DENIED",
          "Private authenticated peer required.",
        );
      try {
        assertNodeTime(v.issued_at, v.expires_at, now);
      } catch {
        throw new AuthError(
          401,
          "AUTHORITY_PROOF_EXPIRED",
          "Current authority proof required.",
        );
      }
      if (
        Date.parse(v.issued_at) > now ||
        Date.parse(v.expires_at) - Date.parse(v.issued_at) > 5000 ||
        v.control_id !== nodeDigest(options.controllerPublicKey) ||
        v.grants_hash !== nodeDigest(grants) ||
        !verifyNodeValue(v, r.body.signature, options.controllerPublicKey) ||
        grants.some((g) => g.organizationId !== v.organization_id) ||
        grants[0]?.permission !== "node:deploy" ||
        grants[0]?.resource.kind !== "project" ||
        grants[1]?.permission !== "server:provision" ||
        grants[1]?.resource.kind !== "environment"
      )
        throw new AuthError(
          403,
          "AUTHORITY_BINDING_DENIED",
          "Current authority binding denied.",
        );
      for (const [key, expiry] of requests)
        if (expiry <= now) requests.delete(key);
      if (requests.has(v.request_nonce) || requests.size >= 1024)
        throw new AuthError(
          429,
          "AUTHORITY_REPLAY_OR_LIMIT",
          "Fresh bounded authority request required.",
        );
      requests.set(v.request_nonce, Date.parse(v.expires_at));
      return options.auth.guardExecutions(grants, async (p) => {
        const time = Date.now(),
          expires = Math.min(time + 2000, p.authorityExpiresAt ?? 0);
        if (
          p.user.account_type !== "adult" ||
          time >= Date.parse(v.expires_at) ||
          expires <= time
        )
          throw new AuthError(
            403,
            "AUTHORITY_DENIED",
            "Current adult authority required.",
          );
        const payload = {
          schema_version: 1 as const,
          purpose: "identity.execution.proof.v1" as const,
          authority_id: nodeDigest(publicKey),
          control_id: v.control_id,
          organization_id: v.organization_id,
          request_nonce: v.request_nonce,
          grants_hash: v.grants_hash,
          user_id: p.user.id,
          session_id: p.sessionId,
          user_version: p.userVersion,
          account_type: "adult" as const,
          authority_expires_at: new Date(
            p.authorityExpiresAt ?? 0,
          ).toISOString(),
          issued_at: new Date(time).toISOString(),
          expires_at: new Date(expires).toISOString(),
        };
        return signedExecutionAuthorityProof.parse({
          payload,
          signature: signNodeValue(payload, options.authorityPrivateKey),
        });
      });
    },
  );
  await app.ready();
  return app;
}
