import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  cacheDir: `${tmpdir()}/craftlayer-vitest`,
  resolve: {
    alias: Object.fromEntries(
      ["core", "contracts", "config", "db", "auth"].map((name) => [
        `@craftlayer/${name}`,
        fileURLToPath(
          new URL(`./packages/${name}/src/index.ts`, import.meta.url),
        ),
      ]),
    ),
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tests/unit/**/*.test.ts",
    ],
    exclude: [
      "**/*.integration.test.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
    ],
    testTimeout: 10000,
  },
});
