import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { DeploymentJobs } from "./deployment-jobs.js";

/** Operator-configured private placement, never a queue or browser authority. */
export const deploymentDispatchScope = z.strictObject({
  organization_id: z.uuid(),
  project_id: z.uuid(),
  node_id: z.uuid(),
  credential_version: z.number().int().positive(),
});
export type DeploymentDispatchScope = z.infer<typeof deploymentDispatchScope>;

/** PostgreSQL outboxes are the durable source. Reopening restarts the bounded scan. */
export class DeploymentDispatcher {
  #scope: DeploymentDispatchScope;
  #after: string | null = null;
  #busy = false;
  constructor(
    private readonly jobs: Pick<
      DeploymentJobs,
      "dispatchPending" | "settleExpiredForNode"
    >,
    scope: unknown,
  ) {
    this.#scope = deploymentDispatchScope.parse(scope);
  }
  async tick(signal?: AbortSignal) {
    if (this.#busy) throw new Error("DEPLOYMENT_DISPATCH_ALREADY_RUNNING");
    this.#busy = true;
    try {
      signal?.throwIfAborted();
      const expired = await this.jobs.settleExpiredForNode(this.#scope);
      signal?.throwIfAborted();
      const batch = await this.jobs.dispatchPending(
        this.#scope,
        { after: this.#after },
        signal,
      );
      this.#after = batch.after;
      return { expired, issued: batch.issued, blocked: batch.blocked };
    } finally {
      this.#busy = false;
    }
  }
  async run(
    signal: AbortSignal,
    observe: (state: "completed" | "unavailable") => void = () => {},
  ) {
    while (!signal.aborted) {
      try {
        await this.tick(signal);
        observe("completed");
      } catch {
        if (signal.aborted) break;
        observe("unavailable");
      }
      try {
        await delay(1000, undefined, { signal });
      } catch {
        break;
      }
    }
  }
}
