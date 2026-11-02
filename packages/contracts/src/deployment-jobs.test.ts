import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { deploymentJobRequest, nodeJobRequest } from "./deployment-jobs.js";

it("restricts human job preparation to an immutable intake reference", () => {
  const v = { intent_id: randomUUID() };
  expect(deploymentJobRequest.parse(v)).toEqual(v);
  for (const extra of [
    { approval: true },
    { image: "paper:latest" },
    { command: "start" },
    { organization_id: randomUUID() },
    { lease_ms: 3600000 },
  ])
    expect(() => deploymentJobRequest.parse({ ...v, ...extra })).toThrow();
});
it("separates signed fetch and fresh permit nonce purposes without accepting arbitrary verbs", () => {
  const v = {
    schema_version: 1,
    purpose: "node.command.fetch.v1",
    control_id: "a".repeat(64),
    organization_id: randomUUID(),
    project_id: randomUUID(),
    node_id: randomUUID(),
    credential_version: 1,
    request_id: randomUUID(),
    job_id: randomUUID(),
    command_hash: "b".repeat(64),
    permit_nonce: null,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 5000).toISOString(),
  };
  expect(nodeJobRequest.parse(v)).toEqual(v);
  expect(() =>
    nodeJobRequest.parse({ ...v, purpose: "node.command.permit.request.v1" }),
  ).toThrow();
  expect(() =>
    nodeJobRequest.parse({ ...v, permit_nonce: randomUUID() }),
  ).toThrow();
  expect(() =>
    nodeJobRequest.parse({ ...v, purpose: "node.exec.v1", shell: "rm" }),
  ).toThrow();
  expect(
    nodeJobRequest.parse({
      ...v,
      purpose: "node.command.permit.request.v1",
      permit_nonce: randomUUID(),
    }).purpose,
  ).toBe("node.command.permit.request.v1");
});
