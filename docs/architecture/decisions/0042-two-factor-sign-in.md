# ADR 0042 — Two-factor sign-in for adults

Status: adopted for master plan step A1, 2026-11-08. Built with database and unit evidence; the remote deployment that makes it mandatory (A1 on the VPS) follows.

## Context

The dashboard has only ever been reachable from the owner's machine. Milestone A hosts it on the VPS behind Tailscale, so an adult's password alone is no longer enough: the architecture and the deployment checklist both require MFA on every privileged path before remote access.

## Decision

1. **Standard TOTP, no dependency.** RFC 6238 time-based codes (SHA-1, six digits, thirty-second steps), implemented in `packages/auth/src/totp.ts` and checked against the RFC's own test vectors, so any authenticator app works. Codes are accepted for the current step and one step either side; an accepted step is recorded and nothing at or before it is accepted again, so a code cannot be replayed within its window.
2. **Pending sessions.** Signing in with a password creates a session that is `mfa_pending` when the adult has a confirmed authenticator (or when the instance requires MFA and they have none). A pending session can only read its own state, sign out, and set up, confirm or verify two-factor; every other call fails with `MFA_REQUIRED`. The client is told `verify`, `enroll` or `none` at sign-in.
3. **Secrets are sealed, recovery codes are hashed.** The TOTP secret is encrypted with AES-256-GCM under a key derived (HKDF, purpose-bound) from the installation's identity secret and stored in `user_totp`; it is shown once at setup as base32 and as an `otpauth://` URI. Eight single-use recovery codes are generated at confirmation, shown once, and stored only as SHA-256 hashes. A confirmed secret cannot be changed in place; turning two-factor off requires a current code and deletes the secret and codes.
4. **Required mode for remote deployments.** `CRAFTLAYER_REQUIRE_MFA=true` makes every adult sign-in pending until an authenticator is enrolled and confirmed; confirming completes the sign-in. Children are not subject to it (they cannot manage anything), and agent tokens are unaffected (they are not sessions).
5. **Rate limits and audit.** Confirm, verify and disable are rate-limited per source like login. Every attempt is audited (`auth.mfa_setup_started`, `auth.mfa_enabled`, `auth.mfa_verified`, `auth.mfa_recovery_used`, `auth.mfa_disabled`, with denied outcomes for failed codes).

## Consequences

- The VPS deployment sets `CRAFTLAYER_REQUIRE_MFA=true`; local development leaves it off and two-factor stays optional. The server-management routes, previously refused for any non-loopback public URL, now accept a deployment whose public URL is HTTPS **and** which requires MFA; the API entry point attests that combination and nothing else can enable it.
- Losing both the authenticator and the recovery codes needs the owner's local recovery path (`pnpm cli owner …` on the host), which remains self-hosted and offline.
- A dedicated identity encryption secret can replace the derived key later without changing the schema; it would require re-enrolment or a re-seal migration.
