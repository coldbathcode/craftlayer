import { expect, it } from "vitest";
import { healthSchema } from "./index.js";

it("rejects accidental secret fields in health payloads", () => {
  expect(
    healthSchema.safeParse({
      status: "ok",
      service: "api",
      version: "0.0.0",
      database_url: "secret",
    }).success,
  ).toBe(false);
});
