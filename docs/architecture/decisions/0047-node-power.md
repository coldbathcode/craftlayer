# ADR 0047 — Turning a server on and off: one container, chosen by the operator

Status: adopted for master plan step A3 (on, off, restart) on 2026-11-12. Built and verified locally with a scripted container engine and console. Not yet configured on the family VPS; that state is on the [status board](../../plan/STATUS.md).

## Context

Start, stop and restart were accepted as actions ([ADR 0040](0040-server-action-intake.md)) but every host answered "cannot do that yet". Stopping through the game console alone is not enough: a container with a restart policy comes straight back, and starting needs the container engine. The node agent already mounts the engine socket for read-only inventory ([ADR 0016](0016-node-provisioning-boundary.md)), so the question is how little more to allow.

## Decision

1. **The operator names the container; callers never do.** The agent's private configuration may give a server a `container` with two Compose labels (project and service). Without it the host keeps answering "cannot do that yet".
2. **Three engine calls, nothing else.** A list filtered by those two labels, and start or stop of the single container that list returned. A match that is not exactly one container is refused. There is no create, remove, exec, image, volume or network call in the code.
3. **Off saves first and is checked.** The node asks the server to save through the control channel, asks the engine to stop the container with a 90-second grace period (the server saves again and exits on that signal), then reads the container state. A container stopped this way stays stopped under any restart policy.
4. **On is true only when the server answers.** After starting the container the node waits up to three minutes for the server's own console to answer. If it does not, the action fails as `not_verified` and the evidence says whether the container is still up.
5. **Evidence is what was observed.** Each sentence in the result ("Saved the world.", "Stopped.", "Started; the server answered after 41 seconds.") is something the node saw. A save that was not confirmed is reported as not confirmed and the stop still goes ahead.
6. **Same queue rules as before.** A power action is accepted only when nothing else is open for the server and blocks new work until it finishes; emergency stop still outranks it.

## Consequences

- The agent's heartbeat and status reports pause while a power action runs, at most about five minutes for a restart.
- Access to the engine socket is still host-level power; this decision narrows the code, not the socket. The agent remains the only container that mounts it.
- While a server is off, a due backup fails with `save_failed` as before; backing up a stopped server is still not built.
- "Starting" and "Off" on the dashboard come from the same container read ([ADR 0046](0046-live-status-and-knocks.md)).
