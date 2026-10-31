import { describe, expect, it } from "vitest";
import { organizationContext } from "./index.js";

describe("organization context", () => {
  it("rejects absent/invalid organization IDs rather than selecting a global scope", () => {
    for (const value of ["", "all", "../another-tenant"])
      expect(() => organizationContext(value)).toThrow();
  });
  it("provides immutable explicit scope", () => {
    const context = organizationContext("018f0000-0000-4000-8000-000000000001");
    expect(Object.isFrozen(context)).toBe(true);
    expect(context.organizationId).toBe("018f0000-0000-4000-8000-000000000001");
  });
});
