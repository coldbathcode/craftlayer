import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

if (!process.getuid?.()) throw new Error("Use a non-root worker operator");
mkdirSync(".worker-secrets", { recursive: true, mode: 0o700 });
const local = parseEnv(readFileSync(".env", "utf8"));
if (!local.REDIS_URL) throw new Error("Run pnpm setup:local first");
const files = {
  "compose.env": `CRAFTLAYER_HOST_UID=${process.getuid()}\nCRAFTLAYER_HOST_GID=${process.getgid()}\n`,
  "host.env": `REDIS_URL=${local.REDIS_URL}\nCRAFTLAYER_WORKER_API_ORIGIN=http://127.0.0.1:${local.CRAFTLAYER_HTTP_PORT ?? 3000}\nCRAFTLAYER_WORKER_CREDENTIAL_FILE=${resolve(".worker-secrets/credential.json")}\n`,
};
for (const [name, value] of Object.entries(files))
  if (!existsSync(`.worker-secrets/${name}`))
    writeFileSync(`.worker-secrets/${name}`, value, {
      mode: 0o600,
      flag: "wx",
    });
console.log(
  "Protected worker transport settings ready; enroll a simulation worker separately. Existing files preserved; values omitted.",
);
