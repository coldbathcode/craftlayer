import { connect, type Socket } from "node:net";

/** Source RCON over TCP, as Minecraft servers implement it. Private network only:
 * the password travels in clear text, so a socket must never be reachable publicly. */
const AUTH = 3,
  EXEC = 2,
  AUTH_RESPONSE = 2,
  RESPONSE = 0,
  MAX_BODY = 4096,
  MAX_FRAME = 4096 + 10;
export class RconError extends Error {
  constructor(
    public readonly code:
      | "RCON_UNREACHABLE"
      | "RCON_AUTH_FAILED"
      | "RCON_TIMEOUT"
      | "RCON_PROTOCOL"
      | "RCON_COMMAND_INVALID"
      | "RCON_CLOSED",
  ) {
    super(code);
  }
}
export interface RconSession {
  command(text: string): Promise<{ body: string; truncated: boolean }>;
  close(): Promise<void>;
}
export interface RconOptions {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
}
/** Commands are plain server console lines: one line, printable, bounded. */
export function assertCommandText(text: string) {
  if (
    text.length === 0 ||
    text.length > 1024 ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: console lines must not carry control characters
    /[\u0000-\u001f\u007f]/.test(text)
  )
    throw new RconError("RCON_COMMAND_INVALID");
}
function frame(id: number, type: number, body: string) {
  const payload = Buffer.from(body, "utf8");
  if (payload.length > MAX_BODY) throw new RconError("RCON_COMMAND_INVALID");
  const packet = Buffer.alloc(14 + payload.length);
  packet.writeInt32LE(10 + payload.length, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  payload.copy(packet, 12);
  return packet;
}
class Connection implements RconSession {
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #closed = false;
  #waiting: {
    id: number;
    resolve: (v: { body: string; truncated: boolean }) => void;
    reject: (e: Error) => void;
  } | null = null;
  constructor(
    private readonly socket: Socket,
    private readonly timeoutMs: number,
  ) {
    socket.on("data", (chunk: Buffer) => this.#onData(chunk));
    socket.on("close", () => this.#fail(new RconError("RCON_CLOSED")));
    socket.on("error", () => this.#fail(new RconError("RCON_CLOSED")));
  }
  #fail(error: RconError) {
    this.#closed = true;
    const w = this.#waiting;
    this.#waiting = null;
    w?.reject(error);
  }
  #onData(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    if (this.#buffer.length > MAX_FRAME * 4) {
      this.#fail(new RconError("RCON_PROTOCOL"));
      this.socket.destroy();
      return;
    }
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readInt32LE(0);
      if (length < 10 || length > MAX_FRAME) {
        this.#fail(new RconError("RCON_PROTOCOL"));
        this.socket.destroy();
        return;
      }
      if (this.#buffer.length < 4 + length) return;
      const id = this.#buffer.readInt32LE(4),
        type = this.#buffer.readInt32LE(8),
        body = this.#buffer.subarray(12, 2 + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(4 + length);
      const w = this.#waiting;
      if (!w) continue;
      if (id === -1) {
        // An auth response carrying id -1 means the password was refused.
        this.#waiting = null;
        w.reject(new RconError("RCON_AUTH_FAILED"));
        continue;
      }
      if (type !== RESPONSE && type !== AUTH_RESPONSE) continue;
      if (id !== w.id) continue;
      this.#waiting = null;
      w.resolve({ body, truncated: body.length >= MAX_BODY });
    }
  }
  #send(type: number, body: string) {
    if (this.#closed) return Promise.reject(new RconError("RCON_CLOSED"));
    if (this.#waiting) return Promise.reject(new RconError("RCON_PROTOCOL"));
    const id = this.#nextId++;
    return new Promise<{ body: string; truncated: boolean }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.#waiting?.id === id) {
            this.#waiting = null;
            this.socket.destroy();
            reject(new RconError("RCON_TIMEOUT"));
          }
        }, this.timeoutMs);
        this.#waiting = {
          id,
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
        this.socket.write(frame(id, type, body));
      },
    );
  }
  async authenticate(password: string) {
    await this.#send(AUTH, password);
  }
  async command(text: string) {
    assertCommandText(text);
    return this.#send(EXEC, text);
  }
  async close() {
    this.#closed = true;
    await new Promise<void>((done) => this.socket.end(() => done()));
    this.socket.destroy();
  }
}
/** Connects, authenticates and returns a session. The password is never retained or logged. */
export async function openRcon(options: RconOptions): Promise<RconSession> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = connect({ host: options.host, port: options.port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new RconError("RCON_UNREACHABLE"));
    }, timeoutMs);
    s.once("connect", () => {
      clearTimeout(timer);
      s.setNoDelay(true);
      resolve(s);
    });
    s.once("error", () => {
      clearTimeout(timer);
      reject(new RconError("RCON_UNREACHABLE"));
    });
  });
  const connection = new Connection(socket, timeoutMs);
  try {
    await connection.authenticate(options.password);
  } catch (error) {
    await connection.close().catch(() => {});
    throw error;
  }
  return connection;
}
export const rconPacketTypes = { AUTH, EXEC, RESPONSE, MAX_BODY } as const;
