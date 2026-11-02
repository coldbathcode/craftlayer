import { randomUUID } from "node:crypto";
import type { NodeExecutionPolicy } from "@craftlayer/contracts";
import { generateNodeKey, nodeDigest } from "@craftlayer/node-protocol";
import { expect, it } from "vitest";
import { CommandTransport } from "./command-transport.js";
import { brokerFixture } from "./testing/broker.fixture.js";

function fixture() {
  const f = brokerFixture(),
    control = generateNodeKey(),
    agent = generateNodeKey(),
    policy: NodeExecutionPolicy = {
      schema_version: 1,
      organization_id: f.job.organization_id,
      project_id: f.job.project_id,
      node_id: f.job.node_id,
      credential_version: 1,
      control_id: nodeDigest(control.public_key),
      control_public_key: control.public_key,
      node_public_key: agent.public_key,
      policy_revision: 1,
      policy_hash: f.job.policy_hash,
      enabled: true,
      allowed_actions: ["provision"],
    };
  return {
    ...f,
    policy,
    connection: {
      url: "https://127.0.0.1:9443/",
      ca: "",
      cert: "",
      key: "",
      server_certificate_sha256: "a".repeat(64),
      control_public_key: control.public_key,
      private_key: agent.private_key,
    },
  };
}
it("requires explicit local execution policy and exact private/control key bindings", () => {
  const f = fixture();
  expect(() => new CommandTransport(f)).not.toThrow();
  for (const changes of [
    { policy: { ...f.policy, enabled: false } },
    {
      connection: {
        ...f.connection,
        private_key: generateNodeKey().private_key,
      },
    },
    {
      connection: {
        ...f.connection,
        control_public_key: generateNodeKey().public_key,
      },
    },
    { connection: { ...f.connection, url: "https://example.com/" } },
  ])
    expect(() => new CommandTransport({ ...f, ...changes })).toThrow();
});
it("denies foreign scope/action before attempting any network request", async () => {
  const f = fixture(),
    transport = new CommandTransport(f),
    job = { ...f.job, control_id: f.policy.control_id };
  await expect(
    transport.authorize(
      { ...job, node_id: randomUUID() },
      randomUUID(),
      new AbortController().signal,
    ),
  ).rejects.toThrow("SCOPE");
  await expect(
    transport.authorize(
      { ...job, action: "restart" },
      randomUUID(),
      new AbortController().signal,
    ),
  ).rejects.toThrow("ACTION");
});
