import { randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { NodeJournal } from "./journal.js";

it("persists sequence before reconnect, excludes a second process and refuses a foreign binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "craftlayer-node-journal-")),
    path = join(root, "journal"),
    node = randomUUID();
  const journal = new NodeJournal(path, node, 1);
  try {
    await journal.lock();
    expect(await journal.next()).toBe(1);
    await expect(new NodeJournal(path, node, 1).lock()).rejects.toThrow();
    await journal.close();
    const again = new NodeJournal(path, node, 1);
    await again.lock();
    expect(await again.next()).toBe(2);
    await again.close();
    await expect(new NodeJournal(path, randomUUID(), 1).lock()).rejects.toThrow(
      "NODE_JOURNAL_BINDING_DENIED",
    );
    await writeFile(join(path, "sequence-1.json"), "corrupt");
    const broken = new NodeJournal(path, node, 1);
    await broken.lock();
    await expect(broken.next()).rejects.toThrow();
    await broken.close();
  } finally {
    await journal.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("does not follow a journal directory symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "craftlayer-node-link-"));
  try {
    await symlink(root, join(root, "link"));
    await expect(
      new NodeJournal(join(root, "link"), randomUUID(), 1).lock(),
    ).rejects.toThrow("NODE_JOURNAL_NOT_PRIVATE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
