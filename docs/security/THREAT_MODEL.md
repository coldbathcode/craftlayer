# Unified Core and Minecraft threat model

Status: planned controls, 2026-11-02. Existing identity/provider/runtime evidence is in chapter reviews; Minecraft/node controls are unimplemented. [Security/access](../architecture/security-and-access.md) remains binding. [Management architecture](../architecture/minecraft-management.md) defines scope and transport.

Assets: irreplaceable world/player/plugin identity data, adult/child identities, private player presence, RCON/Floodgate/node/encryption secrets, Docker host and unrelated services, operation/approval integrity, backup recoverability and audit history. Host/DB administrators are trusted; a compromised Docker-capable node threatens its host. RLS and encrypted fields are defenses against application mistakes/theft, not against a malicious host.

| Threat / boundary | Required control | Acceptance proof / owner |
| --- | --- | --- |
| Unknown/spoofed/renamed Java or Bedrock identity → game | Online authentication, immutable verified identity/provenance, default-deny version-specific allowlist, no onboarding join window | MC-03–04 / F2 |
| Stolen session or proxy bypass → management | MFA for remote privileged entry, TLS/private access on every path, current session/CSRF/Origin, throttles, direct-origin blocked | MC-01, MC-05 / F1–F2 |
| Child/viewer/custom-role or machine escalation → service | Account ceiling + scoped permission at API/service/job/node, no implicit Minecraft OP, no self-approval | MC-01, MC-06, MC-10 / all |
| Forged org/project/server/node/backup → DB/job/storage | Membership-derived canonical context, composite FKs/RLS, confined storage and per-node target binding | MC-01, MC-06, MC-09–10 / all |
| Prompt injection/chat/plugin output → host | Bots never receive management credentials; typed allowlisted actions; data cannot alter tools/permissions/approval | MC-10, MC-12 / F2.5 and 04 |
| Public RCON/Docker/data/node ports → host | Private control network, outbound mTLS node, no public listener/socket in general apps, effective packet filtering evidence | MC-05, MC-10 / F0–F2.5 |
| Node job replay/revoke/expiry/old fence → effect | One-use enrollment, signed expiring jobs, local journal/nonce/fence, rotation/revocation and no reconnect resume | MC-06, MC-09 / F2.5 |
| Compromised node/plugin/image → host/peers | Dedicated host/rootless where compatible, pinned vetted artifacts, restricted mounts/networks/quotas, no privileged/host-network containers; document residual host risk | MC-07, MC-10 / F2.5 |
| Concurrent provision or external workload → collision | Transactional reservations plus actual host recheck, unique immutable ownership, capacity/disk/port enforcement before allocation | MC-07–09 / F2.5 |
| Lost ack/worker crash → duplicate destructive action | PostgreSQL operation/receipt/fence + node journal, unknown effects blocked, postcondition reconciliation | MC-06, MC-09 / F2 onward |
| Backup corrupt/stolen/absent or ransomware → lost world | Consistent saves, separate keys, encrypted off-host copy/retention, checksums + isolated restores, disk alerts | MC-08 / F2 |
| Archive traversal/unsafe update/rollback → world destruction | Staging/lock/approval, extraction bounds, immutable IDs/ownership proofs, retain original storage and backups | MC-08–09, MC-11 / F2–F3 |
| Unbounded logs/events/disk use → service failure/privacy leak | Bounded projections/pagination/buffers, redaction, retention, disk quota/alerts; child-safe feeds | MC-02, MC-10–11 / F1–F3 |

Residual decisions: exact Paper/Geyser/Floodgate/image compatibility and safe first-time identity resolution (D-26), remote MFA/proxy choice (D-27), save/snapshot backend + recovery key/off-host target (D-28), node hard disk quotas/isolation/signing and TLS profile (D-29). Unknowns block the affected capability/readiness; no insecure fallback. Implementation reviews must record attack tests and real pinned-version qualification separately from fakes. Disclosure/production security certification is not claimed.
