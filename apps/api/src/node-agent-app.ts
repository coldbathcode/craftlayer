import { X509Certificate } from "node:crypto";
import { TLSSocket } from "node:tls";
import { AuthError } from "@craftlayer/auth";
import { signedNodeRequest, signedNodeResponse } from "@craftlayer/contracts";
import type { NodeControl } from "@craftlayer/minecraft-control";
import { certificateHash } from "@craftlayer/node-protocol";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
/** Separate private mTLS listener. No browser/cookie authentication or Docker access. */
export async function buildNodeAgentApp(options: {
  control: Pick<NodeControl, "exchange">;
  key: Buffer | string;
  cert: Buffer | string;
  ca: Buffer | string;
}) {
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
  app.server.maxConnections = 128;
  app.setErrorHandler((e, _r, reply) => {
    const status =
      e instanceof AuthError
        ? e.status
        : e && typeof e === "object" && "validation" in e
          ? 400
          : 500;
    void reply.code(status).send({
      error: {
        code: e instanceof AuthError ? e.code : "NODE_REQUEST_DENIED",
        message: "Node request denied; values omitted.",
      },
    });
  });
  for (const [path, purpose] of [
    ["/node/v1/enroll", "node.enroll.v1"],
    ["/node/v1/heartbeat", "node.heartbeat.v1"],
  ] as const)
    app.post(
      path,
      {
        schema: {
          body: signedNodeRequest,
          response: { 200: signedNodeResponse },
        },
      },
      async (r) => {
        const socket = r.raw.socket;
        if (
          !(socket instanceof TLSSocket) ||
          !socket.authorized ||
          r.headers.cookie ||
          r.body.payload.purpose !== purpose
        )
          throw new AuthError(
            401,
            "NODE_MTLS_REQUIRED",
            "Mutually authenticated node transport required.",
          );
        const cert = socket.getPeerCertificate();
        if (!cert.raw)
          throw new AuthError(
            401,
            "NODE_MTLS_REQUIRED",
            "Node certificate required.",
          );
        const x509 = new X509Certificate(cert.raw);
        return options.control.exchange(r.body, {
          certificate_sha256: certificateHash(cert.raw),
          certificate_expires_at: Date.parse(x509.validTo),
        });
      },
    );
  await app.ready();
  return app;
}
