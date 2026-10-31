import { expect, it } from "vitest";
import { publicUserSchema, sessionSchema } from "./identity.js";

it("rejects private identity/session fields in public contracts", () => {
  const user = {
    id: "018f0000-0000-4000-8000-000000000001",
    login: "viewer",
    account_type: "adult",
    email: null,
  };
  expect(
    publicUserSchema.safeParse({ ...user, password_hash: "credential-canary" })
      .success,
  ).toBe(false);
  expect(
    sessionSchema.safeParse({
      user,
      csrf_token: "a".repeat(43),
      cookieToken: "credential-canary",
    }).success,
  ).toBe(false);
});
