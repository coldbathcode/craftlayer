# Chapter 05 — Dashboard and Kid Mode

**Status:** not started. **Specification:** ready for engineering review. **Implementation evidence:** none.

**Milestone:** M2. **Requirements:** PR-011–012, PR-021; NFR-02, NFR-08.

## Objective

Give adults a clear control dashboard and children a three-step approved Minecraft mission launch with visible, accurate stop behavior.

## Dependencies and entry gate

Chapters 00–04 accepted. Identity, fleet/event API and a controllable Minecraft bot work.

Before work: inspect Git status, read AGENTS.md and delivery status, confirm the authorized chapter scope, and inspect the previous review evidence. Do not assume a dependency is complete merely because its specification exists.

## Scope and implementation approach

Resumable onboarding, adult role-aware navigation, fleet/group assignment, mission progress, providers/usage projections, child presets, approved-world selection, accessible responsive event-driven UI.

Web consumes generated SDK and sanitized event projections. Child/account ceilings are enforced by API/runtime. Server owns preset approvals and mission snapshot hashes; org switches invalidate cached state.

Architecture references: [api-and-events](../architecture/api-and-events.md), [security-and-access](../architecture/security-and-access.md).

## Ordered engineering tasks

Each task is initially unchecked. Dependencies below describe the default conservative order; record an explicit justified dependency change before reordering. Task sizes are relative engineering complexity (M/L), not delivery dates.

### [ ] CL-05-01 — Design system and screen contracts

**Depends on:** Chapter 04 gate. **Size:** M. **Status:** not started.

**Implementation:** Define accessible typography, spacing, status semantics, touch/focus behavior and mobile layouts. Map all roles/screens/loading/error states before implementing views.

**Required evidence:** Reviewable screen specifications include keyboard path and Stop All placement on small screens.

### [ ] CL-05-02 — Adult onboarding and account shell

**Depends on:** CL-05-01. **Size:** L. **Status:** not started.

**Implementation:** Build bootstrap/login/org selection and resumable setup for provider/world/group/preset with role-filtered navigation. Show missing dependencies and healthy partial setup clearly.

**Required evidence:** Fresh owner completes setup with fake/local services; viewer/child cannot reach admin flows by URL or API.

### [ ] CL-05-03 — Fleet and mission control surfaces

**Depends on:** CL-05-02. **Size:** L. **Status:** not started.

**Implementation:** Implement agent/group assignment, mission list/detail, task graph/list, pause/resume/cancel and explicit stop operation status. Progress is based on verified outcomes.

**Required evidence:** Live deterministic/Minecraft task updates display correctly; failed/blocked/uncertain states remain distinct.

### [ ] CL-05-04 — Events, reconnect and scoped cache

**Depends on:** CL-05-03. **Size:** L. **Status:** not started.

**Implementation:** Add authenticated stream subscription, version deduplication, bounded UI state, resync and logout/org-change cache reset. Revoke access during an open stream.

**Required evidence:** Disconnect/reconnect and foreign/expired cursor cases recover safely; no stale org data appears after switching.

### [ ] CL-05-05 — Adult-approved presets and child launch

**Depends on:** CL-05-04. **Size:** L. **Status:** not started.

**Implementation:** Implement immutable preset approval by scope/version, bounded parameter selection and world → army → preset Start. Child cannot edit template/role/tool/credential settings.

**Required evidence:** Fresh child session launches approved preset in three steps; modified/unapproved/wrong-world presets deny.

### [ ] CL-05-06 — Safety, accessibility and private projections

**Depends on:** CL-05-05. **Size:** L. **Status:** not started.

**Implementation:** Provide persistent scoped Stop All, acknowledged/quiesced feedback, sanitized child event feed and map position fallback. Review contrast, focus, live announcements and reduced motion.

**Required evidence:** Keyboard/screen-reader review and child-secret canaries pass; unreachable workers never appear confirmed stopped.

### [ ] CL-05-07 — Browser acceptance and handoff

**Depends on:** CL-05-06. **Size:** L. **Status:** not started.

**Implementation:** Run adult/operator/viewer/child browser journeys at desktop/mobile widths, session expiry/revocation and provider/worker failure states. Record screenshots and behavioral evidence.

**Required evidence:** Positive child journey and all forbidden-feature API/UI paths pass; no keys in bundles/DOM/network.

## Test plan

- Three-step child launch from a fresh session after adult preparation.
- Viewer write denial, builder execution delegation, child settings/terminal/provider denial.
- Stream revocation, org cache switch, session expiry and reconnect/resync.
- Keyboard/mobile Stop All, asynchronous quiescence and screen-reader status rate limiting.

Use deterministic/fake services first. Any live inference, public deployment, publication or payment action needs existing user authorization for that action; local tests must not silently use real keys. Record exact commands, versions, fixture seeds and exit results. An unavailable dependency is unverified/blocked, not passed.

## Security considerations

- Provider key submission uses a dedicated safe form; saved secrets never return.
- Child arbitrary prompts, chat commands and raw logs are absent and server-denied.
- Do not turn optimistic UI success into a claim of physical stop or verified completion.

## Acceptance criteria

- [ ] Adult can operate fleet and inspect accurate progress; child launches only assigned approved presets.
- [ ] Child cannot manage credentials/roles, execute arbitrary missions or access coding/research.
- [ ] Event/UI targets and accessibility checks have recorded evidence.
- [ ] Required tests pass, relevant documentation is updated, and no unreviewed safety regression remains.
- [ ] Every completed task points to concrete evidence; deferred checks are explicitly listed with impact.

## Demonstration and independent verification

Adult prepares/approves a preset; fresh child completes three selections, watches progress and uses scoped Stop All; forbidden routes deny.

## Documentation and deliverables

Design system notes; screen/state catalog; browser tests; screenshots; child restriction test report; chapter review.

Update the OpenAPI/SDK or configuration reference when changed, add migrations/compatibility notes, and capture limitations. Use a dedicated chapter review document based on [the review template](../templates/chapter-review.md). Do not edit the original source blueprint.

## Review checkpoint and next handoff

Fill the chapter review with implementation summary, task/requirement mapping, checks, security evidence, benchmark results where relevant, known issues and next steps. Update [status](../delivery/status.md), [backlog](../delivery/backlog.md) and [decisions](../delivery/risks-and-decisions.md) together. A chapter is accepted only when its acceptance evidence is reviewed.

Complete the authorized scope before asking for the next chapter. Default chapter-by-chapter authorization follows the blueprint; an explicit user instruction authorizing multiple chapters overrides that default. Use [the handoff template](../templates/agent-handoff.md) so the next session can resume without reconstructing context.
