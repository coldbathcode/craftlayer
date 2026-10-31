import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("health and public API shell", () => {
  it("separates liveness from readiness without leaking dependency errors", async () => {
    const app = await buildApp({
      readiness: async () => {
        throw new Error("postgres://secret-canary");
      },
    });
    try {
      expect((await app.inject("/health/live")).statusCode).toBe(200);
      const response = await app.inject("/health/ready");
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("canary");
      expect(response.json().status).toBe("not_ready");
      const missing = await app.inject("/api/v1/organizations");
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.request_id).toBeTruthy();
    } finally {
      await app.close();
    }
  });
  it("reports ready and generates OpenAPI from the validated response schema", async () => {
    const app = await buildApp({ readiness: async () => true });
    try {
      expect((await app.inject("/health/ready")).statusCode).toBe(200);
      const spec = (await app.inject("/api/v1/openapi.json")).json();
      expect(spec.paths["/health/live"].get.responses["200"]).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});
