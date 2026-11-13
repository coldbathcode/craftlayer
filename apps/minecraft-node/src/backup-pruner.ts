import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { NodeBackupExpired } from "@craftlayer/contracts";
import { z } from "zod";

/**
 * Deletes exactly one expired backup (ADR 0049): the archive and manifest this node
 * wrote for that occurrence, by their fixed names inside the server's own archive
 * folder. The controller names an occurrence, never a path, and both ids must be
 * plain UUIDs, so nothing outside that folder can be reached. A file that is already
 * gone counts as removed. Returns false when a file exists and could not be deleted.
 */
export async function removeBackupArchive(
  expired: NodeBackupExpired,
  backupDirectory: string,
) {
  const server = z.uuid().parse(expired.server_id),
    occurrence = z.uuid().parse(expired.occurrence_id),
    folder = join(backupDirectory, server);
  for (const name of [
    `${occurrence}.tar.gz`,
    `${occurrence}.tar.gz.age`,
    `${occurrence}.manifest.json`,
  ]) {
    const path = join(folder, name);
    await rm(path, { force: true }).catch(() => {});
    if (
      await stat(path).then(
        () => true,
        () => false,
      )
    )
      return false;
  }
  return true;
}
/** One pass: ask what has expired, delete each archive, report each deletion. */
export async function pruneBackups(options: {
  serverIds: string[];
  directory(serverId: string): string | undefined;
  poll(serverIds: string[]): Promise<NodeBackupExpired[]>;
  report(expired: NodeBackupExpired): Promise<void>;
  log?(code: string): void;
}) {
  let removed = 0;
  for (const expired of await options.poll(options.serverIds)) {
    const directory = options.directory(expired.server_id);
    if (!directory) continue;
    if (!(await removeBackupArchive(expired, directory))) {
      options.log?.("NODE_BACKUP_EXPIRY_NOT_REMOVED");
      continue;
    }
    await options.report(expired);
    removed++;
  }
  if (removed) options.log?.("NODE_BACKUP_EXPIRED_ARCHIVES_REMOVED");
  return removed;
}
