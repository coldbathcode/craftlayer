import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeBackupOffer, NodeBackupOutcome } from "@craftlayer/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameChannel } from "./action-runner.js";
import { BackupJournal } from "./backup-journal.js";
import {
  assertBackupDirectories,
  resumeSaving,
  runBackup,
} from "./backup-runner.js";
import { BackupWorker } from "./backup-worker.js";
import { NodeTransportFailure } from "./client.js";
import { RconError } from "./game-control/rcon.js";
import { MemoryWhitelistStore } from "./game-control/whitelist.js";

const server = randomUUID(),
  node = randomUUID();
let directory = "";
const offer = (serverId = server, expiresIn = 3600_000): NodeBackupOffer => ({
  occurrence_id: randomUUID(),
  server_id: serverId,
  kind: "scheduled",
  expires_at: new Date(Date.now() + expiresIn).toISOString(),
});
const good: NodeBackupOutcome = {
  ok: true,
  archive_sha256: "a".repeat(64),
  size_bytes: 10,
  manifest_hash: "b".repeat(64),
  file_count: 1,
  total_bytes: 20,
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "craftlayer-backups-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
/** A scripted private console; `fail` makes one command (or the connection) fail. */
function console_(fail: "none" | "open" | "save-all flush" = "none") {
  const sent: string[] = [];
  const channel: GameChannel = {
    whitelist: new MemoryWhitelistStore(),
    options: {},
    async open() {
      if (fail === "open") throw new RconError("RCON_UNREACHABLE");
      return {
        async command(text) {
          sent.push(text);
          return {
            body:
              text === "save-all flush"
                ? fail === text
                  ? "Unable to save"
                  : "Saved the game"
                : "",
            truncated: false,
          };
        },
        async close() {},
      };
    },
  };
  return { sent, channel };
}
function harness(queue: Array<NodeBackupOffer | null>) {
  const reported: Array<{ occurrence_id: string; outcome: NodeBackupOutcome }> =
      [],
    ran: string[] = [],
    resumed: string[] = [],
    logged: string[] = [];
  let failReport: Error | null = null,
    release: (() => void) | null = null,
    hold = false;
  const journal = new BackupJournal(directory, node);
  const worker = new BackupWorker({
    serverIds: [server],
    journal,
    poll: async () => queue.shift() ?? null,
    report: async (r) => {
      if (failReport) throw failReport;
      reported.push({ occurrence_id: r.occurrence_id, outcome: r.outcome });
      return "complete";
    },
    run: async (o) => {
      ran.push(o.occurrence_id);
      if (hold) await new Promise<void>((done) => (release = done));
      return good;
    },
    resume: async (id) => {
      resumed.push(id);
      return true;
    },
    log: (code) => logged.push(code),
  });
  return {
    journal,
    worker,
    reported,
    ran,
    resumed,
    logged,
    failing(error: Error | null) {
      failReport = error;
    },
    holding() {
      hold = true;
    },
    release() {
      release?.();
    },
  };
}
describe("node backup worker", () => {
  it("journals privately, archives in the background, then reports once", async () => {
    const first = offer(),
      h = harness([first]);
    h.holding();
    await h.worker.tick();
    expect(h.worker.busy).toBe(true);
    expect((await h.journal.read()).open).toEqual({
      occurrence_id: first.occurrence_id,
      server_id: server,
      outcome: null,
    });
    expect((await stat(join(directory, "backups.json"))).mode & 0o077).toBe(0);
    // While the archive is being written the loop keeps turning and asks for nothing.
    await h.worker.tick();
    expect(h.reported).toEqual([]);
    h.release();
    await h.worker.settle();
    expect(h.worker.busy).toBe(false);
    await h.worker.tick();
    expect(h.reported).toEqual([
      { occurrence_id: first.occurrence_id, outcome: good },
    ]);
    expect((await h.journal.read()).open).toBeNull();
    await h.worker.tick();
    expect(h.ran).toEqual([first.occurrence_id]);
  });
  it("keeps an undelivered outcome and delivers it later without archiving again", async () => {
    const first = offer(),
      h = harness([first, offer()]);
    await h.worker.tick();
    await h.worker.settle();
    h.failing(new NodeTransportFailure("NODE_TRANSPORT_FAILED", true));
    await expect(h.worker.tick()).rejects.toBeInstanceOf(NodeTransportFailure);
    expect((await h.journal.read()).open?.outcome).toEqual(good);
    h.failing(null);
    await h.worker.tick();
    expect(h.reported.map((r) => r.occurrence_id)).toEqual([
      first.occurrence_id,
    ]);
    expect(h.ran).toEqual([first.occurrence_id]);
  });
  it("reports a backup cut short by a restart as interrupted after resuming saving", async () => {
    const cut = offer(),
      h = harness([]);
    // An earlier life of this agent accepted the backup and stopped before an outcome.
    await h.journal.begin(cut);
    await h.worker.tick();
    expect(h.resumed).toEqual([server]);
    expect(h.ran).toEqual([]);
    expect(h.reported).toEqual([
      {
        occurrence_id: cut.occurrence_id,
        outcome: { ok: false, failure: "interrupted" },
      },
    ]);
    expect(h.logged).toEqual(["NODE_BACKUP_INTERRUPTED_SAVING_RESUMED"]);
    expect((await h.journal.read()).open).toBeNull();
  });
  it("refuses a server it cannot back up, and drops an answer the controller refuses", async () => {
    const foreign = offer(randomUUID()),
      h = harness([foreign, offer()]);
    await h.worker.tick();
    expect(h.ran).toEqual([]);
    expect(h.reported[0]?.outcome).toEqual({
      ok: false,
      failure: "node_unavailable",
    });
    await h.worker.tick();
    await h.worker.settle();
    h.failing(new NodeTransportFailure("NODE_REQUEST_DENIED", false, 403));
    await h.worker.tick();
    expect(h.logged).toEqual(["NODE_BACKUP_RESULT_REFUSED"]);
    expect((await h.journal.read()).open).toBeNull();
  });
});
describe("node backup runner", () => {
  async function world() {
    const data = join(directory, "data"),
      backups = join(directory, "archives");
    await mkdir(join(data, "world"), { recursive: true });
    await mkdir(join(data, "logs"), { recursive: true });
    await writeFile(join(data, "world/level.dat"), "level");
    await writeFile(join(data, "whitelist.json"), "[]");
    await writeFile(join(data, "logs/latest.log"), "noise");
    return { data, backups };
  }
  it("pauses saving, archives, resumes, verifies and reports the hashes", async () => {
    const { data, backups } = await world(),
      c = console_(),
      o = offer();
    const outcome = await runBackup(o, {
      channel: c.channel,
      dataDirectory: data,
      backupDirectory: backups,
    });
    expect(outcome).toMatchObject({ ok: true, file_count: 2 });
    expect(c.sent).toEqual(["save-off", "save-all flush", "save-on"]);
    expect((await readdir(join(backups, server))).sort()).toEqual([
      `${o.occurrence_id}.manifest.json`,
      `${o.occurrence_id}.tar.gz`,
    ]);
  });
  it("takes no archive when the console is unreachable, the flush fails or the offer is stale", async () => {
    const { data, backups } = await world();
    const target = (c: GameChannel) => ({
      channel: c,
      dataDirectory: data,
      backupDirectory: backups,
    });
    const logged: string[] = [];
    expect(
      await runBackup(offer(), target(console_("open").channel), {
        log: (code) => logged.push(code),
      }),
    ).toEqual({ ok: false, failure: "save_failed" });
    const flush = console_("save-all flush");
    expect(await runBackup(offer(), target(flush.channel))).toEqual({
      ok: false,
      failure: "save_failed",
    });
    // Saving is turned back on even though the flush failed.
    expect(flush.sent).toEqual(["save-off", "save-all flush", "save-on"]);
    const stale = console_();
    expect(await runBackup(offer(server, -1), target(stale.channel))).toEqual({
      ok: false,
      failure: "interrupted",
    });
    expect(stale.sent).toEqual([]);
    expect(logged).toEqual(["NODE_BACKUP_CONSOLE_UNREACHABLE"]);
    await expect(readdir(join(backups, server))).resolves.toEqual([]);
  });
  it("turns saving back on after an interruption and refuses overlapping directories", async () => {
    const c = console_();
    expect(await resumeSaving(c.channel)).toBe(true);
    expect(c.sent).toEqual(["save-on"]);
    expect(await resumeSaving(console_("open").channel)).toBe(false);
    expect(() =>
      assertBackupDirectories("/srv/game/data", "/srv/game/backups"),
    ).not.toThrow();
    for (const [data, backups] of [
      ["/srv/game/data", "/srv/game/data/backups"],
      ["/srv/game/backups/data", "/srv/game/backups"],
      ["/srv/game/data", "/srv/game/data"],
    ] as const)
      expect(() => assertBackupDirectories(data, backups)).toThrow(
        "NODE_BACKUP_DIRECTORIES_OVERLAP",
      );
  });
});
