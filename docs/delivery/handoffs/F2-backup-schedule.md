# CraftLayer session handoff — CL-F2-03/A

**Date:** 2026-11-07 UTC. **Agent/session:** Claude Code. **Branch/base:** main, `4538a83`. **Authorized scope:** local F2/F25/F3 and task commits/pushes; no Chapter 04, production or live world action.

## Current state

`packages/contracts/src/backups.ts` and `packages/minecraft-control/src/backup-schedule.ts` add pure backup policy, occurrence, reconciliation, retention and health logic. **No backup is taken by anything.** Neither VPS world has a scheduled backup; the existing world has only the one encrypted manual archive, and the new playtest world has none. See [ADR 0033](../../architecture/decisions/0033-backup-schedule-semantics.md).

## Working tree

Task files: contracts, schedule module and tests, exports, ADR, F2 chapter, track, status, backlog, build log and this handoff. The pre-existing staged full-project review and shared backlog/status hunks stay preserved and excluded through an isolated index.

## Checks and evidence

Focused unit run PASS/0 (22 cases). 15 of 15 targeted mutants killed. `pnpm check` PASS/0 (387 unit cases/45 files). No SQL, API or UI changed, so database and browser suites were not rerun.

## Decisions and blockers

CL-F2-03 was started before CL-F2-02, because that task needs real clients and owner accounts that are pending. This is a documented refinement, not a release shortcut. No staleness threshold for restore tests is defined; that is a product decision, and the health output reports the last test time rather than inventing one.

## Next action

Add durable per-server backup policy, occurrence and backup records with scoped adult `backup:*` permissions, using the occurrence ID as the idempotency key. Then build archive and manifest verification from `scripts/minecraft/preservation.ts`. Save coordination must follow the bounded save-on recovery rule in [preservation procedures](../../operations/minecraft-preservation.md). The owner-gated VPS work is in the [P4 handoff section](F25-bedrock-vps.md).
