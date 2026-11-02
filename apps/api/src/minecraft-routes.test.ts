import type { IdentityService } from "@craftlayer/auth";
import { expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { MinecraftApi } from "./minecraft-routes.js";

it("blocks remotely configured management paths before invoking a domain handler", async () => {
  let calls = 0;
  const app = await buildApp({
    auth: { verifyCsrf: () => true } as unknown as IdentityService,
    minecraft: {
      list: async () => {
        calls++;
        return { items: [], next_cursor: null };
      },
    } as unknown as MinecraftApi,
    publicUrl: "https://management.example.invalid",
    readiness: async () => true,
  });
  try {
    for (const url of [
      "/api/v1/servers?environment_id=00000000-0000-4000-8000-000000000001",
      "/api/v1/servers/00000000-0000-4000-8000-000000000001/status",
      "/api/v1/operations/00000000-0000-4000-8000-000000000001",
      "/api/v1/servers/00000000-0000-4000-8000-000000000001/identity-enrollments",
    ]) {
      const result = await app.inject({ method: "GET", url });
      expect(result.statusCode).toBe(503);
      expect(result.json().error.code).toBe("MANAGEMENT_REMOTE_UNQUALIFIED");
    }
    expect(calls).toBe(0);
  } finally {
    await app.close();
  }
});
