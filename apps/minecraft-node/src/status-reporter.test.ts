import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeStatusReportRequest } from "@craftlayer/contracts";
import { expect, it } from "vitest";
import type { GameChannel } from "./action-runner.js";
import {
  floodgateUuid,
  MemoryWhitelistStore,
  RconError,
} from "./game-control/index.js";
import { readKnocks, readStatus } from "./status-reporter.js";

const report = nodeStatusReportRequest.pick({
  power: true,
  online: true,
  max_players: true,
  players: true,
  allowed: true,
  knocks: true,
});
function channel(reply: string | null, running?: boolean): GameChannel {
  return {
    whitelist: new MemoryWhitelistStore(),
    options: {},
    async open() {
      if (reply === null) throw new RconError("RCON_UNREACHABLE");
      return {
        command: async () => ({ body: reply, truncated: false }),
        close: async () => {},
      };
    },
    ...(running === undefined
      ? {}
      : {
          power: {
            running: async () => running,
            start: async () => {},
            stop: async () => {},
          },
        }),
  };
}
it("says on only when the server answers, and tells off from starting by its container", async () => {
  const on = await readStatus(
    channel(
      "There are 3 of a max of 5 players online: Alex, .Charlie, bad name!",
    ),
  );
  expect(report.parse(on)).toEqual({
    power: "on",
    online: 3,
    max_players: 5,
    players: ["Alex", ".Charlie"],
    allowed: [],
    knocks: [],
  });
  expect((await readStatus(channel(null))).power).toBe("unknown");
  expect((await readStatus(channel(null, true))).power).toBe("starting");
  expect(await readStatus(channel(null, false))).toMatchObject({
    power: "off",
    players: null,
    online: null,
  });
  // A reply that is not a player list is not evidence the server is on.
  expect((await readStatus(channel("Unknown command"))).power).toBe("unknown");
});
it("reads recent knocks from the plugin file and treats a missing file as nobody asking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "craftlayer-knocks-")),
    path = join(directory, "knocks.jsonl"),
    now = Date.parse("2026-11-12T18:00:00Z");
  try {
    expect(await readKnocks(path, now)).toEqual([]);
    const line = (at: string, uuid: string, name: string) =>
      JSON.stringify({
        v: 1,
        at,
        result: "KICK_WHITELIST",
        edition: "java",
        name,
        uuid,
      });
    await writeFile(
      path,
      [
        line("2026-11-10T10:00:00Z", floodgateUuid("77"), ".Old"),
        line("2026-11-12T17:00:00Z", floodgateUuid("2535400000000001"), ".Kid"),
        line("2026-11-12T17:30:00Z", floodgateUuid("2535400000000001"), ".Kid"),
        "{broken",
      ].join("\n"),
    );
    const knocks = await readKnocks(path, now);
    expect(knocks).toEqual([
      {
        account_uuid: floodgateUuid("2535400000000001"),
        name: ".Kid",
        // The edition and account number come from the account id, not the text.
        edition: "bedrock",
        xuid: "2535400000000001",
        first_at: "2026-11-12T17:00:00.000Z",
        last_at: "2026-11-12T17:30:00.000Z",
        attempts: 2,
      },
    ]);
    expect(report.shape.knocks.parse(knocks)).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
