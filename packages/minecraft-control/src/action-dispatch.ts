import {
  signedNodeActionPollRequest,
  signedNodeActionPollResponse,
  signedNodeActionResultRequest,
  signedNodeActionResultResponse,
} from "@craftlayer/contracts";
import { nodeDigest, nodeTimeWindow } from "@craftlayer/node-protocol";
import type { NodeControl } from "./nodes.js";
import type { ServerActions } from "./server-actions.js";

/**
 * Master plan A2 (ADR 0044). The private gateway's side of server-action dispatch:
 * authenticate the node exactly as a heartbeat is authenticated, then hand it at most
 * one typed action for a server it is bound to, or record its answer. Every reply is
 * signed with the control key and bound to the request it answers. This class holds no
 * identity service and cannot create an action; people do that through the API.
 */
export class ActionDispatch {
  #nodes: Pick<NodeControl, "admit" | "sign">;
  #actions: Pick<
    ServerActions,
    "claimForNode" | "recordNodeResult" | "expireStale"
  >;
  #now: () => number;
  constructor(options: {
    nodes: Pick<NodeControl, "admit" | "sign">;
    actions: Pick<
      ServerActions,
      "claimForNode" | "recordNodeResult" | "expireStale"
    >;
    clock?: () => number;
  }) {
    this.#nodes = options.nodes;
    this.#actions = options.actions;
    this.#now = options.clock ?? Date.now;
  }
  #reply<T extends Record<string, unknown>>(
    request: {
      control_id: string;
      organization_id: string;
      node_id: string;
      credential_version: number;
      sequence: number;
    },
    extra: T,
  ) {
    const payload = {
      schema_version: 1 as const,
      control_id: request.control_id,
      organization_id: request.organization_id,
      node_id: request.node_id,
      credential_version: request.credential_version,
      sequence: request.sequence,
      request_hash: nodeDigest(request),
      ...nodeTimeWindow(this.#now()),
      ...extra,
    };
    return { payload, signature: this.#nodes.sign(payload) };
  }
  async poll(
    input: unknown,
    peer: { certificate_sha256: string; certificate_expires_at: number },
  ) {
    const signed = signedNodeActionPollRequest.parse(input),
      v = signed.payload;
    await this.#nodes.admit(v, signed.signature, peer);
    await this.#actions.expireStale(v.organization_id);
    const action = await this.#actions.claimForNode(
      v.organization_id,
      v.node_id,
      v.server_ids,
    );
    return signedNodeActionPollResponse.parse(
      this.#reply(v, { purpose: "node.actions.offer.v1" as const, action }),
    );
  }
  async result(
    input: unknown,
    peer: { certificate_sha256: string; certificate_expires_at: number },
  ) {
    const signed = signedNodeActionResultRequest.parse(input),
      v = signed.payload;
    await this.#nodes.admit(v, signed.signature, peer);
    const state = await this.#actions.recordNodeResult(
      v.organization_id,
      v.node_id,
      {
        action_id: v.action_id,
        server_id: v.server_id,
        fence: v.fence,
        outcome: v.outcome,
        failure: v.failure,
      },
    );
    return signedNodeActionResultResponse.parse(
      this.#reply(v, {
        purpose: "node.actions.ack.v1" as const,
        action_id: v.action_id,
        state,
      }),
    );
  }
}
