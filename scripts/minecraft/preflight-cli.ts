import { buildReport, type Evidence, object } from "./preflight.js";
import {
  collectLocal,
  type LocalOptions,
  readFileBounded,
} from "./preflight-local.js";

const usage = `CraftLayer read-only preflight (no remote transport or mutations)
  scripts/preflight.sh --fixture /absolute/synthetic-evidence.json
  scripts/preflight.sh --local --container NAME --docker-socket /absolute/local.sock
      [--data-root /absolute/data] [--compose /absolute/compose.yaml]
      [--backup-root /absolute/backups]
No collection occurs without --local or --fixture. Output is sanitized JSON.
Exit 0: inventory produced (NOT readiness); 2: invalid arguments/input.
Local collection requires operator authorization for that machine and scope.
`;
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    process.stdout.write(usage);
    return;
  }
  let evidence: Evidence;
  if (
    args.length === 2 &&
    args[0] === "--fixture" &&
    args[1]?.startsWith("/")
  ) {
    const input = await readFileBounded(args[1]);
    if (input.status !== "ok") throw new Error("INPUT_UNAVAILABLE");
    const e = object(JSON.parse(input.text));
    if (
      typeof e.container_name !== "string" ||
      (e.data_root !== null && typeof e.data_root !== "string") ||
      !e.commands ||
      !e.files
    )
      throw new Error("INVALID_FIXTURE");
    evidence = e as Evidence;
  } else {
    if (args[0] !== "--local" || args.length % 2 !== 1)
      throw new Error("INVALID_ARGUMENTS");
    const values = new Map<string, string>();
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i];
      const value = args[i + 1];
      if (
        !key ||
        !value ||
        values.has(key) ||
        ![
          "--container",
          "--docker-socket",
          "--data-root",
          "--compose",
          "--backup-root",
        ].includes(key)
      )
        throw new Error("INVALID_ARGUMENTS");
      values.set(key, value);
    }
    const container = values.get("--container");
    const socket = values.get("--docker-socket");
    if (!container || !socket) throw new Error("LOCAL_TARGET_REQUIRED");
    const options: LocalOptions = { container, socket };
    for (const [key, field] of [
      ["--data-root", "dataRoot"],
      ["--compose", "compose"],
      ["--backup-root", "backupRoot"],
    ] as const) {
      const value = values.get(key);
      if (value) {
        if (!value.startsWith("/")) throw new Error("ABSOLUTE_PATH_REQUIRED");
        options[field] = value;
      }
    }
    evidence = await collectLocal(options);
  }
  process.stdout.write(`${JSON.stringify(buildReport(evidence), null, 2)}\n`);
}
main().catch(() => {
  // Never echo paths, arguments, raw evidence, errors or child stderr.
  process.stderr.write(
    "PREFLIGHT_INPUT_OR_COLLECTION_FAILED: values omitted; see --help.\n",
  );
  process.exitCode = 2;
});
