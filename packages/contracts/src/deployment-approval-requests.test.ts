import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  deploymentApprovalRequest,
  deploymentApprovalRequestView,
  deploymentReviewSnapshot,
} from "./deployment-approval-requests.js";

it("accepts an intent reference without caller approval or review assertions", () => {
  const request = { intent_id: randomUUID() };
  expect(deploymentApprovalRequest.parse(request)).toEqual(request);
  for (const extra of [
    { approval: true },
    { review_hash: "a".repeat(64) },
    { review: {} },
    { actor_id: randomUUID() },
    { execution_enabled: true },
  ])
    expect(() =>
      deploymentApprovalRequest.parse({ ...request, ...extra }),
    ).toThrow();
});
it("projects only bounded unverified review material and never an approved execution", () => {
  const review = {
      schema_version: 1,
      project_id: randomUUID(),
      environment_id: randomUUID(),
      node_id: randomUUID(),
      reservation_id: randomUUID(),
      deployment_id: randomUUID(),
      server_id: randomUUID(),
      world_id: randomUUID(),
      name: "Separate world",
      template_id: "family-survival-v1",
      plan_hash: "a".repeat(64),
      policy_hash: "b".repeat(64),
      template_hash: "c".repeat(64),
      node_version: 1,
      credential_version: 1,
      reservation_version: 2,
      cpu_milli: 2000,
      memory_mb: 6144,
      disk_mb: 20480,
      java_port: 25565,
      bedrock_port: 19132,
    },
    value = {
      operation_id: randomUUID(),
      intent_id: randomUUID(),
      review_hash: "d".repeat(64),
      review,
      state: "awaiting_review",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 300000).toISOString(),
      expired: false,
      execution_enabled: false,
      qualification: "unverified",
    };
  expect(deploymentApprovalRequestView.parse(value)).toEqual(value);
  for (const extra of [
    { state: "approved" },
    { execution_enabled: true },
    { qualification: "qualified" },
    { grants: [] },
  ])
    expect(() =>
      deploymentApprovalRequestView.parse({ ...value, ...extra }),
    ).toThrow();
  expect(() =>
    deploymentReviewSnapshot.parse({
      ...review,
      docker_socket: "/var/run/docker.sock",
    }),
  ).toThrow();
});
