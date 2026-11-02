# Family Minecraft deployment gates

Status: all Minecraft production gates unverified; this checklist is not authorization to connect to Contabo or modify infrastructure. Copy into the phase review with operator, date, versions, evidence hash and pass/fail/unknown for every item. Any unknown critical item blocks family-ready/provisioning-ready.

## F0 preservation and permission

- [ ] Explicit read-only inspection authorization recorded; actual host/OS/container ID, Compose, mounts/world identity and manually stopped state verified.
- [ ] Redacted inventory includes game/plugin/auth/OP/allowlist/network/effective firewall/disk/backup state and unrelated-workload baseline; secrets/raw world artifacts excluded from Git.
- [ ] Backup-only write/save authorization obtained separately; recoverable consistent pre-change set and isolated restore proven before live changes.
- [ ] Exact remediation, maintenance, rollback and production change authorization recorded; no automatic firewall/SSH adjustment, prune, volume removal or container recreation.

## F1 observation access

- [ ] Existing auth/RBAC/CSRF/session expiry/revocation/cross-tenant and child-ceiling regressions pass using actual restricted roles.
- [ ] HTTPS/private access covers UI, REST, OpenAPI where protected, SSE and later MCP/WebSockets; direct-origin bypass blocked. Remote privileged MFA enforced on every privileged path; chosen external access is optional for local Core.
- [ ] API/web/MCP/bot workers have no Docker socket, host world mounts, RCON or node secrets; observation adapter is separate, fixed verbs only.
- [ ] In-place adoption preserves container ID/mount/config/state and stable-world manifest; offline stays offline. Unsupported/stale observations show unknown; no ready badge.

## F2 family-ready

- [ ] Pinned Paper/Geyser/Floodgate transport and Java/Bedrock identity flow tested with actual compatible clients; no online-mode/allowlist disabling or password shortcut.
- [ ] Unapproved joins denied, approved immutable identities admitted, rename/spoof denied, revocation/expiry applied and verified; kick separate; children not OP.
- [ ] Child/viewer/wrong-scope/expired session denied at API/service/job boundaries with zero effects; operation replay/uncertainty/audit/redaction verified.
- [ ] Daily consistent backup, minimum 14-day retention, weekly encrypted off-host copy configured and tested with approved destination; keys separate, disk/error/save-on recovery tested.
- [ ] Nontrivial isolated restore, checksums/world/plugin identity integrity, corrupt/missing-key/low-space/traversal denials and measured RPO/RTO recorded.
- [ ] Parent mobile/keyboard access/backup/audit workflow verified with providers absent; readiness removed for critical drift, unknown identity or overdue recovery evidence. Lifecycle marked unavailable until F3.

## F2.5 provisioning-ready and F3 operations

- [ ] One-use expiring enrollment, outbound mTLS, signed job target/expiry/fence, rotation/revoke/replay/partition proofs pass.
- [ ] EULA/adult exact plan approved; vetted pinned image/plugin set and architecture/capacity/headroom/CPU/RAM/disk/ports/storage/network validated across all workloads.
- [ ] Concurrent port/capacity conflict rejection creates zero resources; no arbitrary shell/RCON/Docker/images/host paths; quotas actually enforced.
- [ ] Crash/restart reconciliation produces no duplicate container; rollback removes only proven new runtime resources, retains worlds/backups, preserves existing and unrelated workloads.
- [ ] REST/UI/MCP permissions, OAuth issuer/audience/resource/expiry, read-only-client denial and independent human approval pass; high-risk automatic tools disabled.
- [ ] Manual stop survives node/control-plane restart; adopted lifecycle separately enabled/approved; update/restore/decommission rehearsal retains recoverable original storage.
- [ ] No public RCON/Docker/DB/Redis/node/admin service port; only required approved game ports; authorized external/private network evidence recorded.
- [ ] Phase review, risk decisions, handoff, precise feature claims and separate production authorization complete. Disposable tests alone do not certify Contabo.
