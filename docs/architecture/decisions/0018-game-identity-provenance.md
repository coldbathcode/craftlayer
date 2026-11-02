# ADR 0018 — Game identity provenance and gated enrollment

Status: adopted for F2 local implementation, 2026-11-02. F2 authorized by the user’s “continue” after the F1 review. No Contabo or live write authorization.

## Context

A display name, public profile lookup, Java status player sample or client-supplied UUID/XUID is not authentication evidence. Floodgate distinguishes an unlinked synthetic UUID from the effective Java UUID used after account linking. Linking changes which player data is used and cannot silently merge CraftLayer identities, grants or worlds. Real client evidence is still required by CL-F2-01/MC-03.

## Decision

Keep edition and issuer with every authenticated game subject. Java subject is the canonical online profile UUID; Bedrock subject is the exact unsigned 64-bit decimal XUID, stored as text rather than a JavaScript number. Validate the unlinked Floodgate mapping using integer arithmetic; linked evidence requires the effective Java UUID. A Java subject and Bedrock subject remain different even if their current game UUIDs match. Rename preserves a subject; link/unlink/mapping changes require adult review and renewed policy verification. Never migrate player data or auto-merge permissions in response.

Normalization is a pure structural/mapping check, **not a verifier or ownership proof**. It accepts only the future trusted bridge’s typed authenticated-session evidence; there is no HTTP route accepting that evidence. Browser enrollment requests contain only edition/display name. Durable requests must remain pending with `identity_verified:false`/`access_granted:false` until a pinned, authenticated bridge and real compatibility tests are qualified. Web requester identity is derived from current membership, not asserted as ownership of the game account. Actual explicit adult-to-player binding is a later step within CL-F2-01, not inferred from name resolution.

Pin candidate server/plugin artifacts, source commits, game/client versions and Java image digest in a reviewed lock file. Candidate metadata cannot assert qualification. The preparer downloads exact official URLs with SHA-256/size/timeout checks into a fresh private temporary directory, retaining `.part` names. It neither accepts EULA nor executes Java/Docker, opens ports or touches existing files/worlds. Empty OPs/allowlist, online authentication and enforced allowlist are preserved. Artifact integrity is distinct from runtime/client compatibility. Geyser/Floodgate descriptors identify snapshot builds; pinning does not establish release/security suitability.

Do not implement an unsafe name-based RCON onboarding shortcut, whitelist-off join window, third-party identity lookup dependency or global-linking Cloud dependency. Existing live linking settings must be inspected and reviewed, never overwritten with candidate defaults. A separate isolated bridge may be necessary; its authenticated transport, exact target/profile binding and effective identity/event timing must be qualified before promotion or access writes.

## Evidence and consequences

Checkpoint A: official metadata/pinned-source research, pure identity boundary tests and protected non-runnable artifact preparation. No runtime/plugin/real-client qualification. Checkpoint B introduces scoped durable pending resolution requests using existing operations/audit/outbox; it grants no player access. Remaining authenticated bridge, explicit adult binding, unknown/approved Java/Bedrock admission, rename/spoof/link-change proof and rollback are required before CL-F2-01 is complete. CL-F2-02 depends on that gate; no fakes-only closure.

Primary references: [Floodgate API](https://geysermc.org/wiki/floodgate/api/), [linking behavior](https://geysermc.org/wiki/floodgate/linking/), [pinned Floodgate player API](https://github.com/GeyserMC/Floodgate/blob/81b65ccb766bf8024858ebf3eefa6974056aecc5/api/src/main/java/org/geysermc/floodgate/api/player/FloodgatePlayer.java), [Paper download service](https://docs.papermc.io/misc/downloads-service/), [Paper Java requirements](https://docs.papermc.io/paper/getting-started/). Candidate lock contains exact metadata and protocol source URLs. No production compatibility is inferred from those references.
