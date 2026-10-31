import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, parseServerConfig } from "./index.js";

const valid = {
  DATABASE_URL: "postgres://craftlayer_runtime:canary@localhost/test",
  REDIS_URL: "redis://localhost:6379",
};
describe("server config", () => {
  it("fails closed on missing, unknown and privileged config without echoing values", () => {
    for (const env of [
      {},
      { ...valid, CRAFTLAYER_TYPO: "secret-canary" },
      { ...valid, DATABASE_URL: "postgres://admin:secret-canary@localhost/db" },
      { ...valid, CRAFTLAYER_API_PORT: "0" },
    ]) {
      try {
        parseServerConfig(env);
        expect.fail("should reject");
      } catch (error) {
        expect(String(error)).toContain("Invalid server configuration");
        expect(String(error)).not.toContain("secret-canary");
      }
    }
  });
  it("uses private defaults and ignores unrelated shell settings", () => {
    expect(
      parseServerConfig({ ...valid, PATH: "/bin" }).CRAFTLAYER_BIND_HOST,
    ).toBe("127.0.0.1");
  });
  it("redacts credential fields and authorization", () => {
    let output = "";
    const sink = new Writable({
      write(chunk, _encoding, next) {
        output += chunk.toString();
        next();
      },
    });
    createLogger("info", sink).info(
      {
        password: "canary",
        connection: { token: "canary" },
        req: { headers: { authorization: "canary" } },
        DATABASE_URL: "canary",
      },
      "safe",
    );
    expect(output).not.toContain("canary");
    expect(output).toContain("[REDACTED]");
  });
});
