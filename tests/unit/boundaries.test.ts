import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("rejects web server imports, relative escapes and computed module loading", () => {
  const root = mkdtempSync(join(tmpdir(), "craftlayer-boundaries-"));
  try {
    mkdirSync(join(root, "apps/web/src"), { recursive: true });
    writeFileSync(
      join(root, "apps/web/package.json"),
      JSON.stringify({
        name: "@craftlayer/web",
        dependencies: { "@craftlayer/db": "workspace:*" },
      }),
    );
    for (const source of [
      'import "@craftlayer/db";',
      'import "../../../packages/db/src/index.js";',
      'const moduleName="pg"; import(moduleName);',
    ]) {
      writeFileSync(join(root, "apps/web/src/probe.ts"), source);
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/check-boundaries.mjs")],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
