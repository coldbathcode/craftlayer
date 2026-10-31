import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.log("Existing .env kept; no secrets changed.");
} else {
  const secrets = Object.fromEntries(
    [
      "POSTGRES_PASSWORD",
      "MIGRATOR_PASSWORD",
      "RUNTIME_PASSWORD",
      "REDIS_PASSWORD",
    ].map((k) => [k, randomBytes(32).toString("hex")]),
  );
  const values = {
    ...secrets,
    CRAFTLAYER_HTTP_PORT: "3000",
    DATABASE_URL: `postgres://craftlayer_runtime:${secrets.RUNTIME_PASSWORD}@127.0.0.1:55432/craftlayer`,
    MIGRATION_DATABASE_URL: `postgres://craftlayer_migrator:${secrets.MIGRATOR_PASSWORD}@127.0.0.1:55432/craftlayer`,
    REDIS_URL: `redis://:${secrets.REDIS_PASSWORD}@127.0.0.1:56379`,
  };
  writeFileSync(
    ".env",
    `${Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created private .env with independent random credentials. Keep it out of Git and backups shared publicly.",
  );
}
