import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  type NodeActionFailure,
  nodeActionFailure,
  serverActionEvidence,
} from "@craftlayer/contracts";
import { protectedNodeFile } from "@craftlayer/node-protocol";
import { z } from "zod";

/**
 * What this node has accepted and not yet had acknowledged. An action is written here
 * before it runs and its answer is written before it is sent, so a crash or a lost
 * reply can never make the node run the same action twice: on restart an action with
 * no recorded answer is reported as interrupted, never retried. The last fence
 * accepted per server is kept so stale or replayed offers are refused.
 */
const state = z.strictObject({
  node_id: z.uuid(),
  fences: z.record(z.uuid(), z.number().int().positive()),
  open: z
    .strictObject({
      action_id: z.uuid(),
      server_id: z.uuid(),
      fence: z.number().int().positive(),
      outcome: serverActionEvidence.nullable(),
      failure: nodeActionFailure.nullable(),
    })
    .nullable(),
});
export type ActionJournalState = z.infer<typeof state>;
export interface ActionSettlement {
  outcome: z.infer<typeof serverActionEvidence>;
  failure: NodeActionFailure | null;
}
export class ActionJournal {
  readonly #path: string;
  constructor(
    private readonly directory: string,
    private readonly node: string,
  ) {
    this.#path = join(directory, "actions.json");
  }
  async read(): Promise<ActionJournalState> {
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
      return { node_id: this.node, fences: {}, open: null };
    }
  }
  async #write(value: ActionJournalState) {
    const temp = join(this.directory, `.actions-${randomUUID()}`),
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
  /** Records the action as accepted. `settled` is given when it is refused without running. */
  async begin(
    action: { id: string; server_id: string; fence: number },
    settled?: ActionSettlement,
  ) {
    const current = await this.read();
    if (current.open) throw new Error("NODE_ACTION_ALREADY_OPEN");
    await this.#write({
      ...current,
      fences: {
        ...current.fences,
        [action.server_id]: Math.max(
          action.fence,
          current.fences[action.server_id] ?? 0,
        ),
      },
      open: {
        action_id: action.id,
        server_id: action.server_id,
        fence: action.fence,
        outcome: settled?.outcome ?? null,
        failure: settled?.failure ?? null,
      },
    });
  }
  async finish(settled: ActionSettlement) {
    const current = await this.read();
    if (!current.open || current.open.outcome)
      throw new Error("NODE_ACTION_NOT_OPEN");
    await this.#write({
      ...current,
      open: {
        ...current.open,
        outcome: settled.outcome,
        failure: settled.failure,
      },
    });
  }
  /** Called only after the controller acknowledged the answer. */
  async clear() {
    const current = await this.read();
    if (current.open) await this.#write({ ...current, open: null });
  }
}
