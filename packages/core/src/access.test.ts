import { describe, expect, it } from "vitest";
import {
  type AccessScope,
  type Authority,
  canAccess,
  narrowAgentAuthority,
} from "./access.js";
import {
  agentTokenPermissions,
  organizationPermissions,
  rolePermissions,
} from "./permissions.js";

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
          "agent:connect",
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
describe("agent token authority", () => {
  const token = {
    permissions: ["server:read", "player:read", "organization:read"],
    projectId: "project",
    environmentId: "world",
  };
  const org: AccessScope = { kind: "organization", id: "org" };
  const otherWorld: AccessScope = {
    kind: "environment",
    id: "other",
    projectId: "project",
    environmentType: "minecraft",
  };
  it("narrows an administrator to the token scope and never to admin", () => {
    const a = narrowAgentAuthority(principal("org_admin"), token);
    expect(a.orgAdmin).toBe(false);
    expect(a.roles).toEqual([]);
    expect(a.permissions).toEqual(token.permissions);
    expect(canAccess(a, "server:read", world)).toBe(true);
    expect(canAccess(a, "organization:read", org)).toBe(true);
    expect(canAccess(a, "server:read", otherWorld)).toBe(false);
    expect(canAccess(a, "server:read", project)).toBe(false);
    expect(canAccess(a, "membership:manage", org)).toBe(false);
    expect(canAccess(a, "server:adopt", world)).toBe(false);
  });
  it("drops permissions the creator does not currently hold", () => {
    const a = narrowAgentAuthority(principal("viewer"), {
      ...token,
      permissions: ["server:read", "server:adopt", "membership:manage"],
    });
    expect(a.permissions).toEqual(["server:read"]);
    expect(canAccess(a, "server:read", world)).toBe(true);
  });
  it("drops permissions the creator lacks in the token scope", () => {
    const creator: Authority = {
      ...principal("viewer"),
      grants: [
        {
          permission: "server:read",
          projectId: "project",
          environmentId: "other",
        },
      ],
    };
    const a = narrowAgentAuthority(creator, token);
    expect(a.grants).toEqual([]);
    expect(canAccess(a, "server:read", world)).toBe(false);
  });
  it("refuses everything outside the allowlist even if the creator holds it", () => {
    const a = narrowAgentAuthority(principal("org_admin"), {
      ...token,
      permissions: [...organizationPermissions],
    });
    expect([...a.permissions].sort()).toEqual(
      [...agentTokenPermissions].sort(),
    );
  });
  it("never lists a permission the creator lacks, even an organization read", () => {
    const custom: Authority = {
      accountType: "adult",
      permissions: ["project:read"],
      roles: [],
      orgAdmin: false,
      grants: [
        {
          permission: "project:read",
          projectId: "project",
          environmentId: null,
        },
      ],
    };
    const a = narrowAgentAuthority(custom, {
      ...token,
      permissions: ["organization:read", "project:read"],
    });
    expect(a.permissions).toEqual(["project:read"]);
    expect(canAccess(a, "organization:read", org)).toBe(false);
    expect(canAccess(a, "project:read", world)).toBe(true);
  });
  it("gives a child creator nothing", () => {
    const a = narrowAgentAuthority(principal("child"), {
      ...token,
      permissions: ["project:read"],
    });
    expect(a.permissions).toEqual([]);
    expect(a.accountType).toBe("adult");
  });
  it("covers a whole project when the token has no environment", () => {
    const a = narrowAgentAuthority(principal("org_admin"), {
      ...token,
      environmentId: null,
    });
    expect(canAccess(a, "server:read", world)).toBe(true);
    expect(canAccess(a, "server:read", otherWorld)).toBe(true);
    expect(canAccess(a, "server:read", project)).toBe(true);
  });
});
