import type {
  NodeActionFailure,
  NodeActionOffer,
  ServerActionView,
} from "@craftlayer/contracts";
import type { ActionJournal, ActionSettlement } from "./action-journal.js";
import { NodeTransportFailure } from "./client.js";

/**
 * One step of the node's action loop: deliver any answer still owed, otherwise ask for
 * one action, journal it, run it, journal the answer and deliver it. Strictly one
 * action at a time. An offer for a server this node does not control, or with a fence
 * it has already passed, is answered without running anything.
 */
export class ActionWorker {
  constructor(
    private readonly options: {
      serverIds: string[];
      journal: ActionJournal;
      poll(serverIds: string[]): Promise<NodeActionOffer | null>;
      report(result: {
        action_id: string;
        server_id: string;
        fence: number;
        outcome: ActionSettlement["outcome"];
        failure: NodeActionFailure | null;
      }): Promise<ServerActionView["state"]>;
      run(offer: NodeActionOffer): Promise<ActionSettlement>;
      log?(code: string): void;
    },
  ) {}
  /** Returns true when an action was handled, so the caller may ask again at once. */
  async tick() {
    const { journal, serverIds } = this.options;
    const state = await journal.read();
    if (state.open) {
      await this.#deliver();
      return true;
    }
    const offer = await this.options.poll(serverIds);
    if (!offer) return false;
    const refusal: ActionSettlement | null = !serverIds.includes(
      offer.server_id,
    )
      ? {
          outcome: {
            ok: false,
            evidence: "This host does not control that server.",
          },
          failure: "node_unavailable",
        }
      : offer.fence <= (state.fences[offer.server_id] ?? 0)
        ? {
            outcome: {
              ok: false,
              evidence:
                "Refused: this host has already handled a newer action for this server.",
            },
            failure: "interrupted",
          }
        : null;
    if (refusal) await journal.begin(offer, refusal);
    else {
      await journal.begin(offer);
      const settled = await this.options.run(offer).catch(
        (): ActionSettlement => ({
          outcome: {
            ok: false,
            evidence:
              "The action stopped unexpectedly on the host; check the server before trying again.",
          },
          failure: "interrupted",
        }),
      );
      await journal.finish(settled);
    }
    await this.#deliver();
    return true;
  }
  async #deliver() {
    const open = (await this.options.journal.read()).open;
    if (!open) return;
    try {
      await this.options.report({
        action_id: open.action_id,
        server_id: open.server_id,
        fence: open.fence,
        // No recorded answer means the node stopped mid-action: say so, never run it again.
        outcome: open.outcome ?? {
          ok: false,
          evidence:
            "The host restarted while this action was running; its outcome is unknown.",
        },
        failure: open.outcome ? open.failure : "interrupted",
      });
    } catch (error) {
      // The controller no longer accepts an answer for this action. Keep the fence, drop
      // the answer; any other failure leaves it journalled for the next attempt.
      if (!(error instanceof NodeTransportFailure) || error.status !== 403)
        throw error;
      this.options.log?.("NODE_ACTION_RESULT_REFUSED");
    }
    await this.options.journal.clear();
  }
}
