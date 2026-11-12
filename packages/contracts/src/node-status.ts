import { z } from "zod";
import { nodeHash } from "./nodes.js";
import { gamePlayerName, serverActionAccepted } from "./server-actions.js";

/** What a bound node sees of its server right now, carried over the private mTLS
 * transport (master plan A2 and A4, ADR 0046): whether it is on, who is playing, and
 * who was refused at the door. The node reports; the controller only records. */
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const accountUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const serverPower = z.enum(["on", "off", "starting", "unknown"]);
/** One refused join attempt, as the Knock plugin recorded it (ADR 0037). */
export const nodeKnock = z
  .strictObject({
    account_uuid: accountUuid,
    name: z.string().regex(/^[\x20-\x7e]{1,64}$/),
    edition: z.enum(["bedrock", "java"]),
    /** Derived by the node from the account UUID itself; never typed by anyone. */
    xuid: z
      .string()
      .regex(/^[0-9]{1,20}$/)
      .nullable(),
    first_at: z.iso.datetime(),
    last_at: z.iso.datetime(),
    attempts: z.number().int().min(1).max(100000),
  })
  .refine(
    (v) => (v.edition === "bedrock") === (v.xuid !== null),
    "Only Bedrock accounts carry an Xbox account number",
  );
export const nodeStatusReportRequest = z.strictObject({
  schema_version: z.literal(1),
  control_id: nodeHash,
  organization_id: z.uuid(),
  node_id: z.uuid(),
  credential_version: z.number().int().positive().max(2147483646),
  sequence: z.number().int().min(1).max(2147483646),
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  purpose: z.literal("node.status.report.v1"),
  server_id: z.uuid(),
  power: serverPower,
  /** Null unless the server itself answered. */
  online: z.number().int().min(0).max(10000).nullable(),
  max_players: z.number().int().min(0).max(10000).nullable(),
  players: z.array(gamePlayerName).max(100).nullable(),
  /** Names on the server's allowlist file, or null when the node could not read it. */
  allowed: z.array(gamePlayerName).max(200).nullable(),
  knocks: z.array(nodeKnock).max(20),
});
export const nodeStatusReportResponse = z.strictObject({
  schema_version: z.literal(1),
  control_id: nodeHash,
  organization_id: z.uuid(),
  node_id: z.uuid(),
  credential_version: z.number().int().positive(),
  sequence: z.number().int().positive(),
  request_hash: nodeHash,
  issued_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  purpose: z.literal("node.status.ack.v1"),
  server_id: z.uuid(),
});
export const signedNodeStatusReportRequest = z.strictObject({
  payload: nodeStatusReportRequest,
  signature,
});
export const signedNodeStatusReportResponse = z.strictObject({
  payload: nodeStatusReportResponse,
  signature,
});
/** What people see. `fresh` is false when the host has not reported recently: the
 * values are then the last ones known, not the present. */
export const serverLiveView = z.strictObject({
  server_id: z.uuid(),
  /** True when a host looks after this server; without one nothing is ever reported. */
  host_bound: z.boolean(),
  power: serverPower,
  fresh: z.boolean(),
  reported_at: z.iso.datetime().nullable(),
  online: z.number().int().min(0).max(10000).nullable(),
  max_players: z.number().int().min(0).max(10000).nullable(),
  players: z.array(gamePlayerName).max(100).nullable(),
  /** Who can join, as the host last read the allowlist; null when it never has. */
  allowed: z.array(gamePlayerName).max(200).nullable(),
});
/** Someone asking to join. Account numbers are never shown. */
export const knockView = z.strictObject({
  id: z.uuid(),
  server_id: z.uuid(),
  name: z.string().max(64),
  edition: z.enum(["bedrock", "java"]),
  first_at: z.iso.datetime(),
  last_at: z.iso.datetime(),
  attempts: z.number().int().positive(),
  state: z.enum(["asking", "allowed", "ignored"]),
  can_decide: z.boolean(),
});
export const knockPage = z.strictObject({
  server_id: z.uuid(),
  items: z.array(knockView).max(50),
});
export const knockAllowed = z.strictObject({
  knock: knockView,
  action: serverActionAccepted,
});
export type NodeStatusReportRequest = z.infer<typeof nodeStatusReportRequest>;
export type NodeKnock = z.infer<typeof nodeKnock>;
export type ServerPower = z.infer<typeof serverPower>;
export type ServerLiveView = z.infer<typeof serverLiveView>;
export type KnockView = z.infer<typeof knockView>;
