import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  deploymentApprovalDecisionRequest,
  deploymentApprovalDecisionView,
  deploymentApprovalEvidence,
  deploymentApprovalRevocationRequest,
} from "./deployment-approval-decisions.js";

const hash = "a".repeat(64);
it("accepts only an exact review reference and a closed decision", () => {
  const request = {
    request_id: randomUUID(),
    review_hash: hash,
    decision: "approved",
  };
  expect(deploymentApprovalDecisionRequest.parse(request)).toEqual(request);
  expect(
    deploymentApprovalDecisionRequest.parse({
      ...request,
      decision: "rejected",
    }).decision,
  ).toBe("rejected");
  for (const change of [
    { decision: "revoked" },
    { decision: true },
    { review_hash: "not-a-hash" },
    { reviewer_id: randomUUID() },
    { execution_enabled: true },
    { qualification: "verified" },
    { expires_at: new Date().toISOString() },
  ])
    expect(() =>
      deploymentApprovalDecisionRequest.parse({ ...request, ...change }),
    ).toThrow();
  const revocation = { decision_id: randomUUID() };
  expect(deploymentApprovalRevocationRequest.parse(revocation)).toEqual(
    revocation,
  );
  expect(() =>
    deploymentApprovalRevocationRequest.parse({ ...revocation, reason: "x" }),
  ).toThrow();
});
it("never projects enabled execution, qualification or reviewer identity", () => {
  const now = new Date().toISOString(),
    view = {
      operation_id: randomUUID(),
      request_id: randomUUID(),
      review_hash: hash,
      decision: "approved",
      state: "revoked",
      created_at: now,
      expires_at: now,
      revoked_at: now,
      execution_enabled: false,
      qualification: "unverified",
    },
    evidence = {
      decision_id: randomUUID(),
      request_id: randomUUID(),
      intent_id: randomUUID(),
      approval_hash: hash,
      review_hash: hash,
      expires_at: now,
      execution_enabled: false,
      qualification: "unverified",
    };
  expect(deploymentApprovalDecisionView.parse(view)).toEqual(view);
  expect(deploymentApprovalEvidence.parse(evidence)).toEqual(evidence);
  for (const change of [
    { execution_enabled: true },
    { qualification: "verified" },
    { reviewer_id: randomUUID() },
    { reviewer_approval_grant: {} },
  ]) {
    expect(() =>
      deploymentApprovalDecisionView.parse({ ...view, ...change }),
    ).toThrow();
    expect(() =>
      deploymentApprovalEvidence.parse({ ...evidence, ...change }),
    ).toThrow();
  }
});
