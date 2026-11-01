import {
  agentCreate,
  agentView,
  approvalView,
  groupCreate,
  groupView,
  itemsSchema,
  missionCreate,
  missionView,
  stopRequest,
  stopView,
  templateCreate,
  templateView,
  workerCreate,
  workerEnrollment,
  workerView,
} from "@craftlayer/contracts";
import type { z } from "zod";
export interface RuntimeRequestOptions {
  method?: string;
  json?: unknown;
  organization?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}
export type RuntimeTransport = <T extends z.ZodType>(
  path: string,
  schema: T,
  options: RuntimeRequestOptions,
) => Promise<z.infer<T>>;
export function createRuntimeClient(send: RuntimeTransport) {
  return {
    approvals: (org: string, environment: string) =>
      send(
        `/api/v1/approvals?environment_id=${encodeURIComponent(environment)}`,
        itemsSchema(approvalView),
        { organization: org },
      ),
    decideApproval: (org: string, id: string, decision: "approve" | "reject") =>
      send(
        `/api/v1/approvals/${encodeURIComponent(id)}/decision`,
        approvalView,
        {
          method: "POST",
          json: { decision },
          organization: org,
        },
      ),
    missionControl: (
      org: string,
      id: string,
      command: "pause" | "cancel" | "resume",
      version: number,
      key: string,
    ) =>
      send(
        `/api/v1/missions/${encodeURIComponent(id)}/${command}`,
        missionView,
        {
          method: "POST",
          json: { expected_version: version },
          idempotencyKey: key,
          organization: org,
        },
      ),
    stop: (org: string, input: z.input<typeof stopRequest>) =>
      send("/api/v1/emergency-stop", stopView, {
        method: "POST",
        json: stopRequest.parse(input),
        organization: org,
      }),
    stopOperation: (org: string, id: string) =>
      send(`/api/v1/stop-operations/${encodeURIComponent(id)}`, stopView, {
        organization: org,
      }),
    clearStop: (org: string, id: string, epoch: number, reason: string) =>
      send(`/api/v1/emergency-stop/${encodeURIComponent(id)}/clear`, stopView, {
        method: "POST",
        json: { expected_epoch: epoch, reason },
        organization: org,
      }),
    enrollWorker: (org: string, input: z.input<typeof workerCreate>) =>
      send("/api/v1/workers", workerEnrollment, {
        method: "POST",
        json: workerCreate.parse(input),
        organization: org,
      }),
    workers: (org: string, env: string) =>
      send(
        `/api/v1/workers?environment_id=${encodeURIComponent(env)}`,
        itemsSchema(workerView),
        { organization: org },
      ),
    revokeWorker: (org: string, id: string, version: number) =>
      send(`/api/v1/workers/${encodeURIComponent(id)}/revoke`, workerView, {
        method: "POST",
        json: { expected_version: version },
        organization: org,
      }),
    createAgent: (org: string, input: z.input<typeof agentCreate>) =>
      send("/api/v1/agents", agentView, {
        method: "POST",
        json: agentCreate.parse(input),
        organization: org,
      }),
    agents: (org: string, environment: string) =>
      send(
        `/api/v1/agents?environment_id=${encodeURIComponent(environment)}`,
        itemsSchema(agentView),
        { organization: org },
      ),
    createGroup: (org: string, input: z.input<typeof groupCreate>) =>
      send("/api/v1/groups", groupView, {
        method: "POST",
        json: groupCreate.parse(input),
        organization: org,
      }),
    groups: (org: string, environment: string) =>
      send(
        `/api/v1/groups?environment_id=${encodeURIComponent(environment)}`,
        itemsSchema(groupView),
        { organization: org },
      ),
    createTemplate: (org: string, input: z.input<typeof templateCreate>) =>
      send("/api/v1/mission-templates", templateView, {
        method: "POST",
        json: templateCreate.parse(input),
        organization: org,
      }),
    templates: (org: string, environment: string) =>
      send(
        `/api/v1/mission-templates?environment_id=${encodeURIComponent(environment)}`,
        itemsSchema(templateView),
        { organization: org },
      ),
    createMission: (
      org: string,
      key: string,
      input: z.input<typeof missionCreate>,
    ) =>
      send("/api/v1/missions", missionView, {
        method: "POST",
        json: missionCreate.parse(input),
        organization: org,
        idempotencyKey: key,
      }),
    missions: (org: string, environment: string) =>
      send(
        `/api/v1/missions?environment_id=${encodeURIComponent(environment)}`,
        itemsSchema(missionView),
        { organization: org },
      ),
    mission: (org: string, id: string) =>
      send(`/api/v1/missions/${encodeURIComponent(id)}`, missionView, {
        organization: org,
      }),
    execute: (org: string, id: string, version: number, key: string) =>
      send(`/api/v1/missions/${encodeURIComponent(id)}/execute`, missionView, {
        method: "POST",
        json: { expected_version: version },
        organization: org,
        idempotencyKey: key,
      }),
  };
}
