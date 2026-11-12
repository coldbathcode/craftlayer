import {
  agentTokenPermissionSchema,
  serverActionKind,
} from "@craftlayer/contracts";
import { describe, expect, it } from "vitest";
import {
  askKinds,
  asksLine,
  askWords,
  helperReads,
  list,
  readsLine,
  requestText,
  requestWords,
  seenBy,
  serverGroups,
} from "./helper-words.js";

const world = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002",
  project = "00000000-0000-4000-8000-000000000003";
const servers = [
  { name: "Family Survival", project_id: project, environment_id: world },
  { name: "Creative", project_id: project, environment_id: world },
  { name: "Old World", project_id: project, environment_id: other },
];
describe("helper words", () => {
  it("has plain words for every action a helper may ask for", () => {
    expect([...askKinds].sort()).toEqual([...serverActionKind.options].sort());
    for (const kind of serverActionKind.options)
      expect(askWords[kind]).toMatch(/^[a-z ]+$/);
  });
  it("gives a new helper only read permissions the API accepts", () => {
    for (const permission of helperReads)
      expect(agentTokenPermissionSchema.options).toContain(permission);
    expect(helperReads).toEqual(
      expect.arrayContaining(["server:read", "player:read", "backup:read"]),
    );
    expect(helperReads).not.toContain("node:read");
    expect(new Set(helperReads).size).toBe(helperReads.length);
  });
  it("joins lists the way people say them", () => {
    expect(list([])).toBe("");
    expect(list(["a"])).toBe("a");
    expect(list(["a", "b"])).toBe("a and b");
    expect(list(["a", "b", "c"])).toBe("a, b and c");
  });
  it("says what a helper reads and may ask for without internal names", () => {
    expect(readsLine(helperReads)).toBe("servers, players and backups");
    expect(readsLine(["organization:read"])).toBe("names only");
    expect(asksLine([])).toBe("");
    expect(asksLine(["stop", "allow_player"])).toBe(
      "let a player join and turn off",
    );
  });
  it("describes each request in plain words", () => {
    const s = "Family Survival";
    expect(
      requestWords(
        {
          kind: "allow_player",
          player: { edition: "java", name: "BigCrazyPickle" },
        },
        s,
      ),
    ).toBe("let BigCrazyPickle join Family Survival");
    expect(
      requestWords(
        {
          kind: "allow_player",
          player: { edition: "bedrock", gamertag: "Big Pickle", xuid: "123" },
        },
        s,
      ),
    ).toBe("let Big Pickle join Family Survival");
    expect(
      requestWords({ kind: "revoke_player", name: ".Big_Pickle" }, s),
    ).toBe("remove Big Pickle from Family Survival");
    expect(requestWords({ kind: "kick_player", name: "Alex" }, s)).toBe(
      "kick Alex from Family Survival",
    );
    expect(requestWords({ kind: "say", message: "hi" }, s)).toBe(
      "send a message to everyone on Family Survival",
    );
    expect(requestWords({ kind: "save" }, s)).toBe(
      "save the world on Family Survival",
    );
    expect(requestWords({ kind: "start" }, s)).toBe("turn on Family Survival");
    expect(requestWords({ kind: "stop" }, s)).toBe("turn off Family Survival");
    expect(requestWords({ kind: "restart" }, s)).toBe(
      "restart Family Survival",
    );
  });
  it("picks out the words a helper wants shown in the game", () => {
    expect(requestText({ kind: "say", message: "hi all" })).toBe("hi all");
    expect(
      requestText({ kind: "kick_player", name: "Alex", reason: "bedtime" }),
    ).toBe("bedtime");
    expect(requestText({ kind: "kick_player", name: "Alex" })).toBeNull();
    expect(requestText({ kind: "stop" })).toBeNull();
  });
  it("groups servers that one key would cover together", () => {
    expect(serverGroups(servers)).toEqual([
      {
        key: world,
        projectId: project,
        environmentId: world,
        names: ["Family Survival", "Creative"],
      },
      {
        key: other,
        projectId: project,
        environmentId: other,
        names: ["Old World"],
      },
    ]);
    expect(serverGroups([])).toEqual([]);
  });
  it("names the servers a connected helper can see", () => {
    expect(
      seenBy({ project_id: project, environment_id: world }, servers),
    ).toEqual(["Family Survival", "Creative"]);
    expect(
      seenBy({ project_id: project, environment_id: null }, servers),
    ).toEqual(["Family Survival", "Creative", "Old World"]);
    expect(
      seenBy({ project_id: other, environment_id: null }, servers),
    ).toEqual([]);
  });
});
