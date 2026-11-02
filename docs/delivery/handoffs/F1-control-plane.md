# CraftLayer F1 handoff

**Date:** 2026-11-02 UTC. **Agent/session:** Codex, local F1 continuation. **Branch/base/head:** main; F1 base `87a08ed`, prior task commits `aa35729`/`3224f1e`; final CL-F1-03 commit follows this record in Git. **Authorized scope:** local F1 only; no Contabo, live world, deployment or paid inference.

## Current state

CL-F1-01–03 implement registry/operation schema, strict scoped domain/API/SDK, protected sources/fixed Java status-only query and `/servers` parent observation dashboard. F1 review is prepared for owner advancement; [review](../../reviews/F1-control-plane.md) and [runbook](../../development/minecraft-management.md) define exact evidence and limits. No private remote access or family readiness is qualified. Existing main installation is unchanged and is not automatically upgraded by a push.

## Working tree

Task-owned changes are staged/committed/pushed at this checkpoint; final HEAD/remote equality is verified in session after publication. Preserve these five entry-dirty files unchanged and excluded: `packages/runtime/src/events.ts`, `packages/runtime/src/models.ts`, `scripts/check-local-secrets.mjs`, `scripts/test-runtime-stack.mjs`, `tests/integration/auth.integration.test.ts`. They belong to existing Chapter 03 work; do not erase/publish them to obtain an artificially clean tree. Hash comparison is recorded in the build log. Task-owned clean state is required; full-tree clean state is unavailable for this reason.

## Checks and evidence

See [review](../../reviews/F1-control-plane.md) and [build log](../build-log.md) for exact final commands/counts. CL-F1-02 database/API proof: 99 cases + migration proofs in disposable databases. CL-F1-03 adds isolated production-image browser journeys and optional agent-browser snapshot/screenshot, with synthetic sessions removed and project-only cleanup. Full checks use the current preserved working tree; hosted clean-commit CI and real-game/Contabo checks are not claimed. Local screenshot artifacts are ignored/private to this workspace.

## Decisions and blockers

ADR 0017 preserves current auth/scope and metadata-only ownership; only captured inventory and fixed bounded private Java status are supported. Remote management fails closed until private HTTPS/MFA qualification. D-26–D-29, actual identity/access/restore/world/network evidence and F2+ features remain open. No models/paid services are needed. Backup, allowlist, infrastructure and lifecycle controls remain unavailable; no production container/world was touched.

## Next action

After **explicit F2 authorization**, start CL-F2-01 in [F2 chapter](../../chapters/F2-family-access.md): inspect `git status`, current status, management/security/preservation contracts, then select compatible immutable Paper/Geyser/Floodgate fixtures and design identity provenance/web-to-game enrollment without weakening authentication. Work first in disposable worlds; obtain approved actual Java/Bedrock test-client evidence to close compatibility. F2 authorization does not authorize Contabo access or writes. Existing CL-03-07 remains separately authorized and open. Stop at F2 boundary for review before F2.5.
