import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReadRunner } from "../../scripts/minecraft/preflight-local.js";
import {
  capturePreservation,
  compareTrees,
  scanTree,
} from "../../scripts/minecraft/preservation.js";

const canary = "SYNTHETIC_PRIVATE_PLAYER_AND_KEY";
async function temp() {
  return realpath(await mkdtemp(join(tmpdir(), "craftlayer-preservation-")));
}
async function seed(root: string) {
  await mkdir(join(root, "world/region"), { recursive: true });
  await mkdir(join(root, "world/playerdata"));
  await mkdir(join(root, "plugins/floodgate"), { recursive: true });
  await mkdir(join(root, "empty"));
  // Synthetic bytes only; these are not a playable Minecraft world or game proof.
  await writeFile(
    join(root, "world/level.dat"),
    Buffer.from([0, 1, 2, 255, 32, 64]),
  );
  await writeFile(join(root, "world/region/r.0.0.mca"), Buffer.alloc(8192, 7));
  await writeFile(
    join(root, `world/playerdata/${canary}.dat`),
    Buffer.alloc(64, 11),
  );
  await writeFile(join(root, "plugins/floodgate/key.pem"), canary, {
    mode: 0o600,
  });
  await writeFile(
    join(root, "plugins/floodgate/config.yml"),
    "player-link:\n  enabled: false\n",
  );
  await writeFile(
    join(root, "server.properties"),
    `online-mode=true\nwhite-list=true\nenforce-whitelist=true\nrcon.password=${canary}\n`,
  );
  await writeFile(join(root, "whitelist.json"), "[]");
  await writeFile(join(root, "ops.json"), "[]");
  await chmod(join(root, "ops.json"), 0o640);
}
describe("Minecraft preservation and disposable recovery rehearsal", () => {
  it("copies a synthetic recovery set into a fresh isolated directory and verifies every original byte", async () => {
    const root = await temp();
    try {
      const source = join(root, "source");
      const backup = join(root, "snapshot");
      const restore = join(root, "isolated-restore");
      await seed(source);
      const baseline = await scanTree(source);
      const started = performance.now();
      await cp(source, backup, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await cp(backup, restore, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      const restored = await scanTree(restore);
      expect(compareTrees(baseline, restored)).toMatchObject({
        content_matches: true,
        added: 0,
        missing: 0,
        changed: 0,
      });
      expect(
        compareTrees(baseline, await scanTree(source)).content_matches,
      ).toBe(true);
      expect(baseline.total_bytes).toBeGreaterThan(8192);
      expect(
        baseline.entries.some((e) => e.kind === "directory" && e.bytes === 0),
      ).toBe(true);
      expect(JSON.stringify(restored)).not.toContain(canary);
      expect(JSON.stringify(restored)).not.toContain(source);
      expect(performance.now() - started).toBeLessThan(30000);
      // The source is never deleted/overwritten to demonstrate recovery.
      expect(
        await readFile(join(source, "plugins/floodgate/key.pem"), "utf8"),
      ).toBe(canary);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("detects corrupt/missing/renamed/extra recovery bytes and metadata changes", async () => {
    const root = await temp();
    try {
      const source = join(root, "source");
      const target = join(root, "target");
      await seed(source);
      const baseline = await scanTree(source);
      await cp(source, target, { recursive: true });
      await writeFile(join(target, "world/level.dat"), "corrupt");
      await rm(join(target, "whitelist.json"));
      await writeFile(join(target, "unexpected"), "extra");
      const diff = compareTrees(baseline, await scanTree(target));
      expect(diff).toMatchObject({
        content_matches: false,
        added: 1,
        missing: 1,
        changed: 1,
      });
      await rename(
        join(target, "world/region/r.0.0.mca"),
        join(target, "world/region/r.1.0.mca"),
      );
      expect(compareTrees(baseline, await scanTree(target))).toMatchObject({
        content_matches: false,
        added: 2,
        missing: 2,
      });
      const metadataOnly = join(root, "metadata-only");
      await cp(source, metadataOnly, { recursive: true });
      await chmod(join(metadataOnly, "ops.json"), 0o600);
      expect(
        compareTrees(baseline, await scanTree(metadataOnly)),
      ).toMatchObject({ content_matches: true, metadata_matches: false });
      expect(
        compareTrees(baseline, await scanTree(source)).content_matches,
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects symlinks, hardlinks, unsupported/oversized files without partial manifests", async () => {
    const root = await temp();
    try {
      const source = join(root, "source");
      await seed(source);
      const outside = join(root, "outside");
      await writeFile(outside, canary);
      await symlink(outside, join(source, "link"));
      await expect(scanTree(source)).rejects.toThrow(
        "PRESERVATION_SYMLINK_DENIED",
      );
      await rm(join(source, "link"));
      await link(outside, join(source, "hardlink"));
      await expect(scanTree(source)).rejects.toThrow(
        "PRESERVATION_HARDLINK_DENIED",
      );
      await rm(join(source, "hardlink"));
      const file = await open(join(source, "sparse"), "wx");
      try {
        await file.truncate(512 * 1024 ** 2 + 1);
      } finally {
        await file.close();
      }
      await expect(scanTree(source)).rejects.toThrow("PRESERVATION_FILE_LIMIT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("detects same-size mutation after hashing and added children with deterministic fault injection", async () => {
    const root = await temp();
    try {
      await seed(root);
      await expect(
        scanTree(root, {
          afterRead: async () => {
            await writeFile(
              join(root, "world/level.dat"),
              Buffer.from([2, 1, 2, 255, 32, 64]),
            );
          },
        }),
      ).rejects.toThrow("PRESERVATION_CHANGED_DURING_READ");
      await expect(
        scanTree(root, {
          afterRead: async () => {
            await writeFile(join(root, "world/added"), "new");
          },
        }),
      ).rejects.toThrow("PRESERVATION_CHANGED_DURING_READ");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("enforces directory depth and generic failure without leaking source paths", async () => {
    const root = await temp();
    try {
      await mkdir(join(root, ...Array.from({ length: 17 }, () => "nested")), {
        recursive: true,
      });
      await expect(scanTree(root)).rejects.toThrow("PRESERVATION_DEPTH_LIMIT");
      await expect(scanTree(join(root, canary))).rejects.toThrow(
        "PRESERVATION_READ_FAILED",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("binds a complete manifest to matching stopped container/image/mount/config evidence", async () => {
    const root = await temp();
    const server = createServer();
    const socket = join(root, "docker.sock");
    await new Promise<void>((done) => server.listen(socket, done));
    try {
      const data = join(root, "data");
      await seed(data);
      const compose = join(root, "compose.yaml");
      await writeFile(compose, `private: ${canary}`);
      const options = {
        container: "minecraft-java",
        socket,
        dataRoot: data,
        compose,
      };
      let inspections = 0;
      let mode: "stable" | "running" | "changed" = "stable";
      const run: ReadRunner = async (name) => {
        if (name !== "container") return { status: "unavailable", text: "" };
        const n = ++inspections;
        return {
          status: "ok",
          text: JSON.stringify([
            {
              Id: "a".repeat(64),
              Name: "/minecraft-java",
              Image: `sha256:${"b".repeat(64)}`,
              Config: { Env: [canary] },
              State: {
                Running: mode === "running",
                Status: mode === "running" ? "running" : "exited",
                StartedAt:
                  mode === "changed" && n % 2 === 0 ? "changed" : "unchanged",
              },
              Mounts: [
                { Destination: "/data", Source: data, Type: "bind", RW: true },
              ],
            },
          ]),
        };
      };
      const report = await capturePreservation(options, run);
      expect(report.container_id).toBe("a".repeat(64));
      expect(report.tree.total_bytes).toBeGreaterThan(8192);
      expect(report.backup_created).toBe(false);
      expect(report.atomic_snapshot).toBe(false);
      expect(report.production_verified).toBe(false);
      expect(JSON.stringify(report)).not.toContain(canary);
      expect(JSON.stringify(report)).not.toContain(data);
      mode = "running";
      await expect(capturePreservation(options, run)).rejects.toThrow(
        "PRESERVATION_STOPPED_BINDING_REQUIRED",
      );
      mode = "changed";
      inspections = 0;
      await expect(capturePreservation(options, run)).rejects.toThrow(
        "PRESERVATION_BINDING_CHANGED",
      );
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  });
  it("CLI has no backup/restore/remote capability and errors never echo arguments", () => {
    const call = (args: string[]) =>
      spawnSync(resolve("scripts/preservation.sh"), args, {
        encoding: "utf8",
        timeout: 5000,
      });
    expect(call([]).stdout).toContain("No default collection");
    for (const args of [
      ["--restore", canary],
      ["--host", canary],
      ["--local", "--container", canary],
    ]) {
      const result = call(args);
      expect(result.status).toBe(2);
      expect(result.stdout + result.stderr).not.toContain(canary);
    }
  });
});
