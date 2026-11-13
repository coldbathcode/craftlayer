import { join, relative, resolve } from "node:path";
import type { NodeBackupOffer, NodeBackupOutcome } from "@craftlayer/contracts";
import type { GameChannel } from "./action-runner.js";
import {
  BackupError,
  createBackupArchive,
  GameActions,
  type RconSession,
  verifyBackupArchive,
} from "./game-control/index.js";
import { encryptArchive } from "./offsite.js";

/** Where one server's world lives and where its archives go, as this agent sees them.
 * Both come from the operator's private configuration; callers never choose a path. */
export interface BackupTarget {
  channel: GameChannel;
  dataDirectory: string;
  backupDirectory: string;
  /** When set, each verified archive is also encrypted to this key for collection. */
  offsiteRecipient?: string;
}
const within = (parent: string, child: string) => {
  const r = relative(resolve(parent), resolve(child));
  return r === "" || (!r.startsWith("..") && !r.startsWith("/"));
};
/** Archives written inside the world would be swept into the next archive, and a world
 * inside the archive directory would be archived with its own backups. Refuse both. */
export function assertBackupDirectories(data: string, backups: string) {
  if (within(data, backups) || within(backups, data))
    throw new Error("NODE_BACKUP_DIRECTORIES_OVERLAP");
}
const failed = (failure: Exclude<NodeBackupOutcome, { ok: true }>["failure"]) =>
  ({ ok: false, failure }) as const;
/**
 * Takes exactly one offered backup: pause saving, flush, archive, prove the world did
 * not change, resume saving, then read the archive back against its manifest. Success
 * is reported only for an archive that passed that read-back. A world that changed
 * while it was being read is tried once more; nothing else is retried.
 */
export async function runBackup(
  offer: NodeBackupOffer,
  target: BackupTarget,
  options: { now?: () => number; log?: (code: string) => void } = {},
): Promise<NodeBackupOutcome> {
  const now = options.now ?? Date.now;
  if (Date.parse(offer.expires_at) <= now()) return failed("interrupted");
  let session: RconSession | undefined;
  try {
    try {
      session = await target.channel.open();
    } catch {
      // Without the console the world cannot be flushed and held still.
      options.log?.("NODE_BACKUP_CONSOLE_UNREACHABLE");
      return failed("save_failed");
    }
    const actions = new GameActions(
      session,
      target.channel.whitelist,
      target.channel.options,
    );
    for (let attempt = 1; ; attempt++) {
      try {
        const evidence = await createBackupArchive({
          actions,
          dataDir: target.dataDirectory,
          destinationDir: join(target.backupDirectory, offer.server_id),
          occurrenceId: offer.occurrence_id,
          serverId: offer.server_id,
          now,
        });
        const verified = await verifyBackupArchive(
          evidence.archive_path,
          evidence.manifest_path,
        );
        if (!verified.ok || verified.manifest_hash !== evidence.manifest_hash) {
          options.log?.("NODE_BACKUP_VERIFICATION_FAILED");
          return failed("verification_failed");
        }
        // The off-server copy is extra: failing to prepare it never fails the backup.
        if (
          target.offsiteRecipient &&
          !(await encryptArchive(
            evidence.archive_path,
            target.offsiteRecipient,
          ).catch(() => false))
        )
          options.log?.("NODE_BACKUP_OFFSITE_ENCRYPT_FAILED");
        return {
          ok: true,
          archive_sha256: evidence.archive_sha256,
          size_bytes: evidence.size_bytes,
          manifest_hash: evidence.manifest_hash,
          file_count: evidence.file_count,
          total_bytes: evidence.total_bytes,
        };
      } catch (error) {
        const code = error instanceof BackupError ? error.code : null;
        if (code === "WORLD_CHANGED_DURING_BACKUP" && attempt === 1) continue;
        options.log?.(
          code ? `NODE_BACKUP_${code}` : "NODE_BACKUP_STOPPED_UNEXPECTEDLY",
        );
        if (code === "SAVE_RESUME_FAILED")
          // Loud on purpose: the world may not be saving until someone checks.
          options.log?.("NODE_BACKUP_OPERATOR_CHECK_SAVING");
        return failed(
          code === "SAVE_FAILED" || code === "SAVE_RESUME_FAILED" || !code
            ? "save_failed"
            : "archive_failed",
        );
      }
    }
  } finally {
    await session?.close().catch(() => {});
  }
}
/** After a backup was cut short, saving may still be paused: turn it back on. Returns
 * false when the console did not answer (a restarted server saves again by itself). */
export async function resumeSaving(channel: GameChannel) {
  let session: RconSession | undefined;
  try {
    session = await channel.open();
    await new GameActions(
      session,
      channel.whitelist,
      channel.options,
    ).pauseSaving(false);
    return true;
  } catch {
    return false;
  } finally {
    await session?.close().catch(() => {});
  }
}
