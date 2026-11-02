# Existing-server preservation, backup and rollback runbook

Status: F0 local preflight/preservation tooling and synthetic byte-recovery rehearsal implemented; production backup/restore and later F procedures remain unverified. See [runbook](../development/minecraft-preflight.md), [conditional remediation](minecraft-remediation.md) and [review](../reviews/F0-preflight.md). This is not evidence of a live backup or inspection. No commands here authorize production access. Expected `minecraft-java`, `/opt/minecraft-java/compose.yaml` and `/opt/minecraft-java/data` must be discovered, not assumed. Treat worlds/player data as irreplaceable.

## Gates and evidence custody

1. **Local development**: fixtures, mock RCON/Docker and uniquely identified disposable test projects only. Never inherit the main installation's credentials/volumes. Preserve current local `.env`/accounts.
2. **Production read-only inspection**: obtain explicit operator authorization for host, account, read scope and time. Do not install an agent, start a stopped server, run a backup/save command or change firewall/config under this authorization. All require writes and separate approval.
3. **Backup-only authorization**: exact source/target, consistency method, save actions or stop interval and disk budget approved. A backup writes storage and may issue save controls; it is not silently included in read-only inventory. If consistent capture cannot be achieved without stopping, request that exact maintenance action; never infer approval.
4. **Production writes/deployment**: exact reviewed plan, immutable host/server/world mapping, verified recoverable backup and isolated restore, rollback, access-control proofs, unrelated-workload baseline and operator approval. Any changed plan/config/archive digest invalidates approval. Approvals for one operation do not authorize upgrades, network changes or world migration.

Store raw inventory and backup manifests outside Git in operator-protected storage; publish sanitized evidence/hash summaries only. Do not print RCON passwords, Floodgate keys, session tokens, DB dumps, children’s account details, raw logs or world archives. Record operator/date, versions, approved scope and remaining unknowns.

## Read-only inventory

Capture immutable container ID and running/stopped/restart state; Compose project/path and file hash; image digest, Paper/Java/game/plugin versions; real mount roots/volume IDs/ownership and world UUID/metadata; configured heap/container quotas; game ports, bind addresses, network topology; private RCON presence without password; Java online auth, allowlist enforcement and current OPs; Floodgate linking/UUID/XUID/prefix/key handling; backups/schedules/age/retention/encryption/free disk and recovery key availability.

Inspect effective host packet filtering and edge firewall evidence, including Docker-published ports, SSH and unrelated services. Ordinary UFW status alone is insufficient. No automatic firewall change or remote scan. External reachability tests need a separately authorized vantage/target and must preserve access. If permission or evidence is missing, record unknown and block readiness.

Fingerprint stopped world files byte-for-byte with SHA-256 manifests only when reads are authorized and stable. For a running world, checksums across ordinary ticks are not a meaningful preservation comparison; use a consistent snapshot or separately approved quiesced interval. Compare immutable container/mount/config/state and a stable snapshot in adoption tests. Do not claim zero changed live bytes from a running game's natural saves. Adoption itself issues no writes/start/stop or container recreation, including when offline.

## Backup creation and scheduling

- Default daily schedule with explicit timezone, minimum 14 days retention, weekly encrypted off-host copy to an operator-configured destination. No transfer occurs without destination/data-flow approval. Show local backup, off-host replication and restore-test health separately. Proposed RPO ≤24h and RTO ≤60min must be measured, never assumed.
- Serialize per-world backup/restore/update with a durable lease/fence and node-local world lock. Check free space for archive, staging, pre-restore snapshot and headroom before effects. Store occurrence IDs so scheduler replay cannot create multiple logical backups. Missed daily jobs surface as overdue and reconcile without unbounded catch-up.
- Stopped world: copy a verified stable source without starting it. Running world: use version-tested private save coordination, flush acknowledgement and consistent snapshot/archive. If unavailable, require approved clean stop. Do not trust a zip of a world changing while read.
- If saving is disabled, use a tested bounded cleanup/watchdog to re-enable saving in success, error, cancellation and adapter crash cases; failure to confirm save-on is critical/degraded and requires operator action. Stop/revocation prevents new jobs, but must not strand a previously authorized save-off sequence without its bounded safety cleanup. Never restart the server to mask cleanup failure.
- Include world/dimensions/player data, allowlist/OP/bans, sanitized server configuration, plugin versions/data and identity mappings. Separate sensitive RCON/Floodgate/encryption material into a protected encrypted recovery set; user-downloadable archives must exclude plaintext credentials. Record which key references are required for complete recovery.
- Generate manifest with source world/server/node IDs, compatible game/image/plugin versions, config/access-policy versions, timestamps, consistency evidence, sizes, content hashes and encryption/key IDs. Store durable verification state. Check archive integrity/decryptability and perform periodic disposable restore tests. Retention never removes the last verified recovery set or an approval-pinned/pre-change snapshot; failed/new backups never trigger deletion of known-good backups. Deletion needs dedicated scoped policy and audit.

## Isolated restore rehearsal

1. Authorize use of the selected archive and separately recovered keys. Verify provenance, cryptographic checksums, manifest compatibility and available space; fail closed on corruption/missing keys/version mismatch.
2. Extract to a newly created controlled staging root. Reject absolute/traversal paths, symlink/hardlink/device escapes, decompression bombs, excessive counts/size and unexpected ownership. Never accept a caller-supplied host path.
3. Create a disposable isolated test instance using a pinned compatible version, synthetic identities and unique volumes. No production mounts, public game/RCON ports, production credentials or notification destinations. Block plugins' unapproved outbound activity.
4. Verify stable copied-file hashes, world identity/chunks/player state, plugin identity data and configuration; boot only the disposable instance under approved EULA conditions. Record expected boot-time transformations separately from pre-boot archive integrity. Test game readiness and allowlist denial/admission with approved test clients/accounts.
5. Measure restore duration and effective backup age/RPO; record result/artifact hashes, version matrix and operator/test fixture. Cleanup only explicitly owned disposable resources after preserving evidence. Test missing keys, corrupt archive, insufficient disk and extraction attacks. A passing archive checksum alone is not a successful restore.

## Approved production restore or update

Adult scoped authority, independent exact-action approval and separate operator maintenance approval are prerequisites. Freeze conflicting management operations and bot work; establish quiescence and unresolved effects. Take/verify a pre-restore backup; stop/quiesce only with permission and confirm actual state. Restore into new staging storage, validate fully, then perform a reviewed atomic switch only when supported. Never extract directly over the sole live world. Retain the original storage untouched through the recovery window.

If checks fail, keep the server stopped and restore the prior mapping/config/image only if compatible with the retained original world; do not downgrade an upgraded world. Keep backup, failure artifacts and approval/audit trail. No automatic start after restore, control-plane reboot or stop clearance. Explicitly authorize selected start and reconciliation.

## Rollback by operation type

| Operation | Safe rollback / failure response |
| --- | --- |
| F0 inventory | No production change; stop collection, preserve sanitized evidence; never repair automatically |
| F1 adoption | Remove/disable only CraftLayer registration after draining observations; revoke adapter credentials; original container/mount/network/config/state unchanged |
| F2 access | Re-read current desired/actual version; adult-approved compensating access operation with audit. Never restore an obsolete broad whitelist over later valid revocations or disable authentication/allowlist |
| Backup failure | Restore save-on through bounded cleanup, retain verified archives, stop retries on unknown state/disk exhaustion; alert and remove readiness |
| Node enrollment | Revoke credentials/pending jobs, disconnect, reconcile uncertain effects; stop admission without powering off games; host uninstallation is a separately reviewed action |
| Failed provision | Query by immutable deployment/resource IDs, fence attempts, stop/remove only proven newly created runtime container/network, revoke ephemeral secrets and release verified-unused reservations; retain all world storage/backups/diagnostics |
| Update/restore | Use untouched original storage and compatible prior image/config or verified coordinated recovery set; image downgrade alone is insufficient |
| Decommission | Explicit adult confirmation; retain world volumes/backups and recovery metadata by default. Adopted-container removal is disallowed unless separately authorized; unregister-only is the default |

Rollback never prunes Docker, removes a pre-existing/unlabelled container or touches another Compose project. Ambiguous ownership or effects block cleanup for review. Track before/after immutable IDs, config hashes, stopped-state and unrelated services in the [acceptance suite](../testing/minecraft-management.md).
