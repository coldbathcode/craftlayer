# Minecraft identity development and qualification

Status: authorized F2 local work in progress, CL-F2-01 checkpoint A. No authenticated game bridge, verified enrollment, allowlist mutation or family readiness is delivered by this checkpoint. [ADR 0018](../architecture/decisions/0018-game-identity-provenance.md) defines the provenance boundary; [F2 chapter](../chapters/F2-family-access.md) keeps real MC-03 evidence mandatory.

## Pinned candidate, not an upgrade plan

`infra/minecraft/identity-candidate.lock.json` records Paper 26.3 build 237 (stable channel), Geyser 2.12.1 build 1281 and Floodgate 2.2.5 build 141, official artifact checksums/URLs, source commits, Java 25 image manifest digest and source-declared Bedrock versions. Geyser’s pinned dependency catalog targets Java protocol 26.3; its pinned protocol source lists Bedrock 26.40–26.45, 26.50–26.52 and 26.60 individually. These source declarations guide test selection; no real client has been tested. JAR descriptors report Geyser/Floodgate snapshot builds. They need compatibility/security review, not automatic approval.

This candidate is for new disposable fixtures only. It does not describe Contabo’s actual versions and must never trigger a live upgrade, player-data migration or global/local linking change. The Java image digest was researched, not pulled/executed by this checkpoint. No claim of signed upstream artifact authenticity or vulnerability clearance is made from a matching checksum.

## Prepare artifact evidence safely

```bash
pnpm minecraft:identity:prepare
pnpm minecraft:identity:verify /absolute/private/task-created-directory
```

Preparation uses internet only to fetch the three exact pinned official artifact URLs; routine tests inject synthetic bytes. It creates a new random mode-0700 temporary directory and owner-only files, never accepts an existing output/world directory, never deletes/replaces a source, and has no shell/Docker/Java/start command. Downloads are capped at 128 MiB each and 60 seconds, redirects rejected, SHA-256 verified; files retain `.part` suffixes and remain non-runnable. Interrupted/unverified partials remain in the task-created directory for operator review. Successful CLI output identifies that directory and operation/profile hashes; do not commit the binaries.

The fixture contains `eula=false`, empty `whitelist.json`/`ops.json`, online mode, enforced allowlist, RCON/query disabled and loopback server IP. Verify checks exact safety files, file ownership/modes/types, artifact hashes, root/plugins directory boundaries and matching profile marker. It refuses changed EULA/auth/allowlist, symlinks, corrupt artifacts or profile drift. It reports artifact integrity only, with identity compatibility false. It is no backup tool, runtime launcher or sandbox against a compromised host administrator.

Before booting a future disposable test instance, obtain the adult’s EULA acknowledgement and approved client availability, review the pinned Geyser/Floodgate configuration and private network/bridge setup, and keep all files in the disposable project. Do not rename/start these artifacts against an existing world. No launcher, EULA-accepting workflow or public port is supplied here.

## Identity semantics

`normalizeAuthenticatedIdentity` is a pure helper for the future authenticated bridge: it checks typed issuer/edition/UUID/XUID/link mapping only. Supplying a matching object does not authenticate a player. Java online profile UUIDs and unsigned Bedrock XUIDs remain separate subjects; names are private display metadata. Linked Bedrock evidence must preserve the XUID and effective Java UUID; a shared game UUID never grants another account’s access. Link/unlink changes return review-required rather than silently changing permissions or worlds. Public/name-only resolution remains pending, not authenticated provenance or ownership.

The browser enrollment schema accepts edition and requested display name only. It rejects caller UUID/XUID, verification, credentials, paths, commands or web-user assertions. F2 checkpoint B will persist those pending requests under current adult scope; it will not turn them into access. Explicit adult web-to-game assignment, target/issuer/profile-bound authenticated receipts and replay/revocation protection remain required.

## Required qualification record

Use approved licensed clients/accounts, never passwords/tokens in Git or chat. Record exact Java/Bedrock client builds, server/plugin/JRE hashes, trusted bridge build/config and test date. Collect sanitized evidence/hash summaries outside Git. Verify every item; leave unexecuted cases open:

| Case | Required result |
| --- | --- |
| Unknown authenticated Java and Bedrock | Join rejected with allowlist continuously enabled; pre-login authentication provenance captured without world admission |
| Approved identity | Exact immutable identity admitted; observed UUID/XUID/issuer and explicit adult binding agree |
| Spoof/offline/malformed credentials | Denied; supplied names/UUIDs never create verified identities |
| First-time resolution | Pending until trusted evidence; no whitelist-off or auth-off enrollment window |
| Rename | Stable authenticated subject and grants; display name changes do not reassign ownership |
| Bedrock link/unlink/relink | Mapping drift requires adult review; no automatic account merge, inventory/world migration or access inheritance |
| Revocation/expiry/restart | Denial/readback demonstrated later in CL-F2-02, including reconnect and lost acknowledgements |
| Missing/outdated bridge/profile | Unsupported/pending, never verified or ready |

Real-client admission/denial tests and effective bridge event timing are still unexecuted. Snapshot descriptors/protocol source and deterministic fixtures cannot close MC-03. No live/Contabo, backup/restore, family-ready or production claim follows.
