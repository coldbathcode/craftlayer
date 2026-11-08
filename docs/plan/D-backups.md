# Milestone D — Backups you can trust

Part of the [master plan](../MASTER_PLAN.md). Status lives on the [status board](STATUS.md).

## Goal

Every family world is backed up every night, a copy lives somewhere other than the VPS, and a restore has actually been tested. The dashboard shows it as one line: "Last backup: today 4:00 ✓ · Copy off the server ✓ · Restore tested 3 days ago ✓".

## Today

Schedule and retention rules are built and tested (CL-F2-03 checkpoint A, [ADR 0033](../architecture/decisions/0033-backup-schedule-semantics.md)). Nothing takes a backup yet. The new family world has **no backup**. The original world has one manual encrypted archive on the owner's Mac.

## Steps

- **D1 — Nightly backup.** Durable backup policy and records (the next CL-F2-03 checkpoint). The node agent runs a consistent backup: `save-off` + `save-all flush` over the private channel, archive the world, plugins and config, `save-on`, hash and encrypt, store under a dedicated backup path. Retention per the existing rules; never deletes the newest verified copy. **Back up now** button.
- **D2 — Copy off the server.** Encrypted copy to an owner-chosen destination (owner decision: for example a Backblaze B2 bucket, or the owner's Mac via a pull job). Encryption key kept separately with a recovery copy.
- **D3 — Restore test.** Weekly automatic restore of the latest backup into a throwaway, network-isolated container; boots, checks the world loads, then is removed. Result shown on the dashboard.
- **D4 — Restore for real.** Adult-initiated restore with approval: stops the server, keeps the current world as a retained backup, restores, starts, shows the result. Never automatic.
- **Done when:** a week of nightly backups exist with hashes; an off-host copy decrypts and matches; an isolated restore boots; a deliberately corrupted archive is detected and reported, not restored.
