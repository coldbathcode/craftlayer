import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentTokenPermissionSchema } from "../../packages/contracts/src/index.js";
import {
  agentTokenPermissions,
  childPermissions,
  organizationPermissions,
} from "../../packages/core/src/index.js";

describe("agent token permission allowlist", () => {
  it("is identical in contracts, core and the SQL CHECK", () => {
    expect([...agentTokenPermissionSchema.options].sort()).toEqual(
      [...agentTokenPermissions].sort(),
    );
    const migrations = new URL(
      "../../packages/db/migrations/",
      import.meta.url,
    );
    const latest = readdirSync(migrations)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(new URL(f, migrations), "utf8"))
      .filter((sql) => /permissions <@ ARRAY\[/.test(sql))
      .at(-1);
    const literal = /permissions <@ ARRAY\[([^\]]+)\]::text\[\]/.exec(
      latest ?? "",
    )?.[1];
    expect(literal).toBeTruthy();
    const inSql = (literal ?? "")
      .split(",")
      .map((x) => x.trim().replace(/^'|'$/g, ""));
    expect(inSql.sort()).toEqual([...agentTokenPermissions].sort());
  });
  it("contains only read permissions that exist and nothing a child or admin needs", () => {
    for (const permission of agentTokenPermissions) {
      expect(organizationPermissions).toContain(permission);
      expect(permission.endsWith(":read")).toBe(true);
    }
    for (const forbidden of [
      "agent:connect",
      "membership:manage",
      "role:manage",
      "approval:decide",
      "server:adopt",
      "server:provision",
      "node:deploy",
      "node:enroll",
      "player:enroll",
      "provider:manage",
      "stop:clear",
      "environment:admin",
    ])
      expect(agentTokenPermissions).not.toContain(forbidden);
    expect(childPermissions).not.toContain("agent:connect");
  });
});
