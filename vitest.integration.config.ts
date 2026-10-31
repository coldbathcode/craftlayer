import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";
export default defineConfig({
  ...base,
  test: {
    include: [
      "packages/*/src/**/*.integration.test.ts",
      "tests/integration/**/*.integration.test.ts",
    ],
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
    testTimeout: 10000,
  },
});
