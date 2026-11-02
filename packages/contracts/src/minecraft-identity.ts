import { z } from "zod";

export const identityHash = z.string().regex(/^[a-f0-9]{64}$/);
// Java online profile UUIDs are version 4. Floodgate's unlinked UUIDs are not.
export const javaProfileUuid = z
  .string()
  .regex(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
export const xboxXuid = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine((v) => BigInt(v) <= 18446744073709551615n, "XUID exceeds uint64");
const displayName = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[\p{L}\p{M}\p{N} _.#-]+$/u);
const bedrockBase = {
  edition: z.literal("bedrock"),
  issuer: z.literal("floodgate_authenticated_session"),
  xuid: xboxXuid,
  gamertag: displayName,
  game_uuid: z
    .string()
    .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
};
export const authenticatedGameIdentity = z.union([
  z.strictObject({
    edition: z.literal("java"),
    issuer: z.literal("java_online_session"),
    profile_uuid: javaProfileUuid,
    name: z.string().regex(/^[A-Za-z0-9_]{3,16}$/),
  }),
  z.strictObject({
    ...bedrockBase,
    link_state: z.literal("unlinked"),
    linked_java_uuid: z.null(),
  }),
  z.strictObject({
    ...bedrockBase,
    link_state: z.literal("linked"),
    linked_java_uuid: javaProfileUuid,
  }),
]);
// Requesting resolution never establishes provenance, ownership, or permission to join.
export const identityEnrollmentRequest = z.discriminatedUnion("edition", [
  z.strictObject({
    edition: z.literal("java"),
    requested_name: z.string().regex(/^[A-Za-z0-9_]{3,16}$/),
  }),
  z.strictObject({
    edition: z.literal("bedrock"),
    requested_name: displayName,
  }),
]);
export const pendingIdentityEnrollment = z.strictObject({
  id: z.uuid(),
  server_id: z.uuid(),
  edition: z.enum(["java", "bedrock"]),
  requested_name: displayName,
  state: z.literal("pending"),
  reason: z.literal("authenticated_bridge_unavailable"),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  expired: z.boolean(),
  identity_verified: z.literal(false),
  access_granted: z.literal(false),
});
export const identityEnrollmentAccepted = z.strictObject({
  operation_id: z.uuid(),
  enrollment_id: z.uuid(),
  server_id: z.uuid(),
});
export type AuthenticatedGameIdentity = z.infer<
  typeof authenticatedGameIdentity
>;
