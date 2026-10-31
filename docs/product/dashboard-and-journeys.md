# Dashboard, onboarding and family experience

Status: interaction requirements, not a visual implementation. Chapter 05 chooses and documents a coherent design system, then tests it with keyboard and child-role journeys.

## Information architecture

Adult navigation: Overview, Worlds/Environments, Agents & Groups, Missions, Templates, Usage, Settings. Settings contains Members & Roles, Providers, Budgets, Audit and instance administration only where authorized. Show the selected organization/world clearly in all execution views.

Child navigation: Play (world → army → preset), My Agents, Current Mission. No generic admin links, raw logs, arbitrary chat prompt, coding/research navigation or provider metadata. API denial remains mandatory when routes are manually entered.

## First-run adult setup

1. Owner proves local setup authority and creates installation/admin identity.
2. Create first organization/project and set safe resource ceilings.
3. Connect a local Ollama endpoint or optional hosted provider; show current free-only eligibility and uncertainty without requiring a paid key.
4. Connect/create private test world with explicit server prerequisites and consent to any third-party license terms.
5. Create 2 bots, a group and approved shelter preset. Test connection and stop.
6. Optionally create a child account and assign world/group/preset access.

Wizard steps are resumable and server-validated. Unavailable providers do not prevent identity/world setup. Missing dependencies receive actionable explanations, not endless spinners. An already bootstrapped instance cannot expose owner setup again.

## Three-step child launch

Choose an assigned world → choose an approved army/group → choose an approved preset and Start. Fixed bounded options may appear on the preset card; no arbitrary text instructions. Show progress immediately after accepted submission, including queued/blocked reasons. A clear persistent Stop All acts on the child's permitted assigned Minecraft resources and reports stopping/stopped/unreachable accurately.

Adult-prepared preset approval, existing model configuration and healthy world are prerequisites, not extra child steps. Test with a fresh child session and no hidden admin state in the browser.

## Screens and state requirements

| Screen | Required content | Empty/error behavior |
| --- | --- | --- |
| Overview | Active missions, health, budget availability, stop status | Guided next action; no inference spending implied by opening page |
| Fleet | Friendly agent cards, role/world, connection and assignment | Reconnect reason, safe retry, distinguish offline vs busy |
| Mission detail | Bounded task graph/list, verified progress, recent events, pause/cancel/stop | Provider unavailable, approval, materials, lease recovery and failures have specific messages |
| World | Connection, permitted region, positions/map if supported | Text coordinates/list fallback when map unavailable |
| Providers | Redacted labels, eligibility freshness, cooldown and tested capabilities | Never display saved secret; expired catalog explicitly blocks |
| Usage | Observed/estimated units, reserved balances, reset windows | Distinguish unknown from zero and free invoice from infrastructure cost |
| Template editor | Version, allowed tools, task bounds, expected outcomes | Invalid DAG and policy errors before save/execute |
| Approvals | Exact diff/action/target, expiry and policy snapshot | Changed/expired requests cannot be approved |
| Stop operation | Acknowledged/quiesced/unreachable worker counts | Never say all stopped solely because API accepted request |

## UI behavior

Use the typed client and authorized snapshots plus event updates. Reconcile after reconnect, deduplicate events, and invalidate cached data on org switch/logout/revocation. Never reuse one org's query cache under another org. Destructive/privilege changes wait for server acknowledgement; optimistic UI is limited to safe presentation.

Progress derives from verified required outcomes, not model confidence. Show elapsed time and last update, not fabricated precision. A failed optional task cannot make the whole mission appear successful without the configured outcome verifier.

## Accessibility and responsiveness

Readable labels, sufficient contrast, touch targets, keyboard access, visible focus, reduced-motion support and screen-reader status announcements. Color is supplementary. Keep Stop All discoverable on mobile and desktop without relying on hover. Do not flood live regions with every world tick. Confirm accessible approval/diff views and graph list alternatives.

## Browser acceptance evidence

Record desktop/mobile widths, adult/operator/viewer/child roles, loading/empty/error/disconnected states, keyboard path and screen-reader review. Verify no provider keys in DOM, network responses, bundles or client error reporting. Test session expiry while a mission runs and membership revocation during an event stream. Include meaningful Playwright journeys; screenshots alone do not prove authorization.
