import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { pruneBackups, removeBackupArchive } from "./backup-pruner.js";

const server = "00000000-0000-4000-8000-000000000001",
  old = "00000000-0000-4000-8000-000000000002",
  kept = "00000000-0000-4000-8000-000000000003",
  backup = "00000000-0000-4000-8000-000000000004";
it("deletes only the named occurrence's two files and reports each removal once", async () => {
  const root = await mkdtemp(join(tmpdir(), "craftlayer-prune-")),
    folder = join(root, server);
  try {
    await mkdir(folder);
    for (const name of [
      `${old}.tar.gz`,
      `${old}.tar.gz.age`,
      `${old}.manifest.json`,
      `${kept}.tar.gz`,
      `${kept}.manifest.json`,
      "notes.txt",
    ])
      await writeFile(join(folder, name), "x");
    const reported: string[] = [],
      expired = { backup_id: backup, server_id: server, occurrence_id: old };
    const removed = await pruneBackups({
      serverIds: [server],
      directory: (id) => (id === server ? root : undefined),
      poll: async () => [
        expired,
        // A server this node holds no archive folder for is skipped, not guessed at.
        { ...expired, server_id: kept },
      ],
      report: async (e) => {
        reported.push(e.backup_id);
      },
    });
    expect(removed).toBe(1);
    expect(reported).toEqual([backup]);
    expect((await readdir(folder)).sort()).toEqual(
      [`${kept}.manifest.json`, `${kept}.tar.gz`, "notes.txt"].sort(),
    );
    // Already gone counts as removed, so a lost report can be sent again.
    expect(await removeBackupArchive(expired, root)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses anything that is not a plain id, so no path can be named", async () => {
  for (const bad of ["../../etc", "a/b", ""])
    await expect(
      removeBackupArchive(
        { backup_id: backup, server_id: server, occurrence_id: bad },
        "/nonexistent",
      ),
    ).rejects.toThrow();
  await expect(
    removeBackupArchive(
      { backup_id: backup, server_id: "..", occurrence_id: old },
      "/nonexistent",
    ),
  ).rejects.toThrow();
});
