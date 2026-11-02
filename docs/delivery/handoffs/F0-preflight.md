# CraftLayer session handoff — F0

**Date:** 2026-11-02 UTC. **Agent/session:** Codex. **Branch/base/head:** main / REC-01 `82eabd4` / F0 review commit containing this file. CL-F0-01 published `ac81f06`. **Authorized scope:** local F0 implementation after user’s “ok start building craftlayer!”, ordinary task commits/pushes. No Contabo access/write, F1 implementation, paid inference or deployment.

## Current state

CL-F0-01–02 locally implemented/verified. Read [F0 review](../../reviews/F0-preflight.md), [runbook](../../development/minecraft-preflight.md) and [remediation plan](../../operations/minecraft-remediation.md). Tools are `scripts/preflight.sh` and `scripts/preservation.sh`; default help performs no collection. Explicit local read-only scope, bounded outputs/reads, redacted metadata and exited-only source capture; no remote/mutating/backup/restore capability. Synthetic temporary snapshot-copy recovery verifies bytes and corruption/loss/metadata/binding refusals. Game/production recovery remains unverified.

## Working tree

Preserve five entry-dirty files outside F0 commits: `packages/runtime/src/events.ts`, `packages/runtime/src/models.ts`, `scripts/check-local-secrets.mjs`, `scripts/test-runtime-stack.mjs`, `tests/integration/auth.integration.test.ts`. Their hashes were recorded at F0 entry and compared before publication. Do not stash/reset/commit them for cleanup. No task-owned modifications should remain after final publication; whole-tree cleanliness is intentionally unavailable while those unrelated edits remain.

## Checks and evidence

`pnpm check` PASS/0: lint/boundaries, source/test/web strict checks, 215 tests across 21 files and docs/source validation. `sh -n scripts/preflight.sh scripts/preservation.sh` and `git diff --check` PASS/0. Targeted preflight ten cases and preservation/recovery seven cases passed. Five pre-existing file hashes match entry state; AGENTS/source/unified inputs have no diff. Final publication/synchronization executes after this record; use Git/session output for actual remote equality. Exact evidence is in [build log](../build-log.md). Full application integration/browser/Compose/game/off-host/production checks not run for script-only changes; source/test/web strict check and existing unit suite are relevant. No real Docker daemon, game account or live world used.

## Decisions and blockers

ADRs 0015/0016 and D-26–D-32 remain. Current manifests are not atomic snapshots or backup artifacts; 2 GiB/512 MiB/10,000-entry/depth-16/30s conservative bounds refuse unsupported data. Local scripts trust installed binaries/host administrators and detect ordinary races; they do not isolate compromised hosts. Production F0 evidence, RCON/privacy/identity/plugin versions, encryption/key/off-host and actual playable restoration remain open, not local implementation blockers.

## Next action

Present the F0 local review and request **F1 implementation authorization**. After approval start CL-F1-01: strict server/operation contracts, additive scoped schema/permissions, current identity/audit integration. Then private observation adapter/REST/SDK and parent read-only dashboard using synthetic/disposable fixtures first. No models/bots or production deployment required. Request authorization at the next phase boundary; Contabo inspection/backup/writes are separate scopes.

CL-03-07 remains previously authorized but unfinished, with its unrelated modifications preserved; F0 does not complete its runtime restart/fault review. At every coherent checkpoint run relevant checks, update evidence/docs, commit only task files, push origin main and verify actual remote equality without force. Report retained unrelated dirty state honestly.
