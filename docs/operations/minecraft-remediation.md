# Minecraft preservation and remediation decision plan

F0 local implementation, 2026-11-02. This is a conditional operator review plan, not observed Contabo findings or permission to change infrastructure. [Preflight](../development/minecraft-preflight.md) emits bounded findings; actual deployment details remain unknown. Apply the [separate inspection/backup/write approval gates](minecraft-preservation.md) before any live action.

## Prioritized review

| Priority / preflight finding | Evidence to obtain with approved read scope | Proposed change only after exact approval | Recovery / rollback |
| --- | --- | --- | --- |
| P0 `CONTAINER_NOT_VERIFIED`, `DATA_BINDING_NOT_VERIFIED` | Actual selected container ID/state, Compose and exact mount root; no name/path assumptions | Correct CraftLayer selection/mapping only, with operator review; never move/recreate the server | Discard proposed mapping; existing runtime unchanged |
| P0 `RCON_PUBLISHED_NON_LOOPBACK` | Actual configured RCON port, Docker binds/host networking, effective host + edge routes and unrelated/SSH baseline | Restrict management connectivity privately; exact reviewed rule/config change, scoped maintenance and verified recovery first | Restore prior reviewed network/config only if secure; retain private admin access; do not reopen public RCON to recover convenience |
| P0 `ONLINE_AUTH_NOT_VERIFIED`, `ALLOWLIST_NOT_VERIFIED`, `ALLOWLIST_ENFORCEMENT_NOT_VERIFIED` | Literal config plus pinned real Java/Bedrock/plugin identity and allowlist behavior; unknown is not false or safe | Enforce online authentication/default-deny allowlist through later F2; no temporary bypass, no shared password or offline authentication | Versioned compensating change with identity recheck; never restore an obsolete broad whitelist or disable protections |
| P0 `PRIVILEGED_GAME_CONTAINER`, `NETWORK_ISOLATION_REQUIRES_REVIEW` | Full trusted operator review of host privilege, mounts/networks, unrelated workloads and recoverable source | Plan isolated least-privilege runtime/config only under later migration/lifecycle authorization; F0 does not recreate an adopted container | Keep original retained world/config; rehearse compatible restore; no image-only rollback of changed world format |
| P0 `BACKUP_POLICY_AND_ISOLATED_RESTORE_UNVERIFIED` | Consistency method, source/target capacity, last verified archive, key recovery and off-host policy; candidate file age is not proof | Separately approved consistent pre-change backup before other writes; F2 daily/14-day/weekly-off-host policy and isolated game restore | Retain last known-good backup and original storage; save-on cleanup after any coordinated save failure; never delete to make space automatically |
| P1 `EFFECTIVE_FIREWALL_AND_EDGE_REVIEW_REQUIRED` | Host Docker rules/IPv4/IPv6 and edge/private-entry evidence from authorized vantage | Default-deny management/private HTTPS + MFA on every path; expose required game transport only after review | Exact reversible plan protecting SSH/unrelated services; no automatic firewall enablement |
| P1 `JAVA_BEDROCK_IDENTITY_TESTS_REQUIRED` | Pinned Paper/Geyser/Floodgate versions, stable UUID/XUID provenance, first-time/linked/renamed identities and actual clients | F2 adult-approved verified account binding and access reconciliation | Pending/unverified remains denied; revoke/expiry verified separately from optional kick |
| P1 operational metadata unknown | Java/game/plugin versions, container heap vs RAM headroom, ownership, disk/backups/OPs and parent entry | Document supported version/capacity plan before any update/provision; child accounts never OP or admin | Keep prior compatible versions/data; defer unsupported operations |

Priority reflects impact, not permission to execute. A critical finding does not authorize stopping the family server or changing its configuration. If exposure is suspected, report the exact evidence and propose an explicit containment/maintenance action for operator approval. Read-only registration/observations can be developed on synthetic data while host decisions remain open.

## Preservation and recovery evidence packet

Record protected operator authorization, selected host/container/world, preflight observation time/hash, before/after stopped-container/config/mount binding, preservation content/metadata hashes and limits, separate Compose fingerprint, verified recovery set/keys and rollback scope. Keep raw paths, world bytes, credentials and private player information outside Git. A stable preservation manifest is evidence of selected reads; it creates no backup and is not an atomic snapshot.

Before real writes, rehearse restoration of a consistent archive into an isolated pinned game instance and verify world/player/plugin state and access; record actual RPO/RTO, checksums, key availability and errors. F0’s temporary filesystem-copy rehearsal proves synthetic byte comparison only. It does not satisfy real Minecraft restore, encrypted archive, off-host storage, public reachability or family-ready gates.

## Stop and handoff

F0 local tools/rehearsal are implemented; production inspection, backup capture, remediation and deployment remain unexecuted. F1 can build registry/API/SDK and a read-only parent dashboard with synthetic adapters after separate F1 authorization. No production integration is implied by that next phase.
