# Milestone D — Backups you can trust

Part of the [master plan](../MASTER_PLAN.md). Status lives on the [status board](STATUS.md).

## Goal

Every family world is backed up every night, a copy lives somewhere other than the VPS, and a restore has actually been tested. The dashboard shows it as one line: "Last backup: today 4:00 ✓ · Copy off the server ✓ · Restore tested 3 days ago ✓".

## Today

Rules, records, the archive library and the nightly loop on the server helper are built and tested locally ([ADR 0045](../architecture/decisions/0045-node-backups.md)). The loop is not switched on for the VPS yet, so the new family world still has **no backup**. The original world has one manual encrypted archive on the owner's Mac.

## Steps

- **D1 — Nightly backup.** Durable backup policy and records *(built 2026-11-08: [ADR 0038](../architecture/decisions/0038-backup-records.md), [runbook](../development/backups.md))*. The node agent runs a consistent backup: `save-off` + `save-all flush` over the private channel, archive the world, plugins and config, `save-on`, hash and encrypt, store under a dedicated backup path. Retention per the existing rules; never deletes the newest verified copy. **Back up now** button. *(Built 2026-11-12: the helper takes the due nightly backup and "Back up now", verifies it and reports the hashes. Remaining: switch it on for the VPS, delete expired archives, the button itself (B2); encryption moves to D2.)*
- **D2 — Copy off the server.** Encrypted copy to a **free** destination (owner decision 4): a nightly pull to the owner's Mac over Tailscale, optionally plus a free-tier bucket later. Encryption key kept separately with a recovery copy.
- **D3 — Restore test.** Weekly automatic restore of the latest backup into a throwaway, network-isolated container; boots, checks the world loads, then is removed. Result shown on the dashboard.
- **D4 — Restore for real.** Adult-initiated restore with approval: stops the server, keeps the current world as a retained backup, restores, starts, shows the result. Never automatic.
- **Done when:** a week of nightly backups exist with hashes; an off-host copy decrypts and matches; an isolated restore boots; a deliberately corrupted archive is detected and reported, not restored.
