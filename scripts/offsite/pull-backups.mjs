// Off-server copy of world backups (master plan D2, ADR 0050). Runs on the owner's own
// machine: collects the encrypted archives a CraftLayer host prepared, proves each one
// decrypts to exactly the archive its manifest describes, and keeps the newest copies.
// The private key never leaves this machine and nothing is ever decrypted to disk.
//   node scripts/offsite/pull-backups.mjs <config.json>
// config: { "ssh_host", "remote_directory", "local_directory", "identity_file", "keep" }
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const encrypted = new RegExp(`^(${ID})\\.tar\\.gz\\.age$`);
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;

function finish(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      ...options,
    });
    const chunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.once("error", () => resolve({ ok: false, out: "" }));
    child.once("exit", (code) =>
      resolve({ ok: code === 0, out: Buffer.concat(chunks).toString("utf8") }),
    );
  });
}
/** Reads the host over SSH with fixed commands; the remote path is checked first. */
export function sshSource(host, directory) {
  if (!/^[A-Za-z0-9._-]+$/.test(host) || !SAFE_PATH.test(directory))
    throw new Error("OFFSITE_SOURCE_INVALID");
  const ssh = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20"];
  return {
    async list() {
      const r = await finish("ssh", [
        ...ssh,
        host,
        "--",
        // A folder that does not exist yet means no backups yet, not a failure. The
        // path was checked above to hold nothing a shell could act on.
        `test -d ${directory} && ls -1 ${directory} || test ! -e ${directory}`,
      ]);
      if (!r.ok) throw new Error("OFFSITE_SOURCE_UNREACHABLE");
      return r.out.split("\n").filter(Boolean);
    },
    async fetch(name, to) {
      const r = await finish("scp", [
        "-q",
        ...ssh,
        `${host}:${directory}/${name}`,
        to,
      ]);
      return r.ok;
    },
  };
}
/** Decrypts in memory only, returning the hash and size of what came out. */
export function decryptedDigest(file, identityFile, program = "age") {
  return new Promise((resolve) => {
    const child = spawn(program, ["-d", "-i", identityFile, "--", file], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const hash = createHash("sha256");
    let bytes = 0;
    child.stdout.on("data", (d) => {
      hash.update(d);
      bytes += d.length;
    });
    child.once("error", () => resolve(null));
    child.once("exit", (code) =>
      resolve(code === 0 ? { sha256: hash.digest("hex"), bytes } : null),
    );
  });
}
/**
 * One pass. A copy is kept only after it decrypted with this machine's key to exactly
 * the archive hash and size its manifest records, for the occurrence its name claims.
 * Anything else is discarded and reported; it is fetched again next time.
 */
export async function pullBackups(options) {
  const { source, localDirectory, identityFile } = options,
    keep = options.keep ?? 30,
    log = options.log ?? (() => {}),
    now = options.now ?? Date.now,
    incoming = join(localDirectory, ".incoming");
  if (!Number.isInteger(keep) || keep < 2)
    throw new Error("OFFSITE_KEEP_INVALID");
  mkdirSync(localDirectory, { recursive: true, mode: 0o700 });
  chmodSync(localDirectory, 0o700);
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(incoming, { mode: 0o700 });
  const result = { fetched: 0, failed: 0, removed: 0, held: 0 };
  try {
    const names = await source.list();
    for (const name of names.sort()) {
      const id = encrypted.exec(name)?.[1];
      if (!id || existsSync(join(localDirectory, `${id}.verified.json`)))
        continue;
      const manifestName = `${id}.manifest.json`,
        archive = join(incoming, name),
        manifestPath = join(incoming, manifestName);
      let proof = null;
      if (
        names.includes(manifestName) &&
        (await source.fetch(manifestName, manifestPath)) &&
        (await source.fetch(name, archive))
      ) {
        let manifest = null;
        try {
          manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        } catch {}
        const digest = await decryptedDigest(
          archive,
          identityFile,
          options.program,
        );
        if (
          digest &&
          manifest?.kind === "craftlayer_backup_manifest" &&
          manifest.occurrence_id === id &&
          manifest.archive_sha256 === digest.sha256 &&
          manifest.archive_bytes === digest.bytes
        )
          proof = {
            occurrence_id: id,
            server_id: manifest.server_id,
            backup_created_at: manifest.created_at,
            archive_sha256: digest.sha256,
            archive_bytes: digest.bytes,
            verified_at: new Date(now()).toISOString(),
          };
      }
      if (!proof) {
        rmSync(archive, { force: true });
        rmSync(manifestPath, { force: true });
        result.failed++;
        log(`offsite_copy_failed ${id}`);
        continue;
      }
      renameSync(archive, join(localDirectory, name));
      renameSync(manifestPath, join(localDirectory, manifestName));
      // Written last: its presence means the two files beside it were proven.
      writeFileSync(
        join(localDirectory, `${id}.verified.json`),
        `${JSON.stringify(proof, null, 2)}\n`,
        { mode: 0o600 },
      );
      result.fetched++;
      log(`offsite_copy_ok ${id} bytes=${proof.archive_bytes}`);
    }
    // Keep the newest proven copies; remove only files this script named itself.
    const proven = readdirSync(localDirectory)
      .map((n) => new RegExp(`^(${ID})\\.verified\\.json$`).exec(n)?.[1])
      .filter(Boolean)
      .map((id) => {
        try {
          return JSON.parse(
            readFileSync(join(localDirectory, `${id}.verified.json`), "utf8"),
          );
        } catch {
          return null;
        }
      })
      .filter((p) => p && typeof p.backup_created_at === "string")
      .sort((a, b) => b.backup_created_at.localeCompare(a.backup_created_at));
    for (const old of proven.slice(keep)) {
      for (const suffix of [".tar.gz.age", ".manifest.json", ".verified.json"])
        rmSync(join(localDirectory, `${old.occurrence_id}${suffix}`), {
          force: true,
        });
      result.removed++;
    }
    result.held = Math.min(proven.length, keep);
    const newest = proven[0];
    writeFileSync(
      join(localDirectory, "status.json"),
      `${JSON.stringify(
        {
          checked_at: new Date(now()).toISOString(),
          held: result.held,
          newest_backup_at: newest?.backup_created_at ?? null,
          last_run: result,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  } finally {
    rmSync(incoming, { recursive: true, force: true });
  }
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stamp = () => new Date().toISOString();
  try {
    const config = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
    if ((statSync(config.identity_file).mode & 0o077) !== 0)
      throw new Error("OFFSITE_IDENTITY_NOT_PRIVATE");
    const result = await pullBackups({
      source: sshSource(config.ssh_host, config.remote_directory),
      localDirectory: config.local_directory,
      identityFile: config.identity_file,
      keep: config.keep ?? 30,
      log: (line) => console.log(`${stamp()} ${line}`),
    });
    console.log(
      `${stamp()} offsite_run fetched=${result.fetched} failed=${result.failed} removed=${result.removed} held=${result.held}`,
    );
    process.exitCode = result.failed ? 1 : 0;
  } catch (error) {
    console.log(
      `${stamp()} offsite_run_failed ${error instanceof Error && /^OFFSITE_[A-Z_]+$/.test(error.message) ? error.message : "OFFSITE_CONFIG_OR_IO"}`,
    );
    process.exitCode = 2;
  }
}
