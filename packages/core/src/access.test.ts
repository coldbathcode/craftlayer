import { describe, expect, it } from "vitest";
import { type AccessScope, type Authority, canAccess } from "./access.js";
import { organizationPermissions, rolePermissions } from "./permissions.js";

const project: AccessScope = { kind: "project", id: "project" };
const world: AccessScope = {
  kind: "environment",
  id: "world",
  projectId: "project",
  environmentType: "minecraft",
};
function principal(role: keyof typeof rolePermissions): Authority {
  return {
    accountType: role === "child" ? "child" : "adult",
    permissions: rolePermissions[role],
    roles: [role],
    orgAdmin: role === "org_admin",
    grants: organizationPermissions.map((permission) => ({
      permission,
      projectId: "project",
      environmentId: "world",
    })),
  };
}
describe("permission/account/scope matrix", () => {
  for (const role of Object.keys(
    rolePermissions,
  ) as (keyof typeof rolePermissions)[])
    for (const permission of organizationPermissions)
      it(`${role} / ${permission}`, () => {
        const p = principal(role);
        const scope = [
          "organization:read",
          "membership:manage",
          "role:manage",
          "user:invite",
          "project:create",
          "environment:admin",
          "provider:manage",
          "budget:manage",
          "preset:approve",
          "audit:read",
        ].includes(permission)
          ? { kind: "organization" as const, id: "org" }
          : world;
        const expected =
          p.permissions.includes(permission) ||
          (role === "builder" &&
            [
              "mission:create",
              "mission:execute",
              "mission:pause",
              "mission:cancel",
              "preset:launch",
              "stop:request",
            ].includes(permission));
        expect(canAccess(p, permission, scope)).toBe(expected);
        expect(canAccess({ ...p, grants: [] }, permission, world)).toBe(
          role === "org_admin",
        );
        expect(
          canAccess(p, permission, { ...world, id: "unassigned-world" }),
        ).toBe(role === "org_admin");
        expect(
          canAccess(p, permission, { ...world, projectId: "foreign-project" }),
        ).toBe(role === "org_admin");
        if (role === "child")
          for (const environmentType of ["coding", "research"])
            expect(
              canAccess(p, permission, { ...world, environmentType }),
            ).toBe(false);
      });
  it("denies unknown/instance permissions and unassigned scopes", () => {
    expect(canAccess(principal("org_admin"), "instance:manage", project)).toBe(
      false,
    );
    expect(
      canAccess(principal("viewer"), "project:read", {
        kind: "project",
        id: "foreign",
      }),
    ).toBe(false);
  });
  it("keeps child ceiling even with an extra admin role", () => {
    const p = principal("org_admin");
    p.accountType = "child";
    expect(canAccess(p, "provider:manage", world)).toBe(false);
    expect(
      canAccess(p, "preset:launch", { ...world, environmentType: "coding" }),
    ).toBe(false);
    p.grants = [
      {
        permission: "preset:launch",
        projectId: "project",
        environmentId: null,
      },
    ];
    expect(canAccess(p, "preset:launch", world)).toBe(false);
  });
  it("does not turn a world-only assignment into authority over the full project", () => {
    expect(canAccess(principal("operator"), "mission:execute", project)).toBe(
      false,
    );
  });
});
