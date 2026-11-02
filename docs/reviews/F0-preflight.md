# F0 review — Local preservation and read-only preflight

**Implementation state:** locally implemented/verified; production F0 unverified. **Acceptance decision:** pending owner review/advancement. **Reviewer:** Codex implementation self-review, independent review unassigned. **Date:** 2026-11-02 UTC. **Commit/tree:** CL-F0-01 `ac81f06`, followed by CL-F0-02 commit containing this review. **Authorized scope:** user’s “ok start building craftlayer!” after REC-01, interpreted as next F0 local chapter. No F1, Contabo connection or production writes authorized.

## Delivered behavior

CL-F0-01: explicit local/fixture preflight with no-shell allowlisted Docker inspect/list/version and firewall reads, bounded file metadata/config parsing, private fingerprints, redacted errors and explicit unknown/non-ready results. CL-F0-02: stopped-source preservation manifest tied to exact container/image/config/mount binding before/after bounded hashing, change detection and typed content/metadata comparison. Conditional remediation/approval/rollback guide and updated runbook accompany the tools.

PR-023/028/029 are covered for local observation/preservation tooling and procedure rehearsal only. There is no Minecraft management API/dashboard, backup feature, game restore, live adoption or node provisioning. Reuse preserves prior identity/provider/runtime chapters; Chapter 03 final qualification remains open.

## Acceptance evidence

| Task / criterion | Command or fixture procedure | Result / exit | Scope |
| --- | --- | --- | --- |
| CL-F0-01 / MC-02 redaction/no mutation/unknown reads | `pnpm test:preflight` (also in `pnpm check`) | PASS / 0; ten targeted cases included in final 215 | Recording runner, temp Unix socket, synthetic Docker/config/player/firewall canaries, fixed read argv, rejected remote/shell inputs, bounded/symlink-safe reads |
| CL-F0-02 / MC-02 preservation and binding | `pnpm test:preflight:recovery` | PASS / 0; seven targeted cases included in final 215 | Source content preserved, exited-only exact binding; changed binding/source, links, over-limit/deep tree refused |
| CL-F0-02 / synthetic MC-08 recovery rehearsal | Same suite: copy synthetic source → snapshot → fresh isolated directory and compare hashes | Passed in targeted suite | Generated binary/config/plugin/key test bytes; no playable world, encrypted archive or game boot; original source never removed/overwritten |
| Corruption/deletion/rename/mode/extra-file failures | Same suite with deterministic fault injection | Passed in targeted suite | Changed/added/missing content and metadata detected; arbitrary raw names/paths/secrets absent from manifests |
| Source/test/web type/lint/regression/docs | `pnpm check` | PASS / 0; 215 tests across 21 files, lint/boundaries, strict source/test/web checks and docs | Current working tree; preserves entry-dirty runtime files. Hosted clean-commit CI not claimed |
| Shell syntax / whitespace | `sh -n scripts/preflight.sh scripts/preservation.sh`; `git diff --check` | PASS / 0 | No operational script collection against real host |

Environment: macOS arm64, Node 22.23.3, pnpm 10.23.0; TypeScript 5.9.3/Vitest 5.0.5. Tests create/remove only their own temporary directories/sockets. Fixture source is generated in test code; names resembling game files are synthetic bytes. No game/image/model download, EULA acceptance, paid call or real Docker daemon used.

## Safety and failure review

No mutable infrastructure command is present in the command factory: no SSH/exec/RCON/start/stop/prune/save/firewall write. Explicit Unix socket, restricted subprocess environment, fixed known CLI locations, 3s timeout and 256 KiB output bounds prevent context/transport fallback and shell interpolation. Raw child errors are never forwarded. No args prints help only. Host-installed binaries and administrators are trusted, not sandboxed.

Selected files use bounded no-follow/nonblocking reads and parent symlink checks. Tree hashing refuses links/special files and detects ordinary concurrent changes, with before/after file identity and final metadata/directory pass. Stopped-container binding is checked before/after. Fingerprints exclude raw names/paths/contents but remain protected inventory; they are not encryption. Reads may update atime. Scanning is not an atomic snapshot, cannot isolate a compromised host and cannot cancel an already-stalled filesystem syscall.

Local operator CLI is not a new remote authorization surface; no credentials, role changes, worker permissions or database migrations introduced. API/worker tenant and child policies remain unchanged. Actual denied game joins, cross-tenant server APIs, private-network reachability and recovery remain later phase gates. Application tests passed in the existing working tree, not a claim that the uncommitted Chapter 03 changes are accepted.

## Performance and user verification

Conservative limits: 10,000 entries, depth 16, total 2 GiB, single file 512 MiB, 30s cooperative scan budget. Recovery fixture has more than 8 KiB of synthetic world/plugin/config bytes and verifies each digest in a fresh directory, with a 30s test bound. This is no large-world capacity/RPO/RTO benchmark. CLI help/error/fixture paths tested; no UI/accessibility or production usage study applies to this phase.

## Known limitations and unresolved work

Contabo OS/container/path/state, installed Java/Paper/Geyser/Floodgate versions, volume ownership, actual identity and first-time enrollment, effective firewall/edge/MFA entry, live backup/keys/off-host policy and isolated game restoration remain unverified. F0 tools never start a running/offline server to resolve these unknowns. The preflight does not interpret arbitrary YAML or Java property escapes; ambiguous inputs are unknown. Manifests can refuse larger/linked real data; do not truncate or silently widen limits.

The snapshot-copy test is not a deployable backup/restore implementation. It exercises preservation/difference detection and the local procedural rehearsal. F2 must deliver consistent encrypted archives, key recovery, scheduling/retention/off-host and real isolated game restore. Missing-key/corrupt archive/decompression/space/game compatibility tests remain F2, not passed by file-copy proof. No production readiness claim.

## Review decision and handoff

- [x] Local task evidence and limits recorded; final combined checks passed before publication.
- [x] Local acceptance criteria met; production/game/backup gates explicitly unverified.
- [x] No unresolved local defect identified by targeted checks; host compromise/operational limits remain documented.
- [x] Chapter/track/status/risk/operations updated; original source and prior chapters preserved.

Decision: **local implementation review prepared; owner advancement pending**. Next is CL-F1-01 after explicit F1 authorization; local registry/API/SDK and observation dashboard only. Production read, backup/save capture and changes remain separately approved. See [handoff](../delivery/handoffs/F0-preflight.md).
