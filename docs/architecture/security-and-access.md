# Security, identity and authorization

Status: Chapter 01 identity controls are implemented as recorded in [ADR 0012](decisions/0012-identity-boundary.md) and the [identity review](../reviews/01-identity-and-rbac.md); remaining runtime/adapter controls are proposed requirements. These controls are part of Core, not paid features.

## Trust boundaries and assets

Protect account sessions, provider keys, organization data, world integrity, host filesystem, budget limits, user/child privacy, coding artifacts and audit integrity. Trust boundaries include browser/API, org/org, API/worker, control-plane/sandbox, worker/game server, provider endpoints, research internet content, and backup/key storage.

Threat actors include unauthenticated clients, malicious org members, child users attempting forbidden features, compromised agents/models, poisoned pages/repositories/chat, stolen worker tokens and external service failures. A malicious host administrator can inspect self-hosted data and processes; encrypted database fields do not protect against a fully compromised host.

## Authentication

- Local password login uses a vetted password hashing implementation, Argon2id (@node-rs/argon2 2.2.2; measured parameters in ADR 0012), with parameters measured on the reference host. Never invent cryptography or store plaintext/reversible passwords.
- Use opaque random server-side sessions with hashed stored tokens, secure/HttpOnly/SameSite cookies, explicit idle/absolute expiry and rotation after login/invitation acceptance, and immediate authorization-version invalidation after permission changes. TLS is required for shared/LAN production use; loopback HTTP is development only.
- Add CSRF token and Origin checks for cookie-authenticated writes; restrict CORS and WebSocket origins. Do not put session tokens in URLs or browser local storage.
- Rate-limit login/reset/invitation consumption and avoid account enumeration in responses. Password reset is single-use/expiring and revokes sessions.
- Offline self-hosted recovery uses an owner-only local administrative command; email delivery is optional and disabled until configured. Never expose reset tokens in normal logs or a public dev mailbox.
- Bootstrap owner creation is single-use and atomic with an installation-local setup token. Concurrent requests cannot claim multiple owners. Disable bootstrap afterward.
- Child accounts are created by an adult org admin, use an adult-managed local login, require no personal email, and have no public signup flow. Do not collect dates of birth merely to implement the role.
- OIDC/social login is later optional functionality and cannot remove local recovery. CLI authentication uses short-lived scoped credentials, stored in OS keychain where supported, with a secure permission-restricted file fallback.

## Permission vocabulary and proposed role matrix

`S` means only granted project/environment/owned resources; `A` means organization administration; `I` means explicit instance privilege. Blank is deny. Scope is checked in addition to permission. Child permissions cannot be broadened by assigning a second unrestricted role; account restrictions remain an upper bound.

| Permission | Instance Owner | Org Admin | Operator | Builder | Viewer | Child |
| --- | --- | --- | --- | --- | --- | --- |
| `instance:manage`, `organization:create` | I | | | | | |
| `user:invite`, `membership:manage`, `role:manage` | | A | | | | |
| `provider:manage`, `budget:manage`, `environment:admin` | | A | | | | |
| `mission:read`, `agent:read`, `event:read` | | A | S | S | S | S |
| `mission:create`, `mission:execute` | | A | S | delegated S | | |
| `preset:launch` | | A | S | delegated S | | assigned S |
| `template:write`, `group:manage`, `agent:assign` | | A | S | template only S | | |
| `preset:approve` | | A | | | | |
| `mission:pause`, `mission:cancel` | | A | S | delegated S | | assigned S |
| `stop:request` | I instance scope | A org scope | S | delegated S | | assigned Minecraft S |
| `stop:clear` | I instance scope | A org scope | delegated S | | | |
| `approval:decide`, `coding:execute`, `research:execute` | | delegated A | delegated S | delegated S | | |
| `audit:read` | I instance audit | A | delegated S | | | |
| `billing:read` | | Cloud only | | | | |

Instance Owner is an installation privilege, not an implicit membership in every org. Normal org data access requires membership or an explicit audited break-glass administrative path. Org Admin cannot grant instance ownership or modify instance policy. Org administrators may disable a membership in their own organization, not a global identity used by other organizations. Installation-level user disable is an explicitly privileged owner operation, with separate audit and recovery protections. Builder template edit does not grant template approval or execution.

## Authorization procedure

Authenticate → reject disabled/revoked principal → resolve current membership → load canonical resource → compare org/project/world → enforce explicit permission and resource grant → apply child/account restrictions → validate current policy/stop/approval/budget → transact.

For execution, persist a grant tied to initiating principal/membership, permitted resources/actions, policy version and template hash. Workers recheck current authority; a user disabled after queuing cannot keep creating effects. A scheduler service principal cannot amplify the initiating user's rights. Background maintenance uses a separate narrowly scoped identity, not “admin=true” in a job.

Return 404 for inaccessible foreign resources to reduce existence leaks, while logging the denial internally. Lists, counts, exports, error details, event replay and artifact paths must enforce the same boundary as direct GETs.

## Threat register

| Threat | Control | Required evidence |
| --- | --- | --- |
| Forged org/resource IDs | Membership-derived context, composite FKs, RLS and canonical reload | Cross-org HTTP/worker/storage/event tests |
| Queue tampering/replay | Worker binding, signed/authenticated transport as appropriate, payload validation, DB fence | Altered payload and stale attempt test |
| Prompt injection in page/chat/repo | Treat content as data, no ambient authority, schemas/allowlists, approval hashes | Adversarial fixtures never invoke forbidden tool |
| Secret leakage | Encrypted credential store, redaction, no prompt/browser/sandbox credentials | Canary secret absent from all outputs |
| Host takeover via coding | Separate restricted runner, no socket/host mount, egress/resource limits | Escape-oriented fixture and configuration review |
| SSRF/DNS rebinding | Canonical URL validation, resolved-IP checks, redirect checks, egress proxy | Private/IPv6/metadata/redirect fixtures |
| Self-approval or changed patch | Independent approver; action+target+patch+policy digest; expiry | TOCTOU mutation invalidates approval |
| Stop ignored in partition | Latched durable stop, short leases, local watchdog, disconnect/kill | Network partition then no effects by deadline |
| Child privilege escalation | Adult onboarding, account ceiling, preset allowlist, scoped stop | Alternate routes/API/CLI/WS denial suite |
| Cost runaway | Atomic reservations, zero-price eligibility, bounded retries/loops | Concurrent budget and hidden fallback tests |
| Supply chain compromise | Lockfile, pinned images/actions, license/SBOM and vulnerability review | Release manifest and review evidence |
| Backup theft or lost key | Encrypted backups, separate protected key recovery, restore drills | Authorized restore and missing-key failure |

Docker daemon access is highly privileged. Rootless Docker reduces some host exposure but does not by itself establish a hostile multi-tenant code boundary. Do not mount its socket in the API, dashboard or general task runner. [Docker security](https://docs.docker.com/engine/security/), [rootless mode](https://docs.docker.com/engine/security/rootless/).

## Child and Minecraft restrictions

Only approved private worlds, adult-approved immutable presets and bounded parameters. No arbitrary model chat, player attacks, arbitrary game chat commands, terminal, code/research adapter, external URLs, provider/budget settings or secret-bearing logs. Strip untrusted player/server chat from instructions. No raw chat streaming to child UI by default. Map positions and player names are private world data.

World edits are restricted to approved build/mining regions and material/action allowlists. Guard role targets hostile mobs only and remains bounded by server/preset policy. Adult changes to a preset invalidate the previous approval until reapproved.

## Approvals and auditing

Approvals are capabilities for an exact action, not a blanket “yes.” Include action type, target, template/patch hash, resource scope, requester, approver, policy version, expiration and one-time consumption. Destructive actions, external deployment and high-risk code operations require appropriate adult permission and separate approval. General chat text never counts as an internal runtime approval record.

Audit sensitive changes in the same transaction as the change. Include actor/service identity, request/correlation ID, scope, result, reason and redacted diff. App role cannot update/delete audit rows. This is access-controlled history, not a claim of tamper-proof storage against DB owners. Define a later append-only external export if stronger tamper evidence is required.

## Release security gate

Complete tenant tests, child escape tests, secret scanning, dependency/image vulnerability triage, sandbox review, restore/key exercise and stop partition tests. Resolve exploitable critical/high issues before public release or record a narrowly scoped exception approved by the project owner. Choose disclosure contact and maintainers before publishing `SECURITY.md`; do not invent a monitored address.

## Chapter 01 audit limits

Identity changes commit actor/action/target/outcome and allowlisted change identifiers atomically. Denials are stored in restricted instance audit without guessed IDs or raw URLs; the organization endpoint exposes recent scoped events only. Request/correlation propagation, instance-audit UI/export and retention jobs are deferred to the event/operations chapters. This is a recorded implementation limit, not a claim that the full future audit contract exists.

## Unified family and node boundaries

[Threat model](../security/THREAT_MODEL.md), [deployment gates](../security/DEPLOYMENT_CHECKLIST.md) and [management permissions](minecraft-management.md) extend these controls. Remote privileged access requires MFA, HTTPS/private entry on all management paths and blocked origin bypass; local recovery remains self-hosted. Children cannot provision/decommission, modify access, use backup administration, restore, change world/network/security settings, moderate players, manage credentials or control server lifecycle even with extra roles. Bot Stop All never implies game-server stop. New adult-scoped templates cannot broaden these account ceilings.

Adoption is read-only in place; approved live writes require verified recovery and rollback. Only an isolated control adapter holds private RCON and fixed typed actions. Docker-capable node/broker is host-privileged, separately enrolled and credentialed, with outbound mTLS/signed expiring jobs/local target policy. It is never a general simulation worker. No API/web/MCP/bot socket or node-management public listener. Existing independent-adult exact-approval semantics remain; machine callers and requesters cannot self-approve. Recovery/unavailable-second-adult limitations are surfaced, not bypassed.
