# CraftLayer handoff — playable VPS priority / CL-F25-03/P1

**Date:** 2026-11-04. **Base:** main `3e26839`. **Scope:** user asks for a fully playable server on their VPS as quickly as possible. Local preparation is implemented. Exact VPS target/read scope and concrete host change approval remain to be established; no prior family-world change or Chapter 04 authorization is inferred.

## Current state

`pnpm minecraft:playtest:prepare [private-input.json]` creates a new private temporary Java-only Compose bundle with the existing exact Paper/Java candidate pins. Artifact download is bounded/checksummed and incomplete bytes keep `.part`; no runtime, SSH or API call exists. Online allowlist is enforced, admin listeners disabled, game port loopback-only, OP list empty, EULA false, resources bounded and data/runtime paths separate. No existing-world output argument. Input may specify an online player name/UUID, numeric non-root UID/GID and unprivileged TCP port; shape validation does not prove identity.

## Working tree

Task code/tests/package command and linked docs are published together. Preserve the pre-existing staged full-project review and unrelated backlog/status review hunks. Private bundles live in the OS temporary directory, never Git. No local or VPS world has been booted, migrated or deleted. Whole-tree cleanliness cannot be claimed while the unrelated review remains staged.

## Evidence and pending inputs

See build log for exact tests, real artifact download and Compose validation. These do not prove playable readiness. The user has been asked for Java/Bedrock client choice, VPS SSH host/account and player name, plus explicit Minecraft EULA acknowledgement for a local isolated boot/restore rehearsal. No answer was available while this handoff was prepared. The only locally configured SSH alias discovered is `oliubuntulab`; it has not been assumed to be the VPS or contacted.

## Decisions and next action

Follow [ADR 0031](../../architecture/decisions/0031-operator-playtest-first.md). First use confirmed target details to perform authorized read-only inventory, including existing workload preservation/recovery, resources/ports and a dedicated quota-controlled data filesystem. Prepare the exact new-world deployment/backup/rollback plan before asking for live-write approval. Accept EULA only after explicit acknowledgement. Verify real boot, authenticated allowed/denied player access, graceful stop and isolated backup restoration before handing over the connection instructions. Bedrock needs its own pinned configuration and identity/network evidence; ordinary TCP SSH forwarding is Java-only.

After the owner can play, connect actual read-only dashboard observation and implement the required typed lifecycle/backup controls. Durable platform approval decisions are still required for platform automation, but should not become an indefinite blocker to this separately operated test milestone. Keep all established platform safety gates and preserve existing worlds.
