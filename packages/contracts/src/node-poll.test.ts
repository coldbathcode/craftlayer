import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { nodePollRequest, nodePollResponse } from "./node-poll.js";

const scope = () => ({
  schema_version: 1,
  control_id: "a".repeat(64),
  organization_id: randomUUID(),
  project_id: randomUUID(),
  node_id: randomUUID(),
  credential_version: 1,
  issued_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 5000).toISOString(),
});
it("limits polling to a signed scope/nonce without caller command or approval assertions", () => {
  const v = {
    ...scope(),
    purpose: "node.command.poll.v1",
    request_id: randomUUID(),
  };
  expect(nodePollRequest.parse(v)).toEqual(v);
  for (const extra of [
    { command: "start" },
    { approval: true },
    { job_id: randomUUID() },
    { purpose: "node.command.fetch.v1" },
  ])
    expect(() => nodePollRequest.parse({ ...v, ...extra })).toThrow();
});
it("limits discovery to one redacted reference rather than commands, credentials or readiness", () => {
  const job = {
      operation_id: randomUUID(),
      command_hash: "b".repeat(64),
      expires_at: new Date().toISOString(),
    },
    v = {
      ...scope(),
      purpose: "node.command.poll.response.v1",
      request_hash: "c".repeat(64),
      jobs: [job],
    };
  expect(nodePollResponse.parse(v)).toEqual(v);
  for (const extra of [
    { jobs: [job, job] },
    { jobs: [{ ...job, command: {} }] },
    { grant: {} },
    { ready: true },
  ])
    expect(() => nodePollResponse.parse({ ...v, ...extra })).toThrow();
});
