import {
  type AuthenticatedGameIdentity,
  authenticatedGameIdentity,
  xboxXuid,
} from "@craftlayer/contracts";

/** Mapping only. An XUID supplied by a browser/name lookup is never authenticated. */
export function floodgateUuid(xuid: string) {
  const value = BigInt(xboxXuid.parse(xuid)).toString(16).padStart(16, "0");
  return `00000000-0000-0000-${value.slice(0, 4)}-${value.slice(4)}`;
}
/** Call only for data obtained from a separately authenticated, pinned game bridge.
 * Structural validation is not a proof of authentication or account ownership.
 */
export function normalizeAuthenticatedIdentity(input: unknown) {
  const v = authenticatedGameIdentity.parse(input);
  if (v.edition === "java")
    return {
      subject: `java:${v.profile_uuid}`,
      game_uuid: v.profile_uuid,
      edition: v.edition,
      display_name: v.name,
      issuer: v.issuer,
      link_state: "not_applicable" as const,
    };
  const expected =
    v.link_state === "linked" ? v.linked_java_uuid : floodgateUuid(v.xuid);
  if (v.game_uuid !== expected) throw new Error("IDENTITY_MAPPING_MISMATCH");
  return {
    subject: `bedrock:${v.xuid}`,
    game_uuid: expected,
    edition: v.edition,
    display_name: v.gamertag,
    issuer: v.issuer,
    link_state: v.link_state,
  };
}
/** Never merge Java and Bedrock subjects, even when linking makes game UUIDs equal. */
export function identityContinuity(
  previous: AuthenticatedGameIdentity,
  current: AuthenticatedGameIdentity,
) {
  const a = normalizeAuthenticatedIdentity(previous),
    b = normalizeAuthenticatedIdentity(current);
  if (a.subject !== b.subject) return "different_subject" as const;
  if (a.game_uuid !== b.game_uuid || a.link_state !== b.link_state)
    return "link_changed_review_required" as const;
  return "same_subject" as const;
}
