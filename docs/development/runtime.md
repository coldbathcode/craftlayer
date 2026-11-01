# Simulation runtime and fleet operations

Chapter 03 is in progress. CL-03-01–02 implement bounded domain persistence and authenticated fleet/template/mission commands. Scheduler, workers, stop controls and streaming are subsequent checkpoints; a queued mission does not yet execute in this checkpoint. No Minecraft connection, coding runner, external tool or live inference is implied. [ADR 0014](../architecture/decisions/0014-runtime-authority-and-recovery.md) defines the trust boundary.

Use a dedicated `simulation` environment created through the authenticated environment API with `{projectId,name,type:"simulation"}`. The existing account console can create projects; simulation setup is currently an API/CLI workflow, not the Minecraft world UI. Adults need explicit environment-scoped permissions or organization administration. Child access remains limited to assigned Minecraft worlds and cannot enter simulation.

## Command and authority model

The API derives membership from the current session and loads canonical resource scope. Every runtime list requires an explicit `environment_id`; an organization header alone is insufficient. Templates and groups are environment scoped and immutable after creation. Revising a template creates another immutable ID/version in its family. A mission snapshots its graph and hash; a later template version cannot alter an existing mission.

The JSON graph has schema version 1, 1–50 uniquely named task nodes, explicit dependency keys and required/optional outcomes. Cycles, duplicate/missing edges, unknown kinds/fields, more than three attempts or actions over ten seconds reject. Only reviewed `fixture.echo`, `fixture.wait`, `fixture.fail`, `fixture.model` and `fixture.approval` definitions are accepted. Their later execution must still pass worker authority/budget/stop/receipt checks. A model cannot supply an arbitrary tool, credential or endpoint.

Current routes under `/api/v1`:

| Route | Behavior |
| --- | --- |
| `GET, POST /agents` | Scoped list/create simulation agents; assignment requires `agent:assign` |
| `PUT /agents/:id/status` | Versioned enable/disable; refuses active or uncertain assignments |
| `GET, POST /groups` | Same-environment group of 1–4 distinct agents; creation needs `group:manage` |
| `GET, POST /mission-templates` | Scoped immutable graph versions; writing needs `template:write` |
| `GET, POST /missions` | Bounded scoped list or create a snapshotted draft; creation needs `mission:create` |
| `GET /missions/:id` | Scoped redacted state/task projection; `mission:read` |
| `POST /missions/:id/execute` | Current `mission:execute`, expected version and UUID idempotency key; stores a signed current-user execution grant |

All cookie mutations require exact Origin and session CSRF. Creation/execution of missions also require a UUID `Idempotency-Key`. Same actor/route/key/body replays the original response; changing the body conflicts. A replayed response is an original snapshot, so GET the mission for latest state. Idempotency never overrides current permission. Terminal missions cannot restart in place. Signed grants/cookies/provider keys never enter mission projections or queue messages.

## CLI

Use the trusted loopback/HTTPS origin and supply passwords through hidden input or stdin, never argv:

```bash
pnpm cli login http://127.0.0.1:3000 your-login
pnpm cli fleet agents ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm cli template list ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm cli mission list ORGANIZATION_UUID ENVIRONMENT_UUID
pnpm cli mission get ORGANIZATION_UUID MISSION_UUID
pnpm cli logout
```

The CLI calls the same API with the same contracts/permissions. It stores an opaque session cookie and CSRF token in mode-0600 `~/.config/craftlayer/session.json`, under a mode-0700 directory. The file must belong to the current non-root operator; symlinked, oversized or unsafe files deny. OS keychain integration/Windows qualification remains later release work. `CRAFTLAYER_CLI_SESSION_FILE` overrides the path for disposable tests. Never commit or print session contents.

Create resources using protected JSON input files you control:

```bash
pnpm cli fleet create-agent ORGANIZATION_UUID agent.json
pnpm cli fleet create-group ORGANIZATION_UUID group.json
pnpm cli template create ORGANIZATION_UUID template.json
pnpm cli mission create ORGANIZATION_UUID mission.json IDEMPOTENCY_UUID
pnpm cli mission execute ORGANIZATION_UUID MISSION_UUID EXPECTED_VERSION IDEMPOTENCY_UUID
```

`agent.json` contains `environment_id`, `name` and `adapter:"simulation"`. `group.json` contains `environment_id`, `name`, `agent_ids`. `mission.json` contains `group_id`, `template_id`, `name`. Template input:

```json
{
  "environment_id": "REPLACE_WITH_SIMULATION_UUID",
  "name": "Observe and verify",
  "adapter": "simulation",
  "graph": {
    "schema_version": 1,
    "nodes": [
      {"key":"observe","action":{"kind":"fixture.echo","value":"observed"}},
      {"key":"verify","dependencies":[{"key":"observe"}],"action":{"kind":"fixture.echo","value":"verified"}}
    ]
  }
}
```

Replace the illustrative environment string with a real UUID. Defaults are required nodes/edges, three attempts and five-second action deadlines. Add `supersedes` with an existing same-environment template ID to create a new family version. The API rejects an invalid graph before persistence.

A successful CLI login prints only authentication status. Other commands emit authorized JSON resource projections or sanitized errors with nonzero exit codes. Logout revokes the session and therefore any queued grant tied to it; worker execution must revalidate, not trust the original submit response. Child/viewer denials are enforced by the API regardless of CLI arguments.

## Evidence and next implementation

`pnpm check` and `pnpm test:db` exercise graph/state bounds, immutable/same-mission SQL constraints, concurrent idempotency, current authority, tenant/environment isolation, native HTTP CLI login/get/execute/logout, revoked execution grants and viewer CLI denial. Tests use disposable databases and their own HTTP server/session directory. Never use the real unclaimed installation for fixtures.

Read current delivery status before continuing. CL-03-03 supplies the durable outbox and fair scheduling; CL-03-04 supplies authenticated worker effects, then CL-03-05–07 stop, streams/recovery and fault review. These sections will be updated with actual commands/evidence as implemented, not treated as existing behavior.
