import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { type InventoryTarget, inventorySchema } from "@craftlayer/contracts";
import type { ObservationSource } from "./index.js";
import { privateGameEndpoint, queryJavaStatus } from "./java-status.js";
export class InventoryFileSource implements ObservationSource {
  #reads = 0;
  #queries = 0;
  constructor(private readonly path?: string) {}
  async list(org: string, environment: string): Promise<InventoryTarget[]> {
    if (!this.path) return [];
    if (this.#reads >= 4) throw new Error("INVENTORY_UNAVAILABLE");
    this.#reads++;
    let file: FileHandle | undefined;
    try {
      file = await open(
        this.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.size > 65536 ||
        (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.()
      )
        throw new Error("INVENTORY_DENIED");
      const bytes = Buffer.alloc(65537);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const after = await file.stat();
      if (
        bytesRead > 65536 ||
        bytesRead !== after.size ||
        stat.size !== after.size ||
        stat.mtimeMs !== after.mtimeMs
      )
        throw new Error("INVENTORY_CHANGED");
      const data = inventorySchema.parse(
        JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")),
      );
      if (
        data.targets.some(
          (t) =>
            t.java_status &&
            !privateGameEndpoint(t.java_status.address, t.java_status.port),
        )
      )
        throw new Error("INVENTORY_ENDPOINT_DENIED");
      return data.targets.filter(
        (t) => t.organization_id === org && t.environment_id === environment,
      );
    } catch {
      throw new Error("INVENTORY_UNAVAILABLE");
    } finally {
      try {
        await file?.close();
      } finally {
        this.#reads--;
      }
    }
  }
  async observe(org: string, environment: string, targetId: string) {
    const target = (await this.list(org, environment)).find(
      (t) => t.id === targetId,
    );
    if (!target) throw new Error("INVENTORY_UNAVAILABLE");
    if (!target.java_status) return target;
    if (this.#queries >= 4) throw new Error("INVENTORY_UNAVAILABLE");
    this.#queries++;
    // Status-only protocol cannot prove authentication/allowlist/backup policy
    // or enumerate all players. Never project server-supplied descriptions/chat.
    try {
      const result = await queryJavaStatus(target.java_status);
      return {
        ...target,
        observation: {
          ...target.observation,
          source: "java_status" as const,
          observed_at: new Date().toISOString(),
          state: "online" as const,
          players: null,
          reported_player_count: result.player_count,
          online_authentication: null,
          allowlist_enabled: null,
          enforce_allowlist: null,
          rcon_public: null,
        },
      };
    } catch {
      return {
        ...target,
        observation: {
          ...target.observation,
          source: "java_status" as const,
          observed_at: new Date().toISOString(),
          state: "unavailable" as const,
          players: null,
          reported_player_count: 0,
          online_authentication: null,
          allowlist_enabled: null,
          enforce_allowlist: null,
          rcon_public: null,
        },
      };
    } finally {
      this.#queries--;
    }
  }
}
