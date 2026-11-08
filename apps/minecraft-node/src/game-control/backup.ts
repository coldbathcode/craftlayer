import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import type { GameActions } from "./actions.js";

/**
 * Consistent backup of a Minecraft server's data directory (master plan D1 effect).
 * The world is flushed with saving paused, hashed, archived, hashed again to prove it
 * did not change while being read, and saving is always resumed. The manifest records
 * what was included and why; verification and restore check every file against it.
 * Nothing here talks to the API or decides retention: the caller records the evidence.
 */
export class BackupError extends Error {
  constructor(
    public readonly code:
      | "SAVE_FAILED"
      | "SAVE_RESUME_FAILED"
      | "INSUFFICIENT_SPACE"
      | "ARCHIVE_FAILED"
      | "WORLD_CHANGED_DURING_BACKUP"
      | "ARCHIVE_CORRUPT"
      | "MANIFEST_MISMATCH"
      | "RESTORE_TARGET_NOT_EMPTY"
      | "UNSAFE_PATH"
      | "TOO_LARGE",
    detail = "",
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}
const LIMITS = {
  files: 200_000,
  bytes: 64 * 1024 ** 3,
  tarTimeoutMs: 30 * 60_000,
} as const;
/** Top-level entries that are runtime noise or re-downloadable, never part of a world. */
const EXCLUDED_ROOTS = new Set([
  "logs",
  "cache",
  "libraries",
  "versions",
  ".paper",
  "lost+found",
  "eula.txt",
  "crash-reports",
  "debug",
]);
/** Plugin subtrees that are caches or profilers, not identity or state. */
const EXCLUDED_PLUGIN_PATHS = [
  /^plugins\/[^/]+\/cache(\/|$)/,
  /^plugins\/spark(\/|$)/,
  /^plugins\/bStats(\/|$)/,
];
export const manifestEntry = z.strictObject({
  path: z.string().min(1).max(1024),
  bytes: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const backupManifest = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal("craftlayer_backup_manifest"),
  occurrence_id: z.uuid(),
  server_id: z.uuid(),
  created_at: z.iso.datetime(),
  consistency: z.strictObject({
    saving_paused: z.boolean(),
    flushed: z.boolean(),
    rescanned_unchanged: z.literal(true),
  }),
  excluded: z.array(z.string()).max(10000),
  skipped_symlinks: z.array(z.string()).max(10000),
  entries: z.array(manifestEntry).max(LIMITS.files),
  total_bytes: z.number().int().min(0),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  archive_name: z.string().regex(/^[a-f0-9-]+\.tar\.gz$/),
  archive_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  archive_bytes: z.number().int().min(0),
});
export type BackupManifest = z.infer<typeof backupManifest>;
export interface BackupEvidence {
  archive_path: string;
  manifest_path: string;
  archive_sha256: string;
  size_bytes: number;
  manifest_hash: string;
  file_count: number;
  total_bytes: number;
}
function safeRelative(path: string) {
  if (
    path === "" ||
    path.startsWith("/") ||
    path.split("/").some((p) => p === "" || p === "." || p === "..") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: archive member names must be plain
    /[\u0000-\u001f\u007f]/.test(path) ||
    /^[a-zA-Z]:/.test(path)
  )
    throw new BackupError("UNSAFE_PATH", path.slice(0, 80));
  return path;
}
/** Walks the data directory, keeping world/state/config files and skipping noise and symlinks. */
export async function selectBackupFiles(dataDir: string) {
  const files: string[] = [],
    excluded: string[] = [],
    skipped: string[] = [];
  async function walk(dir: string) {
    let entries: Dirent[];
    entries = await readdir(dir, { withFileTypes: true });
    // Byte order, not locale order, so manifests are identical on every host.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(dir, entry.name),
        rel = relative(dataDir, full).split(sep).join("/");
      const depth = rel.split("/").length;
      if (depth === 1 && EXCLUDED_ROOTS.has(entry.name)) {
        excluded.push(rel);
        continue;
      }
      if (EXCLUDED_PLUGIN_PATHS.some((re) => re.test(rel))) {
        excluded.push(rel);
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped.push(rel);
        continue;
      }
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        if (/[\n\r]/.test(rel))
          throw new BackupError("UNSAFE_PATH", "newline in name");
        files.push(safeRelative(rel));
        if (files.length > LIMITS.files)
          throw new BackupError("TOO_LARGE", "file count");
      }
    }
  }
  await walk(dataDir);
  return { files, excluded, skipped };
}
async function sha256File(path: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}
export async function hashFiles(dataDir: string, files: readonly string[]) {
  const entries: z.infer<typeof manifestEntry>[] = [];
  let total = 0;
  for (const path of files) {
    const s = await lstat(join(dataDir, path));
    if (!s.isFile()) throw new BackupError("UNSAFE_PATH", path);
    total += s.size;
    if (total > LIMITS.bytes) throw new BackupError("TOO_LARGE", "bytes");
    entries.push({
      path,
      bytes: s.size,
      sha256: await sha256File(join(dataDir, path)),
    });
  }
  const content = createHash("sha256");
  for (const e of entries)
    content.update(`${e.path}\n${e.bytes}\n${e.sha256}\n`);
  return { entries, total_bytes: total, content_sha256: content.digest("hex") };
}
function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = LIMITS.tarTimeoutMs,
) {
  return new Promise<{ stdout: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new BackupError("ARCHIVE_FAILED", `${cmd} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
      if (stdout.length > 64 * 1024 ** 2) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8").slice(0, 4096);
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new BackupError("ARCHIVE_FAILED", `${cmd} unavailable`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout });
      else
        reject(
          new BackupError(
            "ARCHIVE_FAILED",
            `${cmd} exit ${code}: ${stderr.slice(0, 300)}`,
          ),
        );
    });
  });
}
export interface CreateBackupOptions {
  /** Live console; null for a stopped server (no save coordination needed). */
  actions: Pick<GameActions, "saveAll" | "pauseSaving"> | null;
  dataDir: string;
  destinationDir: string;
  occurrenceId: string;
  serverId: string;
  now?: () => number;
}
/**
 * Pause saving → flush → hash → archive → re-hash → resume saving. Saving is resumed
 * in every path, including failures; a failure to resume is reported as its own error
 * because the server then needs an operator, not a retry.
 */
export async function createBackupArchive(
  options: CreateBackupOptions,
): Promise<BackupEvidence> {
  const now = options.now ?? Date.now;
  z.uuid().parse(options.occurrenceId);
  z.uuid().parse(options.serverId);
  await mkdir(options.destinationDir, { recursive: true, mode: 0o700 });
  const archiveName = `${options.occurrenceId}.tar.gz`,
    archivePath = join(options.destinationDir, archiveName),
    partial = `${archivePath}.part`,
    manifestPath = join(
      options.destinationDir,
      `${options.occurrenceId}.manifest.json`,
    );
  let paused = false,
    flushed = false;
  let outcome: { value?: BackupEvidence; error?: unknown } = {};
  try {
    if (options.actions) {
      const off = await options.actions.pauseSaving(true);
      paused = off.ok;
      const flush = await options.actions.saveAll();
      if (!flush.ok)
        throw new BackupError("SAVE_FAILED", flush.evidence.slice(0, 200));
      flushed = true;
    }
    const selection = await selectBackupFiles(options.dataDir);
    const before = await hashFiles(options.dataDir, selection.files);
    const space = await statfs(options.destinationDir);
    const free = Number(space.bavail) * Number(space.bsize);
    if (free < before.total_bytes * 2 + 64 * 1024 ** 2)
      throw new BackupError(
        "INSUFFICIENT_SPACE",
        `${free} bytes free for ${before.total_bytes}`,
      );
    const listPath = `${archivePath}.list`;
    await writeFile(listPath, `${selection.files.join("\n")}\n`, {
      mode: 0o600,
    });
    try {
      await rm(partial, { force: true });
      await run(
        "tar",
        ["-czf", partial, "-C", options.dataDir, "-T", listPath],
        options.dataDir,
      );
    } finally {
      await rm(listPath, { force: true });
    }
    const after = await hashFiles(options.dataDir, selection.files);
    if (after.content_sha256 !== before.content_sha256) {
      await rm(partial, { force: true });
      throw new BackupError("WORLD_CHANGED_DURING_BACKUP");
    }
    const archiveSha = await sha256File(partial),
      archiveBytes = (await lstat(partial)).size;
    const manifest: BackupManifest = backupManifest.parse({
      schema_version: 1,
      kind: "craftlayer_backup_manifest",
      occurrence_id: options.occurrenceId,
      server_id: options.serverId,
      created_at: new Date(now()).toISOString(),
      consistency: {
        saving_paused: paused,
        flushed,
        rescanned_unchanged: true,
      },
      excluded: selection.excluded,
      skipped_symlinks: selection.skipped,
      entries: before.entries,
      total_bytes: before.total_bytes,
      content_sha256: before.content_sha256,
      archive_name: archiveName,
      archive_sha256: archiveSha,
      archive_bytes: archiveBytes,
    });
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const handle = await open(`${manifestPath}.part`, "w", 0o600);
    try {
      await handle.writeFile(manifestText);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(partial, archivePath);
    await rename(`${manifestPath}.part`, manifestPath);
    outcome = {
      value: {
        archive_path: archivePath,
        manifest_path: manifestPath,
        archive_sha256: archiveSha,
        size_bytes: archiveBytes,
        manifest_hash: createHash("sha256").update(manifestText).digest("hex"),
        file_count: before.entries.length,
        total_bytes: before.total_bytes,
      },
    };
  } catch (error) {
    outcome = { error };
  }
  // Saving is resumed in every path. A failed resume outranks the original outcome
  // because the server then needs an operator, not a retry.
  if (options.actions && paused) {
    const on = await options.actions.pauseSaving(false).catch(() => null);
    if (!on)
      throw new BackupError(
        "SAVE_RESUME_FAILED",
        "operator action required: saving may still be paused",
      );
  }
  if (outcome.error) throw outcome.error;
  if (!outcome.value) throw new BackupError("ARCHIVE_FAILED", "no result");
  return outcome.value;
}
export async function readManifest(manifestPath: string) {
  const text = await readFile(manifestPath, "utf8");
  if (text.length > 64 * 1024 ** 2)
    throw new BackupError("TOO_LARGE", "manifest");
  const parsed = backupManifest.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new BackupError("MANIFEST_MISMATCH", "manifest schema");
  for (const e of parsed.data.entries) safeRelative(e.path);
  return {
    manifest: parsed.data,
    manifest_hash: createHash("sha256").update(text).digest("hex"),
  };
}
/** Archive hash must match the manifest and the member list must be exactly the manifest's files. */
export async function verifyBackupArchive(
  archivePath: string,
  manifestPath: string,
) {
  const { manifest, manifest_hash } = await readManifest(manifestPath);
  const problems: string[] = [];
  const sha = await sha256File(archivePath);
  if (sha !== manifest.archive_sha256)
    problems.push("archive hash differs from manifest");
  if ((await lstat(archivePath)).size !== manifest.archive_bytes)
    problems.push("archive size differs from manifest");
  let members: string[] = [];
  try {
    members = (await run("tar", ["-tzf", archivePath], ".")).stdout
      .split("\n")
      .map((m) => m.replace(/^\.\//, "").replace(/\/$/, ""))
      .filter(Boolean);
  } catch (error) {
    problems.push(
      error instanceof Error ? error.message : "unreadable archive",
    );
  }
  const expected = new Set(manifest.entries.map((e) => e.path));
  for (const m of members) {
    try {
      safeRelative(m);
    } catch {
      problems.push(`unsafe member ${m.slice(0, 80)}`);
      continue;
    }
    if (
      !expected.has(m) &&
      !manifest.entries.some((e) => e.path.startsWith(`${m}/`))
    )
      problems.push(`unexpected member ${m.slice(0, 80)}`);
  }
  const present = new Set(members);
  for (const e of manifest.entries)
    if (!present.has(e.path))
      problems.push(`missing member ${e.path.slice(0, 80)}`);
  return {
    ok: problems.length === 0,
    problems: problems.slice(0, 50),
    manifest,
    manifest_hash,
  };
}
/** Restores into an existing, empty directory and proves every file hash matches the manifest. */
export async function restoreBackupArchive(
  archivePath: string,
  manifestPath: string,
  targetDir: string,
) {
  const verified = await verifyBackupArchive(archivePath, manifestPath);
  if (!verified.ok)
    throw new BackupError(
      "ARCHIVE_CORRUPT",
      verified.problems.join("; ").slice(0, 300),
    );
  if ((await readdir(targetDir)).length)
    throw new BackupError("RESTORE_TARGET_NOT_EMPTY");
  await run("tar", ["-xzf", archivePath, "-C", targetDir], targetDir);
  const restored = await hashFiles(
    targetDir,
    verified.manifest.entries.map((e) => e.path),
  );
  if (restored.content_sha256 !== verified.manifest.content_sha256)
    throw new BackupError("MANIFEST_MISMATCH", "restored content differs");
  return {
    files: restored.entries.length,
    total_bytes: restored.total_bytes,
    manifest: verified.manifest,
  };
}
