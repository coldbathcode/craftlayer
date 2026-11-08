import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { assertCommandText, openRcon, RconError } from "./rcon.js";

const PASSWORD = "rcon-secret-canary-7f3a";
function packet(id: number, type: number, body: string) {
  const payload = Buffer.from(body, "utf8"),
    p = Buffer.alloc(14 + payload.length);
  p.writeInt32LE(10 + payload.length, 0);
  p.writeInt32LE(id, 4);
  p.writeInt32LE(type, 8);
  payload.copy(p, 12);
  return p;
}
/** Minimal Minecraft-like RCON server: auth, then echoes commands through a handler. */
function fakeServer(
  handle: (command: string, socket: Socket, id: number) => void,
  options: { fragment?: boolean; slow?: boolean } = {},
) {
  const seen: string[] = [];
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0),
      authenticated = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0);
        if (buffer.length < 4 + length) return;
        const id = buffer.readInt32LE(4),
          type = buffer.readInt32LE(8),
          body = buffer.subarray(12, 2 + length).toString("utf8");
        buffer = buffer.subarray(4 + length);
        if (type === 3) {
          authenticated = body === PASSWORD;
          socket.write(packet(authenticated ? id : -1, 2, ""));
          continue;
        }
        if (!authenticated) {
          socket.destroy();
          return;
        }
        seen.push(body);
        if (options.slow) continue;
        handle(body, socket, id);
      }
    });
  });
  return {
    seen,
    server,
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        }),
      ),
  };
}
const reply =
  (text: string, fragment = false) =>
  (_command: string, socket: Socket, id: number) => {
    const p = packet(id, 0, text);
    if (fragment) {
      socket.write(p.subarray(0, 7));
      setTimeout(() => socket.write(p.subarray(7)), 20);
    } else socket.write(p);
  };
let servers: Server[] = [];
afterEach(async () => {
  for (const s of servers) await new Promise((done) => s.close(done));
  servers = [];
});
describe("rcon client", () => {
  it("authenticates, sends commands and reassembles fragmented frames", async () => {
    const fake = fakeServer(
      reply("There are 0 of a max of 5 players online:", true),
    );
    servers.push(fake.server);
    const port = await fake.listen();
    const session = await openRcon({
      host: "127.0.0.1",
      port,
      password: PASSWORD,
      timeoutMs: 1000,
    });
    const r = await session.command("list");
    expect(r.body).toBe("There are 0 of a max of 5 players online:");
    expect(r.truncated).toBe(false);
    expect(fake.seen).toEqual(["list"]);
    await session.close();
    await expect(session.command("list")).rejects.toMatchObject({
      code: "RCON_CLOSED",
    });
  });
  it("refuses a wrong password without echoing it", async () => {
    const fake = fakeServer(reply("never"));
    servers.push(fake.server);
    const port = await fake.listen();
    let caught: unknown;
    try {
      await openRcon({
        host: "127.0.0.1",
        port,
        password: "wrong-password-canary",
        timeoutMs: 1000,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RconError);
    expect((caught as RconError).code).toBe("RCON_AUTH_FAILED");
    expect(JSON.stringify(caught)).not.toContain("canary");
    expect(fake.seen).toEqual([]);
  });
  it("times out a silent server and reports unreachable ports", async () => {
    const fake = fakeServer(reply("x"), { slow: true });
    servers.push(fake.server);
    const port = await fake.listen();
    const session = await openRcon({
      host: "127.0.0.1",
      port,
      password: PASSWORD,
      timeoutMs: 200,
    });
    await expect(session.command("list")).rejects.toMatchObject({
      code: "RCON_TIMEOUT",
    });
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", () => r()));
    const address = closed.address();
    const free = typeof address === "object" && address ? address.port : 0;
    await new Promise((r) => closed.close(r));
    await expect(
      openRcon({
        host: "127.0.0.1",
        port: free,
        password: PASSWORD,
        timeoutMs: 500,
      }),
    ).rejects.toMatchObject({ code: "RCON_UNREACHABLE" });
  });
  it("rejects multi-line, control-character, empty and oversized command text", () => {
    for (const bad of ["", "list\nstop", "say \u0007", "x".repeat(1025)])
      expect(() => assertCommandText(bad)).toThrow(RconError);
    expect(() => assertCommandText("whitelist list")).not.toThrow();
  });
  it("drops the connection on a malformed frame length", async () => {
    const fake = fakeServer((_c, socket) => {
      const bad = Buffer.alloc(4);
      bad.writeInt32LE(999999, 0);
      socket.write(bad);
    });
    servers.push(fake.server);
    const port = await fake.listen();
    const session = await openRcon({
      host: "127.0.0.1",
      port,
      password: PASSWORD,
      timeoutMs: 1000,
    });
    await expect(session.command("list")).rejects.toMatchObject({
      code: "RCON_PROTOCOL",
    });
  });
});
