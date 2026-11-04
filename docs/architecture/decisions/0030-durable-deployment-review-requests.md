# ADR 0030 — Durable deployment review requests

Status: adopted for authorized local CL-F25-03 checkpoint J, 2026-11-04. Metadata foundation for independent review; no execution or production authorization.

## Decision

Add private `DeploymentAdmissions.requestApproval` and `approvalRequest` methods. Request input contains only an existing immutable deployment intent ID and a UUID idempotency key. Derive all review data from the canonical allocated reservation: organization/project/environment/node, deployment/server/world IDs, plan/template/policy hashes, node and credential versions, reservation version, name and fixed resource/port requirements. Never accept caller approval, qualification, grant, command, image or host-path assertions.

Request creation requires current adult membership, project `node:deploy`, canonical Minecraft environment `server:provision`, the original intent actor/session, an unchanged active node/credential and no applicable emergency stop. Issue the original node/provision grants before opening the metadata transaction, then validate both in one identity transaction to obtain the actual bounded authority expiry without nested pool leases. Retain the sealed grants privately for later original-authority revalidation. Bind the review digest to a versioned purpose, request/intent/organization, original actor/session, sealed-grant digest, exact snapshot, stop-state digest and expiry. The digest identifies review material; it is not a signed grant or approval capability.

Persist one immutable `awaiting_review`, execution-disabled row per intent in SQL 0026, with atomic audit and reference-only outbox. Existing scoped transaction locks serialize races. Lifetime is at most five minutes, bounded by current original session authority and node credential expiry. Same-key replay rechecks current scope/binding/stop and returns the original record, including its expired projection; it never renews the deadline. A different key conflicts. Explicit future request generations/renewal are not implemented.

SQL composite tenant FKs and an insert guard compare the entire JSON review against canonical reservation fields and original intent actor/session, and bind both sealed grants to the exact actor/session/permission/resource scope. Already-issued commands cannot gain a retrospective request. Forced RLS, SELECT/INSERT-only runtime grants and immutable triggers deny promotion, editing and deletion. Scope/time indexing supports future bounded review listing without scanning other tenants. Public projections omit actor/session identifiers, stop digest, grants and keys, and always report unverified qualification and disabled execution. Historical scoped reads do not assert current requester authority or current readiness.

## Sequencing and limits

This request begins after an allocated intent exists. It does not implement or replace the independent approval already required by reservation dispatch admission; test allocations still use explicit fake admission. The request also does not satisfy `DeploymentJobs` qualification: a missing qualifier continues to deny, even after a review request exists. No HTTP/SDK/MCP/UI route, decision, revocation, worker consumer or installed command path is added here.

Next implement independent adult decisions bound to this exact snapshot and current original/reviewer authority, explicit rejection/revocation and evidence validation. Before effects, composition must revalidate those records and actual host/storage/image/game/identity/recovery qualification. A boolean test qualifier must never become production policy. Future decisions must also reject already-issued/stale/expired requests and cannot renew an existing physical job or release uncertain resources.

## Evidence and rollback

Contract and real disposable database tests cover strict request/projection fields, concurrent replay/reopen, exact digest/resource binding, no command/authority issuance, current adult/session/tenant denial, expiry/no renewal, stop epoch changes, node revocation, default qualification denial, retrospective request refusal, immutable SQL material and foreign outbox references. Exact executed results are in the build log; real game/host/approval execution remains unverified.

SQL 0026 is additive. An application rollback may retain the new rows/index/schema and all allocation/history; older code ignores requests. Do not drop history, rewind stop/credential versions, release allocations or reset worlds/journals to retry. Production migration/deployment remains separately authorized.
