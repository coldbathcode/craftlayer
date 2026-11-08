// Builds the CraftLayer Knock server plugin with the system JDK (javac/jar), compiling
// against the Paper API jars of a booted pinned server so the result matches exactly
// what runs. No Gradle, no network. Usage:
//   node scripts/minecraft/build-knock-plugin.mjs <libraries-dir> [output-jar]
// <libraries-dir> is the `libraries` directory a Paper server creates on first boot
// (for example <bundle>/data/libraries); it must contain paper-api, adventure-api,
// adventure-key and jspecify. The output defaults to
// infra/minecraft/plugins/craftlayer-knock/dist/craftlayer-knock.jar (ignored by Git).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const plugin = join(root, "infra/minecraft/plugins/craftlayer-knock");
const [librariesArg, outputArg] = process.argv.slice(2);
if (!librariesArg) {
  console.error(
    "Usage: build-knock-plugin.mjs <paper-libraries-dir> [output-jar]",
  );
  process.exit(2);
}
function findJars(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findJars(full, out);
    else if (
      /^(paper-api|adventure-api|adventure-key|jspecify)-.*\.jar$/.test(
        entry.name,
      )
    )
      out.push(full);
  }
  return out;
}
const jars = findJars(resolve(librariesArg));
for (const needed of [
  "paper-api",
  "adventure-api",
  "adventure-key",
  "jspecify",
])
  if (!jars.some((j) => j.includes(`/${needed}-`)))
    throw new Error(`Missing ${needed} jar under ${librariesArg}`);
const output = resolve(outputArg ?? join(plugin, "dist/craftlayer-knock.jar"));
const classes = join(plugin, "dist/classes");
rmSync(join(plugin, "dist"), { recursive: true, force: true });
mkdirSync(classes, { recursive: true });
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`${cmd} failed:\n${r.stderr || r.stdout}`);
  return r;
};
run("javac", [
  "--release",
  "21",
  "-Xlint:all",
  "-Werror",
  "-cp",
  jars.join(":"),
  "-d",
  classes,
  join(plugin, "src/dev/craftlayer/knock/KnockPlugin.java"),
]);
run("jar", [
  "--create",
  "--file",
  output,
  "-C",
  classes,
  ".",
  "-C",
  plugin,
  "plugin.yml",
]);
const sha256 = createHash("sha256").update(readFileSync(output)).digest("hex");
console.log(
  JSON.stringify({
    output,
    bytes: statSync(output).size,
    sha256,
    compiled_against: jars.map((j) => j.split("/").pop()),
  }),
);
