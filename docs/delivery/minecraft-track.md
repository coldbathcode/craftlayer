# Minecraft server management implementation track

Status: F0 local implementation authorized by the user after REC-01; CL-F0-01 verified, CL-F0-02 next. F1–F3 remain separately gated. [Gap analysis](unified-reconciliation.md) explains reuse and conflicts; [roadmap](roadmap.md) retains original chapters. Each phase needs separate authorization/review; production access and changes need separate operator authorization. No Contabo checks have been executed.

## Sequence and milestones

| Order | Phase / dependency | Deliverable / milestone |
| --- | --- | --- |
| 0 | Preserve 00–02 and CL-03-01–06; CL-03-07 is still authorized | Finish existing runtime qualification separately; no new agent scope and no rebuild |
| 1 | [F0](../chapters/F0-preflight.md); foundation/identity evidence | Redacted local preflight, preservation/recovery baseline and proposed remediation; production inspection only after permission |
| 2 | [F1](../chapters/F1-control-plane.md); F0 local proof + 00–01 | Earliest observation dashboard: read-only adoption/status/players/audit, no LLM or node/Docker prerequisite |
| 3 | [F2](../chapters/F2-family-access.md); F1 | Earliest family-ready access/backup dashboard, pinned real Java/Bedrock tests and isolated restore required; lifecycle visibly unavailable |
| 4 | [F2.5](../chapters/F2.5-docker-provisioning.md); F2 | Secure node enrollment, Family Survival plan/provision/rollback, REST/UI and secured MCP subset; no VPS purchase |
| 5 | [F3](../chapters/F3-server-operations.md); F2.5 | Full initial management scope: approved adopted-server start/stop/restart, metrics/logs, update/decommission and multi-server parity |
| 6 | Original CL-04 → 05 → 06 → 07 → 08 → 09 | Bots/cooperation, Kid Mode and broader Core; reuse F fixtures/UI/backup/control services, preserve mission contracts |
| 7 | Chapters 10–11 | Optional design then separately authorized Cloud repository; never a Core dependency |

F1 can be implemented and tested with captured synthetic inventory while live inspection waits. F2 can be tested on disposable worlds while live write permission waits. Neither may claim Contabo adoption or family readiness until corresponding real gates pass. F-track tasks are not Chapter 04 authorization. Review each F phase with the existing chapter-review template; carry risk, acceptance and handoff evidence forward.

## Task index

Each task's implementation and evidence are specified in its phase chapter. States below describe implementation, not planning completion. This index is the canonical F-track backlog; the original 84 IDs remain in [backlog](backlog.md).

| Task | Work item | Dependency | State |
| --- | --- | --- | --- |
| [CL-F0-01](../chapters/F0-preflight.md) | Fixture-driven redacted read-only preflight | F0 authorized; 00–01 evidence | Verified locally |
| [CL-F0-02](../chapters/F0-preflight.md) | Preservation manifest, backup/restore rehearsal and remediation plan | CL-F0-01; live inspection only separately approved | Not started |
| [CL-F1-01](../chapters/F1-control-plane.md) | Server/operation contracts, scope schema and management permissions | F0 local gate; 00–01 | Not started |
| [CL-F1-02](../chapters/F1-control-plane.md) | In-place adoption, observation adapter and REST/SDK | CL-F1-01 | Not started |
| [CL-F1-03](../chapters/F1-control-plane.md) | Parent observation dashboard, private access and review | CL-F1-02 | Not started |
| [CL-F2-01](../chapters/F2-family-access.md) | Pinned Java/Bedrock identity verification and enrollment | F1 gate | Not started |
| [CL-F2-02](../chapters/F2-family-access.md) | Desired/actual allowlist operations, revoke/expiry and UI | CL-F2-01 | Not started |
| [CL-F2-03](../chapters/F2-family-access.md) | Consistent scheduled backups, off-host policy and isolated restore | CL-F2-02 | Not started |
| [CL-F2-04](../chapters/F2-family-access.md) | Family acceptance, security/recovery review and handoff | CL-F2-03 | Not started |
| [CL-F25-01](../chapters/F2.5-docker-provisioning.md) | One-use node enrollment, outbound mTLS and signed commands | F2 gate | Not started |
| [CL-F25-02](../chapters/F2.5-docker-provisioning.md) | Constrained broker, template plan, quotas/port reservations | CL-F25-01 | Not started |
| [CL-F25-03](../chapters/F2.5-docker-provisioning.md) | Durable provision, readiness, crash reconciliation and rollback | CL-F25-02 | Not started |
| [CL-F25-04](../chapters/F2.5-docker-provisioning.md) | Creation wizard, REST and secured MCP subset | CL-F25-03 | Not started |
| [CL-F25-05](../chapters/F2.5-docker-provisioning.md) | Disposable-host acceptance and provisioning review | CL-F25-04 | Not started |
| [CL-F3-01](../chapters/F3-server-operations.md) | Adopted lifecycle approvals, multi-server metrics/logs | F2.5 gate | Not started |
| [CL-F3-02](../chapters/F3-server-operations.md) | Staged updates, retained decommission, API/MCP parity and review | CL-F3-01 | Not started |

## First coding task ready to execute after approval

CL-F0-01 creates `scripts/preflight.sh` as a read-only entry point with deterministic parser/redaction fixtures. No SSH automation, secrets in output, remote targets or mutations by default. Inspect Docker availability/state, IDs/mounts/networks/published ports, game/plugin/auth/allowlist metadata, storage/backup age and effective firewall evidence with bounded allowlisted reads. Never emit full `docker inspect`, Compose render, plugin configs or environment. Missing privileges/dependencies produce `unknown`/non-ready evidence rather than repairs or assumed passes.

Tests must prove zero write/start/stop/exec/firewall/prune/restore calls against a recording fake command runner; canaries redacted even in malformed input/errors; stopped-server state preserved; unrelated-container metadata excluded; missing tools/privileges explicit. Produce a timestamped schema-versioned sanitized report and manual review instructions. Run only on local fixtures/disposable resources until production read access is explicitly authorized. This task does not implement F1 or authorize a new skeleton.

The already authorized next task remains CL-03-07: review dirty runtime changes, complete isolated restart/Redis-loss/fault evidence, then Chapter 03 review/handoff. REC-01 does not execute that coding task.
