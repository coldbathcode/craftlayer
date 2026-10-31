import { healthSchema } from "@craftlayer/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { identityRequest } from "./index.js";

afterEach(() => vi.unstubAllGlobals());
it("confines credentialed requests to API paths and rejects redirected/private responses", async () => {
  const mock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ status: "ok", service: "api", version: "0.0.0" }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", mock);
  for (const path of [
    "https://evil.invalid/",
    "/api/v1/../../outside",
    "//evil.invalid/api/v1/auth/me",
  ])
    await expect(identityRequest(path, healthSchema)).rejects.toThrow();
  expect(mock).not.toHaveBeenCalled();
  await identityRequest("/api/v1/system/status", healthSchema);
  expect(mock).toHaveBeenCalledWith(
    "/api/v1/system/status",
    expect.objectContaining({
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    }),
  );
  await identityRequest("/api/v1/auth/sessions/fixture", healthSchema, {
    method: "DELETE",
    csrf: "fixture-csrf",
  });
  expect(mock).toHaveBeenLastCalledWith(
    "/api/v1/auth/sessions/fixture",
    expect.objectContaining({
      method: "DELETE",
      headers: { "x-csrf-token": "fixture-csrf" },
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            service: "api",
            version: "0.0.0",
            password_hash: "secret-canary",
          }),
          { status: 200 },
        ),
    ),
  );
  await expect(
    identityRequest("/api/v1/system/status", healthSchema),
  ).rejects.toMatchObject({ status: 502, code: "INVALID_RESPONSE" });
});
