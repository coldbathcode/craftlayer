import { X509Certificate } from "node:crypto";
import { TLSSocket } from "node:tls";
import { AuthError } from "@craftlayer/auth";
import {
  deploymentJobView,
  signedNodeActionPollRequest,
  signedNodeActionPollResponse,
  signedNodeActionResultRequest,
  signedNodeActionResultResponse,
  signedNodeBackupPollRequest,
  signedNodeBackupPollResponse,
  signedNodeBackupResultRequest,
  signedNodeBackupResultResponse,
  signedNodeCommand,
  signedNodeCommandPermit,
  signedNodeCommandReceipt,
  signedNodeJobRequest,
  signedNodePollRequest,
  signedNodePollResponse,
  signedNodeRequest,
  signedNodeResponse,
} from "@craftlayer/contracts";
import type {
  ActionDispatch,
  BackupDispatch,
  DeploymentJobs,
  NodeControl,
} from "@craftlayer/minecraft-control";
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
  jobs?: Pick<DeploymentJobs, "exchange" | "recordReceipt" | "poll">;
  /** Typed server-action dispatch; absent unless the operator enables it. */
  actions?: Pick<ActionDispatch, "poll" | "result">;
  /** Backups taken by a bound node; absent unless the operator enables it. */
  backups?: Pick<BackupDispatch, "poll" | "result">;
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
  function peer(socket: unknown, cookie: unknown) {
    if (
      !(socket instanceof TLSSocket) ||
      !socket.authorized ||
      cookie !== undefined
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
    return {
      certificate_sha256: certificateHash(cert.raw),
      certificate_expires_at: Date.parse(new X509Certificate(cert.raw).validTo),
    };
  }
  const jobs = options.jobs;
  if (jobs) {
    app.post(
      "/node/v1/commands/poll",
      {
        schema: {
          body: signedNodePollRequest,
          response: { 200: signedNodePollResponse },
        },
      },
      (r) => jobs.poll(r.body, peer(r.raw.socket, r.headers.cookie)),
    );
    app.post(
      "/node/v1/commands/exchange",
      {
        schema: {
          body: signedNodeJobRequest,
          response: { 200: signedNodeCommand.or(signedNodeCommandPermit) },
        },
      },
      async (r) => {
        const connection = peer(r.raw.socket, r.headers.cookie),
          abort = new AbortController(),
          cancel = () => abort.abort();
        r.raw.once("aborted", cancel);
        try {
          return await jobs.exchange(r.body, connection, abort.signal);
        } finally {
          r.raw.off("aborted", cancel);
        }
      },
    );
    app.post(
      "/node/v1/commands/receipt",
      {
        schema: {
          body: signedNodeCommandReceipt,
          response: { 200: deploymentJobView },
        },
      },
      (r) => jobs.recordReceipt(r.body, peer(r.raw.socket, r.headers.cookie)),
    );
  }
  const actions = options.actions;
  if (actions) {
    app.post(
      "/node/v1/actions/poll",
      {
        schema: {
          body: signedNodeActionPollRequest,
          response: { 200: signedNodeActionPollResponse },
        },
      },
      (r) => actions.poll(r.body, peer(r.raw.socket, r.headers.cookie)),
    );
    app.post(
      "/node/v1/actions/result",
      {
        schema: {
          body: signedNodeActionResultRequest,
          response: { 200: signedNodeActionResultResponse },
        },
      },
      (r) => actions.result(r.body, peer(r.raw.socket, r.headers.cookie)),
    );
  }
  const backups = options.backups;
  if (backups) {
    app.post(
      "/node/v1/backups/poll",
      {
        schema: {
          body: signedNodeBackupPollRequest,
          response: { 200: signedNodeBackupPollResponse },
        },
      },
      (r) => backups.poll(r.body, peer(r.raw.socket, r.headers.cookie)),
    );
    app.post(
      "/node/v1/backups/result",
      {
        schema: {
          body: signedNodeBackupResultRequest,
          response: { 200: signedNodeBackupResultResponse },
        },
      },
      (r) => backups.result(r.body, peer(r.raw.socket, r.headers.cookie)),
    );
  }
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
