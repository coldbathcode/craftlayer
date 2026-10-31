# ADR 0012 — Identity-service privileges and authentication boundary

Status: adopted for Chapter 01, 2026-10-31.

Use a dedicated `craftlayer_identity` PostgreSQL login, with no ownership, DDL, superuser or BYPASSRLS privilege. It can access the named global identity/session tables and tenant-scoped identity administration tables. The normal runtime role cannot read password hashes, sessions or reset tokens. The API composition root constructs an auth service whose private pool is never exposed to routes. Worker and web do not receive this credential.

Identity is global; org membership is separate. Organization tables retain forced RLS. A narrow identity-only SELECT policy discovers the authenticated user's memberships; normal tenant reads/writes still require transaction-local organization context. The service validates sessions and current membership before setting this context. This is defense in depth against mistakes, not protection against a fully compromised auth service.

A one-shot owner provisioner creates the new role on existing installations before migrations. Only that temporary container receives the admin DB URL. Fresh installations initialize it directly. Existing passwords are preserved; missing `.env` keys are generated locally, not committed.

Use immutable built-in permission templates, tenant-aware role/grant foreign keys, column-restricted identity updates and append-only audit grants. Instance ownership is separate from Org Admin; a DB trigger protects the last active owner and rejects child owners. Account-type changes are not granted to the identity role.

Authentication uses opaque hashed session tokens, bounded expiry, same-origin/CSRF checks and current-authority checks. Hash-library/transport choices and measured parameters are recorded with CL-01-02. Optional SMTP is disabled unless explicitly configured; tests use local fakes. No hosted identity or public registration dependency.

Alternatives: runtime-wide identity table access makes accidental leaks easier; a DB administrator/bypass connection in API handlers violates the privilege boundary; many SECURITY DEFINER CRUD functions add unnecessary dynamic privilege complexity. A dedicated restricted service role and private repository keep the boundary explicit and testable.

CL-01-02 uses `@node-rs/argon2` 2.2.2 with Argon2id, 19,456 KiB, two iterations, one lane and 32-byte output. A local synthetic sample measured 9 ms each for hash and verify; this is not a portable performance guarantee. At most two password jobs run concurrently per process, and persistent login/IP buckets bound attempts. The library handles random salts. [Library source](https://github.com/napi-rs/node-rs/tree/main/packages/argon2), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Session tokens have 256 bits of randomness and are stored as SHA-256 digests. Idle expiry is 30 minutes; absolute expiry is 12 hours. CSRF tokens are keyed to the session bearer and the local CSRF secret. All cookie mutations require exact configured Origin; public login/setup/reset flows use Origin without requiring an expired session's CSRF token. Cookies are HttpOnly, SameSite=Strict, path=/, and Secure on HTTPS. Plain HTTP is allowed only for loopback configuration; shared-host access requires TLS. [Fastify cookie](https://github.com/fastify/fastify-cookie).
