import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { protectedNodeFile } from "@craftlayer/node-protocol";
import { z } from "zod";

const state = z.strictObject({
  node_id: z.uuid(),
  credential_version: z.number().int().positive(),
  sequence: z.number().int().min(0).max(2147483646),
});
/** A crash leaves a lock for explicit operator review; it never resets the sequence. */
export class NodeJournal {
  #lock: Awaited<ReturnType<typeof open>> | undefined;
  constructor(
    private readonly directory: string,
    private readonly node: string,
    private readonly version: number,
  ) {}
  async lock() {
    let created = false;
    await mkdir(this.directory, { mode: 0o700 })
      .then(() => {
        created = true;
      })
      .catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
    const stat = await lstat(this.directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error("NODE_JOURNAL_NOT_PRIVATE");
    const marker = join(this.directory, "binding.json");
    if (created)
      await writeFile(marker, JSON.stringify({ node_id: this.node }), {
        mode: 0o600,
        flag: "wx",
      });
    const binding = z
      .strictObject({ node_id: z.uuid() })
      .parse(JSON.parse(await protectedNodeFile(marker)));
    if (binding.node_id !== this.node)
      throw new Error("NODE_JOURNAL_BINDING_DENIED");
    this.#lock = await open(join(this.directory, "agent.lock"), "wx", 0o600);
    await this.#lock.writeFile(String(process.pid));
    await this.#lock.sync();
    return created;
  }
  async next() {
    const path = join(this.directory, `sequence-${this.version}.json`);
    let previous = 0;
    try {
      const v = state.parse(JSON.parse(await protectedNodeFile(path)));
      if (v.node_id !== this.node || v.credential_version !== this.version)
        throw new Error("NODE_JOURNAL_BINDING_DENIED");
      previous = v.sequence;
    } catch (e) {
      if (!e || typeof e !== "object" || !("code" in e) || e.code !== "ENOENT")
        throw e;
    }
    if (previous >= 2147483645)
      throw new Error("NODE_CREDENTIAL_ROTATION_REQUIRED");
    const sequence = previous + 1,
      temp = join(this.directory, `.sequence-${randomUUID()}`),
      file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({
          node_id: this.node,
          credential_version: this.version,
          sequence,
        }),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
    const directory = await open(this.directory, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return sequence;
  }
  async close() {
    if (this.#lock) {
      await this.#lock.close();
      await unlink(join(this.directory, "agent.lock"));
      this.#lock = undefined;
    }
  }
}
