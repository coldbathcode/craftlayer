import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeActionOffer } from "@craftlayer/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionJournal, type ActionSettlement } from "./action-journal.js";
import { type GameChannel, runServerAction } from "./action-runner.js";
import { ActionWorker } from "./action-worker.js";
import { NodeTransportFailure } from "./client.js";
import { RconError } from "./game-control/rcon.js";
import { MemoryWhitelistStore } from "./game-control/whitelist.js";

const server = randomUUID(),
  node = randomUUID();
let directory = "";
const offer = (
  fence: number,
  request: NodeActionOffer["request"] = { kind: "save" },
  serverId = server,
): NodeActionOffer => ({
  id: randomUUID(),
  server_id: serverId,
  kind: request.kind,
  request,
  fence,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
});
const ok: ActionSettlement = {
  outcome: { ok: true, evidence: "Saved the game" },
  failure: null,
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "craftlayer-actions-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function harness(queue: Array<NodeActionOffer | null>) {
  const reported: Array<{ action_id: string; ok: boolean; failure: unknown }> =
      [],
    ran: string[] = [];
  let failReport: Error | null = null;
  const journal = new ActionJournal(directory, node);
  const worker = new ActionWorker({
    serverIds: [server],
    journal,
    poll: async () => queue.shift() ?? null,
    report: async (r) => {
      if (failReport) throw failReport;
      reported.push({
        action_id: r.action_id,
        ok: r.outcome.ok,
        failure: r.failure,
      });
      return r.outcome.ok ? "succeeded" : "failed";
    },
    run: async (o) => {
      ran.push(o.id);
      return ok;
    },
  });
  return {
    journal,
    worker,
    reported,
    ran,
    failing(error: Error | null) {
      failReport = error;
    },
  };
}
describe("node action worker", () => {
  it("journals privately, runs once, reports, and remembers the fence", async () => {
    const first = offer(1),
      h = harness([first]);
    expect(await h.worker.tick()).toBe(true);
    expect(h.ran).toEqual([first.id]);
    expect(h.reported).toEqual([
      { action_id: first.id, ok: true, failure: null },
    ]);
    expect(await h.journal.read()).toEqual({
      node_id: node,
      fences: { [server]: 1 },
      open: null,
    });
    expect((await stat(join(directory, "actions.json"))).mode & 0o077).toBe(0);
    expect(await h.worker.tick()).toBe(false);
  });
  it("refuses a stale fence and a server it does not control without running anything", async () => {
    const h = harness([
      offer(3),
      offer(3),
      offer(9, { kind: "save" }, randomUUID()),
    ]);
    await h.worker.tick();
    await h.worker.tick();
    await h.worker.tick();
    expect(h.ran).toHaveLength(1);
    expect(h.reported.map((r) => r.failure)).toEqual([
      null,
      "interrupted",
      "node_unavailable",
    ]);
  });
  it("keeps an undelivered answer and sends it before asking for more work", async () => {
    const first = offer(1),
      second = offer(2),
      h = harness([first, second]);
    h.failing(new NodeTransportFailure("NODE_TRANSPORT_UNAVAILABLE", true));
    await expect(h.worker.tick()).rejects.toThrow();
    expect((await h.journal.read()).open?.outcome?.ok).toBe(true);
    h.failing(null);
    // A new worker over the same journal, as after a restart.
    expect(await h.worker.tick()).toBe(true);
    expect(h.ran).toEqual([first.id]);
    expect(h.reported).toHaveLength(1);
    expect(await h.worker.tick()).toBe(true);
    expect(h.ran).toEqual([first.id, second.id]);
  });
  it("reports an action with no recorded answer as interrupted, and drops a refused answer", async () => {
    const first = offer(1),
      h = harness([]);
    await h.journal.begin(first);
    await expect(h.journal.begin(offer(2))).rejects.toThrow();
    await h.worker.tick();
    expect(h.ran).toEqual([]);
    expect(h.reported).toEqual([
      { action_id: first.id, ok: false, failure: "interrupted" },
    ]);
    await h.journal.begin(offer(2));
    h.failing(new NodeTransportFailure("NODE_REQUEST_DENIED", false, 403));
    expect(await h.worker.tick()).toBe(true);
    expect(await h.journal.read()).toMatchObject({
      fences: { [server]: 2 },
      open: null,
    });
    h.failing(new NodeTransportFailure("NODE_REQUEST_DENIED", false, 401));
    await h.journal.begin(offer(3));
    await expect(h.worker.tick()).rejects.toThrow();
    expect((await h.journal.read()).open).not.toBeNull();
  });
  it("refuses a journal that belongs to another node", async () => {
    await new ActionJournal(directory, node).begin(offer(1));
    await expect(
      new ActionJournal(directory, randomUUID()).read(),
    ).rejects.toThrow("NODE_JOURNAL_BINDING_DENIED");
  });
});
describe("running one offered action", () => {
  const scripted = (
    reply: (text: string) => string,
  ): GameChannel & { sent: string[] } => {
    const sent: string[] = [];
    return {
      sent,
      whitelist: new MemoryWhitelistStore(),
      options: {},
      async open() {
        return {
          async command(text) {
            sent.push(text);
            return { body: reply(text), truncated: false };
          },
          async close() {},
        };
      },
    };
  };
  it("maps each kind to one fixed verb and returns the server's words", async () => {
    const channel = scripted((t) =>
      t.startsWith("kick") ? "Kicked Steve: Bedtime" : "Saved the game",
    );
    expect(
      await runServerAction(
        offer(1, { kind: "kick_player", name: "Steve", reason: "Bedtime" }),
        channel,
      ),
    ).toEqual({
      outcome: {
        ok: true,
        evidence: "Kicked Steve: Bedtime",
        detail: { name: "Steve", wasOnline: true },
      },
      failure: null,
    });
    expect((await runServerAction(offer(2), channel)).outcome.ok).toBe(true);
    expect(channel.sent).toEqual(["kick Steve Bedtime", "save-all flush"]);
  });
  it("never touches the server for power actions or late offers", async () => {
    const channel = scripted(() => "");
    for (const kind of ["start", "stop", "restart"] as const)
      expect(await runServerAction(offer(1, { kind }), channel)).toMatchObject({
        outcome: { ok: false },
        failure: "node_unavailable",
      });
    expect(
      await runServerAction(
        { ...offer(1), expires_at: new Date(Date.now() - 1).toISOString() },
        channel,
      ),
    ).toMatchObject({ outcome: { ok: false }, failure: "interrupted" });
    expect(channel.sent).toEqual([]);
  });
  it("reports an unreachable or unconvinced server without retrying", async () => {
    const down: GameChannel = {
      whitelist: new MemoryWhitelistStore(),
      options: {},
      async open() {
        throw new RconError("RCON_UNREACHABLE");
      },
    };
    expect(await runServerAction(offer(1), down)).toMatchObject({
      outcome: { ok: false },
      failure: "server_unreachable",
    });
    const vague = scripted(() => "Nothing happened");
    expect(await runServerAction(offer(1), vague)).toMatchObject({
      outcome: { ok: false, evidence: "Nothing happened" },
      failure: "not_verified",
    });
    expect(vague.sent).toEqual(["save-all flush"]);
  });
});
