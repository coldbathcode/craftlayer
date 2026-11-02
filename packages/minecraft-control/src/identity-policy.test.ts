import { identityEnrollmentRequest } from "@craftlayer/contracts";
import { expect, it } from "vitest";
import {
  floodgateUuid,
  identityContinuity,
  normalizeAuthenticatedIdentity,
} from "./identity-policy.js";

const java = {
  edition: "java",
  issuer: "java_online_session",
  profile_uuid: "a1234567-1234-4123-8123-123456789abc",
  name: "TestPlayer",
} as const;
const bedrock = {
  edition: "bedrock",
  issuer: "floodgate_authenticated_session",
  xuid: "2533274790395904",
  game_uuid: floodgateUuid("2533274790395904"),
  gamertag: "Test Player",
  link_state: "unlinked",
  linked_java_uuid: null,
} as const;
it("keeps uint64 XUID precision and rejects invalid subjects", () => {
  expect(floodgateUuid("18446744073709551615")).toBe(
    "00000000-0000-0000-ffff-ffffffffffff",
  );
  for (const value of [
    "0",
    "-1",
    "01",
    "18446744073709551616",
    "2.5",
    "1e19",
    "",
    "0xFF",
  ])
    expect(() => floodgateUuid(value)).toThrow();
  expect(normalizeAuthenticatedIdentity(bedrock).subject).toBe(
    `bedrock:${bedrock.xuid}`,
  );
  expect(() =>
    normalizeAuthenticatedIdentity({
      ...bedrock,
      game_uuid: java.profile_uuid,
    }),
  ).toThrow("IDENTITY_MAPPING_MISMATCH");
});
it("uses issuer/edition provenance and never grants equality from names or linked UUIDs", () => {
  const renamed = { ...java, name: "RenamedPlayer" };
  expect(identityContinuity(java, renamed)).toBe("same_subject");
  expect(
    identityContinuity(java, {
      ...java,
      profile_uuid: "b1234567-1234-4123-8123-123456789abc",
    }),
  ).toBe("different_subject");
  const linked = {
    ...bedrock,
    link_state: "linked",
    linked_java_uuid: java.profile_uuid,
    game_uuid: java.profile_uuid,
  } as const;
  expect(identityContinuity(bedrock, linked)).toBe(
    "link_changed_review_required",
  );
  expect(identityContinuity(linked, bedrock)).toBe(
    "link_changed_review_required",
  );
  expect(identityContinuity(java, linked)).toBe("different_subject");
  expect(() =>
    normalizeAuthenticatedIdentity({ ...java, issuer: "display_name_lookup" }),
  ).toThrow();
  expect(() =>
    normalizeAuthenticatedIdentity({
      ...java,
      profile_uuid: floodgateUuid(bedrock.xuid),
    }),
  ).toThrow();
});
it("browser enrollment cannot assert UUID/XUID, provenance, verification or access", () => {
  const input = { edition: "java", requested_name: "TestPlayer" };
  expect(identityEnrollmentRequest.safeParse(input).success).toBe(true);
  for (const field of [
    "uuid",
    "xuid",
    "issuer",
    "identity_verified",
    "web_user_id",
    "allowlist",
    "command",
    "profile_hash",
  ])
    expect(
      identityEnrollmentRequest.safeParse({ ...input, [field]: "untrusted" })
        .success,
    ).toBe(false);
});
