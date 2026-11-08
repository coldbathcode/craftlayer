import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackupError,
  createBackupArchive,
  restoreBackupArchive,
  selectBackupFiles,
  verifyBackupArchive,
} from "./backup.js";

const dirs: string[] = [];
async function temp() {
  const d = await mkdtemp(join(tmpdir(), "craftlayer-backup-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function fixtureWorld() {
  const data = await temp();
  await mkdir(join(data, "world/region"), { recursive: true });
  await mkdir(join(data, "plugins/Geyser-Spigot/cache"), { recursive: true });
  await mkdir(join(data, "plugins/floodgate"), { recursive: true });
  await mkdir(join(data, "logs"), { recursive: true });
  await mkdir(join(data, "libraries/x"), { recursive: true });
  await writeFile(join(data, "world/level.dat"), "level");
  await writeFile(join(data, "world/region/r.0.0.mca"), "x".repeat(5000));
  await writeFile(
    join(data, "plugins/Geyser-Spigot/config.yml"),
    "bedrock: {}",
  );
  await writeFile(join(data, "plugins/Geyser-Spigot/cache/big.bin"), "cache");
  await writeFile(
    join(data, "plugins/floodgate/key.pem"),
    "secret-key-material",
  );
  await writeFile(join(data, "whitelist.json"), "[]");
  await writeFile(join(data, "server.properties"), "a=b");
  await writeFile(join(data, "eula.txt"), "eula=true");
  await writeFile(join(data, "logs/latest.log"), "noise");
  await writeFile(join(data, "libraries/x/lib.jar"), "jar");
  await symlink("/etc/hostname", join(data, "escape-link"));
  return data;
}
/** Scripted console that records save coordination order. */
function console_(saveOk = true) {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      async pauseSaving(pause: boolean) {
        calls.push(pause ? "save-off" : "save-on");
        return { ok: true, evidence: "", detail: {} };
      },
      async saveAll() {
        calls.push("save-all");
        return {
          ok: saveOk,
          evidence: saveOk ? "Saved the game" : "Unable to save",
          detail: { saved: saveOk },
        };
      },
    },
  };
}
describe("backup archive", () => {
  it("selects world, plugin state and config; skips logs, caches, libraries, eula and symlinks", async () => {
    const data = await fixtureWorld();
    const s = await selectBackupFiles(data);
    expect(s.files).toEqual([
      "plugins/Geyser-Spigot/config.yml",
      "plugins/floodgate/key.pem",
      "server.properties",
      "whitelist.json",
      "world/level.dat",
      "world/region/r.0.0.mca",
    ]);
    expect(s.excluded).toEqual(
      expect.arrayContaining([
        "logs",
        "libraries",
        "eula.txt",
        "plugins/Geyser-Spigot/cache",
      ]),
    );
    expect(s.skipped).toEqual(["escape-link"]);
  });
  it("pauses saving, flushes, archives, re-hashes, resumes, and the archive verifies and restores byte for byte", async () => {
    const data = await fixtureWorld(),
      dest = await temp(),
      target = await temp();
    const c = console_();
    const occurrence = randomUUID(),
      server = randomUUID();
    const evidence = await createBackupArchive({
      actions: c.actions,
      dataDir: data,
      destinationDir: dest,
      occurrenceId: occurrence,
      serverId: server,
      now: () => Date.parse("2026-11-08T04:00:00Z"),
    });
    expect(c.calls).toEqual(["save-off", "save-all", "save-on"]);
    expect(evidence.file_count).toBe(6);
    expect(evidence.archive_sha256).toMatch(/^[a-f0-9]{64}$/);
    const manifest = JSON.parse(await readFile(evidence.manifest_path, "utf8"));
    expect(manifest.consistency).toEqual({
      saving_paused: true,
      flushed: true,
      rescanned_unchanged: true,
    });
    expect(manifest.excluded).toContain("logs");
    const verified = await verifyBackupArchive(
      evidence.archive_path,
      evidence.manifest_path,
    );
    expect(verified.ok).toBe(true);
    expect(verified.manifest_hash).toBe(evidence.manifest_hash);
    const restored = await restoreBackupArchive(
      evidence.archive_path,
      evidence.manifest_path,
      target,
    );
    expect(restored.files).toBe(6);
    expect(await readFile(join(target, "world/region/r.0.0.mca"), "utf8")).toBe(
      "x".repeat(5000),
    );
    expect(
      await readFile(join(target, "plugins/floodgate/key.pem"), "utf8"),
    ).toBe("secret-key-material");
    await expect(
      restoreBackupArchive(
        evidence.archive_path,
        evidence.manifest_path,
        target,
      ),
    ).rejects.toMatchObject({
      code: "RESTORE_TARGET_NOT_EMPTY",
    });
  });
  it("aborts before archiving when the flush fails, and always resumes saving", async () => {
    const data = await fixtureWorld(),
      dest = await temp();
    const c = console_(false);
    await expect(
      createBackupArchive({
        actions: c.actions,
        dataDir: data,
        destinationDir: dest,
        occurrenceId: randomUUID(),
        serverId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SAVE_FAILED" });
    expect(c.calls).toEqual(["save-off", "save-all", "save-on"]);
    const left = (await readdir(dest)).filter((n) => n.endsWith(".tar.gz"));
    expect(left).toEqual([]);
  });
  it("reports a world that changed while being read and leaves no partial archive", async () => {
    const data = await fixtureWorld(),
      dest = await temp();
    let flushes = 0;
    const actions = {
      async pauseSaving() {
        return { ok: true, evidence: "", detail: {} };
      },
      async saveAll() {
        flushes++;
        // Mutate a file after the first hash pass: simulates a write that slipped through.
        setTimeout(
          () =>
            void writeFile(join(data, "world/level.dat"), `changed-${flushes}`),
          5,
        );
        return {
          ok: true,
          evidence: "Saved the game",
          detail: { saved: true },
        };
      },
    };
    await new Promise((r) => setTimeout(r, 20));
    const attempt = createBackupArchive({
      actions,
      dataDir: data,
      destinationDir: dest,
      occurrenceId: randomUUID(),
      serverId: randomUUID(),
    });
    // Either the change landed before the first hash (then the archive is consistent) or between
    // the passes (then it must be refused). Both are honest; what is forbidden is a silent mismatch.
    const result = await attempt.then(
      (e) => ({ ok: true as const, e }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "WORLD_CHANGED_DURING_BACKUP",
      });
      const files = await readdir(dest);
      expect(files.filter((f) => f.endsWith(".part"))).toEqual([]);
    } else {
      expect(
        (
          await verifyBackupArchive(
            result.e.archive_path,
            result.e.manifest_path,
          )
        ).ok,
      ).toBe(true);
    }
  });
  it("detects a corrupted archive and a manifest that lies", async () => {
    const data = await fixtureWorld(),
      dest = await temp(),
      target = await temp();
    const e = await createBackupArchive({
      actions: null,
      dataDir: data,
      destinationDir: dest,
      occurrenceId: randomUUID(),
      serverId: randomUUID(),
    });
    const bytes = Buffer.from(await readFile(e.archive_path));
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 0xff;
    await writeFile(e.archive_path, bytes);
    const v = await verifyBackupArchive(e.archive_path, e.manifest_path);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("archive hash differs");
    await expect(
      restoreBackupArchive(e.archive_path, e.manifest_path, target),
    ).rejects.toMatchObject({ code: "ARCHIVE_CORRUPT" });
    // A manifest with a traversal path is refused before anything is extracted.
    const manifest = JSON.parse(await readFile(e.manifest_path, "utf8"));
    manifest.entries[0].path = "../escape";
    await writeFile(e.manifest_path, JSON.stringify(manifest));
    await expect(
      verifyBackupArchive(e.archive_path, e.manifest_path),
    ).rejects.toBeInstanceOf(BackupError);
  });
});
