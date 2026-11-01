import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { AuthService } from "@craftlayer/auth";
import {
  parseOwnerRecoveryConfig,
  parseServerConfig,
} from "@craftlayer/config";
import { runtimeCli } from "./runtime.js";
import { readSecret } from "./secret.js";

const [command, subcommand, file] = process.argv.slice(2);
if (await runtimeCli(process.argv.slice(2))) {
} else if (!command || ["help", "--help", "-h"].includes(command)) {
  console.log(
    "CraftLayer CLI — local Core\n\n  config validate [env-file]   Validate server config without printing secrets\n  help                         Show this help\n\nOwner tools: owner bootstrap-token; owner reset-password <login> (hidden input or stdin). Runtime: login <origin> <login>; logout; fleet agents|groups <org> <environment>; fleet create-agent|create-group <org> <json-file>; template create <org> <json-file>; template list <org> <environment>; mission create <org> <json-file> <idempotency-uuid>; mission get|list <org> <id-or-environment>; mission execute <org> <mission> <version> <idempotency-uuid>. worker enroll <org> <environment> [protected-file]; worker list <org> <environment>; worker revoke <org> <worker> <version>. Passwords use hidden input/stdin; local session files are mode 0600.",
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
} else if (command === "owner" && subcommand === "bootstrap-token") {
  if (!process.env.CRAFTLAYER_BOOTSTRAP_TOKEN) {
    console.error("Run pnpm setup:local first.");
    process.exitCode = 1;
  } else console.log(process.env.CRAFTLAYER_BOOTSTRAP_TOKEN);
} else if (
  command === "owner" &&
  subcommand === "reset-password" &&
  file &&
  process.argv.length === 5
) {
  let auth: AuthService | undefined;
  try {
    const config = parseOwnerRecoveryConfig(process.env);
    if (
      !config.AUTH_DATABASE_URL ||
      !config.CRAFTLAYER_BOOTSTRAP_TOKEN ||
      !config.CRAFTLAYER_RECOVERY_TOKEN ||
      !config.CRAFTLAYER_CSRF_SECRET
    )
      throw new Error("Missing local identity config");
    const password = await readSecret();
    auth = new AuthService({
      databaseUrl: config.AUTH_DATABASE_URL,
      bootstrapToken: config.CRAFTLAYER_BOOTSTRAP_TOKEN,
      recoveryToken: config.CRAFTLAYER_RECOVERY_TOKEN,
      csrfSecret: config.CRAFTLAYER_CSRF_SECRET,
    });
    await auth.initialize();
    await auth.recoverPassword(
      config.CRAFTLAYER_RECOVERY_TOKEN,
      file,
      password,
    );
    console.log(
      "Password changed; existing sessions revoked. Account disable status is unchanged.",
    );
  } catch {
    console.error(
      "Local owner recovery failed; validate local identity access and account. Secrets omitted.",
    );
    process.exitCode = 1;
  } finally {
    await auth?.close();
  }
} else {
  console.error("Unknown command; use --help");
  process.exitCode = 2;
}
