import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  executionAuthorityProof,
  executionAuthorityRequest,
} from "./execution-authority.js";

it("separates current identity proofs from node permits and rejects caller approval/PII fields", () => {
  const request = {
    schema_version: 1,
    purpose: "identity.execution.check.v1",
    control_id: "a".repeat(64),
    organization_id: randomUUID(),
    request_nonce: randomUUID(),
    grants_hash: "b".repeat(64),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000).toISOString(),
  };
  expect(executionAuthorityRequest.parse(request)).toEqual(request);
  expect(() =>
    executionAuthorityRequest.parse({ ...request, approval: true }),
  ).toThrow();
  const proof = {
    ...request,
    purpose: "identity.execution.proof.v1",
    authority_id: "c".repeat(64),
    user_id: randomUUID(),
    session_id: randomUUID(),
    user_version: 1,
    account_type: "adult",
    authority_expires_at: new Date(Date.now() + 30000).toISOString(),
  };
  expect(executionAuthorityProof.parse(proof)).toEqual(proof);
  for (const extra of [
    { purpose: "node.command.permit.v1" },
    { account_type: "child" },
    { approved: true },
    { email: "private@example.com" },
    { grants: [] },
  ])
    expect(() =>
      executionAuthorityProof.parse({ ...proof, ...extra }),
    ).toThrow();
});
