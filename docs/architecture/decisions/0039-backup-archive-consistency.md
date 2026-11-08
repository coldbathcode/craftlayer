# ADR 0039 — Backup archive consistency, verification and restore

Status: adopted for master plan step D1 (effect library), 2026-11-08. Built in the node agent's game-control library and proven on a disposable pinned Paper server locally; not yet scheduled or installed on the VPS.

## Context

A backup of a running Minecraft world is only trustworthy if the world was not changing while it was read, if the archive can be proven to contain exactly what was hashed, and if a restore reproduces those bytes. [ADR 0038](0038-backup-records.md) created the records; this decision fixes how the archive that fills them is made.

## Decision

1. **Save coordination through the private console.** `save-off`, then `save-all flush` (which must be confirmed by the server), then read, then `save-on` in every path including failures. A failed resume is its own error (`SAVE_RESUME_FAILED`) because it needs an operator, not a retry. A stopped server skips coordination.
2. **Hash, archive, re-hash.** Every included file is hashed before archiving and again after. If the content hash differs, the partial archive is deleted and the backup fails with `WORLD_CHANGED_DURING_BACKUP` rather than recording something that cannot be verified.
3. **Explicit selection, byte-ordered.** World directories, plugin state and configuration are included; logs, caches, libraries, versions, crash reports, the EULA marker, Geyser caches and profiler data are excluded and listed as such in the manifest. Symlinks are never followed; they are recorded as skipped. Member names are checked against traversal and control characters both when writing and when reading.
4. **Manifest as the contract.** The manifest records occurrence and server IDs, time, the consistency steps taken, every file with size and SHA-256, a content hash over that list, and the archive's own hash and size. The manifest hash is what the records layer stores as `manifest_hash`.
5. **Verification checks three things.** Archive hash and size against the manifest, the archive's member list exactly equal to the manifest (no extra, missing or unsafe members), and manifest paths free of traversal. Restore requires an existing empty directory, verifies first, extracts, then re-hashes every file against the manifest.
6. **Space before effect.** Free space of at least twice the selected bytes plus headroom is required before archiving.
7. **Plain `tar` with a file list.** The system `tar` is invoked with fixed flags and an explicit file list; no shell, no caller-supplied paths.

## Consequences

- The node-side effect (D1) will call `createBackupArchive` under the occurrence it was given and record the evidence through `recordComplete`; verification of the stored archive later records `verified_at`; a successful isolated restore records `restore_tested_at` (D3).
- Floodgate's `key.pem` and other plugin secrets are inside the archive, so archives are sensitive until the encryption step (D2) wraps them; they must stay on protected storage and never be offered for download in plain form.
- Compression level, chunked uploads and incremental backups are deliberately out of scope.
