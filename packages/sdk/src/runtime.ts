import {
  agentCreate,
  agentView,
  groupCreate,
  groupView,
  itemsSchema,
  missionCreate,
  missionView,
  templateCreate,
  templateView,
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
