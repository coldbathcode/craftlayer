import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";

function run(args) {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const ids = run(["compose", "ps", "-q"]).trim().split("\n").filter(Boolean);
assert.equal(ids.length, 5, "Expected five running services");
const containers = JSON.parse(run(["inspect", ...ids]));
for (const container of containers) {
  const service = container.Config.Labels["com.docker.compose.service"];
  assert.equal(
    container.State.Health.Status,
    "healthy",
    `${service} unhealthy`,
  );
  assert.notEqual(container.Config.User, "", "Must explicitly run non-root");
  assert.notEqual(container.Config.User, "root");
  assert(container.HostConfig.CapDrop.includes("ALL"));
  assert(container.HostConfig.Memory > 0);
  const ports = Object.values(container.HostConfig.PortBindings ?? {}).flat();
  if (service === "web") {
    assert.equal(ports.length, 1);
    assert.equal(ports[0].HostIp, "127.0.0.1");
  } else assert.equal(ports.length, 0, `${service} unexpectedly published`);
  if (service === "web")
    assert(
      !container.Config.Env.some((value) =>
        /^(DATABASE_URL|AUTH_DATABASE_URL|REDIS_URL|MIGRATION_DATABASE_URL|PROVISION_DATABASE_URL|CRAFTLAYER_(BOOTSTRAP_TOKEN|RECOVERY_TOKEN|CSRF_SECRET|SMTP_URL)|.*PASSWORD)=/.test(
          value,
        ),
      ),
      "Web must not receive credentials",
    );
  if (service === "worker")
    assert(
      !container.Config.Env.some((value) =>
        /^(AUTH_DATABASE_URL|PROVISION_DATABASE_URL|MIGRATION_DATABASE_URL|CRAFTLAYER_(BOOTSTRAP_TOKEN|RECOVERY_TOKEN|CSRF_SECRET|SMTP_URL))=/.test(
          value,
        ),
      ),
      "Worker must not receive identity or migration credentials",
    );
  assert(
    !container.Mounts.some((mount) => mount.Source.includes("docker.sock")),
  );
}
const response = await fetch(
  `http://127.0.0.1:${process.env.CRAFTLAYER_HTTP_PORT ?? 3000}/api/v1/system/status`,
);
assert(response.ok);
assert.equal((await response.json()).status, "ok");
console.log(
  "Stack health, private ports, non-root users, memory/capability limits and web secret separation: PASS",
);
