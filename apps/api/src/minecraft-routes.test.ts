import type { IdentityService } from "@craftlayer/auth";
import { expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { MinecraftApi } from "./minecraft-routes.js";
import type { NodeApi } from "./node-routes.js";

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

it("opens host management to a remote deployment only when private entry and MFA are attested", async () => {
  const org = "00000000-0000-4000-8000-000000000002",
    url = "/api/v1/nodes?project_id=00000000-0000-4000-8000-000000000001";
  for (const remoteManagement of [false, true]) {
    let calls = 0;
    const app = await buildApp({
      auth: { verifyCsrf: () => true } as unknown as IdentityService,
      nodes: {
        list: async () => {
          calls++;
          return { items: [] };
        },
      } as unknown as NodeApi,
      publicUrl: "https://management.example.invalid",
      remoteManagement,
      readiness: async () => true,
    });
    try {
      const result = await app.inject({
        method: "GET",
        url,
        headers: {
          cookie: "craftlayer_session=synthetic",
          "x-craftlayer-organization": org,
        },
      });
      if (remoteManagement) {
        expect(result.json().error?.code).not.toBe(
          "MANAGEMENT_REMOTE_UNQUALIFIED",
        );
        expect(calls).toBe(1);
      } else {
        expect(result.statusCode).toBe(503);
        expect(result.json().error.code).toBe("MANAGEMENT_REMOTE_UNQUALIFIED");
        expect(calls).toBe(0);
      }
    } finally {
      await app.close();
    }
  }
});
