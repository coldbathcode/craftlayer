# Milestone E — New servers in a few taps

Part of the [master plan](../MASTER_PLAN.md). Status lives on the [status board](STATUS.md).

## Goal

A parent creates a new family world from the phone: answer three questions, tap Create, and get join instructions a minute later.

## Today

Most of the machinery exists and is tested locally: Family Survival template, capacity and port checks, reservations, signed node commands, durable deployment jobs, ownership-labelled rollback and independent approval records (CL-F25-01 to 03). The automatic provision route is deliberately disabled until installed qualification, readiness checks and crash recovery are proven. The current family server was deployed by hand with the same template.

## Steps

- **E1 — Wizard.** Name, game mode, who can play. The platform picks free ports, checks memory and disk, shows the plan in plain words, and asks for confirmation.
- **E2 — Turn on real provisioning** on the VPS node: installed qualification, readiness (server answers and allowlist enforced), crash reconciliation and rollback that removes only what the failed attempt created and keeps any world data. Completes CL-F25-03 to CL-F25-05.
- **E3 — Approval that fits a family.** The current rule needs a *second* adult to approve a deployment. Owner decision: keep two-adult approval, or add a **single-owner mode** (typed confirmation plus a short cooling-off delay, recorded in the audit). A rule change needs an ADR.
- **E4 — Decommission.** Turn a server off permanently with a retained final backup and explicit confirmation; data is kept for the retention period, never deleted immediately.
- **Done when:** a parent creates, joins, and decommissions a disposable server end to end on the VPS; port and capacity conflicts are refused in plain words; a crash mid-creation recovers without touching other servers.
