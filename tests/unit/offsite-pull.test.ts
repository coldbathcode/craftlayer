import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { encryptArchive } from "../../apps/minecraft-node/src/offsite.js";
// @ts-expect-error plain script without types
import { pullBackups, sshSource } from "../../scripts/offsite/pull-backups.mjs";

// These cases use the real `age` program on both sides; without it they are skipped.
const hasAge = spawnSync("age", ["--version"]).status === 0;
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
it.skipIf(!hasAge)(
  "keeps only copies that decrypt to exactly what their manifest records",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "craftlayer-offsite-")),
      remote = join(root, "remote"),
      local = join(root, "local"),
      key = join(root, "key.txt");
    try {
      mkdirSync(remote);
      expect(spawnSync("age-keygen", ["-o", key]).status).toBe(0);
      const recipient = /public key: (age1[0-9a-z]+)/.exec(
        readFileSync(key, "utf8"),
      )?.[1];
      if (!recipient) throw new Error("No recipient");
      const make = async (n: number, day: string, tamper?: string) => {
        const archive = join(remote, `${id(n)}.tar.gz`),
          body = Buffer.from(`world ${n} `.repeat(5000));
        writeFileSync(archive, body);
        expect(await encryptArchive(archive, recipient)).toBe(true);
        writeFileSync(
          join(remote, `${id(n)}.manifest.json`),
          JSON.stringify({
            kind: "craftlayer_backup_manifest",
            occurrence_id: tamper === "id" ? id(9) : id(n),
            server_id: id(0),
            created_at: `2026-11-${day}T04:00:00.000Z`,
            archive_sha256:
              tamper === "hash"
                ? "0".repeat(64)
                : createHash("sha256").update(body).digest("hex"),
            archive_bytes: body.length,
          }),
        );
      };
      await make(1, "10");
      await make(2, "11");
      await make(3, "12", "hash");
      await make(4, "13", "id");
      // Encrypted to someone else's key: this machine cannot read it.
      const other = join(root, "other.txt");
      spawnSync("age-keygen", ["-o", other]);
      const stranger = /public key: (age1[0-9a-z]+)/.exec(
        readFileSync(other, "utf8"),
      )?.[1];
      await make(5, "14");
      rmSync(join(remote, `${id(5)}.tar.gz.age`));
      expect(
        await encryptArchive(join(remote, `${id(5)}.tar.gz`), String(stranger)),
      ).toBe(true);
      writeFileSync(join(remote, "notes.txt"), "not a backup");
      const source = {
        list: async () => readdirSync(remote),
        fetch: async (name: string, to: string) => {
          copyFileSync(join(remote, name), to);
          return true;
        },
      };
      const lines: string[] = [];
      const run = (keep = 30) =>
        pullBackups({
          source,
          localDirectory: local,
          identityFile: key,
          keep,
          log: (l: string) => lines.push(l),
        });
      expect(await run()).toMatchObject({ fetched: 2, failed: 3, held: 2 });
      const kept = readdirSync(local).sort();
      expect(kept).toEqual(
        [
          "status.json",
          ...[1, 2].flatMap((n) => [
            `${id(n)}.manifest.json`,
            `${id(n)}.tar.gz.age`,
            `${id(n)}.verified.json`,
          ]),
        ].sort(),
      );
      // Nothing was ever decrypted to disk, and no plain archive was copied.
      expect(kept.some((n) => n.endsWith(".tar.gz"))).toBe(false);
      expect(
        lines.filter((l) => l.startsWith("offsite_copy_failed")),
      ).toHaveLength(3);
      // A second pass fetches nothing new; the bad ones are tried and refused again.
      expect(await run()).toMatchObject({ fetched: 0, failed: 3 });
      // Keeping fewer removes the oldest proven copy only.
      expect(await run(2)).toMatchObject({ removed: 0 });
      await make(6, "15");
      expect(await run(2)).toMatchObject({ fetched: 1, removed: 1, held: 2 });
      expect(existsSync(join(local, `${id(1)}.tar.gz.age`))).toBe(false);
      expect(existsSync(join(local, `${id(6)}.tar.gz.age`))).toBe(true);
      expect(
        JSON.parse(readFileSync(join(local, "status.json"), "utf8")),
      ).toMatchObject({
        held: 2,
        newest_backup_at: "2026-11-15T04:00:00.000Z",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);
it("refuses a host or folder that could carry anything but a plain name", () => {
  expect(() => sshSource("host; rm -rf /", "/backups")).toThrow();
  expect(() => sshSource("host", "/backups; id")).toThrow();
  expect(() => sshSource("host", "relative")).toThrow();
  expect(() =>
    sshSource("craftlayer-host", "/home/x/backups/a-b"),
  ).not.toThrow();
});
it("leaves no partial file and reports failure when the encryption program is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "craftlayer-offsite-"));
  try {
    const archive = join(root, "a.tar.gz");
    writeFileSync(archive, "x");
    expect(
      await encryptArchive(
        archive,
        `age1${"q".repeat(58)}`,
        "/nonexistent/age",
      ),
    ).toBe(false);
    expect(readdirSync(root)).toEqual(["a.tar.gz"]);
    await expect(encryptArchive(archive, "not-a-key")).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
