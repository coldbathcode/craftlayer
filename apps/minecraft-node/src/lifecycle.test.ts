import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DockerPower } from "./lifecycle.js";

async function engine(containers: Array<{ Id: string; State: string }>) {
  const directory = await mkdtemp(join(tmpdir(), "craftlayer-power-")),
    socket = join(directory, "engine.sock"),
    requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${decodeURIComponent(req.url ?? "")}`);
    if (req.method === "GET") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(containers));
      return;
    }
    const first = containers[0];
    if (first) first.State = req.url?.includes("/start") ? "running" : "exited";
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((done) => server.listen(socket, done));
  return {
    socket,
    requests,
    async close() {
      await new Promise((done) => server.close(done));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const target = { compose_project: "family", compose_service: "minecraft" };
it("starts and stops only the one container its two labels select", async () => {
  const id = "c".repeat(64),
    fake = await engine([{ Id: id, State: "running" }]);
  try {
    const power = new DockerPower(fake.socket, target);
    expect(await power.running()).toBe(true);
    await power.stop();
    expect(await power.running()).toBe(false);
    await power.start();
    expect(await power.running()).toBe(true);
    const list =
      'GET /v1.50/containers/json?all=true&filters={"label":["com.docker.compose.project=family","com.docker.compose.service=minecraft"]}';
    expect(fake.requests).toEqual([
      list,
      list,
      `POST /v1.50/containers/${id}/stop?t=90`,
      list,
      list,
      `POST /v1.50/containers/${id}/start`,
      list,
    ]);
  } finally {
    await fake.close();
  }
});
it("refuses to act when the labels match no container or more than one", async () => {
  for (const containers of [
    [],
    [
      { Id: "a".repeat(64), State: "running" },
      { Id: "b".repeat(64), State: "running" },
    ],
  ]) {
    const fake = await engine(containers);
    try {
      const power = new DockerPower(fake.socket, target);
      await expect(power.stop()).rejects.toThrow("GAME_CONTAINER_AMBIGUOUS");
      await expect(power.start()).rejects.toThrow("GAME_CONTAINER_AMBIGUOUS");
      expect(fake.requests.every((r) => r.startsWith("GET "))).toBe(true);
    } finally {
      await fake.close();
    }
  }
});
it("accepts only a local socket and plain label values", () => {
  expect(() => new DockerPower("tcp://engine", target)).toThrow();
  expect(
    () =>
      new DockerPower("/var/run/docker.sock", {
        compose_project: 'family"],"x":["y',
        compose_service: "minecraft",
      }),
  ).toThrow();
});
