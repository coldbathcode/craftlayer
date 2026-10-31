import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const directory =
  process.env.CRAFTLAYER_MIGRATIONS_DIRECTORY ??
  fileURLToPath(new URL("../migrations/", import.meta.url));
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error(
    "MIGRATION_DATABASE_URL is required; runtime credentials cannot migrate",
  );
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});
try {
  await client.connect();
  await client.query("select pg_advisory_lock(74618001)");
  await client.query(
    "create table if not exists craftlayer_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())",
  );
  for (const name of (await readdir(directory))
    .filter((n) => /^\d{4}_.+\.sql$/.test(n))
    .sort()) {
    const text = await readFile(`${directory}/${name}`, "utf8");
    const checksum = createHash("sha256").update(text).digest("hex");
    const { rows } = await client.query<{ checksum: string }>(
      "select checksum from craftlayer_migrations where name=$1",
      [name],
    );
    if (rows[0]) {
      if (rows[0].checksum !== checksum)
        throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query("begin");
    try {
      await client.query(text);
      await client.query(
        "insert into craftlayer_migrations(name,checksum) values($1,$2)",
        [name, checksum],
      );
      await client.query("commit");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  console.log("Migrations current");
} catch {
  console.error(
    "Migration failed; check database availability, migration role and migration checksums. Credentials are omitted.",
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
