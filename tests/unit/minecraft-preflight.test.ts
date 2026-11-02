import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReport,
  type Evidence,
  hash,
  MAX_READ,
  type ReadName,
  readNames,
} from "../../scripts/minecraft/preflight.js";
import {
  collectLocal,
  confinedFile,
  readCommand,
  readFileBounded,
} from "../../scripts/minecraft/preflight-local.js";

const secret = "SYNTHETIC_SECRET_DO_NOT_PRINT";
const id = "a".repeat(64);
const now = new Date("2026-11-02T12:00:00Z");
const ok = (text: string) => ({ status: "ok" as const, text });
function fixture(running = false): Evidence {
  return {
    container_name: "minecraft-java",
    data_root: "/fixture/data",
    commands: {
      docker_version: ok(
        JSON.stringify({ Server: { Version: "28.2.2", private: secret } }),
      ),
      container: ok(
        JSON.stringify([
          {
            Id: id,
            Name: "/minecraft-java",
            Image: `sha256:${"b".repeat(64)}`,
            Config: {
              Image: `private/${secret}:latest`,
              Env: [`RCON_PASSWORD=${secret}`],
              Labels: { secret },
            },
            State: {
              Running: running,
              Status: running ? "running" : "exited",
              Error: secret,
            },
            HostConfig: {
              Memory: 6442450944,
              NanoCpus: 4000000000,
              NetworkMode: "bridge",
              RestartPolicy: { Name: "unless-stopped" },
            },
            Mounts: [
              {
                Type: "bind",
                Source: "/fixture/data",
                Destination: "/data",
                RW: true,
              },
              {
                Type: "volume",
                Source: `/unrelated/${secret}`,
                Destination: `/${secret}`,
                RW: false,
              },
            ],
            NetworkSettings: {
              Networks: { [secret]: { IPAddress: secret } },
              Ports: {
                "25565/tcp": [{ HostPort: "25565", HostIp: "0.0.0.0" }],
                "19132/udp": [{ HostPort: "19132", HostIp: "::" }],
              },
            },
          },
        ]),
      ),
      containers: ok(
        [
          JSON.stringify({
            ID: id,
            State: running ? "running" : "exited",
            Names: secret,
          }),
          JSON.stringify({
            ID: "c".repeat(64),
            State: "running",
            Names: secret,
            private: secret,
          }),
        ].join("\n"),
      ),
      firewall_nft: ok(JSON.stringify({ nftables: [secret] })),
      firewall_iptables: { status: "denied", text: secret },
    },
    files: {
      compose: ok(`password: ${secret}`),
      properties: ok(
        `online-mode=true\nwhite-list=true\nenforce-whitelist=true\npvp=false\nenable-command-block=false\nenable-rcon=true\nrcon.password=${secret}\nrcon.port=25575\nserver-port=25565\n`,
      ),
      allowlist: ok(
        JSON.stringify([
          { uuid: "00000000-0000-4000-8000-000000000001", name: secret },
        ]),
      ),
      operators: ok("[]"),
      geyser: ok(`remote:\n  auth-type: floodgate\nsecret: ${secret}`),
      floodgate: ok(`key-file-name: ${secret}`),
    },
    disk: { available_bytes: 1e9, total_bytes: 2e9 },
    backups: { count: 2, newest_mtime_ms: now.getTime() - 86400000 },
  };
}
async function temp() {
  return realpath(await mkdtemp(join(tmpdir(), "craftlayer-preflight-")));
}
describe("read-only Minecraft preflight", () => {
  it("preserves stopped and running observations while excluding raw secrets/players/paths", () => {
    for (const running of [false, true]) {
      const f = fixture(running);
      const before = JSON.stringify(f);
      const report = buildReport(f, now);
      expect(report.container).toMatchObject({
        verified: true,
        id,
        running,
        state: running ? "running" : "exited",
        data_binding: "matched",
      });
      expect(report.configuration).toMatchObject({
        online_authentication: true,
        allowlist_enabled: true,
        enforce_allowlist: true,
        operators: { entries: 0 },
        allowlist: { valid_uuid_entries: 1 },
      });
      expect(report.docker.other_containers?.count).toBe(1);
      expect(report.backup_inventory?.newest_age_seconds).toBe(86400);
      expect(report.family_ready).toBe(false);
      expect(report.production_verified).toBe(false);
      expect(JSON.stringify(report)).not.toContain(secret);
      expect(JSON.stringify(report)).not.toContain("/fixture/data");
      expect(JSON.stringify(f)).toBe(before);
    }
  });
  it("detects RCON exposure on IPv4/IPv6 and custom port; loopback is not proof of network privacy", () => {
    for (const ip of ["0.0.0.0", "::", "192.168.1.3", "not-an-ip"]) {
      const f = fixture();
      const c = JSON.parse(f.commands.container?.text ?? "[]");
      c[0].NetworkSettings.Ports["25575/tcp"] = [
        { HostPort: "25575", HostIp: ip },
      ];
      f.commands.container = ok(JSON.stringify(c));
      expect(buildReport(f, now).findings).toContainEqual({
        code: "RCON_PUBLISHED_NON_LOOPBACK",
        severity: "critical",
      });
    }
    const f = fixture();
    const c = JSON.parse(f.commands.container?.text ?? "[]");
    c[0].NetworkSettings.Ports["25575/tcp"] = [
      { HostPort: "25575", HostIp: "127.0.0.1" },
    ];
    f.commands.container = ok(JSON.stringify(c));
    expect(
      buildReport(f, now).findings.some(
        (v) => v.code === "RCON_PUBLISHED_NON_LOOPBACK",
      ),
    ).toBe(false);
    expect(buildReport(f, now).firewall.effective_reachability).toBe(
      "unverified",
    );
    f.files.properties = ok("rcon.port=25580");
    c[0].NetworkSettings.Ports["25580/tcp"] = [
      { HostPort: "25590", HostIp: "::" },
    ];
    f.commands.container = ok(JSON.stringify(c));
    expect(
      buildReport(f, now).findings.some(
        (v) => v.code === "RCON_PUBLISHED_NON_LOOPBACK",
      ),
    ).toBe(true);
  });
  it("rejects mismatched/ambiguous container or data roots before trusting safe properties", () => {
    for (const mutate of [
      (f: Evidence) => {
        f.data_root = "/other";
      },
      (f: Evidence) => {
        f.commands.container = ok(
          JSON.stringify([{ Name: "/foreign", Id: id }]),
        );
      },
      (f: Evidence) => {
        f.commands.container = ok("[]");
      },
      (f: Evidence) => {
        f.commands.container = ok("[{},{}]");
      },
    ]) {
      const f = fixture();
      mutate(f);
      const report = buildReport(f, now);
      expect(report.configuration.online_authentication).toBeNull();
      expect(report.container.data_binding).not.toBe("matched");
    }
  });
  it("fails closed on malformed/duplicated properties and incomplete/unavailable reads without echoes", () => {
    for (const value of [
      `online-mode=true\nonline-mode=false`,
      `online-mode=tr\\ue`,
      `online-mode=true\n${secret}`,
      `online-mode: not-true`,
    ]) {
      const f = fixture();
      f.files.properties = ok(value);
      expect(buildReport(f, now).configuration.online_authentication).not.toBe(
        true,
      );
    }
    for (const status of [
      "denied",
      "failed",
      "timeout",
      "too_large",
      "unavailable",
    ] as const) {
      const f = fixture();
      f.commands.container = { status, text: secret };
      f.files.properties = { status, text: secret };
      expect(JSON.stringify(buildReport(f, now))).not.toContain(secret);
      expect(buildReport(f, now).container.verified).toBe(false);
    }
    const f = fixture();
    f.commands.container = ok(secret);
    f.commands.containers = ok(secret);
    expect(JSON.stringify(buildReport(f, now))).not.toContain(secret);
    f.commands.container = ok(" ".repeat(MAX_READ + 1));
    expect(buildReport(f, now).docker.reads.container).toBe("too_large");
  });
  it("never qualifies hostile network/privileged settings or unsafe authentication", () => {
    const f = fixture();
    const c = JSON.parse(f.commands.container?.text ?? "[]");
    c[0].HostConfig = { Privileged: true, NetworkMode: "host" };
    f.commands.container = ok(JSON.stringify(c));
    f.files.properties = ok(
      "online-mode=false\nwhite-list=false\nenforce-whitelist=false",
    );
    const report = buildReport(f, now);
    expect(
      report.findings.filter((v) => v.severity === "critical"),
    ).toHaveLength(5);
    expect(report.family_ready).toBe(false);
  });
  it("has only fixed read argv, local Unix transport, and rejects shell/remote/unknown operations", () => {
    const options = {
      container: "minecraft-java",
      socket: "/fixture/docker.sock",
    };
    expect(readNames.map((name) => readCommand(name, options))).toEqual([
      {
        binary: "docker",
        args: [
          "--host",
          "unix:///fixture/docker.sock",
          "version",
          "--format",
          "{{json .}}",
        ],
      },
      {
        binary: "docker",
        args: [
          "--host",
          "unix:///fixture/docker.sock",
          "container",
          "inspect",
          "minecraft-java",
        ],
      },
      {
        binary: "docker",
        args: [
          "--host",
          "unix:///fixture/docker.sock",
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--format",
          "{{json .}}",
        ],
      },
      { binary: "nft", args: ["--json", "list", "ruleset"] },
      { binary: "iptables", args: [] },
    ]);
    for (const container of [
      "--help",
      "x;touch /tmp/forbidden",
      "$(id)",
      "../../other",
      "x\nstart",
    ]) {
      expect(() =>
        readCommand("container", { ...options, container }),
      ).toThrow();
    }
    for (const socket of [
      "tcp://host:2375",
      "ssh://host",
      "relative",
      "/x\n--context",
    ]) {
      expect(() => readCommand("container", { ...options, socket })).toThrow();
    }
    expect(() => readCommand("exec" as ReadName, options)).toThrow(
      "UNSUPPORTED_READ",
    );
  });
  it("collects with a recording runner and leaves selected/unrelated files and stopped state intact", async () => {
    const root = await temp();
    const server = createServer();
    const socket = join(root, "docker.sock");
    await new Promise<void>((done) => server.listen(socket, done));
    try {
      await mkdir(join(root, "data"));
      await mkdir(join(root, "backups"));
      await writeFile(join(root, "backups/candidate"), secret);
      await symlink(join(root, "unrelated"), join(root, "backups/link"));
      await writeFile(
        join(root, "data/server.properties"),
        "online-mode=true\n",
      );
      await writeFile(join(root, "unrelated"), secret);
      const f = fixture();
      const called: ReadName[] = [];
      const result = await collectLocal(
        {
          container: "minecraft-java",
          socket,
          dataRoot: join(root, "data"),
          backupRoot: join(root, "backups"),
        },
        async (name, options) => {
          readCommand(name, options);
          called.push(name);
          return f.commands[name] ?? { status: "unavailable", text: "" };
        },
      );
      expect(called).toEqual(readNames);
      expect(result.backups?.count).toBe(1);
      expect(result.files.properties?.text).toBe("online-mode=true\n");
      expect(await readFile(join(root, "unrelated"), "utf8")).toBe(secret);
      expect(await readFile(join(root, "data/server.properties"), "utf8")).toBe(
        "online-mode=true\n",
      );
      expect(buildReport(result, now).container.state).toBe("exited");
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not fall back to Docker context when local socket is absent", async () => {
    const called: ReadName[] = [];
    const e = await collectLocal(
      { container: "minecraft-java", socket: "/nonexistent/craftlayer.sock" },
      async (name) => {
        called.push(name);
        throw new Error(secret);
      },
    );
    expect(called).toEqual(["firewall_nft", "firewall_iptables"]);
    expect(buildReport(e, now).docker.reads.container).toBe("unavailable");
    expect(JSON.stringify(buildReport(e, now))).not.toContain(secret);
  });
  it("bounds file reads and denies symlink/path traversal and special files", async () => {
    const root = await temp();
    try {
      await writeFile(join(root, "outside"), secret);
      await mkdir(join(root, "data"));
      await symlink(
        join(root, "outside"),
        join(root, "data/server.properties"),
      );
      expect(
        (await confinedFile(join(root, "data"), "server.properties")).status,
      ).toBe("denied");
      expect(
        (await confinedFile(join(root, "data"), "../outside")).status,
      ).toBe("denied");
      expect((await readFileBounded(join(root, "data"))).status).toBe("denied");
      await writeFile(join(root, "large"), "x".repeat(MAX_READ + 1));
      expect((await readFileBounded(join(root, "large"))).status).toBe(
        "too_large",
      );
      expect((await readFileBounded(join(root, "missing"))).status).toBe(
        "unavailable",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("CLI help makes no collection; fixture CLI redacts; malformed/remote arguments fail without echoes", async () => {
    const root = await temp();
    const cli = resolve("scripts/preflight.sh");
    const call = (args: string[]) =>
      spawnSync(cli, args, {
        encoding: "utf8",
        env: {
          ...process.env,
          DOCKER_HOST: `ssh://${secret}`,
          DOCKER_CONTEXT: secret,
        },
        timeout: 5000,
      });
    try {
      expect(call([]).stdout).toContain("No collection occurs");
      const input = join(root, "input.json");
      await writeFile(input, JSON.stringify(fixture()));
      const good = call(["--fixture", input]);
      expect(good.status).toBe(0);
      expect(JSON.parse(good.stdout).container.state).toBe("exited");
      expect(good.stdout + good.stderr).not.toContain(secret);
      await writeFile(input, secret);
      for (const args of [
        ["--fixture", input],
        ["--host", secret],
        ["--local", "--container", secret],
        ["--local", "--container", "x", "--docker-socket", `ssh://${secret}`],
      ]) {
        const result = call(args);
        expect(result.status).toBe(2);
        expect(result.stdout + result.stderr).not.toContain(secret);
      }
      expect(hash(await readFile(input))).toBe(hash(secret));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
