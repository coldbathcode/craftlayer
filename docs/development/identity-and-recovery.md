# Local identity and administrator runbook

Chapter 01 implements local accounts, scoped authorization and account administration. Agent execution, provider keys, Minecraft connections and the complete Kid Mode experience remain later work. Core requires no hosted identity or email service.

## First owner

1. Run `pnpm install --frozen-lockfile`, `pnpm setup:local`, then `pnpm stack:up` from the repository. Setup preserves existing `.env` values and adds missing credentials with mode 0600. Preserve that file and the existing volumes.
2. Open `http://127.0.0.1:3000/account` (or the configured loopback port).
3. In a private host terminal run `pnpm cli owner bootstrap-token`. This explicitly prints the local setup secret; do not paste it into chat, tickets, Git or screenshots.
4. Enter the token, owner login and a 12–128 character password. Email is optional. Setup creates one owner, an organization and its adult Org Admin membership atomically. Concurrent or repeated setup cannot create another owner.
5. Keep the recovery configuration private and backed up separately. Do not rotate local secrets casually: recovery initialization checks the stored credential hash, and pending recovery mail depends on the CSRF-derived encryption key.

The development installation is intentionally left unclaimed by implementation tests. All browser bootstrap fixtures use separate disposable Compose projects and credentials.

## People, roles and world assignments

Use the organization selector to choose an active membership. Selection is a context hint; the server validates membership and current permissions on every operation. Instance Owner is distinct from organization administration. Only an owner can create an organization or disable an identity globally; Org Admin manages members in its own organization.

Create a project and environment metadata before child onboarding. Adding metadata does not start a Minecraft server or agent. Create a child with a local login, password and an assigned Minecraft world. No child email or date of birth is collected. Additional worlds require explicit child-safe scoped grants. A child cannot receive coding/research access or administrative permissions, even if extra roles are inserted into a fixture database.

Invite an adult with an approved role. The one-time link is displayed immediately after creation; copy it privately before refreshing. It expires after 24 hours and can create an adult account or join an existing authenticated adult. The bearer is in the browser fragment, removed from history on entry; the API receives it in a POST body. Revocation is available through `DELETE /api/v1/invitations/:id`; list invitations without exposing bearer hashes. No invitation email is sent automatically.

Viewer, Builder and Operator permissions do not implicitly grant every project/world. Assign resource grants explicitly; Builder delegation is separately checked. The minimal account UI can assign/revoke grants, change adult roles, suspend/restore memberships, disable/restore identities as owner, reset child passwords, review recent organization audit and revoke own sessions. Custom roles are available through the API. The server enforces last active owner and adult Org Admin safeguards.

## Sessions and revocation

Sessions expire after 30 minutes idle or 12 hours absolute. Cookies are HttpOnly and SameSite Strict; HTTPS adds Secure. Exact configured Origin is mandatory on mutations, with a session-bound `X-CSRF-Token` for authenticated mutations. Public setup/login/reset requests require Origin without an expired session's CSRF value. Existing-account invitation acceptance also requires CSRF.

`GET /api/v1/auth/me` returns the caller's public identity, active organizations, current session ID and CSRF value. Keep these in transient memory. The browser client does not persist credentials or tenant data in local storage. `GET /auth/sessions` and `DELETE /auth/sessions/:id` operate only on the caller's sessions.

Role/grant/membership changes increment authorization versions. Global disable and password recovery invalidate sessions. Internal signed execution grants bind user, membership, versions, exact resource, expiry and originating session; revalidation rejects stale grants. Later worker code must call that boundary before effects. There is no running agent engine in Chapter 01.

The UI refreshes authority after mutations and on “Refresh access”; an already displayed snapshot is not a permission grant. REST authorization takes effect immediately after the revocation transaction commits. Live UI subscriptions are later work.

## Recovery without email

On the trusted host run `pnpm cli owner reset-password <login>`. Type the new password at the hidden prompt, or provide one line on stdin from a trusted secret source. Never put a password in command arguments. The tool requires only the restricted identity URL and protected bootstrap/recovery/CSRF settings, not Redis or the normal runtime database URL. It changes the password, invalidates reset tokens and revokes existing sessions. A disabled account stays disabled and must be restored separately by an authorized owner.

An adult with membership-management permission can reset a child's password from the account UI. The child must sign in again. This operation cannot reset another adult's password. Adults use optional email recovery or local owner recovery.

## Optional SMTP recovery

Default Compose has no SMTP configuration or API internet egress. To enable mail deliberately, add `CRAFTLAYER_SMTP_URL=smtps://.../` and `CRAFTLAYER_SMTP_FROM` to protected local configuration, then use `docker compose -f docker-compose.yml -f infra/compose/smtp.yml up -d --build --wait`. Configure the exact public HTTPS origin for a shared installation; plain HTTP is allowed only on loopback. Reverse proxy/TLS deployment qualification belongs to Chapter 09.

Verified TLS is required. SMTP URL query options and file/URL attachment access are rejected. Requests return a generic response for known, unknown, child and disabled accounts. Eligible adult reset links expire in 30 minutes and are single use. The database stores token hashes; the mail outbox encrypts its short-lived token payload with row-bound AES-GCM. Delivery uses leases, batches of five, three attempts and five-minute retry spacing. An uncertain SMTP acknowledgement can duplicate mail; consuming the reset remains single use. Expired/consumed payloads are pruned in bounded batches.

Actual SMTP delivery has not been exercised; automated tests inject local delivery fakes. Pending-mail key rotation, audit retention/purge and coordinated restore qualification remain Chapter 09. Do not claim delivery from a successful reset request.

## API contracts and evidence

`GET /api/v1/openapi.json` exposes implemented routes. Shared strict Zod response contracts live in `packages/contracts/src/identity.ts`; the browser SDK validates those same projections, confines credentials to same-origin API paths and refuses redirects. Request schemas live with explicit Fastify routes. No generic credential GET or owner-recovery HTTP endpoint exists.

Organization lists expose only authenticated active memberships. Membership/role/grant/invitation/audit lists are permission scoped and bounded to 100 rows without global totals. Cursor pagination and full administrative search are deferred; this interface is for the small local installation. Successful changes audit in their transaction. Denials audit separately to the restricted instance log, with generic action names and no guessed IDs, tokens or raw URLs. Organization audit cannot reveal another organization's denials. Audit details use an allowlist of nonsecret identifiers and permission/status changes.

Run `pnpm check`, `pnpm build`, `pnpm test:db`, `pnpm test:e2e`, `pnpm test:identity-ui` and `pnpm test:offline`. The identity browser command provisions and removes its own random-port installation, including test volumes. Never run its fixtures against a personal installation. See the chapter review for exact executed results and remaining limitations.
