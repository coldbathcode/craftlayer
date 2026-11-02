import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  bounded,
  buildReport,
  type Evidence,
  hash,
  object,
} from "./preflight.js";
import {
  checkedRoot,
  collectLocal,
  type LocalOptions,
  type ReadRunner,
} from "./preflight-local.js";

const LIMITS = {
  entries: 10000,
  bytes: 2 * 1024 ** 3,
  fileBytes: 512 * 1024 ** 2,
  depth: 16,
  milliseconds: 30000,
};
class PreservationError extends Error {}
function deny(code: string): never {
  throw new PreservationError(code);
}
function stamp(s: Stats) {
  return [
    s.dev,
    s.ino,
    s.mode,
    s.uid,
    s.gid,
    s.nlink,
    s.size,
    s.mtimeMs,
    s.ctimeMs,
  ].join(":");
}
export type TreeEntry = {
  path_sha256: string;
  kind: "file" | "directory";
  bytes: number;
  content_sha256: string | null;
  mode: number;
  uid: number;
  gid: number;
};
export type TreeManifest = {
  schema_version: 1;
  content_sha256: string;
  metadata_sha256: string;
  total_bytes: number;
  entries: TreeEntry[];
};
// Host administrators are trusted. This detects ordinary concurrent changes;
// it cannot create an atomic filesystem snapshot or isolate a compromised host.
export async function scanTree(
  path: string,
  hooks: { afterRead?: () => Promise<void> } = {},
): Promise<TreeManifest> {
  const started = performance.now();
  const entries: TreeEntry[] = [];
  const observed: { path: string; stamp: string }[] = [];
  let total = 0;
  function budget() {
    if (performance.now() - started > LIMITS.milliseconds)
      deny("PRESERVATION_DEADLINE");
    if (entries.length > LIMITS.entries || total > LIMITS.bytes)
      deny("PRESERVATION_SIZE_LIMIT");
  }
  try {
    const root = await checkedRoot(path);
    const walk = async (current: string, depth: number) => {
      budget();
      if (depth > LIMITS.depth) deny("PRESERVATION_DEPTH_LIMIT");
      const before = await lstat(current);
      if (before.isSymbolicLink()) deny("PRESERVATION_SYMLINK_DENIED");
      if (!before.isFile() && !before.isDirectory())
        deny("PRESERVATION_SPECIAL_FILE_DENIED");
      if (before.isFile() && before.nlink !== 1)
        deny("PRESERVATION_HARDLINK_DENIED");
      observed.push({ path: current, stamp: stamp(before) });
      const entry: TreeEntry = {
        path_sha256: hash(relative(root, current).split(sep).join("/")),
        kind: before.isDirectory() ? "directory" : "file",
        bytes: before.isFile() ? before.size : 0,
        content_sha256: null,
        mode: before.mode & 0o7777,
        uid: before.uid,
        gid: before.gid,
      };
      entries.push(entry);
      budget();
      if (before.isDirectory()) {
        const directory = await opendir(current);
        for await (const child of directory)
          await walk(join(current, child.name), depth + 1);
      } else {
        if (before.size > LIMITS.fileBytes) deny("PRESERVATION_FILE_LIMIT");
        total += before.size;
        budget();
        const file = await open(
          current,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          if (stamp(await file.stat()) !== stamp(before))
            deny("PRESERVATION_CHANGED_DURING_READ");
          const h = createHash("sha256");
          const buffer = Buffer.alloc(65536);
          let offset = 0;
          while (offset < before.size) {
            budget();
            const result = await file.read(
              buffer,
              0,
              Math.min(buffer.length, before.size - offset),
              offset,
            );
            if (result.bytesRead === 0)
              deny("PRESERVATION_CHANGED_DURING_READ");
            h.update(buffer.subarray(0, result.bytesRead));
            offset += result.bytesRead;
          }
          if (stamp(await file.stat()) !== stamp(before))
            deny("PRESERVATION_CHANGED_DURING_READ");
          entry.content_sha256 = h.digest("hex");
        } finally {
          await file.close();
        }
      }
    };
    await walk(root, 0);
    await hooks.afterRead?.();
    // A final pass detects modifications after a file was hashed and new/removed
    // directory entries. atime is intentionally excluded: reads can update it.
    for (const item of observed) {
      budget();
      if (stamp(await lstat(item.path)) !== item.stamp)
        deny("PRESERVATION_CHANGED_DURING_READ");
    }
    entries.sort((a, b) => a.path_sha256.localeCompare(b.path_sha256));
    return {
      schema_version: 1,
      content_sha256: hash(
        JSON.stringify(
          entries.map((e) => [
            e.path_sha256,
            e.kind,
            e.bytes,
            e.content_sha256,
          ]),
        ),
      ),
      metadata_sha256: hash(JSON.stringify(entries)),
      total_bytes: total,
      entries,
    };
  } catch (error) {
    if (error instanceof PreservationError) throw error;
    deny("PRESERVATION_READ_FAILED");
  }
}
function stoppedFingerprint(e: Evidence) {
  const report = buildReport(e);
  if (
    !report.container.verified ||
    report.container.running !== false ||
    report.container.state !== "exited" ||
    report.container.data_binding !== "matched"
  )
    deny("PRESERVATION_STOPPED_BINDING_REQUIRED");
  const result = bounded(e.commands.container);
  const values: unknown = JSON.parse(result.text);
  const c = object(Array.isArray(values) ? values[0] : null);
  return {
    container_id: String(c.Id),
    // Includes last start/finish/restart evidence, configuration, image,
    // host settings and mount/network identity; raw secrets never escape.
    binding_sha256: hash(
      JSON.stringify([
        c.Id,
        c.Image,
        c.State,
        c.RestartCount,
        c.Config,
        c.HostConfig,
        c.Mounts,
        c.NetworkSettings,
      ]),
    ),
  };
}
export async function capturePreservation(
  options: LocalOptions,
  run?: ReadRunner,
) {
  if (!options.dataRoot || !options.compose)
    deny("PRESERVATION_DATA_AND_COMPOSE_REQUIRED");
  const before = await collectLocal(options, run);
  const binding = stoppedFingerprint(before);
  const compose = bounded(before.files.compose);
  if (compose.status !== "ok") deny("PRESERVATION_COMPOSE_REQUIRED");
  const tree = await scanTree(options.dataRoot);
  const after = await collectLocal(options, run);
  if (
    JSON.stringify(stoppedFingerprint(after)) !== JSON.stringify(binding) ||
    hash(bounded(after.files.compose).text) !== hash(compose.text) ||
    bounded(after.files.compose).status !== "ok"
  )
    deny("PRESERVATION_BINDING_CHANGED");
  return {
    schema_version: 1,
    observed_at: new Date().toISOString(),
    kind: "stopped_source_preservation_manifest",
    ...binding,
    compose_sha256: hash(compose.text),
    tree,
    atomic_snapshot: false,
    backup_created: false,
    restoration_verified: false,
    production_verified: false,
  };
}
export function compareTrees(before: TreeManifest, after: TreeManifest) {
  const old = new Map(before.entries.map((e) => [e.path_sha256, e]));
  const next = new Map(after.entries.map((e) => [e.path_sha256, e]));
  const added = after.entries.filter((e) => !old.has(e.path_sha256)).length;
  const missing = before.entries.filter((e) => !next.has(e.path_sha256)).length;
  const changed = after.entries.filter((e) => {
    const previous = old.get(e.path_sha256);
    return (
      previous &&
      (previous.content_sha256 !== e.content_sha256 ||
        previous.bytes !== e.bytes ||
        previous.kind !== e.kind)
    );
  }).length;
  return {
    content_matches:
      added === 0 &&
      missing === 0 &&
      changed === 0 &&
      before.content_sha256 === after.content_sha256,
    metadata_matches: before.metadata_sha256 === after.metadata_sha256,
    added,
    missing,
    changed,
  };
}
