import pg from "pg";

const url = process.env.PROVISION_DATABASE_URL;
const password = process.env.IDENTITY_PASSWORD;
if (
  !url ||
  new URL(url).username !== "craftlayer_admin" ||
  !password ||
  !/^[a-f0-9]{48,128}$/.test(password)
)
  throw new Error(
    "Owner provisioning configuration missing or invalid; values omitted",
  );
const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
try {
  await client.connect();
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(74618000)");
  const exists = await client.query(
    "select 1 from pg_roles where rolname='craftlayer_identity'",
  );
  if (!exists.rowCount) {
    await client.query(
      "create role craftlayer_identity login nosuperuser nocreatedb nocreaterole noinherit nobypassrls",
    );
    const result = await client.query<{ statement: string }>(
      "select format('ALTER ROLE craftlayer_identity PASSWORD %L',$1::text) as statement",
      [password],
    );
    await client.query(result.rows[0]?.statement ?? "");
  }
  await client.query(
    "grant connect on database craftlayer to craftlayer_identity",
  );
  await client.query("grant usage on schema public to craftlayer_identity");
  await client.query("commit");
  console.log("Identity role provisioned; existing password preserved.");
} catch {
  await client.query("rollback").catch(() => {});
  console.error("Owner role provisioning failed; values omitted.");
  process.exitCode = 1;
} finally {
  await client.end();
}
