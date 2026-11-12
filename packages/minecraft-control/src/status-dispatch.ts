import {
  signedNodeStatusReportRequest,
  signedNodeStatusReportResponse,
} from "@craftlayer/contracts";
import { nodeDigest, nodeTimeWindow } from "@craftlayer/node-protocol";
import type { NodeControl } from "./nodes.js";
import type { ServerLive } from "./server-live.js";

/**
 * Master plan A2 and A4 (ADR 0046). The private gateway's side of live status:
 * authenticate the node exactly as a heartbeat is authenticated, then record what it
 * reports for a server it is bound to. The reply is signed and bound to the request.
 */
export class StatusDispatch {
  #nodes: Pick<NodeControl, "admit" | "sign">;
  #live: Pick<ServerLive, "recordNodeReport">;
  #now: () => number;
  constructor(options: {
    nodes: Pick<NodeControl, "admit" | "sign">;
    live: Pick<ServerLive, "recordNodeReport">;
    clock?: () => number;
  }) {
    this.#nodes = options.nodes;
    this.#live = options.live;
    this.#now = options.clock ?? Date.now;
  }
  async report(
    input: unknown,
    peer: { certificate_sha256: string; certificate_expires_at: number },
  ) {
    const signed = signedNodeStatusReportRequest.parse(input),
      v = signed.payload;
    await this.#nodes.admit(v, signed.signature, peer);
    await this.#live.recordNodeReport(v.organization_id, v.node_id, {
      server_id: v.server_id,
      power: v.power,
      online: v.online,
      max_players: v.max_players,
      players: v.players,
      allowed: v.allowed,
      knocks: v.knocks,
    });
    const payload = {
      schema_version: 1 as const,
      control_id: v.control_id,
      organization_id: v.organization_id,
      node_id: v.node_id,
      credential_version: v.credential_version,
      sequence: v.sequence,
      request_hash: nodeDigest(v),
      ...nodeTimeWindow(this.#now()),
      purpose: "node.status.ack.v1" as const,
      server_id: v.server_id,
    };
    return signedNodeStatusReportResponse.parse({
      payload,
      signature: this.#nodes.sign(payload),
    });
  }
}
