import { request } from "node:http";
import { type NodeCapacity, nodeCapacity } from "@craftlayer/contracts";
import { z } from "zod";

const id = z.string().regex(/^[a-f0-9]{64}$/),
  maxBytes = 1024 * 1024;
/** This adapter exposes fixed reads only. Socket access still implies host compromise risk. */
export class DockerInventory {
  constructor(private readonly socket: string) {
    if (!socket.startsWith("/") || socket.includes("\0"))
      throw new Error("LOCAL_DOCKER_SOCKET_REQUIRED");
  }
  async #read(path: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socket,
          path: `/v1.50${path}`,
          method: "GET",
          agent: false,
          timeout: 2000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy(new Error("DOCKER_RESPONSE_LIMIT"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            try {
              if (res.statusCode !== 200)
                throw new Error("DOCKER_INVENTORY_UNAVAILABLE");
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new Error("DOCKER_INVENTORY_UNAVAILABLE"));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("DOCKER_TIMEOUT")));
      req.on("error", () => reject(new Error("DOCKER_INVENTORY_UNAVAILABLE")));
      req.end();
    });
  }
  async read(now = Date.now()): Promise<NodeCapacity> {
    const deadline = Date.now() + 5000;
    const [rawInfo, rawContainers] = await Promise.all([
      this.#read("/info"),
      this.#read("/containers/json?all=true"),
    ]);
    const info = z
      .object({
        NCPU: z.number().int().min(1).max(4096),
        MemTotal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        Architecture: z.string(),
      })
      .parse(rawInfo);
    const containers = z
      .array(z.object({ Id: id }))
      .max(256)
      .parse(rawContainers);
    let memory = 0,
      unbounded = 0;
    const ports: NodeCapacity["occupied_ports"] = [];
    // Bound concurrency and consider stopped/unrelated containers without projecting their secrets/names.
    for (let start = 0; start < containers.length; start += 4) {
      if (Date.now() > deadline) throw new Error("DOCKER_INVENTORY_DEADLINE");
      const batch = await Promise.all(
        containers
          .slice(start, start + 4)
          .map((c) => this.#read(`/containers/${c.Id}/json`)),
      );
      for (const raw of batch) {
        const c = z
          .object({
            HostConfig: z.object({
              Memory: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
              PortBindings: z
                .record(
                  z.string(),
                  z
                    .array(
                      z.object({ HostIp: z.string(), HostPort: z.string() }),
                    )
                    .nullable(),
                )
                .nullable(),
            }),
          })
          .parse(raw);
        if (c.HostConfig.Memory === 0) unbounded++;
        else memory += c.HostConfig.Memory;
        for (const [port, bindings] of Object.entries(
          c.HostConfig.PortBindings ?? {},
        )) {
          const protocol = port.split("/")[1];
          if (protocol !== "tcp" && protocol !== "udp")
            throw new Error("UNSUPPORTED_PORT_PROTOCOL");
          for (const b of bindings ?? []) {
            const number = Number(b.HostPort);
            if (!Number.isInteger(number) || number < 1 || number > 65535)
              throw new Error("UNRESOLVED_HOST_PORT");
            ports.push({
              host_ip: b.HostIp || "0.0.0.0",
              port: number,
              protocol,
            });
            if (ports.length > 128) throw new Error("DOCKER_PORT_LIMIT");
          }
        }
      }
    }
    return nodeCapacity.parse({
      observed_at: new Date(now).toISOString(),
      docker_api: "1.50",
      architecture: ["aarch64", "arm64"].includes(info.Architecture)
        ? "arm64"
        : ["x86_64", "amd64"].includes(info.Architecture)
          ? "amd64"
          : "other",
      cpu_count: info.NCPU,
      memory_total_mb: Math.floor(info.MemTotal / 1048576),
      memory_reserved_mb: Math.ceil(memory / 1048576),
      unbounded_containers: unbounded,
      container_count: containers.length,
      occupied_ports: ports,
      network_inventory_complete: false,
      disk_quota_verified: false,
      provisioning_qualified: false,
    });
  }
}
