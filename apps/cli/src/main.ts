import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { parseServerConfig } from "@craftlayer/config";

const [command, subcommand, file] = process.argv.slice(2);
if (!command || ["help", "--help", "-h"].includes(command)) {
  console.log(
    "CraftLayer CLI — foundation\n\n  config validate [env-file]   Validate server config without printing secrets\n  help                         Show this help\n\nAuthentication and mission commands arrive in later chapters.",
  );
} else if (command === "config" && subcommand === "validate") {
  try {
    parseServerConfig({
      ...process.env,
      ...(file ? parseEnv(await readFile(file, "utf8")) : {}),
    });
    console.log(JSON.stringify({ valid: true }));
  } catch {
    console.error(
      JSON.stringify({
        valid: false,
        error: "Configuration invalid or unreadable; values omitted.",
      }),
    );
    process.exitCode = 1;
  }
} else {
  console.error("Unknown command; use --help");
  process.exitCode = 2;
}
