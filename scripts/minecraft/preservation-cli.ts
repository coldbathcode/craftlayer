import { capturePreservation } from "./preservation.js";

const help = `CraftLayer stopped-source preservation manifest (read only)
  scripts/preservation.sh --local --container NAME --docker-socket /absolute/local.sock
      --data-root /absolute/selected/data --compose /absolute/selected/compose.yaml
No default collection, remote transport, backup creation or restore operation.
The selected Docker container must remain exited with the exact /data binding.
Output contains fingerprints and private inventory metadata; protect it outside Git.
Exit 0: manifest captured; 2: refused/unknown/changed source (values omitted).
`;
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    process.stdout.write(help);
    return;
  }
  if (args[0] !== "--local" || args.length !== 9)
    throw new Error("INVALID_ARGUMENTS");
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      !key ||
      !value ||
      values.has(key) ||
      !["--container", "--docker-socket", "--data-root", "--compose"].includes(
        key,
      ) ||
      (key !== "--container" && !value.startsWith("/"))
    )
      throw new Error("INVALID_ARGUMENTS");
    values.set(key, value);
  }
  const container = values.get("--container");
  const socket = values.get("--docker-socket");
  const dataRoot = values.get("--data-root");
  const compose = values.get("--compose");
  if (!container || !socket || !dataRoot || !compose)
    throw new Error("INVALID_ARGUMENTS");
  const report = await capturePreservation({
    container,
    socket,
    dataRoot,
    compose,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
main().catch(() => {
  process.stderr.write(
    "PRESERVATION_REFUSED: source is unverified, changing, unsupported or exceeds limits; values omitted.\n",
  );
  process.exitCode = 2;
});
