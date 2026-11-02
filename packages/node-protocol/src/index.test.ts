import { signedNodeRequest } from "@craftlayer/contracts";
import { expect, it } from "vitest";
import {
  assertNodeTime,
  canonical,
  generateNodeKey,
  nodeDigest,
  signNodeValue,
  verifyNodeValue,
} from "./index.js";

it("signs canonical payloads and rejects alteration, different keys and expired proofs", () => {
  const a = generateNodeKey(),
    b = generateNodeKey(),
    body = { purpose: "fixed", node: "one", sequence: 1 },
    signature = signNodeValue(body, a.private_key);
  expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  expect(verifyNodeValue(body, signature, a.public_key)).toBe(true);
  expect(
    verifyNodeValue({ ...body, sequence: 2 }, signature, a.public_key),
  ).toBe(false);
  expect(verifyNodeValue(body, signature, b.public_key)).toBe(false);
  expect(nodeDigest(body)).not.toBe(
    nodeDigest({ ...body, purpose: "another" }),
  );
  const now = Date.now();
  expect(() =>
    assertNodeTime(
      new Date(now - 31000).toISOString(),
      new Date(now + 1000).toISOString(),
      now,
    ),
  ).toThrow();
});
it("has no arbitrary commands, endpoints, environment, world path or credentials in node messages", () => {
  const request = {
    payload: {
      schema_version: 1,
      control_id: "a".repeat(64),
      purpose: "node.enroll.v1",
      organization_id: "00000000-0000-4000-8000-000000000001",
      node_id: "00000000-0000-4000-8000-000000000002",
      credential_version: 1,
      sequence: 0,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30000).toISOString(),
    },
    signature: "A".repeat(86),
  };
  expect(signedNodeRequest.safeParse(request).success).toBe(true);
  for (const field of [
    "command",
    "docker_api",
    "host_path",
    "world_path",
    "env",
    "credential",
    "shell",
  ])
    expect(
      signedNodeRequest.safeParse({
        ...request,
        payload: { ...request.payload, [field]: "untrusted" },
      }).success,
    ).toBe(false);
});
