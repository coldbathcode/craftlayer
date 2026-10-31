# Foundation implementation handoff

Date: 2026-10-31. Branch: `main`. Remote: `origin` → https://github.com/coldbathcode/craftlayer.git. Scope authorized: Chapter 00 only, with standing commits/pushes after every build step.

## Delivered and verified

See [chapter review](../../reviews/00-foundation.md), [build log](../build-log.md), [quickstart](../../development/quickstart.md) and [compatibility](../../development/compatibility.md). Seven numbered task commits capture the implementation and final documentation; Git history is authoritative for hashes. The initial GitHub CI baseline is `caa37cb`.

Main working stack is available at http://127.0.0.1:3000 with ignored `.env` and persistent project volumes. No provider/game service is enabled. Preserve those local credentials and unrelated Docker workloads. Disposable test containers are removed by their harness. The temporary fresh-clone stack uses a separate project and is removed after its verification.

## Start a later session

1. Read root AGENTS.md, CLAUDE.md when applicable, and current delivery status.
2. Inspect `git status --short --branch`, `git log -10 --oneline`, remote equality and CI results.
3. Follow quickstart; do not regenerate `.env` or replace existing DB credentials to debug readiness.
4. Only when Chapter 01 is authorized, start CL-01-01 after reading its full spec, security/access model and data model.

## Remaining limits

No authentication/RBAC implementation, provider gateway, scheduler, missions, actual stop latch, Minecraft adapter, coding/research or restore tooling. ADR 0011 is adopted; the original ten design proposals retain their individual review state. License and production release decisions remain open.

## Publication rule

At every build-step endpoint update the exact checkpoint and evidence, commit relevant changes, push to `origin main`, and verify clean/synchronized state. This instruction persists; do not ask again for ordinary build-step pushes. Never force-push, include secrets, run paid inference or deploy publicly without their own authorization.
