// Opt-in check of the dashboard database backup (master plan A1). Requires Docker.
//   pnpm test:db-backup
// Starts two disposable Postgres containers of the pinned image on a private network,
// runs infra/postgres/backup.sh the way the overlay does, restores a dump into the
// second database, and checks retention, the failure path and the health check. It
// removes only the containers, network and temporary directory it created.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pinLocalDocker } from "./lib/local-docker.mjs";

pinLocalDocker();

const image = JSON.parse(readFileSync("infra/images.lock.json", "utf8"))
  .postgres.image;
const overlay = "infra/compose/database-backup.yml";
const script = resolve("infra/postgres/backup.sh");
const id = `clbackuptest-${process.pid}`;
const source = `${id}-source`;
const target = `${id}-target`;
const password = randomBytes(24).toString("hex");
const directory = mkdtempSync(join(tmpdir(), "craftlayer-db-backup-"));
const user = `${process.getuid()}:${process.getgid()}`;
// Passwords travel in the child environment only, never on a command line.
const env = {
  ...process.env,
  POSTGRES_PASSWORD: password,
  PGPASSWORD: password,
};
const DUMP = /^craftlayer-db-\d{8}T\d{6}Z\.dump$/;

function docker(args, options = {}) {
  return spawnSync("docker", args, { encoding: "utf8", env, ...options });
}
function run(args, options) {
  const result = docker(args, options);
  if (result.status !== 0)
    throw new Error(`docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
function check(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`);
  console.error(`ok: ${message}`);
}
/** Runs the backup script with the overlay's confinement; returns status and output. */
function backup(mode, extra = {}, asUser = user) {
  const settings = {
    PGHOST: source,
    PGDATABASE: "craftlayer",
    PGUSER: "craftlayer_admin",
    PGCONNECT_TIMEOUT: "5",
    BACKUP_DIR: "/backups",
    ...extra,
  };
  return docker([
    "run",
    "--rm",
    "--network",
    id,
    "--user",
    asUser,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--memory",
    "128m",
    "--pids-limit",
    "32",
    "-e",
    "PGPASSWORD",
    ...Object.entries(settings).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-v",
    `${directory}:/backups`,
    "-v",
    `${script}:/usr/local/share/craftlayer/backup.sh:ro`,
    "--entrypoint",
    "sh",
    image,
    "/usr/local/share/craftlayer/backup.sh",
    mode,
  ]);
}
async function database(name) {
  run([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    id,
    "-e",
    "POSTGRES_PASSWORD",
    "-e",
    "POSTGRES_USER=craftlayer_admin",
    "-e",
    "POSTGRES_DB=craftlayer",
    image,
  ]);
  for (let i = 0; i < 60; i++) {
    // The entrypoint restarts the server once after initialisation; wait for the real one.
    const ready = docker(["exec", name, "pg_isready", "-h", name, "-q"]);
    if (ready.status === 0) return;
    await delay(1000);
  }
  throw new Error(`${name} did not become ready`);
}
const sql = (name, statement) =>
  run([
    "exec",
    name,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-At",
    "-c",
    statement,
  ]);
const dumps = () =>
  readdirSync(directory)
    .filter((f) => DUMP.test(f))
    .sort();
const partials = () =>
  readdirSync(directory).filter((f) => f.includes("partial"));

try {
  check(
    readFileSync(overlay, "utf8").includes(`image: ${image}\n`),
    "overlay uses the pinned postgres image from infra/images.lock.json",
  );
  const config = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      id,
      "-f",
      "docker-compose.yml",
      "-f",
      overlay,
      "config",
      "--quiet",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...Object.fromEntries(
          [
            "POSTGRES_PASSWORD",
            "MIGRATOR_PASSWORD",
            "RUNTIME_PASSWORD",
            "IDENTITY_PASSWORD",
            "REDIS_PASSWORD",
            "CRAFTLAYER_BOOTSTRAP_TOKEN",
            "CRAFTLAYER_RECOVERY_TOKEN",
            "CRAFTLAYER_CSRF_SECRET",
          ].map((key) => [key, "placeholder"]),
        ),
        CRAFTLAYER_HOST_UID: String(process.getuid()),
        CRAFTLAYER_HOST_GID: String(process.getgid()),
        CRAFTLAYER_DB_BACKUP_DIR: directory,
      },
    },
  );
  check(config.status === 0, "compose config resolves with the overlay");

  run(["network", "create", "--internal", id]);
  await database(source);
  await database(target);
  sql(
    source,
    "CREATE TABLE backup_probe (id int PRIMARY KEY, note text NOT NULL)",
  );
  sql(source, "INSERT INTO backup_probe VALUES (1, 'kept across restore')");

  // An unrelated file and a near-miss name must survive every run.
  writeFileSync(join(directory, "notes.txt"), "not a dump\n");
  writeFileSync(join(directory, "craftlayer-db-manual.dump"), "not ours\n");

  const first = backup("once");
  check(first.status === 0, "first dump exits 0");
  check(
    /^database_backup_ok \d{8}T\d{6}Z bytes=[1-9]\d* kept=1$/.test(
      first.stdout.trim(),
    ),
    "one short success line with timestamp, size and count",
  );
  check(
    !first.stdout.includes(password) && !first.stderr.includes(password),
    "no password in output",
  );
  check(
    dumps().length === 1 && partials().length === 0,
    "one finished dump, no partial files",
  );
  const [dump] = dumps();
  const digest = createHash("sha256")
    .update(readFileSync(join(directory, dump)))
    .digest("hex");
  check(
    readFileSync(join(directory, `${dump}.sha256`), "utf8") ===
      `${digest}  ${dump}\n`,
    "sha256 sidecar matches the dump",
  );

  const restore = docker([
    "run",
    "--rm",
    "--network",
    id,
    "--user",
    user,
    "-e",
    "PGPASSWORD",
    "-v",
    `${directory}:/backups:ro`,
    "--entrypoint",
    "pg_restore",
    image,
    "--exit-on-error",
    "--no-owner",
    "-h",
    target,
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    `/backups/${dump}`,
  ]);
  check(
    restore.status === 0,
    "pg_restore into an empty second database succeeds",
  );
  check(
    sql(target, "SELECT note FROM backup_probe WHERE id = 1") ===
      "kept across restore",
    "the row is back after restore",
  );

  check(backup("health").status === 0, "health passes with a fresh dump");
  check(
    backup("health", { BACKUP_MAX_AGE_MINUTES: "0" }).status === 1,
    "health fails when the newest dump is too old",
  );

  for (let i = 0; i < 2; i++) {
    await delay(1100); // names carry one-second timestamps
    check(
      backup("once", { BACKUP_KEEP: "2" }).status === 0,
      `dump ${i + 2} exits 0`,
    );
  }
  const kept = dumps();
  check(
    kept.length === 2 && !kept.includes(dump),
    "retention keeps the newest 2 and drops the oldest",
  );
  const names = readdirSync(directory).sort();
  check(
    !names.includes(`${dump}.sha256`) &&
      kept.every((f) => names.includes(`${f}.sha256`)),
    "sidecars follow their dumps",
  );
  check(
    names.includes("notes.txt") && names.includes("craftlayer-db-manual.dump"),
    "unrelated files are left alone",
  );

  const failed = backup("once", { PGHOST: `${id}-absent` });
  check(failed.status === 1, "a dump against a wrong host exits 1");
  check(
    /^database_backup_failed \d{8}T\d{6}Z stage=dump$/.test(
      failed.stdout.trim(),
    ),
    "one short failure line",
  );
  check(
    dumps().join() === kept.join() && partials().length === 0,
    "a failed dump leaves no new or partial file",
  );

  const root = backup("once", {}, "0:0");
  check(
    root.status === 2 && dumps().join() === kept.join(),
    "refuses to run as root",
  );
  check(
    backup("once", { BACKUP_KEEP: "0" }).status === 2,
    "refuses an invalid retention count",
  );
  console.log("database backup checks passed");
} finally {
  docker(["rm", "-f", "-v", source, target]);
  docker(["network", "rm", id]);
  rmSync(directory, { recursive: true, force: true });
}
