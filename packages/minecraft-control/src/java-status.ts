import { createConnection, isIP } from "node:net";
export function privateGameEndpoint(address: string, port: number) {
  const ip = isIP(address);
  const parts = address.split(".").map(Number);
  const ipv4 =
    ip === 4 &&
    (parts[0] === 127 ||
      parts[0] === 10 ||
      (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
      (parts[0] === 192 && parts[1] === 168));
  const ipv6 =
    ip === 6 && (address === "::1" || /^(fc|fd)[a-f0-9]{2}:/i.test(address));
  return (
    (ipv4 || ipv6) &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535 &&
    ![2375, 2376, 5432, 6379, 25575].includes(port)
  );
}
export function varInt(value: number) {
  const bytes: number[] = [];
  let n = value >>> 0;
  do {
    let b = n & 127;
    n >>>= 7;
    if (n) b |= 128;
    bytes.push(b);
  } while (n);
  return Buffer.from(bytes);
}
function readInt(
  buffer: Buffer,
  offset: number,
): { value: number; next: number } | null {
  let value = 0;
  for (let n = 0; n < 5; n++) {
    const b = buffer[offset + n];
    if (b === undefined) return null;
    if (n === 4 && (b & 0xf8) !== 0) throw new Error("STATUS_FRAME_INVALID");
    value |= (b & 127) << (n * 7);
    if ((b & 128) === 0) return { value, next: offset + n + 1 };
  }
  throw new Error("STATUS_FRAME_INVALID");
}
export async function queryJavaStatus(endpoint: {
  address: string;
  port: number;
  protocol_version: number;
}): Promise<{ player_count: number }> {
  if (
    !privateGameEndpoint(endpoint.address, endpoint.port) ||
    !Number.isInteger(endpoint.protocol_version) ||
    endpoint.protocol_version < 1 ||
    endpoint.protocol_version > 100000
  )
    throw new Error("STATUS_TARGET_DENIED");
  return new Promise((resolve, reject) => {
    let done = false;
    let data: Buffer = Buffer.alloc(0);
    const socket = createConnection({
      host: endpoint.address,
      port: endpoint.port,
      family: isIP(endpoint.address),
    });
    const finish = (value?: { player_count: number }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (value) resolve(value);
      else reject(new Error("STATUS_UNAVAILABLE"));
    };
    const timer = setTimeout(() => finish(), 1000);
    timer.unref();
    socket.on("error", () => finish());
    socket.on("end", () => finish());
    socket.on("connect", () => {
      const host = Buffer.from(endpoint.address, "utf8");
      const port = Buffer.alloc(2);
      port.writeUInt16BE(endpoint.port);
      // Fixed handshake nextState=1 followed by status request id=0. No login,
      // ping echo, command, credential or caller-selected packet is supported.
      const handshake = Buffer.concat([
        varInt(0),
        varInt(endpoint.protocol_version),
        varInt(host.length),
        host,
        port,
        varInt(1),
      ]);
      socket.write(
        Buffer.concat([
          varInt(handshake.length),
          handshake,
          Buffer.from([1, 0]),
        ]),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      if (done) return;
      if (data.length + chunk.length > 65536) {
        finish();
        return;
      }
      data = Buffer.concat([data, chunk]);
      try {
        const frame = readInt(data, 0);
        if (!frame) return;
        if (frame.value <= 0 || frame.value > 65530) {
          finish();
          return;
        }
        if (data.length < frame.next + frame.value) return;
        if (data.length !== frame.next + frame.value) {
          finish();
          return;
        }
        const id = readInt(data, frame.next);
        if (id?.value !== 0) {
          finish();
          return;
        }
        const text = readInt(data, id.next);
        if (!text || text.value !== data.length - text.next) {
          finish();
          return;
        }
        const payload = JSON.parse(
          data.subarray(text.next).toString("utf8"),
        ) as { players?: { online?: unknown } };
        const count = payload?.players?.online;
        if (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0 ||
          count > 10000
        ) {
          finish();
          return;
        }
        finish({ player_count: count });
      } catch {
        finish();
      }
    });
  });
}
