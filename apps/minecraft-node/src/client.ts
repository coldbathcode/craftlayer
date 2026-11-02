import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import {
  type NodeAgentRequest,
  nodeAgentRequest,
  signedNodeResponse,
} from "@craftlayer/contracts";
import {
  assertNodeTime,
  certificateHash,
  nodeDigest,
  privateNodeAddress,
  signNodeValue,
  verifyNodeValue,
} from "@craftlayer/node-protocol";
export function privateController(value: string) {
  const url = new URL(value),
    host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !privateNodeAddress(host) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("PRIVATE_HTTPS_CONTROLLER_REQUIRED");
  return url;
}
export interface NodeConnection {
  url: string;
  ca: string;
  cert: string;
  key: string;
  server_certificate_sha256: string;
  control_public_key: string;
  private_key: string;
}
export class NodeTransportFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
export class NodeTransport {
  constructor(private readonly config: NodeConnection) {
    privateController(config.url);
  }
  async send(input: NodeAgentRequest) {
    const payload = nodeAgentRequest.parse(input),
      body = JSON.stringify({
        payload,
        signature: signNodeValue(payload, this.config.private_key),
      }),
      url = new URL(
        payload.purpose === "node.enroll.v1"
          ? "/node/v1/enroll"
          : "/node/v1/heartbeat",
        this.config.url,
      );
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "POST",
          ca: this.config.ca,
          cert: this.config.cert,
          key: this.config.key,
          minVersion: "TLSv1.3",
          maxVersion: "TLSv1.3",
          rejectUnauthorized: true,
          agent: false,
          timeout: 3000,
          checkServerIdentity: (host, cert) => {
            const e = checkServerIdentity(host, cert);
            if (e) return e;
            if (
              certificateHash(cert.raw) !==
              this.config.server_certificate_sha256
            )
              return new Error("NODE_SERVER_CERTIFICATE_MISMATCH");
            return undefined;
          },
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let count = 0;
          res.on("data", (b: Buffer) => {
            count += b.length;
            if (count > 16384) {
              req.destroy(new Error("NODE_RESPONSE_LIMIT"));
              return;
            }
            chunks.push(b);
          });
          res.on("error", reject);
          res.on("end", () => {
            try {
              const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (res.statusCode !== 200) {
                const e = new NodeTransportFailure(
                  res.statusCode === 409 &&
                    result?.error?.code === "NODE_ALREADY_ENROLLED"
                    ? "NODE_ALREADY_ENROLLED"
                    : "NODE_REQUEST_DENIED",
                  res.statusCode === 429 || (res.statusCode ?? 500) >= 500,
                );
                reject(e);
              } else resolve(result);
            } catch {
              reject(new Error("NODE_RESPONSE_DENIED"));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy());
      const deadline = setTimeout(
        () => req.destroy(new Error("NODE_TRANSPORT_DEADLINE")),
        3000,
      );
      req.once("close", () => clearTimeout(deadline));
      req.on("error", (e) =>
        reject(
          new NodeTransportFailure(
            "NODE_TRANSPORT_UNAVAILABLE",
            !(
              e.message.includes("CERT") ||
              e.message.includes("certificate") ||
              e.message.includes("NODE_SERVER_CERTIFICATE_MISMATCH")
            ),
          ),
        ),
      );
      req.end(body);
    });
    const response = signedNodeResponse.parse(raw),
      v = response.payload;
    assertNodeTime(v.issued_at, v.expires_at, Date.now());
    if (
      !verifyNodeValue(v, response.signature, this.config.control_public_key) ||
      v.control_id !== nodeDigest(this.config.control_public_key) ||
      v.request_hash !== nodeDigest(payload) ||
      v.organization_id !== payload.organization_id ||
      v.node_id !== payload.node_id ||
      v.credential_version !== payload.credential_version ||
      v.sequence !== payload.sequence
    )
      throw new Error("NODE_RESPONSE_BINDING_DENIED");
    return v;
  }
}
