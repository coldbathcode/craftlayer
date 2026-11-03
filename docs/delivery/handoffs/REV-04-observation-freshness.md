# CraftLayer session handoff — observation freshness

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base:** main / `3865f0c`. **Scope:** authorized local management correctness follow-up REV-04; no production access or later chapter implementation.

## Current state

Observe now reads current operation/server projections concurrently, then reports unchanged source time, latest fresh/stale/unavailable status and actual observation timestamp. Successful source reads cannot imply advancing a static capture. Existing generation/session/org guards and failed-snapshot-preservation notice remain. No API/schema/operation-history change or invented fixture timestamp. React best-practices skill applied for parallel dependent-after-mutation readback without new state/effects.

## Working tree

Preserve five CL-03-07 runtime/test files, full-project review and its original backlog/status hunks. New implementation evidence is appended separately; unpublished review table retains its historical Planned row. Publish only this follow-up; verify task state/HEAD/remote and protected hashes, without claiming whole-tree cleanliness.

## Checks and evidence

Exact final checks and results are in [build log](../build-log.md). Browser regression adds a fixed stale-source reread, verifies unchanged/stale notice and card, then fresh-source notice. Existing production-image real local mTLS/host/planner/identity-request/role/tenant/mobile/keyboard/logout journey remains. Initial browser assertion assumed one recorded-observation entry; the new additional observation legitimately produces two, so the assertion now expects both. This earlier run is not a pass. No game/world/production or real identity/recovery proof.

## Decisions and blockers

This message reflects current authorized readback, not immutable per-operation observation history. No fabricated timestamps or capture refresh. F2 real identity/allowlist/backups and F25 qualified installed composition remain incomplete; remote private entry/MFA and production gates remain. No package/version/permissions change.

## Next action

Address independent REV-07: type-check role/delegation registry against canonical organization permissions and compare current SQL permissions/built-in role seeds against TypeScript using a disposable DB. Do not change grants to make a drift test pass without reviewing compatibility. Continue authorized local checkpoints with separate commits/pushes; preserve uncommitted Chapter 03/review work.
