import {
  agentTokenPermissions,
  builderDelegatedPermissions,
  childPermissions,
  organizationPermissions,
} from "./permissions.js";
export interface AccessScope {
  kind: "organization" | "project" | "environment";
  id: string;
  projectId?: string;
  environmentType?: string;
}
export interface ScopeGrant {
  permission: string;
  projectId: string;
  environmentId: string | null;
}
export interface Authority {
  accountType: "adult" | "child";
  permissions: readonly string[];
  roles: readonly string[];
  orgAdmin: boolean;
  grants: readonly ScopeGrant[];
}
const reads = new Set([
  "project:read",
  "environment:read",
  "agent:read",
  "mission:read",
  "event:read",
]);
const orgActions = new Set([
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
]);
/** Scope comes from canonical DB rows, never a caller-supplied owner/world claim. */
export function canAccess(
  authority: Authority,
  permission: string,
  scope: AccessScope,
): boolean {
  if (!(organizationPermissions as readonly string[]).includes(permission))
    return false;
  const child = authority.accountType === "child";
  if (child && !childPermissions.includes(permission)) return false;
  const base = authority.permissions.includes(permission);
  if (!child && authority.orgAdmin && base) return true;
  if (scope.kind === "organization") return base && orgActions.has(permission);
  if (
    child &&
    scope.kind === "environment" &&
    scope.environmentType !== "minecraft"
  )
    return false;
  if (child && scope.kind === "project" && permission !== "project:read")
    return false;
  const matching = authority.grants.filter((g) => {
    if (child && !g.environmentId) return false;
    if (scope.kind === "project")
      return (
        g.projectId === scope.id &&
        (reads.has(permission) || g.environmentId === null)
      );
    return (
      g.projectId === scope.projectId &&
      (g.environmentId === scope.id || (!child && g.environmentId === null))
    );
  });
  const explicit = matching.some((g) => g.permission === permission);
  const delegated =
    authority.roles.includes("builder") &&
    (builderDelegatedPermissions as readonly string[]).includes(permission) &&
    explicit;
  return (
    (base && (explicit || (reads.has(permission) && matching.length > 0))) ||
    (!child && delegated)
  );
}
export interface AgentTokenScope {
  permissions: readonly string[];
  projectId: string;
  environmentId: string | null;
}
/** Authority an external AI agent token confers right now: the token's allowlisted
 * permissions, intersected with what its creating adult can currently do in the
 * token's scope. Agents are never administrators, never children and never hold
 * roles, so every scoped decision must match an explicit synthesized grant. */
export function narrowAgentAuthority(
  creator: Authority,
  token: AgentTokenScope,
): Authority {
  const none: Authority = {
    accountType: "adult",
    permissions: [],
    roles: [],
    orgAdmin: false,
    grants: [],
  };
  if (creator.accountType !== "adult") return none;
  const scope: AccessScope = token.environmentId
    ? {
        kind: "environment",
        id: token.environmentId,
        projectId: token.projectId,
      }
    : { kind: "project", id: token.projectId };
  const permissions = [...new Set(token.permissions)].filter(
    (p) =>
      (agentTokenPermissions as readonly string[]).includes(p) &&
      creator.permissions.includes(p),
  );
  return {
    ...none,
    permissions,
    grants: permissions
      .filter((permission) => canAccess(creator, permission, scope))
      .map((permission) => ({
        permission,
        projectId: token.projectId,
        environmentId: token.environmentId,
      })),
  };
}
