import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  deploymentIntentAccepted,
  deploymentIntentRequest,
  deploymentIntentView,
} from "./deployment-intents.js";

it("accepts reference-only deployment intake and refuses qualification/commands supplied by callers", () => {
  const request = {
    reservation_id: randomUUID(),
    dispatch_operation_id: randomUUID(),
    reservation_version: 2,
  };
  expect(deploymentIntentRequest.parse(request)).toEqual(request);
  for (const extra of [
    { qualified: true },
    { approval_hash: "a".repeat(64) },
    { execution_enabled: true },
    { command: { action: "provision" } },
    { image: "paper:latest" },
    { organization_id: randomUUID() },
  ])
    expect(() =>
      deploymentIntentRequest.parse({ ...request, ...extra }),
    ).toThrow();
  expect(() =>
    deploymentIntentRequest.parse({ ...request, reservation_version: 0 }),
  ).toThrow();
});
it("can only project a disabled pending intent and never accept ready/succeeded status", () => {
  const accepted = {
    operation_id: randomUUID(),
    deployment_id: randomUUID(),
    reservation_id: randomUUID(),
    state: "pending_qualification",
    effects: "none",
    execution_enabled: false,
  };
  expect(deploymentIntentAccepted.parse(accepted)).toEqual(accepted);
  for (const extra of [
    { state: "ready" },
    { state: "succeeded" },
    { effects: "provision" },
    { execution_enabled: true },
  ])
    expect(() =>
      deploymentIntentAccepted.parse({ ...accepted, ...extra }),
    ).toThrow();
  expect(
    deploymentIntentView.parse({
      ...accepted,
      project_id: randomUUID(),
      environment_id: randomUUID(),
      node_id: randomUUID(),
      server_id: randomUUID(),
      world_id: randomUUID(),
      created_at: new Date().toISOString(),
    }).execution_enabled,
  ).toBe(false);
});
