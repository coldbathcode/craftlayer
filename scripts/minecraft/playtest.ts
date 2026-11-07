import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  identityCandidate,
  loadIdentityCandidate,
} from "./identity-fixture.js";

// Operator preparation for a separate test world. This has no Docker,
// SSH, EULA acceptance, existing-world import or platform approval capability.
export const playtestInput = z.strictObject({
  edition: z.enum(["java", "crossplay"]).default("java"),
  player: z
    .strictObject({
      name: z.string().regex(/^[A-Za-z0-9_]{3,16}$/),
      uuid: z.uuid(),
    })
    .optional(),
  uid: z.number().int().min(1).max(2147483647).default(1000),
  gid: z.number().int().min(1).max(2147483647).default(1000),
  port: z.number().int().min(1024).max(65535).default(25575),
  bedrock_port: z.number().int().min(1024).max(65535).default(19133),
});
const deploymentId = z.uuid();
const maxBytes = 128 * 1024 * 1024;
type Download = (url: string) => AsyncIterable<Uint8Array>;

export class PlaytestPreparationError extends Error {
  constructor(
    readonly directory: string,
    cause: unknown,
  ) {
    super("PLAYTEST_PREPARATION_FAILED", { cause });
  }
}

export function renderPlaytest(input: unknown, candidate: unknown, id: string) {
  const value = playtestInput.parse(input),
    profile = identityCandidate.parse(candidate);
  deploymentId.parse(id);
  const paper = profile.artifacts.find((a) => a.component === "paper");
  if (!paper || paper.version !== profile.minecraft_java)
    throw new Error("PLAYTEST_PROFILE_MISMATCH");
  if (value.edition === "crossplay" && value.port === value.bedrock_port)
    throw new Error("PLAYTEST_PORT_CONFLICT");
  const artifacts = profile.artifacts.filter(
    (a) => a.component === "paper" || value.edition === "crossplay",
  );
  const name = `craftlayer-playtest-${id}`;
  const compose = {
    name,
    services: {
      minecraft: {
        image: profile.java_image,
        pull_policy: "missing",
        user: `${value.uid}:${value.gid}`,
        working_dir: "/data",
        entrypoint: ["/opt/java/openjdk/bin/java"],
        command: [
          "-Xms512M",
          "-Xmx2048M",
          "-jar",
          "/runtime/paper.jar",
          "--nogui",
        ],
        restart: "no",
        init: true,
        read_only: true,
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        cpus: 2,
        mem_limit: "3g",
        memswap_limit: "3g",
        pids_limit: 512,
        stop_signal: "SIGTERM",
        stop_grace_period: "120s",
        ports: [
          {
            target: 25565,
            published: String(value.port),
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
          ...(value.edition === "crossplay"
            ? ["tcp", "udp"].map((protocol) => ({
                target: value.bedrock_port,
                published: String(value.bedrock_port),
                host_ip: "127.0.0.1",
                protocol,
              }))
            : []),
        ],
        volumes: [
          {
            type: "bind",
            source: "./data",
            target: "/data",
            bind: { create_host_path: false },
          },
          {
            type: "bind",
            source: "./runtime",
            target: "/runtime",
            read_only: true,
            bind: { create_host_path: false },
          },
        ],
        tmpfs: ["/tmp:rw,nosuid,nodev,size=268435456,mode=1777"],
        logging: {
          driver: "local",
          options: { "max-size": "10m", "max-file": "3" },
        },
        labels: {
          "io.craftlayer.purpose": "operator-playtest",
          "io.craftlayer.deployment": id,
        },
      },
    },
  };
  const properties = `${[
    "online-mode=true",
    "white-list=true",
    "enforce-whitelist=true",
    "enforce-secure-profile=true",
    "enable-rcon=false",
    "enable-query=false",
    "management-server-enabled=false",
    "enable-jmx-monitoring=false",
    "enable-status=true",
    "server-ip=",
    "server-port=25565",
    "level-name=world",
    "gamemode=survival",
    "difficulty=normal",
    "max-players=5",
    "view-distance=6",
    "simulation-distance=4",
    "spawn-protection=0",
    "log-ips=false",
    "motd=CraftLayer private playtest",
    "accepts-transfers=false",
  ].join("\n")}\n`;
  const manifest = {
    schema_version: 1,
    deployment_id: id,
    purpose:
      value.edition === "crossplay"
        ? "operator-crossplay-playtest"
        : "operator-java-playtest",
    edition: value.edition,
    minecraft_java: profile.minecraft_java,
    java_image: profile.java_image,
    paper_sha256: paper.sha256,
    artifacts: artifacts.map(({ component, version, build, sha256 }) => ({
      component,
      version,
      build,
      sha256,
    })),
    bedrock_versions:
      value.edition === "crossplay" ? profile.bedrock_versions : [],
    candidate_id: profile.id,
    eula_accepted: false,
    player_configured: Boolean(value.player),
    player_identity_verified: false,
    game_boot_verified: false,
    backup_restore_verified: false,
    storage_quota_verified: false,
    production_ready: false,
    craftlayer_managed: false,
    public_game_port: false,
  };
  return { value, paper, artifacts, compose, properties, manifest };
}

async function* officialDownload(url: string) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: {
      "User-Agent":
        "CraftLayer-playtest/0.1 (https://github.com/coldbathcode/craftlayer)",
    },
  });
  if (!response.ok || !response.body)
    throw new Error("PLAYTEST_DOWNLOAD_UNAVAILABLE");
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body.cancel();
    throw new Error("PLAYTEST_ARTIFACT_TOO_LARGE");
  }
  for await (const chunk of response.body) yield chunk;
}

/** Creates a new private bundle only; never accepts an existing output/data path. */
export async function preparePlaytest(
  input: unknown,
  candidate: unknown,
  download: Download = officialDownload,
) {
  const rendered = renderPlaytest(input, candidate, randomUUID()),
    directory = await mkdtemp(join(tmpdir(), "craftlayer-playtest-"));
  await mkdir(join(directory, "data"), { mode: 0o700 });
  await mkdir(join(directory, "runtime"), { mode: 0o700 });
  if (rendered.value.edition === "crossplay") {
    for (const folder of [
      "data/plugins",
      "data/plugins/Geyser-Spigot",
      "data/plugins/floodgate",
      "data/plugins/bStats",
    ])
      await mkdir(join(directory, folder), { mode: 0o700 });
  }
  const files: Record<string, string> = {
    "compose.json": `${JSON.stringify(rendered.compose, null, 2)}\n`,
    "manifest.json": `${JSON.stringify(rendered.manifest, null, 2)}\n`,
    "data/server.properties": rendered.properties,
    "data/eula.txt": "eula=false\n",
    "data/whitelist.json": `${JSON.stringify(
      rendered.value.player ? [rendered.value.player] : [],
      null,
      2,
    )}\n`,
    "data/ops.json": "[]\n",
    "README.txt":
      `CraftLayer ${rendered.value.edition} playtest preparation — NOT DEPLOYED\n\n` +
      `Minecraft Java ${rendered.manifest.minecraft_java}; new world only.\n` +
      `EULA: https://www.minecraft.net/en-us/eula — not accepted.\n` +
      `Listen on VPS loopback TCP ${rendered.value.port}; Java client uses an SSH tunnel.\n` +
      `Container UID/GID: ${rendered.value.uid}:${rendered.value.gid}; heap 2 GiB, container 3 GiB, 2 CPUs.\n` +
      (rendered.value.edition === "crossplay"
        ? `Bedrock uses loopback TCP/UDP ${rendered.value.bedrock_port}; ordinary SSH TCP forwarding cannot carry game UDP.\nPinned Geyser/Floodgate with builtin signaling; linking and metrics disabled. No Bedrock player has been granted access.\n`
        : `No Geyser/Floodgate is installed.\n`) +
      `No RCON, OP accounts, automatic restart or dashboard lifecycle control.\n\n` +
      `Before boot: inspect the approved VPS; verify spare memory/disk/ports, current workload recovery,\n` +
      `dedicated quota-controlled storage, correct data ownership, exact online player UUID and explicit EULA acceptance.\n` +
      `Before play: verify authenticated allowlist admission/denial, graceful stop, backup and isolated restore.\n` +
      `Never place this bundle over an existing deployment or point /data at an existing world.\n` +
      `No deployment, EULA change, backup, restore or deletion is performed by preparation.\n` +
      `Follow docs/development/minecraft-playtest.md in the CraftLayer repository.\n`,
  };
  if (rendered.value.edition === "crossplay") {
    files["data/plugins/Geyser-Spigot/config.yml"] =
      `bedrock:\n  address: 0.0.0.0\n  port: ${rendered.value.bedrock_port}\n  webrtc-port: 0\n  transport: nethernet\n  clone-remote-port: false\n  signaling:\n    mode: builtin\n    stun-discovery: false\n    advertise-addresses: ["127.0.0.1:${rendered.value.bedrock_port}"]\njava:\n  auth-type: floodgate\nlog-player-ip-addresses: false\nsaved-user-logins: []\nenable-metrics: false\ndebug-mode: false\nconfig-version: 12\n`;
    files["data/plugins/floodgate/config.yml"] =
      `key-file-name: key.pem\nusername-prefix: "."\nreplace-spaces: true\nplayer-link:\n  enabled: false\n  require-link: false\n  enable-own-linking: false\n  enable-global-linking: false\nmetrics:\n  enabled: false\nconfig-version: 3\n`;
    files["data/plugins/bStats/config.yml"] = "enabled: false\n";
  }
  for (const [name, content] of Object.entries(files))
    await writeFile(join(directory, name), content, {
      flag: "wx",
      mode: 0o600,
    });
  for (const artifact of rendered.artifacts) {
    const relative =
      artifact.component === "paper"
        ? "runtime/paper.jar"
        : `data/plugins/${artifact.filename}`;
    const file = await open(join(directory, `${relative}.part`), "wx", 0o600);
    let bytes = 0;
    const hash = createHash("sha256");
    try {
      for await (const chunk of download(artifact.url)) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error("PLAYTEST_ARTIFACT_TOO_LARGE");
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      if (!bytes || hash.digest("hex") !== artifact.sha256)
        throw new Error("PLAYTEST_ARTIFACT_HASH_MISMATCH");
    } catch (error) {
      // EULA stays false. Retain incomplete evidence; no cleanup can touch worlds.
      throw new PlaytestPreparationError(directory, error);
    } finally {
      await file.close();
    }
    await rename(
      join(directory, `${relative}.part`),
      join(directory, relative),
    );
  }
  await writeFile(
    join(directory, "artifact.sha256"),
    rendered.artifacts
      .map(
        (a) =>
          `${a.sha256}  ${a.component === "paper" ? "runtime/paper.jar" : `data/plugins/${a.filename}`}\n`,
      )
      .join(""),
    { flag: "wx", mode: 0o600 },
  );
  return {
    directory,
    deployment_id: rendered.manifest.deployment_id,
    artifact_integrity: true,
    deployed: false,
    eula_accepted: false,
    player_configured: rendered.manifest.player_configured,
  };
}

async function main() {
  const [command, inputFile, ...extra] = process.argv.slice(2);
  if (command === "--help" && !inputFile && !extra.length) {
    console.log(
      "Usage: pnpm minecraft:playtest:prepare [input.json]\nCreates a fresh local java or crossplay bundle; never starts or deploys it. Optional input: edition, player {name,uuid}, uid, gid, port, bedrock_port. EULA remains false. Crossplay requires separate real-client qualification.",
    );
    return;
  }
  if (command !== "prepare" || extra.length)
    throw new Error("INVALID_ARGUMENTS");
  const input = inputFile ? JSON.parse(await readFile(inputFile, "utf8")) : {};
  console.log(
    JSON.stringify(await preparePlaytest(input, await loadIdentityCandidate())),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  void main().catch(() => {
    console.error(
      "Playtest preparation failed. No server was started. Any partial bundle remains in a fresh private temporary directory; no existing data was changed.",
    );
    process.exitCode = 1;
  });
