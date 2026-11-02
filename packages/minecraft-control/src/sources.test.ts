import {
  chmod,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { InventoryFileSource } from "./inventory.js";
import { privateGameEndpoint, queryJavaStatus, varInt } from "./java-status.js";

it("allows literal private game endpoints and rejects metadata/public/DNS/admin destinations", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.1.5",
    "172.16.1.1",
    "192.168.4.1",
    "::1",
    "fd12::1",
  ])
    expect(privateGameEndpoint(address, 25565)).toBe(true);
  for (const address of [
    "169.254.169.254",
    "8.8.8.8",
    "172.32.0.1",
    "localhost",
    "metadata.internal",
    "::ffff:169.254.169.254",
  ])
    expect(privateGameEndpoint(address, 25565)).toBe(false);
  for (const port of [22, 2375, 2376, 5432, 6379, 25575, 65536])
    expect(privateGameEndpoint("127.0.0.1", port)).toBe(false);
});
it("sends only a status handshake/request and discards chat, samples and descriptions", async () => {
  let observed = Buffer.alloc(0);
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.on("data", (bytes) => {
      observed = Buffer.concat([observed, bytes]);
      if (observed.length < (observed[0] ?? 100) + 3) return;
      const json = Buffer.from(
        JSON.stringify({
          players: { online: 2, sample: [{ name: "PRIVATE_CANARY" }] },
          description: "PRIVATE_CANARY",
        }),
      );
      const body = Buffer.concat([varInt(0), varInt(json.length), json]);
      const packet = Buffer.concat([varInt(body.length), body]);
      socket.write(packet.subarray(0, 2));
      socket.end(packet.subarray(2));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture socket required");
    const result = await queryJavaStatus({
      address: "127.0.0.1",
      port: address.port,
      protocol_version: 1,
    });
    expect(result).toEqual({ player_count: 2 });
    expect(Array.from(observed.subarray(-3))).toEqual([1, 1, 0]);
    expect(observed.length).toBe((observed[0] ?? 0) + 3);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
it("bounds malformed/oversized/unresponsive status responses without leaking error text", async () => {
  for (const response of [
    Buffer.from([255, 255, 255, 255, 255]),
    Buffer.alloc(66000, 255),
    null,
  ]) {
    const server = createServer((socket) => {
      socket.on("error", () => {});
      socket.on("data", () => {
        if (response) socket.end(response);
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("fixture socket required");
      await expect(
        queryJavaStatus({
          address: "127.0.0.1",
          port: address.port,
          protocol_version: 1,
        }),
      ).rejects.toThrow("STATUS_UNAVAILABLE");
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
});
it("protects inventory files, filters tenant targets and denies symlink/secret/unsafe endpoint input", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "craftlayer-inventory-")),
  );
  const path = join(root, "inventory.json");
  const org = "00000000-0000-4000-8000-000000000001",
    environment = "00000000-0000-4000-8000-000000000002";
  const target = {
    id: "family",
    organization_id: org,
    environment_id: environment,
    label: "Family",
    binding_hash: "a".repeat(64),
    observation: {
      observed_at: new Date().toISOString(),
      state: "offline",
      java: null,
      bedrock: null,
      players: null,
      online_authentication: null,
      allowlist_enabled: null,
      enforce_allowlist: null,
      rcon_public: null,
      backup_verified: false,
      identity_verified: false,
    },
  };
  const source = new InventoryFileSource(path);
  try {
    await writeFile(
      path,
      JSON.stringify({ schema_version: 1, targets: [target] }),
      { mode: 0o600 },
    );
    expect(await source.list(org, environment)).toHaveLength(1);
    expect(
      await source.list("00000000-0000-4000-8000-000000000003", environment),
    ).toHaveLength(0);
    await chmod(path, 0o644);
    await expect(source.list(org, environment)).rejects.toThrow(
      "INVENTORY_UNAVAILABLE",
    );
    await chmod(path, 0o600);
    for (const extra of [
      { rcon_password: "PRIVATE_CANARY" },
      {
        java_status: {
          address: "169.254.169.254",
          port: 25565,
          protocol_version: 1,
        },
      },
    ]) {
      await writeFile(
        path,
        JSON.stringify({
          schema_version: 1,
          targets: [{ ...target, ...extra }],
        }),
      );
      await expect(source.list(org, environment)).rejects.toThrow(
        "INVENTORY_UNAVAILABLE",
      );
    }
    const alias = join(root, "alias");
    await symlink(path, alias);
    await expect(
      new InventoryFileSource(alias).list(org, environment),
    ).rejects.toThrow("INVENTORY_UNAVAILABLE");
    await writeFile(path, "x".repeat(65537));
    await expect(source.list(org, environment)).rejects.toThrow(
      "INVENTORY_UNAVAILABLE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
