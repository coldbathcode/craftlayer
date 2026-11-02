import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { privateController } from "./client.js";
import { DockerInventory } from "./docker.js";

it("uses fixed read requests, includes all workload reservations and omits secrets/names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "craftlayer-node-engine-")),
    socket = join(directory, "engine.sock"),
    requests: string[] = [];
  const id = "a".repeat(64);
  let dynamic = false;
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.endsWith("/info")
          ? {
              NCPU: 4,
              MemTotal: 8 * 1024 ** 3,
              Architecture: "arm64",
              secret: "NODE_SECRET_CANARY",
            }
          : req.url?.includes("/containers/json")
            ? [{ Id: id, Names: ["private-player-name"] }]
            : {
                HostConfig: {
                  Memory: 2 * 1024 ** 3,
                  PortBindings: {
                    "25565/tcp": [
                      { HostIp: "0.0.0.0", HostPort: dynamic ? "" : "25565" },
                    ],
                  },
                },
                ...(dynamic
                  ? {
                      NetworkSettings: {
                        Ports: {
                          "25565/tcp": [
                            { HostIp: "0.0.0.0", HostPort: "32768" },
                            { HostIp: "0.0.0.0", HostPort: "32768" },
                          ],
                        },
                      },
                    }
                  : {}),
                Config: { Env: ["RCON_PASSWORD=NODE_SECRET_CANARY"] },
              },
      ),
    );
  });
  await new Promise<void>((done) => server.listen(socket, done));
  try {
    const result = await new DockerInventory(socket).read();
    expect(result).toMatchObject({
      cpu_count: 4,
      memory_total_mb: 8192,
      memory_reserved_mb: 2048,
      container_count: 1,
      provisioning_qualified: false,
    });
    expect(result.occupied_ports).toEqual([
      { host_ip: "0.0.0.0", port: 25565, protocol: "tcp" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/CANARY|private-player/);
    expect(requests.every((r) => r.startsWith("GET /v1.50/"))).toBe(true);
    expect(requests).toHaveLength(3);
    dynamic = true;
    const assigned = await new DockerInventory(socket).read();
    expect(assigned.occupied_ports).toEqual([
      { host_ip: "0.0.0.0", port: 32768, protocol: "tcp" },
    ]);
    expect(assigned.network_inventory_complete).toBe(false);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
it("requires literal private HTTPS controller with no redirect/HTTP/metadata endpoint escape", () => {
  expect(privateController("https://127.0.0.1:9443").hostname).toBe(
    "127.0.0.1",
  );
  expect(privateController("https://100.100.100.100:9443").protocol).toBe(
    "https:",
  );
  for (const url of [
    "http://127.0.0.1:9443",
    "https://169.254.169.254",
    "https://8.8.8.8",
    "https://controller.example.invalid",
    "https://user:pass@10.0.0.1",
    "https://10.0.0.1/path",
  ])
    expect(() => privateController(url)).toThrow();
});

it("bounds a slow Docker response even when it keeps sending bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "craftlayer-node-slow-")),
    socket = join(directory, "engine.sock");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write(" ");
    const trickle = setInterval(() => res.write(" "), 100);
    res.once("close", () => clearInterval(trickle));
  });
  await new Promise<void>((done) => server.listen(socket, done));
  try {
    await expect(new DockerInventory(socket).read()).rejects.toThrow(
      "DOCKER_INVENTORY_UNAVAILABLE",
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}, 7000);
