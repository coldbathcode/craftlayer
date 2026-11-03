import {
  deploymentAdmissionView,
  deploymentJobView,
} from "@craftlayer/contracts";
import { identityRequest } from "./index.js";
export function deploymentClient(
  organization: string,
  csrf: string,
  signal?: AbortSignal,
) {
  const context = { organization, csrf, ...(signal ? { signal } : {}) };
  return {
    admit: (intent: string, key: string) =>
      identityRequest(
        "/api/v1/servers/provision/admissions",
        deploymentAdmissionView,
        {
          ...context,
          method: "POST",
          json: { intent_id: intent },
          idempotencyKey: key,
        },
      ),
    admission: (id: string) =>
      identityRequest(
        `/api/v1/servers/provision/admissions/${encodeURIComponent(id)}`,
        deploymentAdmissionView,
        context,
      ),
    job: (id: string) =>
      identityRequest(
        `/api/v1/servers/provision/jobs/${encodeURIComponent(id)}`,
        deploymentJobView,
        context,
      ),
    operation: (id: string) =>
      identityRequest(
        `/api/v1/operations/${encodeURIComponent(id)}`,
        deploymentAdmissionView.or(deploymentJobView),
        context,
      ),
  };
}
