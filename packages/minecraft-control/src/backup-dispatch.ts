import {
  signedNodeBackupPollRequest,
  signedNodeBackupPollResponse,
  signedNodeBackupPrunedRequest,
  signedNodeBackupPrunedResponse,
  signedNodeBackupPruneRequest,
  signedNodeBackupPruneResponse,
  signedNodeBackupResultRequest,
  signedNodeBackupResultResponse,
} from "@craftlayer/contracts";
import { nodeDigest, nodeTimeWindow } from "@craftlayer/node-protocol";
import type { BackupRecords } from "./backup-records.js";
import type { NodeControl } from "./nodes.js";

/**
 * Master plan D1 (ADR 0045). The private gateway's side of backups: authenticate the
 * node exactly as a heartbeat is authenticated, then hand it at most one backup for a
 * server it is bound to, or record the hashes it reports. Every reply is signed with
 * the control key and bound to the request it answers. This class holds no identity
 * service; people set the policy and press "Back up now" through the API.
 */
export class BackupDispatch {
  #nodes: Pick<NodeControl, "admit" | "sign">;
  #backups: Pick<
    BackupRecords,
    | "claimForNode"
    | "recordNodeResult"
    | "expireStale"
    | "expiredForNode"
    | "recordArchiveRemoved"
  >;
  #now: () => number;
  constructor(options: {
    nodes: Pick<NodeControl, "admit" | "sign">;
    backups: Pick<
      BackupRecords,
      | "claimForNode"
      | "recordNodeResult"
      | "expireStale"
      | "expiredForNode"
      | "recordArchiveRemoved"
    >;
    clock?: () => number;
  }) {
    this.#nodes = options.nodes;
    this.#backups = options.backups;
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
    const signed = signedNodeBackupPollRequest.parse(input),
      v = signed.payload;
    await this.#nodes.admit(v, signed.signature, peer);
    await this.#backups.expireStale(v.organization_id);
    const backup = await this.#backups.claimForNode(
      v.organization_id,
      v.node_id,
      v.server_ids,
    );
    return signedNodeBackupPollResponse.parse(
      this.#reply(v, { purpose: "node.backups.offer.v1" as const, backup }),
    );
  }
  async result(
    input: unknown,
    peer: { certificate_sha256: string; certificate_expires_at: number },
  ) {
    const signed = signedNodeBackupResultRequest.parse(input),
      v = signed.payload;
    await this.#nodes.admit(v, signed.signature, peer);
    const state = await this.#backups.recordNodeResult(
      v.organization_id,
      v.node_id,
      {
        occurrence_id: v.occurrence_id,
        server_id: v.server_id,
        outcome: v.outcome,
      },
    );
    return signedNodeBackupResultResponse.parse(
      this.#reply(v, {
        purpose: "node.backups.ack.v1" as const,
        occurrence_id: v.occurrence_id,
        state,
      }),
    );
  }
  /** Which old archives this node may delete now. */
  async prune(
    input: unknown,
    peer: { certificate_sha256: string; certificate_expires_at: number },
  ) {
    const signed = signedNodeBackupPruneRequest.parse(input),
      v = signed.payload;
    await this.#nodes.admit(v, signed.signature, peer);
    const expired = await this.#backups.expiredForNode(
      v.organization_id,
      v.node_id,
      v.server_ids,
    );
    return signedNodeBackupPruneResponse.parse(
      this.#reply(v, {
        purpose: "node.backups.prune.offer.v1" as const,
        expired,
      }),
    );
  }
  async pruned(
    input: unknown,
    peer: { certificate_sha256: string; certificate_expires_at: number },
  ) {
    const signed = signedNodeBackupPrunedRequest.parse(input),
      v = signed.payload;
    await this.#nodes.admit(v, signed.signature, peer);
    await this.#backups.recordArchiveRemoved(v.organization_id, v.node_id, {
      backup_id: v.backup_id,
      server_id: v.server_id,
      occurrence_id: v.occurrence_id,
    });
    return signedNodeBackupPrunedResponse.parse(
      this.#reply(v, {
        purpose: "node.backups.prune.ack.v1" as const,
        backup_id: v.backup_id,
      }),
    );
  }
}
