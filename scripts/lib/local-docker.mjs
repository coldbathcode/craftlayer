import { execFileSync } from "node:child_process";

// Inspecting a context reads local configuration; never contact a remote daemon.
export function localDockerEndpoint(
  env = process.env,
  inspect = () =>
    JSON.parse(
      execFileSync("docker", ["context", "inspect"], { env, encoding: "utf8" }),
    )[0]?.Endpoints?.docker?.Host,
) {
  const endpoint = env.DOCKER_HOST || inspect();
  if (typeof endpoint !== "string" || !/^unix:\/\/\/[^\r\n]+$/.test(endpoint))
    throw new Error(
      "Local prototype/tests require a Unix Docker socket; refusing SSH/TCP/remote Docker contexts",
    );
  return endpoint;
}
/** Pin every child command to the checked local socket even if context changes later. */
export function pinLocalDocker() {
  const endpoint = localDockerEndpoint();
  process.env.DOCKER_HOST = endpoint;
  for (const key of [
    "DOCKER_CONTEXT",
    "DOCKER_TLS",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
  ])
    delete process.env[key];
}
