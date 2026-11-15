import { describe, expect, it } from "vitest";
import { CorrectionGuard } from "./correction-guard.js";
import { installTickEndShim } from "./protocol.js";

function recorder() {
  const sent: string[] = [];
  const client = {
    write(name: string, _params: unknown) {
      sent.push(name);
      return true;
    },
  };
  installTickEndShim(client);
  return { client, sent };
}

describe("tick-end shim", () => {
  it("closes the tick between two position-bearing packets", () => {
    const { client, sent } = recorder();
    client.write("teleport_confirm", {});
    client.write("position_look", {});
    client.write("position", {});
    client.write("tick_end", {});
    expect(sent).toEqual([
      "teleport_confirm",
      "position_look",
      "tick_end",
      "position",
      "tick_end",
    ]);
  });
  it("leaves a normal tick untouched", () => {
    const { client, sent } = recorder();
    client.write("position", {});
    client.write("tick_end", {});
    client.write("position", {});
    client.write("chat_message", {});
    client.write("tick_end", {});
    expect(sent).toEqual([
      "position",
      "tick_end",
      "position",
      "chat_message",
      "tick_end",
    ]);
  });
});

describe("correction guard", () => {
  it("flags a burst of corrections inside the window", () => {
    const guard = new CorrectionGuard({ threshold: 3, windowMs: 1000 });
    guard.record(0);
    guard.record(100);
    expect(guard.looping(200)).toBe(false);
    guard.record(200);
    expect(guard.looping(200)).toBe(true);
    expect(guard.total).toBe(3);
  });
  it("forgets corrections older than the window", () => {
    const guard = new CorrectionGuard({ threshold: 3, windowMs: 1000 });
    guard.record(0);
    guard.record(100);
    guard.record(200);
    expect(guard.looping(1150)).toBe(false);
    guard.record(1200);
    guard.reset();
    expect(guard.looping(1200)).toBe(false);
  });
  it("rejects meaningless options", () => {
    expect(() => new CorrectionGuard({ threshold: 1, windowMs: 10 })).toThrow(
      "CORRECTION_GUARD_OPTIONS",
    );
  });
});
