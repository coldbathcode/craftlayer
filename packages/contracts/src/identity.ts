import { z } from "zod";

const id = z.uuid(),
  date = z.iso.datetime();
export const publicUserSchema = z.strictObject({
  id,
  login: z.string(),
  account_type: z.enum(["adult", "child"]),
  email: z.email().nullable(),
});
export const organizationSchema = z.strictObject({ id, name: z.string() });
export const sessionSchema = z.strictObject({
  user: publicUserSchema,
  csrf_token: z.string().length(43),
});
export const meSchema = z.strictObject({
  user: publicUserSchema,
  organizations: z.array(organizationSchema),
  instance_owner: z.boolean(),
  current_session_id: id,
  csrf_token: z.string().length(43),
});
export const authoritySchema = z.strictObject({
  account_type: z.enum(["adult", "child"]),
  membership_version: z.number().int(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  can_manage_members: z.boolean(),
  can_manage_roles: z.boolean(),
  can_create_projects: z.boolean(),
  can_manage_environments: z.boolean(),
  can_invite: z.boolean(),
  can_read_audit: z.boolean(),
});
export const projectSchema = organizationSchema;
export const environmentSchema = z.strictObject({
  id,
  name: z.string(),
  project_id: id,
  type: z.enum(["minecraft", "coding", "research"]),
});
export const memberSchema = z.strictObject({
  id,
  user_id: id,
  login: z.string(),
  account_type: z.enum(["adult", "child"]),
  disabled_at: date.nullable(),
  user_disabled_at: date.nullable(),
  roles: z.array(z.string()),
});
export const roleSchema = z.strictObject({
  id,
  name: z.string(),
  built_in: z.boolean(),
  permissions: z.array(z.string()),
});
export const sessionItemSchema = z.strictObject({
  id,
  created_at: date,
  expires_at: date,
});
export const auditSchema = z.strictObject({
  id: z.string(),
  actor_id: id.nullable(),
  action: z.string(),
  target_id: z.string().nullable(),
  outcome: z.enum(["allowed", "denied"]),
  created_at: date,
  details: z.record(
    z.string(),
    z.union([z.string(), z.boolean(), z.array(z.string())]),
  ),
});
export const inviteSchema = z.strictObject({
  id,
  token: z.string(),
  expires_at: date,
});
export const grantSchema = z.strictObject({
  id,
  membership_id: id,
  permission: z.string(),
  project_id: id,
  environment_id: id.nullable(),
});
export const childCreatedSchema = z.strictObject({
  id,
  login: z.string(),
  membership_id: id,
  account_type: z.literal("child"),
});
export const okSchema = z.strictObject({ ok: z.literal(true) });
export const setupSchema = z.strictObject({ required: z.boolean() });
export const resetAcceptedSchema = z.strictObject({
  accepted: z.boolean(),
  message: z.string(),
});
export const itemsSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item) });
export const invitationItemSchema = z.strictObject({
  id,
  role_id: id,
  expires_at: date,
  consumed_at: date.nullable(),
  revoked_at: date.nullable(),
});
export const identityResponseContracts = {
  "POST /api/v1/auth/logout": okSchema,
  "DELETE /api/v1/auth/sessions/:id": okSchema,
  "POST /api/v1/organizations": organizationSchema,
  "POST /api/v1/projects": projectSchema,
  "POST /api/v1/environments": environmentSchema,
  "POST /api/v1/roles": roleSchema.omit({ built_in: true }),
  "PUT /api/v1/memberships/:id/roles": okSchema,
  "POST /api/v1/memberships/:id/status": okSchema,
  "POST /api/v1/users/:id/status": okSchema,
  "POST /api/v1/resource-grants": okSchema,
  "DELETE /api/v1/resource-grants/:id": okSchema,
  "GET /api/v1/invitations": itemsSchema(invitationItemSchema),
  "DELETE /api/v1/invitations/:id": okSchema,
  "POST /api/v1/auth/password-reset/consume": okSchema,
  "POST /api/v1/children": childCreatedSchema,
  "POST /api/v1/children/:id/password": okSchema,
  "GET /api/v1/auth/setup": setupSchema,
  "POST /api/v1/auth/login": sessionSchema,
  "POST /api/v1/auth/bootstrap": sessionSchema,
  "POST /api/v1/invitations/consume": sessionSchema,
  "GET /api/v1/auth/me": meSchema,
  "GET /api/v1/auth/authority": authoritySchema,
  "GET /api/v1/auth/sessions": itemsSchema(sessionItemSchema),
  "GET /api/v1/organizations": itemsSchema(organizationSchema),
  "GET /api/v1/projects": itemsSchema(projectSchema),
  "GET /api/v1/projects/:id": projectSchema,
  "GET /api/v1/environments": itemsSchema(environmentSchema),
  "GET /api/v1/environments/:id": environmentSchema,
  "GET /api/v1/memberships": itemsSchema(memberSchema),
  "GET /api/v1/users": itemsSchema(memberSchema),
  "GET /api/v1/roles": itemsSchema(roleSchema),
  "GET /api/v1/resource-grants": itemsSchema(grantSchema),
  "GET /api/v1/audit": itemsSchema(auditSchema),
  "POST /api/v1/invitations": inviteSchema,
  "POST /api/v1/auth/password-reset/request": resetAcceptedSchema,
} as const;
export type Me = z.infer<typeof meSchema>;
export type AuthorityView = z.infer<typeof authoritySchema>;
export type Project = z.infer<typeof projectSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type SessionItem = z.infer<typeof sessionItemSchema>;
export type ResourceGrant = z.infer<typeof grantSchema>;
