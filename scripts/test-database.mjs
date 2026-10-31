import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const image = "craftlayer-postgres-test:local";
const name = `craftlayer-test-${process.pid}`;
const password = randomBytes(24).toString("hex");
const env = { ...process.env };
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
  for (let i = 0; i < 2; i++)
    run("pnpm", ["db:migrate"], { env, stdio: "inherit" });
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
  run("pnpm", ["test:integration"], { env, stdio: "inherit" });
} catch (error) {
  console.error(error.message.replaceAll(password, "[REDACTED]"));
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
}
