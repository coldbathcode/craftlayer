# Chapter F2 progress review — Local pending-identity prototype

**Implementation state:** CL-F2-01 partially implemented and locally verified; F2 incomplete. **Acceptance decision:** not eligible for family release. **Reviewer:** engineering self-review, independent review unassigned. **Date:** 2026-11-02 UTC. **Commit/tree:** checkpoint A `e9c7ddd`, checkpoint B recorded in Git after this review. **Authorized scope:** user continuation authorizes local F2; subsequent steering prioritises a usable local prototype. No production/game-world authorization.

## Delivered behavior

Checkpoint A pins candidate Paper/Geyser/Floodgate/JRE metadata and downloads/checks exact official JARs without execution/EULA acceptance. Strict issuer/edition/UUID/XUID contracts and pure continuity helpers preserve subject and link-change boundaries. Checkpoint B adds SQL 0017 and scoped immutable pending request operations/API/SDK/UI. Names remain unresolved, `identity_verified:false` and `access_granted:false`; no promotion/allowlist or authenticated bridge exists. Operation success means request persistence only. The separate loopback prototype exposes ordinary parent/viewer/child accounts, two simulated servers and a real saved-request/audit flow. [ADR 0018](../architecture/decisions/0018-game-identity-provenance.md), PR-025/026 portions and [prototype guide](../development/prototype.md) define the exact scope.

## Acceptance evidence

| Task/criterion portion | Exact command/procedure | Result | Limit |
| --- | --- | --- | --- |
| Checkpoint A provenance/candidate safety | `pnpm check` | PASS / 0; 253 unit cases at A | Structure/mapping, not authenticated game ownership or admission |
| Artifact integrity | `node --import tsx scripts/minecraft/identity-fixture.ts prepare`, then `verify <new-private-directory>` | PASS / 0 | Three official hashes match; descriptors are pinned snapshots; no game/Java image executed; EULA false |
| Checkpoint B schema/auth/receipts | `pnpm test:db` | PASS / 0; 103 cases + migration proofs | Restricted RLS/FKs, current adult scope, child/viewer denial, concurrent replay/conflict, no promotion, HTTP/CSRF/audit; disposable database only |
| Source/types/regression/docs | `pnpm check` | PASS / 0; 258 unit cases, final docs check in build log | Includes preserved entry-dirty runtime code; no hosted clean-commit CI claim |
| Actual UI/REST and mobile/focus | `pnpm test:server-ui` | PASS / 0; one full journey in 34.3s | Parent saves pending request; viewer/child controls denied; tenant/session clearing, synthetic marker, source failure and original F1 flows; isolated production images |
| Production build/prototype | `pnpm prototype:up` | PASS / 0; build/health/seed, loopback 3001 | Separate generated accounts/volumes; no real game/provider |
| Manual prototype request | Headed `agent-browser` snapshot/fill/submit/readback/screenshot | PASS; `PrototypeTry` persists as Pending · no access | Synthetic data only; browser left available for user testing |
| Local Docker scope guard | Node assertions with SSH/TCP context fixtures plus actual local socket pin | PASS / 0 | Prevents accidental remote daemon selection; not isolation from a compromised local host |

Environment: macOS arm64, Node 22.23.3/pnpm 10.23.0, Docker 28.2.2, pinned PostgreSQL 18/Next 16.4.3/React 19.3.1/Playwright 1.64.1 Chromium; agent-browser 0.27.0. Detailed command failures/corrections and final results are in [build log](../delivery/build-log.md).

## Safety and failure review

Canonical membership/server scope and child ceilings precede pending writes and replay. Strict browser bodies cannot assert UUID/XUID/provenance, web-user binding, paths or commands. SQL rows have forced RLS and composite server/operation/actor FKs; runtime has no update/delete, and pending is the only permitted state. Atomic receipts/audit/reference-only outbox contain no credentials or raw names in audit/queue. A stored request changes no server version/world/allowlist. Expiry is explicit; the 200/server cap and existing operation limits bound retention until a later reviewed purge policy.

The prototype owns a private generated directory and separate Compose namespace/volumes, uses loopback only, and mounts only approved synthetic inventory read-only into API. It has no game connection/socket/world mount. Host launchers reject SSH/TCP Docker contexts and pin the checked local socket. Secrets/browser state are owner-only, ignored and outside Docker builds. Down retains data; no reset/prune/volume-deletion command exists. Rollback is a new reviewed code revert with additive schema/history retained; do not down-migrate/delete records or touch any live world.

## Performance and user verification

Enrollment pages contain at most 50 rows; each server retains at most 200 requests, with 24-hour expiry and no automatic pruning. Existing twelve actor/environment writes/minute and 10,000 operation ceiling remain. Browser checks cover actual persistence/reload, role differences, captured stale/offline/error states, 390px overflow and keyboard skip/focus; no production load, screen-reader or real-family usability certification.

## Known limitations and unresolved work

CL-F2-01 is still open: authenticated bridge/target-profile receipt trust, actual explicit adult web-to-game binding and licensed Java/Bedrock unknown/approved/rename/spoof/link tests are unfinished. EULA was not accepted and no Minecraft server was run. There is no verified identity, access grant/revoke/kick, scheduled backup, encryption/off-host/restore/RPO/RTO, family release or remote MFA/private-entry qualification. CL-F2-02–04 remain unimplemented, and F2.5/F3 remain gated. Existing Chapter 03 final review and five entry-dirty files are preserved, not completed by these checks.

## Review decision and handoff

- [x] Delivered local prototype and partial task evidence/limits recorded.
- [ ] All F2 acceptance criteria met.
- [ ] Real identity/access/recovery gates passed.
- [x] Chapter/backlog/status/risks/runbooks/handoff reflect incomplete F2 accurately.

Decision: **prototype available for testing; chapter acceptance withheld**. Continue CL-F2-01 within existing local authorization. [Handoff](../delivery/handoffs/F2-prototype.md).
