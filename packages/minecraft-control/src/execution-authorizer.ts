import type { ExecutionGrant } from "@craftlayer/auth";
export interface DeploymentPrincipal {
  user: { id: string; account_type: "adult" | "child" };
  sessionId: string;
  userVersion: number;
  authorityExpiresAt?: number;
  /** Remote proof freshness, distinct from the original session lifetime. */
  validatedUntil?: number;
}
export interface DeploymentAuthorizer {
  guardExecutions<T>(
    grants: readonly ExecutionGrant[],
    operation: (principal: DeploymentPrincipal) => Promise<T>,
  ): Promise<T>;
}
