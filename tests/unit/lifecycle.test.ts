import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";

for (const service of ["api", "worker"])
  describe(`${service} process lifecycle`, () => {
    it("stays live while dependencies are unavailable and exits cleanly on SIGTERM", async () => {
      const reservation = createServer();
      reservation.listen(0, "127.0.0.1");
      await once(reservation, "listening");
      const address = reservation.address();
      if (!address || typeof address === "string")
        throw new Error("No test port");
      const port = address.port;
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
      const child = spawn(process.execPath, [`apps/${service}/dist/main.js`], {
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          ...(service === "api"
            ? {
                AUTH_DATABASE_URL:
                  "postgres://craftlayer_identity:credential-canary@127.0.0.1:1/craftlayer",
                CRAFTLAYER_BOOTSTRAP_TOKEN: "a".repeat(64),
                CRAFTLAYER_RECOVERY_TOKEN: "b".repeat(64),
                CRAFTLAYER_CSRF_SECRET: "c".repeat(64),
                DATABASE_URL:
                  "postgres://craftlayer_runtime:credential-canary@127.0.0.1:1/craftlayer",
              }
            : {}),
          REDIS_URL: "redis://127.0.0.1:1",
          CRAFTLAYER_API_PORT: String(port),
          CRAFTLAYER_WORKER_PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      try {
        let live = false;
        for (let i = 0; i < 100; i++) {
          try {
            live = (await fetch(`http://127.0.0.1:${port}/health/live`)).ok;
          } catch {}
          if (live) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(live).toBe(true);
        expect(
          (await fetch(`http://127.0.0.1:${port}/health/ready`)).status,
        ).toBe(503);
        const exit = once(child, "exit");
        child.kill("SIGTERM");
        expect((await exit)[0]).toBe(0);
        expect(output).not.toContain("credential-canary");
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    });
  });
