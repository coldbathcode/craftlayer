# Core and Cloud service boundary

Status: design baseline only. Chapters 10/11 must refine/review it. No Cloud implementation belongs in this repository.

## Ownership

| Concern | Core | Cloud |
| --- | --- | --- |
| Runtime/DAG/providers/adapters/API | Public versioned packages/interfaces | Consume supported versions |
| Identity | Local accounts, orgs, roles and recovery | Tenant-aware identity integration, optional OIDC/social |
| Billing and plan subscriptions | No required billing/entitlement | Hosting/management subscriptions and service lifecycle |
| Credentials | Operator/org scoped encryption and references | Tenant-isolated keys, access controls and managed rotation |
| Deployment | User-owned Compose/private host | Managed tenant control/data planes and hosted runners |
| Telemetry | Off by default, no required phone-home | Operational metrics with stated tenant/privacy policy |
| Backup/upgrade | Documented operator tools | Managed schedules, tested restore, rollout controls |
| Hybrid runner | Optional public runner protocol/client | Optional authenticated outbound orchestration |

Core can create users, route local/authorized models, run examples, inspect events, stop, back up and upgrade without Cloud DNS/account/API. Commercial code cannot be imported by Core packages. Shared features flow through public versions; avoid a private fork that becomes the only functional runtime.

## Cloud tenant model

A commercial tenant/account may own one or more Core organizations; specify mapping explicitly and never assume an email domain proves tenancy. Every request, queue dispatch, stream, artifact, credential and metering event carries validated tenant binding. Choose deployment/isolation tiers using threat model and measured costs; application-level IDs alone are not sufficient for hostile code isolation.

Tenant lifecycle: requested → provisioning → active → suspended/draining → closing → deleted, with failed/reconciling states. Subscription state is related but distinct; a delayed payment webhook must not instantly erase active data. Define drain/read-only/export/grace policies and audit privileged support access.

## Hosting metering and payments

Meter measured agent runtime, provisioned resources, storage and other explicitly priced hosting units. Separate provider token observations from billable hosting usage. Meter events contain tenant, source, quantity/unit, interval, deduplication key and version. Immutable corrections/reconciliation handle retries and late events.

Subscription integration validates webhook signature/timestamp, deduplicates event IDs, handles out-of-order transitions and reconciles against authoritative processor state. All implementation tests use test mode. Plan prices are TBD until cost measurements and business review. Do not create real charges or activate public checkout as a side effect of a technical build.

BYOK means the customer supplies provider credentials; it does not automatically eliminate third-party service fees or obligations. Platform-billed inference/token resale is a separate future project requiring provider-specific terms, payment/abuse/refund accounting and appropriate commercial review. No assumption of permission or compliance is made here.

## Hybrid runner protocol requirements

- Adult/tenant admin initiates enrollment using one-time, short-lived bootstrap capability bound to tenant and runner identity.
- Exchange for mutually authenticated, rotating credentials and outbound connection. No inbound host administration port.
- Runner advertises protocol/capabilities and accepts only tenant-bound signed/authenticated commands with sequence, expiry, scope and stop epoch.
- Cloud requests cannot exceed local operator policy, expose local keys, mount host directories arbitrarily or clear a local stop latch.
- Lease/watchdog bounds effects during partition. Reconnect revokes stale sessions, deduplicates commands, reconciles effects and does not auto-resume stopped missions.
- Credential revoke/compromise and ownership transfer have explicit recovery. Cloud disconnect must leave standalone local operation available.

## Go/no-go for Chapter 11

Core chapter/release evidence accepted; separate repo and environments authorized; identity/tenant/worker isolation reviewed; key management/recovery tested in design; measured cost model; subscription/usage contract; provider/commercial questions triaged; privacy/retention/support responsibility assigned; optional hybrid scope explicit. These are design gates, not permission to spend money or launch publicly.
