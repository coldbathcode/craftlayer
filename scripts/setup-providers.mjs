import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

if (!process.getuid?.())
  throw new Error("Run provider setup as a non-root host operator");
mkdirSync(".secrets", { recursive: true, mode: 0o700 });
const files = {
  "provider-keys.json": JSON.stringify(
    { active: "k1", keys: { k1: randomBytes(32).toString("hex") } },
    null,
    2,
  ),
  "provider-policy.json": JSON.stringify(
    {
      version: 1,
      openrouter_enabled: false,
      openrouter_models: [],
      allow_paid: false,
      max_paid_micro_usd: "0",
      stopped: false,
      ollama: [],
    },
    null,
    2,
  ),
  "provider.env": `CRAFTLAYER_HOST_UID=${process.getuid()}\nCRAFTLAYER_HOST_GID=${process.getgid()}\n`,
};
for (const [name, content] of Object.entries(files))
  if (!existsSync(`.secrets/${name}`))
    writeFileSync(`.secrets/${name}`, `${content}\n`, {
      mode: 0o600,
      flag: "wx",
    });
console.log(
  "Protected provider files ready; existing values preserved, all endpoints disabled. Values omitted.",
);
