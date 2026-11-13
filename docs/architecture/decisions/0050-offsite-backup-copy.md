# ADR 0050 — Off-server backup copy: encrypted on the host to the owner's key, pulled and proven on the owner's machine

Status: adopted for master plan step D2 on 2026-11-13 (owner decision 4: the copy must be free; owner approval to create the key and the nightly job on the owner's Mac). Built and verified locally with the real `age` program. Deployment state is on the [status board](../../plan/STATUS.md).

## Context

Backups sat only on the VPS that runs the world ([ADR 0045](0045-node-backups.md)): losing the machine or the account loses both. Archives also contain plugin secrets, so they cannot be copied anywhere in the clear. The owner's Mac is already on the same private Tailscale network and costs nothing.

## Decision

1. **Public-key encryption, private key off the host.** The helper's private configuration may name an `offsite_recipient`, an [age](https://age-encryption.org) public key. After a backup has passed its read-back, the helper writes `<occurrence>.tar.gz.age` beside it by running the `age` program with fixed arguments and no shell. The matching private key is generated on the owner's machine and never comes near the VPS, so nothing on the VPS can read the copies.
2. **Preparing the copy never fails the backup.** If encryption does not finish, no partial file is left, the helper logs a code, and the verified local backup is reported as usual.
3. **The owner's machine pulls; the VPS never pushes.** `scripts/offsite/pull-backups.mjs` runs on the owner's machine (a daily launchd job), lists the archive folder over SSH on the tailnet with fixed commands, and fetches each encrypted archive and manifest it does not already hold. The VPS holds no credential for the owner's machine.
4. **A copy counts only when proven.** Each fetched archive is decrypted in memory (never to disk) with the local key and must hash to exactly the `archive_sha256` and size its manifest records, for the occurrence its file name claims. Only then are the files kept and a `verified.json` written beside them. Anything else is deleted and fetched again next time. The newest 30 proven copies are kept.
5. **Expiry on the host includes the encrypted file** ([ADR 0049](0049-backup-archive-expiry.md)). Copies on the owner's machine have their own count and are not affected by expiry on the host.

## Consequences

- The plain archive still sits on the VPS for local restores, protected only by file permissions as before.
- **The dashboard does not yet know about the copy.** "Copy kept elsewhere" stays "not set up" until a later step carries the proof back to the controller; today the evidence is the `verified.json` files and `status.json` on the owner's machine.
- The Mac must be awake and on Tailscale for a pull; a missed day is caught up on the next run. Nothing warns the owner yet if pulls stop.
- Losing the private key makes every copy unreadable. The owner keeps a recovery copy of the key outside the Mac.
- A VPS that is fully taken over can still serve a bad manifest with a matching bad archive; this step proves faithful transfer and readability, not the honesty of the host. The hash is the one the controller recorded, so a later step can compare it.
- `age` in the helper image comes from the pinned base image's Debian package rather than a pinned release of its own.
