import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

// Compare values in memory; never print a secret, even on failure.
assert(
  existsSync(".env"),
  "Run pnpm setup:local before this local credential check",
);
const values = parseEnv(readFileSync(".env", "utf8"));
const credentials = Object.entries(values)
  .filter(
    ([key, value]) =>
      /PASSWORD|TOKEN|SECRET|DATABASE_URL|REDIS_URL|SMTP_URL/.test(key) &&
      value.length >= 16,
  )
  .map(([, value]) => Buffer.from(value));
if (existsSync(".secrets/provider-keys.json")) {
  const ring = JSON.parse(readFileSync(".secrets/provider-keys.json", "utf8"));
  for (const value of Object.values(ring.keys))
    credentials.push(Buffer.from(value));
}
if (existsSync(".worker-secrets/credential.json")) {
  let credential;
  try {
    credential = JSON.parse(
      readFileSync(".worker-secrets/credential.json", "utf8"),
    );
  } catch {
    throw new Error("Worker credential JSON invalid; values omitted");
  }
  if (typeof credential.token === "string")
    credentials.push(Buffer.from(credential.token));
}
assert(credentials.length >= 8, "Expected generated local credentials");
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push(path);
  }
}
assert(
  existsSync("apps/web/.next/static"),
  "Build web before checking public bundles",
);
walk("apps/web/.next/static");
let checked = 0;
for (const path of files) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path);
  assert(
    !credentials.some((value) => content.includes(value)),
    `Local credential found in ${path}; value omitted`,
  );
  checked++;
}
console.log(
  `Local credential values absent from ${checked} source/public bundle files: PASS`,
);
