import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { AuthError, type ExecutionGrant } from "@craftlayer/auth";
import {
  executionAuthorityRequest,
  signedExecutionAuthorityProof,
} from "@craftlayer/contracts";
import {
  assertNodeTime,
  certificateHash,
  nodeDigest,
  nodePrivateKey,
  privateNodeAddress,
  signNodeValue,
  verifyNodeValue,
} from "@craftlayer/node-protocol";
import type {
  DeploymentAuthorizer,
  DeploymentPrincipal,
} from "./execution-authorizer.js";
/** Gateway-side current-authority client. No identity DB/CSRF/user cookie secret. */
export class RemoteDeploymentAuthorizer implements DeploymentAuthorizer {
  #url: URL;
  #public: string;
  constructor(
    private readonly options: {
      url: string;
      ca: string;
      cert: string;
      key: string;
      serverCertificateSha256: string;
      authorityPublicKey: string;
      controlPrivateKey: string;
    },
  ) {
    this.#url = new URL(options.url);
    if (
      this.#url.protocol !== "https:" ||
      !privateNodeAddress(this.#url.hostname.replace(/^\[|\]$/g, "")) ||
      this.#url.pathname !== "/" ||
      this.#url.search ||
      this.#url.hash ||
      this.#url.username ||
      this.#url.password
    )
      throw new Error("PRIVATE_AUTHORITY_REQUIRED");
    this.#public = nodePrivateKey(options.controlPrivateKey).public_key;
    if (this.#public === options.authorityPublicKey)
      throw new Error("AUTHORITY_SEPARATE_SIGNING_KEY_REQUIRED");
  }
  async guardExecutions<T>(
    grants: readonly ExecutionGrant[],
    operation: (p: DeploymentPrincipal) => Promise<T>,
  ): Promise<T> {
    const first = grants[0];
    if (grants.length !== 2 || !first)
      throw new AuthError(
        403,
        "DEPLOYMENT_AUTHORITY_DENIED",
        "Current deployment authority denied.",
      );
    const now = Date.now(),
      payload = executionAuthorityRequest.parse({
        schema_version: 1,
        purpose: "identity.execution.check.v1",
        control_id: nodeDigest(this.#public),
        organization_id: first.organizationId,
        request_nonce: randomUUID(),
        grants_hash: nodeDigest(grants),
        issued_at: new Date(now).toISOString(),
        expires_at: new Date(now + 5000).toISOString(),
      }),
      body = JSON.stringify({
        payload,
        grants,
        signature: signNodeValue(payload, this.options.controlPrivateKey),
      });
    if (Buffer.byteLength(body) > 16384)
      throw new AuthError(
        403,
        "DEPLOYMENT_AUTHORITY_DENIED",
        "Current deployment authority denied.",
      );
    let principal: DeploymentPrincipal;
    try {
      const raw = await new Promise<unknown>((resolve, reject) => {
          const req = request(
            new URL("/internal/v1/execution-authority", this.#url),
            {
              method: "POST",
              agent: false,
              ca: this.options.ca,
              cert: this.options.cert,
              key: this.options.key,
              minVersion: "TLSv1.3",
              maxVersion: "TLSv1.3",
              rejectUnauthorized: true,
              timeout: 3000,
              checkServerIdentity: (host, cert) =>
                checkServerIdentity(host, cert) ??
                (certificateHash(cert.raw) !==
                this.options.serverCertificateSha256
                  ? new Error("AUTHORITY_PIN_DENIED")
                  : undefined),
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              },
            },
            (res) => {
              const chunks: Buffer[] = [];
              let size = 0;
              res.on("data", (b: Buffer) => {
                size += b.length;
                if (size > 8192)
                  req.destroy(new Error("AUTHORITY_RESPONSE_LIMIT"));
                else chunks.push(b);
              });
              res.once("error", reject);
              res.once("end", () => {
                try {
                  if (res.statusCode !== 200) throw new Error("DENIED");
                  resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                } catch {
                  reject(new Error("AUTHORITY_RESPONSE_DENIED"));
                }
              });
            },
          );
          const timer = setTimeout(
            () => req.destroy(new Error("AUTHORITY_DEADLINE")),
            3000,
          );
          req.once("close", () => clearTimeout(timer));
          req.once("timeout", () => req.destroy());
          req.once("error", reject);
          req.end(body);
        }),
        signed = signedExecutionAuthorityProof.parse(raw),
        v = signed.payload,
        time = Date.now();
      assertNodeTime(v.issued_at, v.expires_at, time);
      if (
        Date.parse(v.issued_at) > time ||
        Date.parse(v.expires_at) - Date.parse(v.issued_at) > 2000 ||
        v.authority_id !== nodeDigest(this.options.authorityPublicKey) ||
        !verifyNodeValue(
          v,
          signed.signature,
          this.options.authorityPublicKey,
        ) ||
        v.control_id !== payload.control_id ||
        v.organization_id !== payload.organization_id ||
        v.request_nonce !== payload.request_nonce ||
        v.grants_hash !== payload.grants_hash ||
        v.user_id !== first.userId ||
        v.session_id !== first.sessionId ||
        v.user_version !== first.userVersion ||
        Date.parse(v.authority_expires_at) <= time
      )
        throw new Error("DENIED");
      principal = {
        user: { id: v.user_id, account_type: v.account_type },
        sessionId: v.session_id,
        userVersion: v.user_version,
        authorityExpiresAt: Date.parse(v.authority_expires_at),
        validatedUntil: Date.parse(v.expires_at),
      };
    } catch {
      throw new AuthError(
        503,
        "DEPLOYMENT_AUTHORITY_UNAVAILABLE",
        "Current deployment authority unavailable; values omitted.",
      );
    }
    // No network or identity transaction remains open while controller SQL executes.
    return operation(principal);
  }
}
