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

it("keeps the restricted identity URL server-side and rejects privileged identity roles", () => {
  const env = {
    ...valid,
    AUTH_DATABASE_URL: "postgres://craftlayer_identity:canary@localhost/test",
  };
  expect(parseServerConfig(env).AUTH_DATABASE_URL).toBe(env.AUTH_DATABASE_URL);
  expect(() =>
    parseServerConfig({
      ...env,
      AUTH_DATABASE_URL: "postgres://admin:canary@localhost/test",
    }),
  ).toThrow();
});

it("requires TLS for shared origins and SMTP and rejects URL option overrides", () => {
  expect(() =>
    parseServerConfig({
      ...valid,
      CRAFTLAYER_PUBLIC_URL: "http://192.168.1.20:3000",
    }),
  ).toThrow();
  expect(
    parseServerConfig({
      ...valid,
      CRAFTLAYER_PUBLIC_URL: "https://craftlayer.example",
    }).CRAFTLAYER_PUBLIC_URL,
  ).toBe("https://craftlayer.example");
  for (const value of [
    "smtp://mail.example",
    "smtps://mail.example/?tls.rejectUnauthorized=false",
  ])
    expect(() =>
      parseServerConfig({ ...valid, CRAFTLAYER_SMTP_URL: value }),
    ).toThrow();
  expect(
    parseServerConfig({
      ...valid,
      CRAFTLAYER_SMTP_URL: "smtps://mail.example/",
      CRAFTLAYER_SMTP_FROM: "craftlayer@example.invalid",
    }).CRAFTLAYER_SMTP_URL,
  ).toBe("smtps://mail.example/");
});

it("worker configuration rejects database, identity and provider authority", async () => {
  const { parseWorkerConfig } = await import("./index.js");
  const base = { REDIS_URL: "redis://127.0.0.1:6379" };
  expect(parseWorkerConfig(base).CRAFTLAYER_WORKER_PORT).toBe(4001);
  for (const key of [
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
    "CRAFTLAYER_PROVIDER_KEY_FILE",
    "CRAFTLAYER_CSRF_SECRET",
  ])
    expect(() =>
      parseWorkerConfig({ ...base, [key]: "fixture-must-be-rejected" }),
    ).toThrow("separation");
});
