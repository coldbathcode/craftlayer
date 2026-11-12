import type { NodeBackupOffer, NodeBackupOutcome } from "@craftlayer/contracts";
import type { BackupJournal } from "./backup-journal.js";
import { NodeTransportFailure } from "./client.js";

/**
 * One step of the node's backup loop. A backup can take minutes, so the archive runs
 * in the background while the caller keeps its heartbeat and action loop going; every
 * conversation with the controller still happens inside `tick`, one at a time. Strictly
 * one backup at a time, journalled before it starts and before its outcome is sent.
 */
export class BackupWorker {
  #running: Promise<void> | null = null;
  constructor(
    private readonly options: {
      serverIds: string[];
      journal: BackupJournal;
      poll(serverIds: string[]): Promise<NodeBackupOffer | null>;
      report(result: {
        occurrence_id: string;
        server_id: string;
        outcome: NodeBackupOutcome;
      }): Promise<unknown>;
      run(offer: NodeBackupOffer): Promise<NodeBackupOutcome>;
      /** Turns saving back on after a backup was cut short; false if unconfirmed. */
      resume(serverId: string): Promise<boolean>;
      log?(code: string): void;
    },
  ) {}
  get busy() {
    return this.#running !== null;
  }
  /** Resolves when the backup in flight, if any, has written its outcome. */
  async settle() {
    await this.#running;
  }
  async tick() {
    if (this.#running) return;
    const { journal, serverIds } = this.options;
    const open = (await journal.read()).open;
    if (open) {
      if (!open.outcome) {
        // Found with no outcome and nothing running: this agent stopped mid-backup.
        // Never archive it again; make sure the world is saving, then say so.
        const resumed = await this.options
          .resume(open.server_id)
          .catch(() => false);
        this.options.log?.(
          resumed
            ? "NODE_BACKUP_INTERRUPTED_SAVING_RESUMED"
            : "NODE_BACKUP_INTERRUPTED_SAVING_UNCONFIRMED",
        );
        await journal.finish({ ok: false, failure: "interrupted" });
      }
      await this.#deliver();
      return;
    }
    const offer = await this.options.poll(serverIds);
    if (!offer) return;
    if (!serverIds.includes(offer.server_id)) {
      await journal.begin(offer, { ok: false, failure: "node_unavailable" });
      await this.#deliver();
      return;
    }
    await journal.begin(offer);
    this.#running = this.options
      .run(offer)
      .catch((): NodeBackupOutcome => ({ ok: false, failure: "interrupted" }))
      .then((outcome) => journal.finish(outcome))
      .catch(() => this.options.log?.("NODE_BACKUP_JOURNAL_FAILED"))
      .finally(() => {
        this.#running = null;
      });
  }
  async #deliver() {
    const open = (await this.options.journal.read()).open;
    if (!open?.outcome) return;
    try {
      await this.options.report({
        occurrence_id: open.occurrence_id,
        server_id: open.server_id,
        outcome: open.outcome,
      });
    } catch (error) {
      // The controller no longer accepts an answer for this backup: drop the answer.
      // Any other failure leaves it journalled for the next attempt.
      if (!(error instanceof NodeTransportFailure) || error.status !== 403)
        throw error;
      this.options.log?.("NODE_BACKUP_RESULT_REFUSED");
    }
    await this.options.journal.clear();
  }
}
