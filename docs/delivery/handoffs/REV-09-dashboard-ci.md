# CraftLayer session handoff — REV-09 dashboard CI

**Date:** 2026-11-03 UTC. **Agent/session:** Codex. **Branch/base/head:** main, base `fa65291`, head is this checkpoint's commit. **Authorized scope:** existing local management verification and per-step commit/push; no deployment or production changes.

## Current state

The existing workflow now runs `pnpm test:server-ui` in its own unconditionally scheduled `management-browser` job on main pushes and pull requests. It uses existing pinned actions/lockfile, Chromium and disposable local Docker fixtures, a 15-minute timeout and separate seven-day failure artifacts. Token permission remains contents-read only; no production secrets or new external services.

Playwright selects foundation, identity or management specs explicitly. The dashboard spec rejects absent fixture configuration instead of skipping. Foundation discovery cannot accidentally claim dashboard coverage; direct dashboard selection without the wrapper fails.

## Working tree

Task files are workflow/Playwright config/dashboard fixture guard and linked verification docs. The pre-existing full-project review and unrelated status/backlog review hunks remain staged and excluded. Do not discard them or claim whole-tree cleanliness.

## Checks and evidence

Exact check, discovery/negative-config, YAML parse and actual disposable production-image browser results are in the [build log](../build-log.md). The publication snapshot is compared against the tested source/config/test contents; unrelated review prose is excluded. Hosted CI outcome and branch-protection settings are separate facts; local success does not assert either.

## Decisions and blockers

This makes the browser job part of each configured workflow run, not a claim that GitHub branch protection requires its status. The wrapper cleans only its random test project and generated fixture credentials. Browser artifacts contain synthetic fixture activity and retain the existing bounded failure policy. Actual Minecraft clients, production networking, backup/restore and physical host qualification remain open.

## Next action

Inspect the new job's hosted run at the published commit without inferring success from local tests. Then return to the private node composition gap in the F25 chapter: preserve inventory-only installed behavior until independent approval/storage/game/identity/recovery qualification exists. Chapter 04 and all Contabo operations remain separately gated.

## Clean-checkout follow-up

Hosted job 125925734375 in run 41638311720 failed before browser startup because the new isolated job lacked compiled contracts exports. Earlier local proof had reused build outputs. The wrapper now explicitly builds server/workspace exports before fixture preparation and gates Compose teardown until configured startup was attempted, preserving early failure diagnostics. Validate with `pnpm test:server-ui` in a detached checkout with no `packages/contracts/dist/index.js`, then `pnpm check`. An injected failing build also proves no Docker call and temporary-file cleanup. Exact final results/publication are in build log; hosted success still requires a new observed run.
