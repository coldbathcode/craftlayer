import { expect, it } from "vitest";
import { EventCursor } from "./cursor.js";

it("hides global ordinals, binds scope, detects tampering and expires for snapshot resync", () => {
  let now = 1000000;
  const codec = new EventCursor("a".repeat(64), () => now),
    scope = "b".repeat(64),
    anchor = crypto.randomUUID(),
    a = codec.encode(scope, "999999999", anchor),
    b = codec.encode(scope, "1", anchor);
  expect(a.length).toBe(b.length);
  expect(a).not.toBe(codec.encode(scope, "999999999", anchor));
  expect(codec.decode(scope, a)).toMatchObject({
    sequence: "0000000000999999999",
    anchor,
    expired: false,
  });
  expect(() => codec.decode("c".repeat(64), a)).toThrow();
  expect(() =>
    codec.decode(
      scope,
      `${a.slice(0, 20)}${a[20] === "a" ? "b" : "a"}${a.slice(21)}`,
    ),
  ).toThrow();
  now += 900001;
  expect(codec.decode(scope, a).expired).toBe(true);
});
