import { describe, expect, it } from "vitest";
import { parseKnocks } from "./knocks.js";

const now = Date.parse("2026-11-08T17:00:00Z");
const line = (at: string, name: string, uuid: string, extra = "") =>
  `{"v":1,"at":"${at}","result":"KICK_WHITELIST","edition":"bedrock","name":"${name}","uuid":"${uuid}"${extra}}`;
describe("knock records", () => {
  it("groups attempts per account, derives the XUID from the UUID and drops stale or bad lines", () => {
    const text = [
      line(
        "2026-11-08T15:50:14Z",
        ".BigCrazyPickle",
        "00000000-0000-0000-0009-01eed05d1001",
      ),
      "not json",
      '{"v":1,"at":"2026-11-08T15:51:00Z","result":"ALLOWED","edition":"bedrock","name":"x","uuid":"00000000-0000-0000-0009-01eed05d1001"}',
      line(
        "2026-11-08T15:52:44Z",
        ".BigCrazyPickle",
        "00000000-0000-0000-0009-01eed05d1001",
        ',"xuid":"999"',
      ),
      line(
        "2026-11-07T10:00:00Z",
        ".Yesterday",
        "00000000-0000-0000-0009-01eed05d1002",
      ),
      line(
        "2026-11-08T16:10:00Z",
        "JavaKid",
        "7d3f9c2e-1b4a-4c8d-9e6f-0a1b2c3d4e5f",
      ),
      line(
        "2026-11-08T18:30:00Z",
        ".FromTheFuture",
        "00000000-0000-0000-0009-01eed05d1003",
      ),
    ].join("\n");
    const knocks = parseKnocks(text, now);
    expect(knocks).toEqual([
      {
        uuid: "00000000-0000-0000-0009-01eed05d1001",
        name: ".BigCrazyPickle",
        edition: "bedrock",
        xuid: "2535400000000001",
        first_at: "2026-11-08T15:50:14Z",
        last_at: "2026-11-08T15:52:44Z",
        attempts: 2,
      },
      {
        uuid: "7d3f9c2e-1b4a-4c8d-9e6f-0a1b2c3d4e5f",
        name: "JavaKid",
        edition: "java",
        xuid: null,
        first_at: "2026-11-08T16:10:00Z",
        last_at: "2026-11-08T16:10:00Z",
        attempts: 1,
      },
    ]);
  });
  it("returns nothing for an empty or oversized garbage file", () => {
    expect(parseKnocks("", now)).toEqual([]);
    expect(parseKnocks("x".repeat(3 * 1024 * 1024), now)).toEqual([]);
  });
});
