import { setTimeout as delay } from "node:timers/promises";
import type { CommandTransport } from "./command-transport.js";
import type { NodeCommandExecutor } from "./executor.js";

/** Private explicit composition only. Failed receipt delivery never retries physical work. */
export class NodeCommandRunner {
  #busy = false;
  constructor(
    private readonly transport: Pick<
      CommandTransport,
      "poll" | "fetch" | "submitReceipt"
    >,
    private readonly executor: Pick<
      NodeCommandExecutor,
      "receiptDelivery" | "acknowledgeReceipt" | "execute"
    >,
  ) {}
  async tick(
    signal?: AbortSignal,
  ): Promise<"idle" | "blocked" | "pending" | "delivered"> {
    if (this.#busy) throw new Error("NODE_COMMAND_RUNNER_BUSY");
    this.#busy = true;
    try {
      signal?.throwIfAborted();
      const retained = await this.executor.receiptDelivery();
      for (const receipt of retained.receipts) {
        const ack = await this.transport.submitReceipt(receipt, signal);
        await this.executor.acknowledgeReceipt(receipt, ack);
      }
      const remaining = await this.executor.receiptDelivery();
      if (remaining.receipts.length) return "pending";
      if (remaining.blocked) return "blocked";
      signal?.throwIfAborted();
      const next = (await this.transport.poll(signal)).jobs[0];
      if (!next) return "idle";
      const command = await this.transport.fetch(
        next.operation_id,
        next.command_hash,
        signal,
      );
      signal?.throwIfAborted();
      const receipt = await this.executor.execute(command);
      if (signal?.aborted) return "pending";
      const ack = await this.transport.submitReceipt(receipt, signal);
      await this.executor.acknowledgeReceipt(receipt, ack);
      return "delivered";
    } finally {
      this.#busy = false;
    }
  }
  async run(
    signal: AbortSignal,
    observe: (
      state: "idle" | "blocked" | "pending" | "delivered" | "unavailable",
    ) => void = () => {},
  ) {
    while (!signal.aborted) {
      try {
        observe(await this.tick(signal));
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
