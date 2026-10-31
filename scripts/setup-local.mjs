import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const existing = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const values = parseEnv(existing);
const added = {};
for (const key of [
  "POSTGRES_PASSWORD",
  "MIGRATOR_PASSWORD",
  "RUNTIME_PASSWORD",
  "REDIS_PASSWORD",
  "IDENTITY_PASSWORD",
  "CRAFTLAYER_BOOTSTRAP_TOKEN",
  "CRAFTLAYER_RECOVERY_TOKEN",
  "CRAFTLAYER_CSRF_SECRET",
]) {
  if (!values[key]) added[key] = randomBytes(32).toString("hex");
}
const all = { ...values, ...added };
const defaults = {
  CRAFTLAYER_HTTP_PORT: "3000",
  DATABASE_URL: `postgres://craftlayer_runtime:${all.RUNTIME_PASSWORD}@127.0.0.1:55432/craftlayer`,
  MIGRATION_DATABASE_URL: `postgres://craftlayer_migrator:${all.MIGRATOR_PASSWORD}@127.0.0.1:55432/craftlayer`,
  AUTH_DATABASE_URL: `postgres://craftlayer_identity:${all.IDENTITY_PASSWORD}@127.0.0.1:55432/craftlayer`,
  REDIS_URL: `redis://:${all.REDIS_PASSWORD}@127.0.0.1:56379`,
  CRAFTLAYER_PUBLIC_URL: `http://127.0.0.1:${all.CRAFTLAYER_HTTP_PORT ?? 3000}`,
};
for (const [k, v] of Object.entries(defaults)) if (!values[k]) added[k] = v;
if (Object.keys(added).length) {
  writeFileSync(
    ".env",
    `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${Object.entries(
      added,
    )
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
}
chmodSync(".env", 0o600);
console.log(
  "Local configuration ready; missing credentials added, existing values preserved. Secrets are not printed.",
);
