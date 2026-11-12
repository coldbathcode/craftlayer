import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinLocalDocker } from "./lib/local-docker.mjs";

pinLocalDocker();

const image = "craftlayer-postgres-test:local";
const name = `craftlayer-test-${process.pid}`;
const redisName = `craftlayer-redis-test-${process.pid}`;
const password = randomBytes(24).toString("hex");
const env = { ...process.env };
const migrationFixture = mkdtempSync(join(tmpdir(), "craftlayer-migrations-"));
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (result.status !== 0)
    throw new Error(`${cmd} failed: ${result.stderr || "see command output"}`);
  return (result.stdout ?? "").trim();
}
try {
  run("docker", ["build", "-t", image, "infra/postgres"], { stdio: "inherit" });
  run("docker", [
    "run",
    "-d",
    "--name",
    name,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    "POSTGRES_USER=craftlayer_admin",
    "-e",
    "POSTGRES_DB=craftlayer",
    "-e",
    `MIGRATOR_PASSWORD=${password}`,
    "-e",
    `RUNTIME_PASSWORD=${password}`,
    "-e",
    `IDENTITY_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    image,
  ]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const r = spawnSync(
      "docker",
      [
        "exec",
        name,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "craftlayer_admin",
        "-d",
        "craftlayer",
      ],
      { stdio: "ignore" },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Test PostgreSQL readiness timed out");
  const port = run("docker", ["port", name, "5432/tcp"]).split(":").at(-1);
  env.MIGRATION_DATABASE_URL = `postgres://craftlayer_migrator:${password}@127.0.0.1:${port}/craftlayer`;
  env.TEST_DATABASE_URL = `postgres://craftlayer_runtime:${password}@127.0.0.1:${port}/craftlayer`;
  env.TEST_IDENTITY_DATABASE_URL = `postgres://craftlayer_identity:${password}@127.0.0.1:${port}/craftlayer`;
  const redisImage = JSON.parse(readFileSync("infra/images.lock.json", "utf8"))
    .redis.image;
  run("docker", [
    "run",
    "-d",
    "--name",
    redisName,
    "--user",
    "redis",
    "--cap-drop",
    "ALL",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--memory",
    "128m",
    "-e",
    `REDISCLI_AUTH=${password}`,
    "-p",
    "127.0.0.1::6379",
    redisImage,
    "sh",
    "-c",
    'exec redis-server --save "" --appendonly no --requirepass "$REDISCLI_AUTH"',
  ]);
  let redisReady = false;
  for (let i = 0; i < 60; i++) {
    if (
      spawnSync("docker", ["exec", redisName, "redis-cli", "ping"], {
        stdio: "ignore",
      }).status === 0
    ) {
      redisReady = true;
      break;
    }
    await new Promise((accept) => setTimeout(accept, 500));
  }
  if (!redisReady) throw new Error("Test Redis readiness timed out");
  const redisPort = run("docker", ["port", redisName, "6379/tcp"])
    .split(":")
    .at(-1);
  env.TEST_REDIS_URL = `redis://:${password}@127.0.0.1:${redisPort}`;
  for (let i = 0; i < 2; i++)
    run("pnpm", ["db:migrate"], { env, stdio: "inherit" });
  // Management has its own identity fixture/database; it must not bootstrap or
  // reconfigure the existing identity suite's installation secrets.
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE craftlayer_management_test OWNER craftlayer_migrator",
  ]);
  const managementUrl = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/craftlayer_management_test`;
  env.TEST_MANAGEMENT_DATABASE_URL = managementUrl("craftlayer_runtime");
  env.TEST_MANAGEMENT_IDENTITY_DATABASE_URL = managementUrl(
    "craftlayer_identity",
  );
  const previousManagement = join(migrationFixture, "management-prior");
  cpSync("packages/db/migrations", previousManagement, { recursive: true });
  rmSync(join(previousManagement, "0016_minecraft_management.sql"));
  rmSync(join(previousManagement, "0017_minecraft_identity_requests.sql"));
  rmSync(join(previousManagement, "0018_minecraft_nodes.sql"));
  rmSync(join(previousManagement, "0019_minecraft_provision_plans.sql"));
  rmSync(join(previousManagement, "0020_minecraft_reservations.sql"));
  rmSync(join(previousManagement, "0021_minecraft_deployment_intents.sql"));
  rmSync(join(previousManagement, "0022_minecraft_deployment_jobs.sql"));
  rmSync(
    join(previousManagement, "0023_minecraft_deployment_authorizations.sql"),
  );
  rmSync(join(previousManagement, "0024_management_admission_indexes.sql"));
  rmSync(join(previousManagement, "0025_enrollment_history_order.sql"));
  rmSync(join(previousManagement, "0026_deployment_approval_requests.sql"));
  rmSync(join(previousManagement, "0027_deployment_approval_decisions.sql"));
  rmSync(join(previousManagement, "0028_agent_tokens.sql"));
  rmSync(join(previousManagement, "0029_backup_records.sql"));
  rmSync(join(previousManagement, "0030_server_actions.sql"));
  rmSync(join(previousManagement, "0031_agent_requests.sql"));
  rmSync(join(previousManagement, "0032_two_factor.sql"));
  rmSync(join(previousManagement, "0033_action_dispatch.sql"));
  const managementMigration = {
    ...env,
    MIGRATION_DATABASE_URL: managementUrl("craftlayer_migrator"),
  };
  run("pnpm", ["db:migrate"], {
    env: {
      ...managementMigration,
      CRAFTLAYER_MIGRATIONS_DIRECTORY: previousManagement,
    },
    stdio: "inherit",
  });
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer_management_test",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "INSERT INTO organizations(id,name) VALUES('00000000-0000-4000-8000-00000000f101','Prior management fixture'); INSERT INTO roles(id,organization_id,name,built_in) VALUES('00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f101','viewer',true),('00000000-0000-4000-8000-00000000f103','00000000-0000-4000-8000-00000000f101','org_admin',true)",
  ]);
  for (let i = 0; i < 2; i++)
    run("pnpm", ["db:migrate"], { env: managementMigration, stdio: "inherit" });
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE craftlayer_nodes_test OWNER craftlayer_migrator",
  ]);
  const nodesUrl = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/craftlayer_nodes_test`;
  env.TEST_NODES_DATABASE_URL = nodesUrl("craftlayer_runtime");
  env.TEST_NODES_IDENTITY_DATABASE_URL = nodesUrl("craftlayer_identity");
  for (let i = 0; i < 2; i++)
    run("pnpm", ["db:migrate"], {
      env: { ...env, MIGRATION_DATABASE_URL: nodesUrl("craftlayer_migrator") },
      stdio: "inherit",
    });
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE craftlayer_reservations_test OWNER craftlayer_migrator",
  ]);
  const reservationsUrl = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/craftlayer_reservations_test`;
  env.TEST_RESERVATIONS_DATABASE_URL = reservationsUrl("craftlayer_runtime");
  env.TEST_RESERVATIONS_IDENTITY_DATABASE_URL = reservationsUrl(
    "craftlayer_identity",
  );
  for (let i = 0; i < 2; i++)
    run("pnpm", ["db:migrate"], {
      env: {
        ...env,
        MIGRATION_DATABASE_URL: reservationsUrl("craftlayer_migrator"),
      },
      stdio: "inherit",
    });
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE craftlayer_jobs_test OWNER craftlayer_migrator",
  ]);
  const jobsUrl = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/craftlayer_jobs_test`;
  env.TEST_DEPLOYMENT_JOBS_DATABASE_URL = jobsUrl("craftlayer_runtime");
  env.TEST_DEPLOYMENT_JOBS_IDENTITY_DATABASE_URL = jobsUrl(
    "craftlayer_identity",
  );
  for (let i = 0; i < 2; i++)
    run("pnpm", ["db:migrate"], {
      env: { ...env, MIGRATION_DATABASE_URL: jobsUrl("craftlayer_migrator") },
      stdio: "inherit",
    });
  run(
    "docker",
    [
      "exec",
      "-i",
      name,
      "psql",
      "-U",
      "craftlayer_admin",
      "-d",
      "craftlayer",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input:
        "CREATE TABLE project_reference_fixture(organization_id uuid not null,project_id uuid not null,foreign key(organization_id,project_id) references projects(organization_id,id)); ALTER TABLE project_reference_fixture ENABLE ROW LEVEL SECURITY; ALTER TABLE project_reference_fixture FORCE ROW LEVEL SECURITY; CREATE POLICY fixture_scope ON project_reference_fixture USING(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('app.organization_id',true),'')::uuid); GRANT SELECT,INSERT,DELETE ON project_reference_fixture TO craftlayer_runtime;",
    },
  );
  // Backup records get their own installation so suites can run in parallel.
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE craftlayer_backups_test OWNER craftlayer_migrator",
  ]);
  const backupsUrl = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/craftlayer_backups_test`;
  env.TEST_BACKUPS_DATABASE_URL = backupsUrl("craftlayer_runtime");
  env.TEST_BACKUPS_IDENTITY_DATABASE_URL = backupsUrl("craftlayer_identity");
  run("pnpm", ["db:migrate"], {
    env: { ...env, MIGRATION_DATABASE_URL: backupsUrl("craftlayer_migrator") },
    stdio: "inherit",
  });
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE craftlayer_actions_test OWNER craftlayer_migrator",
  ]);
  const actionsUrl = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/craftlayer_actions_test`;
  env.TEST_ACTIONS_DATABASE_URL = actionsUrl("craftlayer_runtime");
  env.TEST_ACTIONS_IDENTITY_DATABASE_URL = actionsUrl("craftlayer_identity");
  run("pnpm", ["db:migrate"], {
    env: { ...env, MIGRATION_DATABASE_URL: actionsUrl("craftlayer_migrator") },
    stdio: "inherit",
  });
  run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE craftlayer_agent_requests_test OWNER craftlayer_migrator",
  ]);
  const agentRequestsUrl = (role) =>
    `postgres://${role}:${password}@127.0.0.1:${port}/craftlayer_agent_requests_test`;
  env.TEST_AGENT_REQUESTS_DATABASE_URL = agentRequestsUrl("craftlayer_runtime");
  env.TEST_AGENT_REQUESTS_IDENTITY_DATABASE_URL = agentRequestsUrl(
    "craftlayer_identity",
  );
  run("pnpm", ["db:migrate"], {
    env: {
      ...env,
      MIGRATION_DATABASE_URL: agentRequestsUrl("craftlayer_migrator"),
    },
    stdio: "inherit",
  });
  run("pnpm", ["test:integration"], { env, stdio: "inherit" });
  cpSync("packages/db/migrations", migrationFixture, { recursive: true });
  writeFileSync(
    join(migrationFixture, "9999_failure.sql"),
    "CREATE TABLE migration_rollback_probe(id integer); SELECT no_such_column;",
  );
  const failureEnv = {
    ...env,
    CRAFTLAYER_MIGRATIONS_DIRECTORY: migrationFixture,
  };
  const failed = spawnSync("pnpm", ["db:migrate"], {
    env: failureEnv,
    encoding: "utf8",
  });
  if (failed.status !== 1)
    throw new Error("Broken migration unexpectedly passed");
  const table = run("docker", [
    "exec",
    name,
    "psql",
    "-U",
    "craftlayer_admin",
    "-d",
    "craftlayer",
    "-Atc",
    "select to_regclass('public.migration_rollback_probe') is null",
  ]);
  if (table !== "t") throw new Error("Failed migration did not roll back DDL");
  rmSync(join(migrationFixture, "9999_failure.sql"));
  appendFileSync(
    join(migrationFixture, "0001_organizations.sql"),
    "\n-- forbidden applied-migration edit\n",
  );
  const checksum = spawnSync("pnpm", ["db:migrate"], {
    env: failureEnv,
    encoding: "utf8",
  });
  if (checksum.status !== 1)
    throw new Error("Changed applied migration unexpectedly passed");
  console.log("Migration rollback and checksum tamper checks: PASS");
} catch (error) {
  console.error(error.message.replaceAll(password, "[REDACTED]"));
  process.exitCode = 1;
} finally {
  rmSync(migrationFixture, { recursive: true, force: true });
  spawnSync("docker", ["rm", "-f", "-v", redisName], { stdio: "ignore" });
  spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
}
