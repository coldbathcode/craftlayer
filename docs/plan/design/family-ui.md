# Family UI — screens, words and error messages (B1 draft)

Part of [Milestone B](../B-simple-ui.md). **Status:** draft for owner review before any code (B2). Mobile first; every screen must work one-handed on a phone.

## Words we use

| We say | We never say on the main screens |
| --- | --- |
| On / Off / Starting / Stopping | running, exited, container, state |
| Playing now | online players, session |
| Can join | allowlist, whitelist, UUID, XUID |
| Asking to join | knock, pending identity request |
| Last backup | archive, snapshot, occurrence |
| Copy kept elsewhere | off-host, remote replication |
| Restore tested | isolated restore, verification |
| How to join | connection details, address binding |
| AI helper | agent token, MCP client, principal |
| Manager / Watcher / Child | org_admin, viewer, operator, role |

Dates are relative when recent ("2 minutes ago", "today 4:00"), absolute otherwise. Names are the family's own names where the account allows it, with the gamertag underneath in smaller text.

## Screen 1 — Home

```
┌──────────────────────────────────────────┐
│ CraftLayer                     [Family ▾]│
├──────────────────────────────────────────┤
│ ⚠ George is asking to join Family        │
│   Survival.                [Allow] [Later]│
├──────────────────────────────────────────┤
│ Family Survival                          │
│ ● On · 2 playing — Alex, Charlie         │
│ Last backup: none yet ⚠                  │
│ [ Players ]  [ Turn off ]  [ How to join ]│
├──────────────────────────────────────────┤
│ Old world (stopped)                      │
│ ○ Off · kept safe, not managed yet       │
│ [ Learn more ]                           │
├──────────────────────────────────────────┤
│ + New server                             │
└──────────────────────────────────────────┘
```

- The banner appears only when something needs a person. Max one banner; others queue.
- Power button text follows state: **Turn on**, **Turn off**, **Starting…**, **Stopping…** (disabled while in progress).
- Watchers see the same card without buttons. Children never see Home; they see **Play** (later, Milestone F).

## Screen 2 — Server

Tabs across the top: **Players · Power · Backups · How to join · Advanced**.

### Players

```
Asking to join
┌──────────────────────────────────────────┐
│ BigCrazyPickle (iPad)   2 minutes ago    │
│                         [Allow] [Ignore] │
└──────────────────────────────────────────┘
Playing now
  Alex · ShadowHex8245 · iPad · 40 min      [Kick]
  Charlie · Oli77777865 · iPad · 12 min     [Kick]
Can join
  Alex · ShadowHex8245 · iPad                [Remove]
  Charlie · Oli77777865 · iPad               [Remove]
[ + Add a player ]
```

- **Add a player**: one field "Gamertag or Minecraft name", picker "iPad / Xbox / Switch / phone" vs "Computer (Java)". If we cannot look the account up, we say: "We couldn't find that account. Ask them to try joining once, then allow them here." No account numbers are ever shown or typed.
- **Allow** adds exactly the proven account from the knock. **Ignore** hides it for 24 hours.
- **Remove** confirms: "Remove Charlie from Family Survival? They'll be disconnected if playing and can't rejoin until allowed again."
- **Kick** confirms with the same shape; it does not remove them.

### Power

```
● On since today 15:58
[ Turn off ]   [ Restart ]
Turning off saves the world first and disconnects everyone playing.
Recent: Restarted today 15:57 by Oli · Turned on yesterday 20:13 by Oli
```

- Progress is live: "Saving the world… Stopping… Off." Every step has a timestamp.
- If it fails: "Family Survival didn't stop within 2 minutes. It is still On. Try again, or open Advanced for details." Never a raw error code on this tab.

### Backups

```
Last backup: none yet ⚠
Copy kept elsewhere: not set up
Restore tested: never
[ Back up now ]
Backups keep the world, players and settings. They run every night at 04:00.
```

With history: list rows "Today 04:00 · 412 MB · ✓ verified · ✓ copy kept elsewhere · [Restore…]". Restore asks twice in plain words and explains that the current world is kept as a backup too.

### How to join

```
On an iPad, Xbox, Switch or phone
1. Open Minecraft, sign in to Xbox.
2. Servers → Add Server.
3. Address  109.123.246.198   Port  19133
4. Tap Join. Only people on the "Can join" list get in.
[ Share these steps ]

On a computer (Java)
Not available for this server yet.
```

- Address and port come from the server record, never typed by hand.
- Share produces a short text message; it never includes anything secret.

### Advanced

Today's technical console, unchanged, with a one-line note at the top: "These details are for troubleshooting. Nothing here is needed day to day."

## Screen 3 — New server

Three steps, one question each, with a progress dot row.

1. **Name** — "What should we call it?" (suggestion chips: Family Survival 2, Creative Garden).
2. **Mode** — Survival / Creative, with a one-line description each.
3. **Who can join** — checkboxes of known family players.

Review card: "Family Creative · Creative · Alex, Charlie, George · uses about 3 GB of the 9 GB free · iPad-friendly." Button: **Create**. Then a live progress list (Preparing → Starting → Checking it answers → Ready) and the How to join card.

If it cannot proceed: "There isn't enough free memory for another server. Turn one off first, or choose a smaller size in Advanced."

## Screen 4 — Family

```
Managers  Oli (you)                         [Invite a manager]
Watchers  —                                 [Invite a watcher]
Children  Alex · plays on Family Survival   [Change]
          Charlie · plays on Family Survival
          George · plays on Family Survival
[ + Add a child ]
```

- Role descriptions in one line: Managers can change anything here. Watchers can look but not change. Children play; they cannot manage anything.
- Adding a child creates a CraftLayer child account (for later Play features) and links their Minecraft identities.

## Screen 5 — AI helpers

```
Claude on Oli's laptop    reads: servers, players    until 8 Dec    [Revoke]
[ + Connect an AI helper ]

Waiting for your OK
┌──────────────────────────────────────────┐
│ Claude asks: let BigCrazyPickle join      │
│ Family Survival.          [Approve] [No] │
└──────────────────────────────────────────┘
```

- Connect flow: name it, pick which servers it may see, pick "read only" (default) or specific actions it may *ask* for, pick how long. Then show the key once with "Copy" and "I've saved it".
- Children never see this screen; watchers see helpers but no buttons.

## Error and empty states (shared)

| Situation | We show |
| --- | --- |
| Can't reach the server helper | "We can't reach Family Survival right now. It may still be running. Last seen 3 minutes ago." |
| Action timed out | "That took too long. Nothing was changed. Try again." |
| Permission missing | "Only a manager can do this." |
| Nothing yet | "No backups yet. The first one runs tonight at 04:00, or tap Back up now." |
| Signed out | "You've been signed out to keep things safe. Sign in again." |

## Accessibility

Minimum 44 px targets, visible focus, labels on every control, status changes announced once (not every second), colour never the only signal (On/Off also by word and icon), reduced motion respected.

## Owner review questions

1. Are "Manager / Watcher / Child" the right words for your family?
2. Should the Home banner also send a phone notification (needs A1 remote access first)?
3. Do you want the old world shown on Home at all until it is managed?
