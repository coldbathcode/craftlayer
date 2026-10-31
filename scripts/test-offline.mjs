import { spawnSync } from "node:child_process";

for (const args of [
  [
    "build",
    "-f",
    "infra/images/Dockerfile",
    "--target",
    "build",
    "-t",
    "craftlayer-check:local",
    ".",
  ],
  [
    "run",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--user",
    "node",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/workspace/node_modules/.vite-temp:uid=1000,gid=1000",
    "--tmpfs",
    "/workspace/node_modules/.vitest-cache:uid=1000,gid=1000",
    "-e",
    "XDG_DATA_HOME=/tmp/craftlayer-vitest",
    "craftlayer-check:local",
    "node",
    "node_modules/vitest/vitest.mjs",
    "run",
  ],
]) {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
