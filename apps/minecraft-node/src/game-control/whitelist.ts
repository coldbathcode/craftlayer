import { open, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/** Vanilla/Paper `whitelist.json`: an array of {uuid, name}. Floodgate players carry
 * zero-prefixed UUIDs that no Mojang lookup can resolve, so they are written here
 * directly and the server is told to reload. Writes are atomic and bounded. */
// Floodgate UUIDs have a zero version nibble, so RFC 4122 validation would reject them.
const anyUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const whitelistEntry = z.strictObject({
  uuid: anyUuid,
  name: z.string().regex(/^[A-Za-z0-9_.]{1,17}$/),
});
export const whitelistFile = z.array(whitelistEntry).max(1000);
export type WhitelistEntry = z.infer<typeof whitelistEntry>;
export interface WhitelistStore {
  read(): Promise<WhitelistEntry[]>;
  /** Replaces the file with `entries`; returns false if the file changed meanwhile. */
  write(
    previous: WhitelistEntry[],
    entries: WhitelistEntry[],
  ): Promise<boolean>;
}
export class FileWhitelistStore implements WhitelistStore {
  constructor(private readonly path: string) {
    if (!path.startsWith("/") || !path.endsWith("/whitelist.json"))
      throw new Error("WHITELIST_PATH_INVALID");
  }
  async read() {
    const raw = await readFile(this.path, "utf8");
    if (raw.length > 256 * 1024) throw new Error("WHITELIST_TOO_LARGE");
    return whitelistFile.parse(JSON.parse(raw));
  }
  async write(previous: WhitelistEntry[], entries: WhitelistEntry[]) {
    whitelistFile.parse(entries);
    // Compare against what the caller read so a concurrent server-side edit is not lost.
    const current = await this.read();
    if (JSON.stringify(current) !== JSON.stringify(previous)) return false;
    const temporary = join(dirname(this.path), `.whitelist.${process.pid}.tmp`);
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(entries, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.path);
    return true;
  }
}
export class MemoryWhitelistStore implements WhitelistStore {
  constructor(public entries: WhitelistEntry[] = []) {}
  async read() {
    return structuredClone(this.entries);
  }
  async write(previous: WhitelistEntry[], entries: WhitelistEntry[]) {
    if (JSON.stringify(this.entries) !== JSON.stringify(previous)) return false;
    this.entries = structuredClone(whitelistFile.parse(entries));
    return true;
  }
}
