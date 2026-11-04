import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadIdentityCandidate } from "../../scripts/minecraft/identity-fixture.js";
import {
  PlaytestPreparationError,
  preparePlaytest,
  renderPlaytest,
} from "../../scripts/minecraft/playtest.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const path of dirs.splice(0)) await rm(path, { recursive: true });
});

it("isolates a new Java server with loopback game access and no administrative ports", async () => {
  const profile = await loadIdentityCandidate();
  const output = renderPlaytest({}, profile, randomUUID());
  const service = output.compose.services.minecraft;
  expect(service.image).toBe(profile.java_image);
  expect(service.ports).toEqual([
    {
      target: 25565,
      published: "25575",
      host_ip: "127.0.0.1",
      protocol: "tcp",
    },
  ]);
  expect(service).toMatchObject({
    user: "1000:1000",
    restart: "no",
    read_only: true,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    cpus: 2,
    mem_limit: "3g",
    memswap_limit: "3g",
    stop_grace_period: "120s",
  });
  expect(service.volumes.map((v) => v.source)).toEqual(["./data", "./runtime"]);
  expect(service.volumes.every((v) => v.bind.create_host_path === false)).toBe(
    true,
  );
  expect(service.volumes[1]?.read_only).toBe(true);
  for (const property of [
    "online-mode=true",
    "white-list=true",
    "enforce-whitelist=true",
    "enforce-secure-profile=true",
    "enable-rcon=false",
    "enable-query=false",
    "management-server-enabled=false",
    "enable-jmx-monitoring=false",
  ])
    expect(output.properties.split("\n")).toContain(property);
  expect(output.manifest).toMatchObject({
    eula_accepted: false,
    player_configured: false,
    player_identity_verified: false,
    game_boot_verified: false,
    backup_restore_verified: false,
    storage_quota_verified: false,
    production_ready: false,
    craftlayer_managed: false,
    public_game_port: false,
  });
});

it("refuses caller images, paths, commands, EULA/qualification claims and root identities", async () => {
  const profile = await loadIdentityCandidate();
  for (const input of [
    { image: "untrusted" },
    { data_root: "/opt/minecraft-java/data" },
    { command: "sh" },
    { privileged: true },
    { eula_accepted: true },
    { qualified: true },
    { host_ip: "0.0.0.0" },
    { uid: 0 },
    { gid: 0 },
    { port: 22 },
    { port: 65536 },
    { player: { name: "Bad\nname", uuid: randomUUID() } },
    { player: { name: "TestPlayer", uuid: "not-a-uuid" } },
  ])
    expect(() => renderPlaytest(input, profile, randomUUID())).toThrow();
  expect(() => renderPlaytest({}, profile, "../existing-world")).toThrow();
  expect(() =>
    renderPlaytest({}, { ...profile, minecraft_java: "1.0" }, randomUUID()),
  ).toThrow("PLAYTEST_PROFILE_MISMATCH");
});

it("prepares private fresh bundles with verified Paper only and leaves EULA unaccepted", async () => {
  const profile = await loadIdentityCandidate(),
    bytes = Buffer.from("synthetic Paper fixture"),
    sha256 = createHash("sha256").update(bytes).digest("hex"),
    candidate = {
      ...profile,
      artifacts: profile.artifacts.map((a) =>
        a.component === "paper"
          ? {
              ...a,
              sha256,
              url: `https://fill-data.papermc.io/v1/objects/${sha256}/paper-${a.version}-${a.build}.jar`,
            }
          : a,
      ),
    },
    calls: string[] = [],
    player = { name: "TestPlayer", uuid: randomUUID() };
  async function* download(url: string) {
    calls.push(url);
    yield bytes;
  }
  const first = await preparePlaytest({ player }, candidate, download);
  dirs.push(first.directory);
  const second = await preparePlaytest({}, candidate, download);
  dirs.push(second.directory);
  expect(first.directory).not.toBe(second.directory);
  expect(first.deployment_id).not.toBe(second.deployment_id);
  expect(first).toMatchObject({
    deployed: false,
    eula_accepted: false,
    player_configured: true,
    artifact_integrity: true,
  });
  expect(calls).toHaveLength(2);
  expect(calls.every((url) => url.includes("fill-data.papermc.io"))).toBe(true);
  expect(await readFile(join(first.directory, "data/eula.txt"), "utf8")).toBe(
    "eula=false\n",
  );
  expect(
    JSON.parse(
      await readFile(join(first.directory, "data/whitelist.json"), "utf8"),
    ),
  ).toEqual([player]);
  expect(
    JSON.parse(
      await readFile(join(second.directory, "data/whitelist.json"), "utf8"),
    ),
  ).toEqual([]);
  expect(await readFile(join(first.directory, "runtime/paper.jar"))).toEqual(
    bytes,
  );
  expect(
    await readFile(join(first.directory, "artifact.sha256"), "utf8"),
  ).toContain(sha256);
  expect((await lstat(first.directory)).mode & 0o077).toBe(0);
  expect(
    (await lstat(join(first.directory, "data/whitelist.json"))).mode & 0o077,
  ).toBe(0);
  await expect(
    lstat(join(first.directory, "data/plugins")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    lstat(join(first.directory, "runtime/paper.jar.part")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects wrong artifact bytes before any runnable JAR is published", async () => {
  const profile = await loadIdentityCandidate();
  const result = await preparePlaytest({}, profile, async function* () {
    yield Buffer.from("corrupt");
  }).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(PlaytestPreparationError);
  if (!(result instanceof PlaytestPreparationError))
    throw new Error("Expected failed preparation");
  dirs.push(result.directory);
  await expect(
    lstat(join(result.directory, "runtime/paper.jar")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    lstat(join(result.directory, "artifact.sha256")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(result.directory, "data/eula.txt"), "utf8")).toBe(
    "eula=false\n",
  );
  expect(
    (await lstat(join(result.directory, "runtime/paper.jar.part"))).isFile(),
  ).toBe(true);
});
