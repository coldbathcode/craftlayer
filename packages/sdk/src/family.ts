import {
  type AgentTokenRequest,
  agentRequestPage,
  agentRequestView,
  agentTokenCreatedSchema,
  agentTokenSchema,
  type BackupPolicyInput,
  backupListView,
  backupPolicyView,
  backupRequestAccepted,
  backupStatusView,
  itemsSchema,
  knockAllowed,
  knockPage,
  knockView,
  okSchema,
  type ServerActionRequest,
  serverActionAccepted,
  serverActionPage,
  serverActionView,
  serverLiveView,
} from "@craftlayer/contracts";
import { identityRequest } from "./index.js";

/** Everything the family screens need (master plan B2 and B3): what the host reports,
 * asking to join, typed actions, backups and AI helpers. Every call goes through the
 * same API and permissions as any other client. */
export function familyClient(
  organization: string,
  csrf: string,
  signal?: AbortSignal,
) {
  const context = { organization, csrf, ...(signal ? { signal } : {}) };
  const server = (id: string, rest: string) =>
    `/api/v1/servers/${encodeURIComponent(id)}/${rest}`;
  const post = (key?: string, json?: unknown) => ({
    ...context,
    method: "POST",
    ...(json === undefined ? {} : { json }),
    ...(key ? { idempotencyKey: key } : {}),
  });
  return {
    live: (id: string) =>
      identityRequest(server(id, "live"), serverLiveView, context),
    knocks: (id: string) =>
      identityRequest(server(id, "knocks"), knockPage, context),
    allowKnock: (knock: string, key: string) =>
      identityRequest(
        `/api/v1/server-knocks/${encodeURIComponent(knock)}/allow`,
        knockAllowed,
        post(key),
      ),
    ignoreKnock: (knock: string) =>
      identityRequest(
        `/api/v1/server-knocks/${encodeURIComponent(knock)}/ignore`,
        knockView,
        post(),
      ),
    act: (id: string, action: ServerActionRequest, key: string) =>
      identityRequest(
        server(id, "actions"),
        serverActionAccepted,
        post(key, action),
      ),
    actions: (id: string) =>
      identityRequest(server(id, "actions"), serverActionPage, context),
    action: (action: string) =>
      identityRequest(
        `/api/v1/server-actions/${encodeURIComponent(action)}`,
        serverActionView,
        context,
      ),
    backupStatus: (id: string) =>
      identityRequest(server(id, "backup-status"), backupStatusView, context),
    backups: (id: string) =>
      identityRequest(server(id, "backups"), backupListView, context),
    backUpNow: (id: string, key: string) =>
      identityRequest(server(id, "backups"), backupRequestAccepted, post(key)),
    setBackupPolicy: (id: string, policy: BackupPolicyInput, key: string) =>
      identityRequest(server(id, "backup-policy"), backupPolicyView, {
        ...context,
        method: "PUT",
        json: policy,
        idempotencyKey: key,
      }),
    agentRequests: (id: string) =>
      identityRequest(server(id, "agent-requests"), agentRequestPage, context),
    decideAgentRequest: (request: string, decision: "approve" | "decline") =>
      identityRequest(
        `/api/v1/agent-requests/${encodeURIComponent(request)}/decide`,
        agentRequestView,
        post(undefined, { decision }),
      ),
    helpers: () =>
      identityRequest(
        "/api/v1/agent-tokens",
        itemsSchema(agentTokenSchema),
        context,
      ),
    connectHelper: (input: AgentTokenRequest) =>
      identityRequest(
        "/api/v1/agent-tokens",
        agentTokenCreatedSchema,
        post(undefined, input),
      ),
    revokeHelper: (id: string) =>
      identityRequest(
        `/api/v1/agent-tokens/${encodeURIComponent(id)}`,
        okSchema,
        { ...context, method: "DELETE" },
      ),
  };
}
