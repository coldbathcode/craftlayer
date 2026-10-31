# CraftLayer session handoff — Chapter 01

**Date:** 2026-10-31 UTC. **Agent/session:** Codex. **Branch:** main. **Base:** Chapter 00 `4df5e20`. **Head:** the CL-01-07 review commit containing this file; use `git log -1` for the final hash. **Authorized scope:** Chapter 01 only; standing commits/pushes to main. No paid inference, mail to real recipients, public deployment, package publication or Cloud implementation was authorized.

## Current state

Chapters 00–01 are implemented. Read [the identity review](../../reviews/01-identity-and-rbac.md) for exact verification and scope limits. CL-01-01–07 cover schema/roles, owner bootstrap, local sessions, service authorization/signed execution grants, invitations/lifecycle, recovery/children, shared API contracts, account console and isolation review. Chapter 02 has not begun.

The main Docker stack is available on loopback port 3000. `/account` is intentionally unclaimed so the user can choose their own owner password. Browser fixtures use a separate random-port Compose project and remove its test volumes. Preserve the real `.env` and its volumes. Never print credentials or claim this installation during tests. The unrelated `rustybin` container was preserved.

## Working tree

No unrelated changes were present when Chapter 01 began. Each task has a separate commit and push. The final publication verifies clean worktree and local/remote main equality; verify again when resuming with `git status --short`, `git log -8 --oneline` and `git ls-remote origin refs/heads/main`.

## Checks and evidence

The chapter review is the evidence index. Relevant commands: `pnpm check`, `pnpm build`, `pnpm test:db`, `pnpm compose:check`, `pnpm check:stack`, `pnpm test:e2e`, `pnpm test:identity-ui`, `pnpm test:offline`, `node scripts/check-local-secrets.mjs`, `pnpm docs:check`. Check their recorded results rather than assuming a specification implies a pass. Browser screenshots/traces and temporary local logs are ignored and not committed; hosted CI retains failure reports.

## Decisions and blockers

ADR 0012 documents restricted identity privileges, Argon2/session choices, local recovery, optional encrypted SMTP outbox and the bounded account UI/audit scope. D-04/D-05 are resolved for the local identity slice; D-23 tracks cursor/global audit/correlation/retention limitations. Core license remains an owner decision. No implementation blocker remains after the recorded checks; the next chapter boundary requires authorization.

Future workers must use the signed grant's current identity/membership/session/resource checks before effects; transport authentication, leases and stop checks remain Chapter 03. Grants do not constitute a complete worker capability system. Provider credentials and encryption/rotation must be designed in Chapter 02, not stored in the browser or improvised inside identity DTOs.

## Next action

Present the Chapter 01 review for owner acceptance and request authorization for Chapter 02. After authorization, read `docs/chapters/02-provider-gateway.md`, provider/security/data architecture and current status, then start CL-02-01. Consult official pinned SDK/provider documentation; do not hardcode free model claims or use live paid inference in tests. Keep local deterministic fakes as the normal path.

At every coherent build step: run relevant checks, update chapter/backlog/status/build log with the exact stopping point, commit task files, push `origin main`, and verify remote equality plus clean tree. No force pushes or secrets.
