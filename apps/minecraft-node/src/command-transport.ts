import { randomUUID } from "node:crypto";
import {
  type NodeCommand,
  type NodeExecutionPolicy,
  nodeCommand,
  nodeExecutionPolicy,
  type SignedNodeCommandReceipt,
  signedNodeCommand,
  signedNodeCommandPermit,
  signedNodeCommandReceipt,
} from "@craftlayer/contracts";
import { nodeDigest, nodePrivateKey } from "@craftlayer/node-protocol";
import { type NodeConnection, NodeTransport } from "./client.js";
import type { ExecutionAuthority } from "./executor.js";
/** Outbound fixed RPCs only. Not wired to the inventory CLI or an environment enable switch. */
export class CommandTransport implements ExecutionAuthority {
  #policy: NodeExecutionPolicy;
  #transport: NodeTransport;
  constructor(options: { connection: NodeConnection; policy: unknown }) {
    this.#policy = nodeExecutionPolicy.parse(options.policy);
    if (
      !this.#policy.enabled ||
      options.connection.control_public_key !==
        this.#policy.control_public_key ||
      nodePrivateKey(options.connection.private_key).public_key !==
        this.#policy.node_public_key ||
      nodeDigest(this.#policy.control_public_key) !== this.#policy.control_id
    )
      throw new Error("NODE_COMMAND_CONNECTION_BINDING_DENIED");
    this.#transport = new NodeTransport(options.connection);
  }
  #command(input: Readonly<NodeCommand>) {
    const v = nodeCommand.parse(input),
      p = this.#policy;
    for (const key of [
      "organization_id",
      "project_id",
      "node_id",
      "credential_version",
      "control_id",
      "policy_revision",
      "policy_hash",
    ] as const) {
      if (v[key] !== p[key]) throw new Error("NODE_COMMAND_SCOPE_DENIED");
    }
    if (!p.allowed_actions.includes(v.action))
      throw new Error("NODE_COMMAND_ACTION_DENIED");
    return v;
  }
  #request(job: string, hash: string, nonce: string | null) {
    const p = this.#policy,
      now = Date.now();
    return {
      schema_version: 1 as const,
      purpose:
        nonce === null
          ? ("node.command.fetch.v1" as const)
          : ("node.command.permit.request.v1" as const),
      control_id: p.control_id,
      organization_id: p.organization_id,
      project_id: p.project_id,
      node_id: p.node_id,
      credential_version: p.credential_version,
      request_id: randomUUID(),
      job_id: job,
      command_hash: hash,
      permit_nonce: nonce,
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + 5000).toISOString(),
    };
  }
  async fetch(job: string, hash: string, signal?: AbortSignal) {
    const signed = signedNodeCommand.parse(
      await this.#transport.job(this.#request(job, hash, null), signal),
    );
    this.#command(signed.payload);
    return signed;
  }
  poll(signal?: AbortSignal) {
    const p = this.#policy,
      now = Date.now();
    return this.#transport.poll(
      {
        schema_version: 1,
        purpose: "node.command.poll.v1",
        control_id: p.control_id,
        organization_id: p.organization_id,
        project_id: p.project_id,
        node_id: p.node_id,
        credential_version: p.credential_version,
        request_id: randomUUID(),
        issued_at: new Date(now).toISOString(),
        expires_at: new Date(now + 5000).toISOString(),
      },
      signal,
    );
  }
  async authorize(
    command: Readonly<NodeCommand>,
    nonce: string,
    signal: AbortSignal,
  ) {
    const v = this.#command(command);
    return signedNodeCommandPermit.parse(
      await this.#transport.job(
        this.#request(v.operation_id, nodeDigest(v), nonce),
        signal,
      ),
    );
  }
  submitReceipt(input: SignedNodeCommandReceipt, signal?: AbortSignal) {
    const receipt = signedNodeCommandReceipt.parse(input),
      v = receipt.payload,
      p = this.#policy;
    for (const key of [
      "organization_id",
      "project_id",
      "node_id",
      "credential_version",
      "control_id",
    ] as const)
      if (v[key] !== p[key]) throw new Error("NODE_RECEIPT_SCOPE_DENIED");
    return this.#transport.submitReceipt(receipt, signal);
  }
}
