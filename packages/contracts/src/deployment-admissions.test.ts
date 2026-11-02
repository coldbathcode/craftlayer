import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  deploymentAdmissionRequest,
  deploymentAdmissionView,
} from "./deployment-admissions.js";

it("admits only an existing intent reference without caller grants, approval or control parameters", () => {
  const v = { intent_id: randomUUID() };
  expect(deploymentAdmissionRequest.parse(v)).toEqual(v);
  for (const extra of [
    { grants: [] },
    { approval: true },
    { command: "start" },
    { control_key: "private" },
    { organization_id: randomUUID() },
  ])
    expect(() =>
      deploymentAdmissionRequest.parse({ ...v, ...extra }),
    ).toThrow();
});
it("projects authority metadata without sealed grants or an executed claim", () => {
  const v = {
    operation_id: randomUUID(),
    intent_id: randomUUID(),
    deployment_id: randomUUID(),
    reservation_id: randomUUID(),
    authorization_state: "active",
    expires_at: new Date().toISOString(),
    effects: "metadata_only",
    job_id: null,
  };
  expect(deploymentAdmissionView.parse(v)).toEqual(v);
  for (const extra of [
    { node_grant: {} },
    { server_grant: {} },
    { effects: "provisioned" },
  ])
    expect(() => deploymentAdmissionView.parse({ ...v, ...extra })).toThrow();
});
