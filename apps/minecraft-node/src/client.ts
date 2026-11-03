import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import {
  deploymentJobView,
  type NodeAgentRequest,
  type NodeJobRequest,
  type NodePollRequest,
  nodeAgentRequest,
  nodeJobRequest,
  nodePollRequest,
  type SignedNodeCommandReceipt,
  signedNodeCommand,
  signedNodeCommandPermit,
  signedNodeCommandReceipt,
  signedNodePollResponse,
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
    const raw = await this.#post(
      url.pathname as "/node/v1/enroll" | "/node/v1/heartbeat",
      body,
    );
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
  async #post(
    path:
      | "/node/v1/enroll"
      | "/node/v1/heartbeat"
      | "/node/v1/commands/exchange"
      | "/node/v1/commands/receipt"
      | "/node/v1/commands/poll",
    body: string,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted)
      throw new NodeTransportFailure("NODE_TRANSPORT_ABORTED", false);
    const url = new URL(path, this.config.url);
    return new Promise<unknown>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "POST",
          ...(signal ? { signal } : {}),
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
  }
  async poll(input: NodePollRequest, signal?: AbortSignal) {
    const payload = nodePollRequest.parse(input);
    try {
      const raw = await this.#post(
          "/node/v1/commands/poll",
          JSON.stringify({
            payload,
            signature: signNodeValue(payload, this.config.private_key),
          }),
          signal,
        ),
        signed = signedNodePollResponse.parse(raw),
        v = signed.payload,
        now = Date.now();
      assertNodeTime(v.issued_at, v.expires_at, now);
      if (
        Date.parse(v.issued_at) > now ||
        Date.parse(v.expires_at) - Date.parse(v.issued_at) > 5000 ||
        Date.parse(v.expires_at) > Date.parse(payload.expires_at) ||
        v.request_hash !== nodeDigest(payload) ||
        !verifyNodeValue(v, signed.signature, this.config.control_public_key)
      )
        throw new Error("DENIED");
      for (const key of [
        "organization_id",
        "project_id",
        "node_id",
        "credential_version",
        "control_id",
      ] as const)
        if (v[key] !== payload[key]) throw new Error("DENIED");
      if (
        v.control_id !== nodeDigest(this.config.control_public_key) ||
        v.jobs.some(
          (j) =>
            Date.parse(j.expires_at) <= now ||
            Date.parse(v.expires_at) > Date.parse(j.expires_at),
        )
      )
        throw new Error("DENIED");
      return v;
    } catch {
      throw new NodeTransportFailure(
        "NODE_POLL_RESPONSE_UNAVAILABLE_OR_DENIED",
        false,
      );
    }
  }
  /** Separate private command library only; inventory entrypoint never calls these methods. */
  async job(input: NodeJobRequest, signal?: AbortSignal) {
    const payload = nodeJobRequest.parse(input);
    try {
      const raw = await this.#post(
          "/node/v1/commands/exchange",
          JSON.stringify({
            payload,
            signature: signNodeValue(payload, this.config.private_key),
          }),
          signal,
        ),
        response =
          payload.purpose === "node.command.fetch.v1"
            ? signedNodeCommand.parse(raw)
            : signedNodeCommandPermit.parse(raw),
        v = response.payload;
      assertNodeTime(v.issued_at, v.expires_at, Date.now());
      if (
        Date.parse(v.issued_at) > Date.now() ||
        !verifyNodeValue(
          v,
          response.signature,
          this.config.control_public_key,
        ) ||
        v.control_id !== nodeDigest(this.config.control_public_key) ||
        v.organization_id !== payload.organization_id ||
        v.project_id !== payload.project_id ||
        v.node_id !== payload.node_id ||
        v.credential_version !== payload.credential_version
      )
        throw new Error("DENIED");
      if (v.purpose === "node.command.v1") {
        if (
          v.operation_id !== payload.job_id ||
          nodeDigest(v) !== payload.command_hash
        )
          throw new Error("DENIED");
      } else if (
        v.command_hash !== payload.command_hash ||
        v.request_nonce !== payload.permit_nonce
      )
        throw new Error("DENIED");
      return response;
    } catch {
      throw new NodeTransportFailure(
        "NODE_COMMAND_RESPONSE_UNAVAILABLE_OR_DENIED",
        false,
      );
    }
  }
  async submitReceipt(input: SignedNodeCommandReceipt, signal?: AbortSignal) {
    const receipt = signedNodeCommandReceipt.parse(input),
      v = receipt.payload;
    try {
      const view = deploymentJobView.parse(
        await this.#post(
          "/node/v1/commands/receipt",
          JSON.stringify(receipt),
          signal,
        ),
      );
      if (
        view.operation_id !== v.operation_id ||
        view.command_hash !== v.command_hash ||
        view.deployment_id !== v.deployment_id ||
        view.server_id !== v.server_id ||
        view.world_id !== v.world_id ||
        view.project_id !== v.project_id ||
        view.node_id !== v.node_id ||
        view.receipt_state !== v.state ||
        (view.state !== v.state && view.state !== "uncertain")
      )
        throw new Error("DENIED");
      return view;
    } catch {
      throw new NodeTransportFailure(
        "NODE_RECEIPT_ACK_UNAVAILABLE_OR_DENIED",
        false,
      );
    }
  }
}
