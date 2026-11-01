# CraftLayer session handoff — Chapter 02

**Date:** 2026-11-01 UTC. **Agent:** Codex. **Branch:** main. **Base:** Chapter 01 `067e1b1`. **Head:** CL-02-07 review commit containing this file; inspect Git for its hash. **Authorized scope:** Chapter 02 with standing commit/push permission. Chapter 03 requires authorization. No paid/live inference, real mail, package publication, public deployment or Cloud implementation was authorized.

## Current state

Provider contracts, encrypted connections, protected optional operator configuration, native Ollama/OpenRouter adapters, policy/cooldown/stop and PostgreSQL budgets are implemented. Local qualification passed; use [the chapter review](../../reviews/02-provider-gateway.md) and [status](../status.md) for actual check results. `packages/providers` exports the guarded internal gateway; it exposes no public arbitrary-prompt API. Real hosted strict-free dispatch is deliberately ineligible without enforceable price evidence.

The primary installation remains private on port 3000 and must remain unclaimed for its owner. Tests create disposable random-port installations and ephemeral databases; preserve ignored `.env`, real volumes and unrelated Docker containers. Do not dump keys or raw logs containing credentials.

## Working tree

All changes belong to Chapter 02; no unrelated modifications existed at entry. Task commits are individually pushed. At final publication verify `git status --short`, `git log -8 --oneline` and local HEAD versus `git ls-remote origin refs/heads/main`; never assume synchronization from this document alone.

## Checks and evidence

Review records exact results. Commands include `pnpm check`, `pnpm build`, `pnpm test:db`, `pnpm test:provider-stack`, `pnpm test:offline`, `pnpm stack:up`, `pnpm compose:check`, `pnpm check:stack`, `pnpm test:e2e`, `pnpm test:identity-ui`, `node scripts/check-local-secrets.mjs`, `pnpm docs:check` and `git diff --check`. Temporary logs/artifacts are ignored, not private data to commit. Hosted CI checks the final published commit separately.

## Decisions and blockers

ADR 0013 defines native bounded transports, conservative pricing, protected encryption keys, guarded SQL and dispatch barrier, immutable budget ledger, uncertain recovery and limited current runtime scope. Default configuration has no required provider key and zero paid spend. D-07 tracks unenforceable hosted pricing; D-06 covers protected keys/restore and D-24 the runtime/replay/reporting boundaries.

`ProviderGateway.generate` accepts only current adult project/environment execution grants. Mission/task labels are budget grouping only; they must not be treated as canonical authorization. Chapter 03 must load canonical entities, persist execution/outcome identity, compose provider stop with emergency stop and implement leases/fences/outbox/worker authentication. A claimed request ID cannot be replayed, even after quota denial; do not blindly create fresh IDs on queue redelivery. Settlement deliberately survives originating-session revocation.

## Next action

At the chapter boundary present the review and request Chapter 03 authorization. Once authorized, read `docs/chapters/03-fleet-engine.md` and its runtime/data/security references and start CL-03-01. No canonical fleet/queue work is authorized by Chapter 02 alone. Continue per-step check → plan/build-log update → commit → push → clean remote verification.
