import { z } from "zod";
export const organizationIdSchema = z.uuid().brand<"OrganizationId">();
export const projectIdSchema = z.uuid().brand<"ProjectId">();
export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export interface OrganizationContext {
  readonly organizationId: OrganizationId;
}
/** Internal capability: only trusted authorization/maintenance services may create context.
 * Parsing an ID is not membership validation. Never derive this directly from request bodies.
 */
export function organizationContext(
  validatedOrganizationId: string,
): OrganizationContext {
  return Object.freeze({
    organizationId: organizationIdSchema.parse(validatedOrganizationId),
  });
}

export * from "./permissions.js";
