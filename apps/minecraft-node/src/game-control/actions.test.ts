import { describe, expect, it } from "vitest";
import { GameActions } from "./actions.js";
import {
  floodgateName,
  floodgateUuid,
  xuidFromFloodgateUuid,
} from "./floodgate.js";
import { RconError, type RconSession } from "./rcon.js";
import { MemoryWhitelistStore } from "./whitelist.js";

/** Scripted console: fixed replies per verb, remembers every command sent. */
function console_(replies: Record<string, string | (() => string)>) {
  const sent: string[] = [];
  const session: RconSession = {
    async command(text) {
      sent.push(text);
      const key = Object.keys(replies).find((k) => text.startsWith(k));
      if (!key) throw new RconError("RCON_PROTOCOL");
      const value = replies[key];
      return {
        body: typeof value === "function" ? value() : (value ?? ""),
        truncated: false,
      };
    },
    async close() {},
  };
  return { sent, session };
}
describe("floodgate identity", () => {
  it("derives the UUID the server logged for a real Bedrock player", () => {
    // Observed on 2026-11-08: Floodgate logged .ShadowHex8245 with this UUID.
    expect(floodgateUuid("2535425006657177")).toBe(
      "00000000-0000-0000-0009-01f4a2e05e99",
    );
    expect(xuidFromFloodgateUuid("00000000-0000-0000-0009-01f4a2e05e99")).toBe(
      "2535425006657177",
    );
    expect(xuidFromFloodgateUuid("4639138c-85f6-4ddb-b850-68dc434fbfec")).toBe(
      null,
    );
    for (const bad of ["", "0", "-1", "abc", "18446744073709551616"])
      expect(() => floodgateUuid(bad)).toThrow("XUID_INVALID");
  });
  it("prefixes gamertags and replaces spaces like Floodgate", () => {
    expect(floodgateName("Big Crazy Pickle")).toBe(".Big_Crazy_Pickle");
    expect(floodgateName("Oli77777865", { prefix: "*" })).toBe("*Oli77777865");
    expect(floodgateName(" trimmed ")).toBe(".trimmed");
    for (const bad of ["", "double  space", "seventeen-chars-x", "a§b"])
      expect(() => floodgateName(bad)).toThrow("GAMERTAG_INVALID");
  });
});
describe("typed game actions", () => {
  it("parses the player list and never sends free text", async () => {
    const c = console_({
      list: "There are 2 of a max of 5 players online: .ShadowHex8245, .Oli77777865",
    });
    const actions = new GameActions(c.session, new MemoryWhitelistStore());
    const r = await actions.players();
    expect(r.detail).toEqual({
      online: 2,
      max: 5,
      names: [".ShadowHex8245", ".Oli77777865"],
    });
    expect(c.sent).toEqual(["list"]);
    const odd = console_({ list: "Unexpected console text" });
    await expect(
      new GameActions(odd.session, new MemoryWhitelistStore()).players(),
    ).rejects.toMatchObject({ code: "RCON_PROTOCOL" });
  });
  it("allows a Bedrock player by writing the Floodgate UUID and reloading, verified by listing", async () => {
    const store = new MemoryWhitelistStore([
      { uuid: "00000000-0000-0000-0009-01f4a2e05e99", name: ".ShadowHex8245" },
    ]);
    const c = console_({
      "whitelist reload": "Reloaded the whitelist",
      "whitelist list": () =>
        `There are ${store.entries.length} whitelisted player(s): ${store.entries.map((e) => e.name).join(", ")}`,
    });
    const actions = new GameActions(c.session, store);
    const r = await actions.allow({
      edition: "bedrock",
      gamertag: "BigCrazyPickle",
      xuid: "2535400000000001",
    });
    expect(r.ok).toBe(true);
    expect(r.detail).toEqual({
      name: ".BigCrazyPickle",
      uuid: floodgateUuid("2535400000000001"),
    });
    expect(store.entries).toHaveLength(2);
    expect(c.sent).toEqual(["whitelist reload", "whitelist list"]);
    // Re-allowing the same account replaces, never duplicates.
    await actions.allow({
      edition: "bedrock",
      gamertag: "BigCrazyPickle",
      xuid: "2535400000000001",
    });
    expect(store.entries).toHaveLength(2);
    const gone = await actions.revoke(".BigCrazyPickle");
    expect(gone.ok).toBe(true);
    expect(store.entries.map((e) => e.name)).toEqual([".ShadowHex8245"]);
  });
  it("reloads again when the server still shows the old file, and gives up honestly", async () => {
    const store = new MemoryWhitelistStore();
    let reloads = 0;
    const c = console_({
      "whitelist reload": () => {
        reloads++;
        return "Reloaded the whitelist";
      },
      "whitelist list": () =>
        reloads >= 2
          ? "There are 1 whitelisted player(s): .Late_Mount"
          : "There are 0 whitelisted player(s):",
    });
    const r = await new GameActions(c.session, store).allow({
      edition: "bedrock",
      gamertag: "Late Mount",
      xuid: "3",
    });
    expect(r.ok).toBe(true);
    expect(reloads).toBe(2);
    const never = console_({
      "whitelist reload": "Reloaded the whitelist",
      "whitelist list": "There are 0 whitelisted player(s):",
    });
    const gaveUp = await new GameActions(never.session, store).allow({
      edition: "bedrock",
      gamertag: "Ghost",
      xuid: "4",
    });
    expect(gaveUp.ok).toBe(false);
    expect(never.sent.filter((x) => x === "whitelist reload")).toHaveLength(4);
  });
  it("reports a Java allow as failed when the server did not actually list the player", async () => {
    const c = console_({
      "whitelist add": "That player does not exist",
      "whitelist list": "There are 0 whitelisted player(s):",
    });
    const r = await new GameActions(
      c.session,
      new MemoryWhitelistStore(),
    ).allow({ edition: "java", name: "Nobody_Here" });
    expect(r.ok).toBe(false);
    expect(r.evidence).toBe("That player does not exist");
    expect(c.sent).toEqual(["whitelist add Nobody_Here", "whitelist list"]);
  });
  it("refuses unsafe names, reasons and messages before touching the console", async () => {
    const c = console_({});
    const actions = new GameActions(c.session, new MemoryWhitelistStore());
    for (const name of ["", "has space", "a/b", "x".repeat(17), "§c"])
      await expect(actions.kick(name)).rejects.toThrow();
    await expect(actions.say("/op me")).rejects.toThrow();
    await expect(actions.say("line\nbreak")).rejects.toThrow();
    await expect(actions.say("§kobfuscated")).rejects.toThrow();
    await expect(actions.kick("Alex", "x".repeat(101))).rejects.toThrow();
    expect(c.sent).toEqual([]);
  });
  it("kicks, says, saves and stops with the server's own words as evidence", async () => {
    const c = console_({
      kick: "Kicked .ShadowHex8245: Bedtime",
      say: "",
      "save-all": "Saved the game",
      stop: () => {
        throw new RconError("RCON_CLOSED");
      },
    });
    const actions = new GameActions(c.session, new MemoryWhitelistStore());
    expect((await actions.kick(".ShadowHex8245", "Bedtime")).detail).toEqual({
      name: ".ShadowHex8245",
      wasOnline: true,
    });
    expect((await actions.say("Dinner in five minutes")).ok).toBe(true);
    expect((await actions.saveAll()).detail.saved).toBe(true);
    expect((await actions.stop()).detail.stopping).toBe(true);
    expect(c.sent).toEqual([
      "kick .ShadowHex8245 Bedtime",
      "say Dinner in five minutes",
      "save-all flush",
      "stop",
    ]);
  });
  it("refuses to overwrite an allowlist that changed underneath it", async () => {
    const store = new MemoryWhitelistStore();
    const original = store.read.bind(store);
    store.read = async () => {
      const value = await original();
      store.entries = [{ uuid: floodgateUuid("1"), name: ".Racer" }];
      return value;
    };
    const c = console_({ "whitelist reload": "", "whitelist list": "" });
    await expect(
      new GameActions(c.session, store).allow({
        edition: "bedrock",
        gamertag: "Late",
        xuid: "2",
      }),
    ).rejects.toThrow("WHITELIST_CHANGED_MEANWHILE");
    expect(c.sent).toEqual([]);
  });
});
