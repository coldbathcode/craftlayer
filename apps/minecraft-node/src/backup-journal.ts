import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  type NodeBackupOutcome,
  nodeBackupOutcome,
} from "@craftlayer/contracts";
import { protectedNodeFile } from "@craftlayer/node-protocol";
import { z } from "zod";

/**
 * The one backup this node has accepted and not yet had acknowledged. It is written
 * here before saving is paused and its outcome is written before it is sent, so a
 * crash or a lost reply can never make the node archive the same occurrence twice, and
 * a backup found here with no outcome after a restart is known to have been cut short.
 */
const state = z.strictObject({
  node_id: z.uuid(),
  open: z
    .strictObject({
      occurrence_id: z.uuid(),
      server_id: z.uuid(),
      outcome: nodeBackupOutcome.nullable(),
    })
    .nullable(),
});
export type BackupJournalState = z.infer<typeof state>;
export class BackupJournal {
  readonly #path: string;
  constructor(
    private readonly directory: string,
    private readonly node: string,
  ) {
    this.#path = join(directory, "backups.json");
  }
  async read(): Promise<BackupJournalState> {
    try {
      const value = state.parse(
        JSON.parse(await protectedNodeFile(this.#path)),
      );
      if (value.node_id !== this.node)
        throw new Error("NODE_JOURNAL_BINDING_DENIED");
      return value;
    } catch (e) {
      if (!e || typeof e !== "object" || !("code" in e) || e.code !== "ENOENT")
        throw e;
      return { node_id: this.node, open: null };
    }
  }
  async #write(value: BackupJournalState) {
    const temp = join(this.directory, `.backups-${randomUUID()}`),
      file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(state.parse(value)));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, this.#path);
    const directory = await open(this.directory, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  /** Records the backup as accepted. `outcome` is given when it is refused without running. */
  async begin(
    backup: { occurrence_id: string; server_id: string },
    outcome?: NodeBackupOutcome,
  ) {
    const current = await this.read();
    if (current.open) throw new Error("NODE_BACKUP_ALREADY_OPEN");
    await this.#write({
      ...current,
      open: {
        occurrence_id: backup.occurrence_id,
        server_id: backup.server_id,
        outcome: outcome ?? null,
      },
    });
  }
  async finish(outcome: NodeBackupOutcome) {
    const current = await this.read();
    if (!current.open || current.open.outcome)
      throw new Error("NODE_BACKUP_NOT_OPEN");
    await this.#write({ ...current, open: { ...current.open, outcome } });
  }
  /** Called only after the controller acknowledged the outcome. */
  async clear() {
    const current = await this.read();
    if (current.open) await this.#write({ ...current, open: null });
  }
}
