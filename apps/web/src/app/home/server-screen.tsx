"use client";
import type {
  BackupListView,
  BackupStatusView,
  KnockView,
  ServerActionRequest,
  ServerActionView,
  ServerLiveView,
  ServerView,
} from "@craftlayer/contracts";
import { type FormEvent, useState } from "react";
import {
  ago,
  backupLine,
  friendly,
  newKey,
  playerDevice,
  playerLabel,
  powerOf,
  size,
} from "./lib";
import { Card, Confirm, PowerBadge, StatusLine } from "./parts";
import { type ActionWords, useServerAction } from "./use-action";
import { type Family, usePolled } from "./use-family";

export const serverTabs = [
  ["players", "Players"],
  ["power", "Power"],
  ["backups", "Backups"],
  ["join", "How to join"],
] as const;
export type ServerTab = (typeof serverTabs)[number][0];
interface Asked {
  title: string;
  body: string;
  confirm: string;
  action: ServerActionRequest;
  words: ActionWords;
}
function Players({ family, server }: { family: Family; server: ServerView }) {
  const data = usePolled(
    async () => {
      const [live, knocks] = await Promise.all([
        family.api.live(server.id),
        family.api.knocks(server.id).then((k) => k.items),
      ]);
      return { live, knocks };
    },
    10000,
    family.lost,
  );
  const action = useServerAction(family, server.id, server.name, data.refresh);
  const [asked, setAsked] = useState<Asked | null>(null),
    [note, setNote] = useState(""),
    [adding, setAdding] = useState(false),
    [device, setDevice] = useState<"console" | "java">("console"),
    [name, setName] = useState("");
  const live: ServerLiveView | null = data.value?.live ?? null,
    state = powerOf(server, live),
    knocks = data.value?.knocks ?? [];
  async function decide(knock: KnockView, allow: boolean) {
    setNote("");
    try {
      if (allow) {
        await family.api.allowKnock(knock.id, newKey());
        setNote(
          `${playerLabel(knock.name)} can join now. Ask them to try again.`,
        );
      } else {
        await family.api.ignoreKnock(knock.id);
        setNote(`Ignored. ${playerLabel(knock.name)} was not let in.`);
      }
      data.refresh();
    } catch (error) {
      if (!family.lost(error)) setNote(friendly(error));
    }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!/^[A-Za-z0-9_]{1,16}$/.test(value)) {
      setNote(
        "A Minecraft name is up to 16 letters, numbers or underscores, with no spaces.",
      );
      return;
    }
    setNote("");
    setAdding(false);
    setName("");
    void action.run(
      { kind: "allow_player", player: { edition: "java", name: value } },
      { working: `Adding ${value}…`, done: `${value} can join now.` },
    );
  }
  if (!data.value && !data.failed)
    return <p className="fam-quiet">Loading players…</p>;
  if (!data.value)
    return (
      <p className="fam-status fam-status-failed" role="alert">
        We couldn't load the players. Check your connection and try again.
      </p>
    );
  return (
    <>
      {knocks.length ? (
        <Card title="Asking to join" tone="attention">
          <ul className="fam-list">
            {knocks.map((k) => (
              <li key={k.id}>
                <span>
                  <strong>{playerLabel(k.name)}</strong>
                  <span className="fam-quiet">
                    {" "}
                    · {k.edition === "bedrock" ? "iPad or console" : "Computer"}{" "}
                    · {ago(k.last_at)}
                  </span>
                </span>
                {k.can_decide ? (
                  <span className="fam-row">
                    <button
                      type="button"
                      className="fam-button fam-primary"
                      onClick={() => void decide(k, true)}
                    >
                      Allow
                      <span className="fam-sr"> {playerLabel(k.name)}</span>
                    </button>
                    <button
                      type="button"
                      className="fam-button"
                      onClick={() => void decide(k, false)}
                    >
                      Ignore
                      <span className="fam-sr"> {playerLabel(k.name)}</span>
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {note ? (
        <p className="fam-status fam-status-done" role="status">
          {note}
        </p>
      ) : null}
      <StatusLine status={action.status} />
      <Card title="Playing now">
        {!state.live ? (
          <p className="fam-quiet">
            Names appear here once the server helper is connected. A manager can
            do that in Advanced.
          </p>
        ) : state.power !== "on" ? (
          <p className="fam-quiet">
            {state.power === "off"
              ? `${server.name} is off.`
              : state.power === "starting"
                ? `${server.name} is starting.`
                : `We can't reach ${server.name} right now. Last seen ${ago(live?.reported_at)}.`}
          </p>
        ) : state.names.length === 0 ? (
          <p className="fam-quiet">Nobody is playing right now.</p>
        ) : (
          <ul className="fam-list">
            {state.names.map((n) => (
              <li key={n}>
                <span>
                  <strong>{playerLabel(n)}</strong>
                  <span className="fam-quiet"> · {playerDevice(n)}</span>
                </span>
                {family.manager ? (
                  <button
                    type="button"
                    className="fam-button"
                    disabled={action.busy}
                    onClick={() =>
                      setAsked({
                        title: `Kick ${playerLabel(n)}?`,
                        body: `${playerLabel(n)} will be disconnected from ${server.name} now. They stay on the list and can rejoin.`,
                        confirm: "Kick",
                        action: { kind: "kick_player", name: n },
                        words: {
                          working: `Kicking ${playerLabel(n)}…`,
                          done: `${playerLabel(n)} was disconnected.`,
                        },
                      })
                    }
                  >
                    Kick<span className="fam-sr"> {playerLabel(n)}</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Can join">
        {live?.allowed == null ? (
          <p className="fam-quiet">
            The list appears here once the server helper is connected.
          </p>
        ) : live.allowed.length === 0 ? (
          <p className="fam-quiet">Nobody is on the list yet.</p>
        ) : (
          <ul className="fam-list">
            {live.allowed.map((n) => (
              <li key={n}>
                <span>
                  <strong>{playerLabel(n)}</strong>
                  <span className="fam-quiet"> · {playerDevice(n)}</span>
                </span>
                {family.manager ? (
                  <button
                    type="button"
                    className="fam-button"
                    disabled={action.busy}
                    onClick={() =>
                      setAsked({
                        title: `Remove ${playerLabel(n)} from ${server.name}?`,
                        body: "They can't rejoin until allowed again. If they are playing now, kick them as well.",
                        confirm: "Remove",
                        action: { kind: "revoke_player", name: n },
                        words: {
                          working: `Removing ${playerLabel(n)}…`,
                          done: `${playerLabel(n)} can no longer join.`,
                        },
                      })
                    }
                  >
                    Remove<span className="fam-sr"> {playerLabel(n)}</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {family.manager ? (
          adding ? (
            <form className="fam-form" onSubmit={add}>
              <fieldset>
                <legend>What do they play on?</legend>
                <label className="fam-choice">
                  <input
                    type="radio"
                    name="device"
                    checked={device === "console"}
                    onChange={() => setDevice("console")}
                  />{" "}
                  iPad, Xbox, Switch or phone
                </label>
                <label className="fam-choice">
                  <input
                    type="radio"
                    name="device"
                    checked={device === "java"}
                    onChange={() => setDevice("java")}
                  />{" "}
                  Computer (Java)
                </label>
              </fieldset>
              {device === "console" ? (
                <p>
                  Ask them to try joining once. They'll be refused, and then
                  appear here under <strong>Asking to join</strong> where you
                  can allow them. See <strong>How to join</strong> for the steps
                  to give them.
                </p>
              ) : (
                <>
                  <label htmlFor="fam-add-name">Minecraft name</label>
                  <input
                    id="fam-add-name"
                    className="fam-input"
                    value={name}
                    maxLength={16}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => setName(e.target.value)}
                  />
                </>
              )}
              <div className="fam-row">
                {device === "java" ? (
                  <button
                    type="submit"
                    className="fam-button fam-primary"
                    disabled={action.busy}
                  >
                    Add
                  </button>
                ) : null}
                <button
                  type="button"
                  className="fam-button"
                  onClick={() => setAdding(false)}
                >
                  {device === "java" ? "Cancel" : "Done"}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="fam-button"
              onClick={() => setAdding(true)}
            >
              + Add a player
            </button>
          )
        ) : null}
      </Card>
      {asked ? (
        <Confirm
          title={asked.title}
          body={asked.body}
          confirm={asked.confirm}
          onCancel={() => setAsked(null)}
          onConfirm={() => {
            const { action: request, words } = asked;
            setAsked(null);
            void action.run(request, words);
          }}
        />
      ) : null}
    </>
  );
}
const powerDone: Record<string, string> = {
  start: "Turned on",
  stop: "Turned off",
  restart: "Restarted",
};
function Power({ family, server }: { family: Family; server: ServerView }) {
  const data = usePolled(
    async () => {
      const [live, actions] = await Promise.all([
        family.api.live(server.id),
        family.api
          .actions(server.id)
          .then((p) => p.items)
          .catch((): ServerActionView[] => []),
      ]);
      return { live, actions };
    },
    5000,
    family.lost,
  );
  const action = useServerAction(family, server.id, server.name, data.refresh);
  const [asked, setAsked] = useState<"stop" | "restart" | null>(null);
  const live = data.value?.live ?? null,
    state = powerOf(server, live),
    names = state.names.map(playerLabel),
    recent = (data.value?.actions ?? [])
      .filter((a) => a.kind in powerDone && a.state === "succeeded")
      .slice(0, 4);
  if (!data.value && !data.failed)
    return <p className="fam-quiet">Checking the server…</p>;
  const who = names.length
    ? `${names.join(" and ")} will be disconnected. `
    : "";
  return (
    <>
      <Card>
        <p className="fam-line fam-big">
          <PowerBadge power={state.power} />
        </p>
        {state.power === "unreachable" ? (
          <p className="fam-quiet">
            We can't reach {server.name} right now. It may still be running.
            Last seen {ago(live?.reported_at)}.
          </p>
        ) : null}
        {!state.live ? (
          <p className="fam-quiet">
            Turning the server on and off from here needs the server helper. A
            manager can connect it in Advanced.
          </p>
        ) : null}
        <StatusLine status={action.status} />
        {family.manager && state.live ? (
          <div className="fam-row">
            {state.power === "off" ? (
              <button
                type="button"
                className="fam-button fam-primary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    { kind: "start" },
                    {
                      working: `Turning on ${server.name}… this can take a minute.`,
                      done: `${server.name} is on.`,
                    },
                  )
                }
              >
                Turn on
              </button>
            ) : null}
            {state.power === "on" || state.power === "starting" ? (
              <>
                <button
                  type="button"
                  className="fam-button"
                  disabled={action.busy}
                  onClick={() => setAsked("stop")}
                >
                  Turn off
                </button>
                <button
                  type="button"
                  className="fam-button"
                  disabled={action.busy}
                  onClick={() => setAsked("restart")}
                >
                  Restart
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        <p className="fam-quiet">
          Turning off saves the world first and disconnects everyone playing.
        </p>
      </Card>
      {recent.length ? (
        <Card title="Recent">
          <ul className="fam-list">
            {recent.map((a) => (
              <li key={a.id}>
                <span>
                  {powerDone[a.kind]}{" "}
                  <span className="fam-quiet">{ago(a.finished_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {asked ? (
        <Confirm
          title={`${asked === "stop" ? "Turn off" : "Restart"} ${server.name}?`}
          body={
            asked === "stop"
              ? `${who}The world is saved first. Nobody can play until it is turned on again.`
              : `${who}The world is saved first. It will be back in about a minute.`
          }
          confirm={asked === "stop" ? "Turn off" : "Restart"}
          onCancel={() => setAsked(null)}
          onConfirm={() => {
            const kind = asked;
            setAsked(null);
            void action.run(
              { kind },
              kind === "stop"
                ? {
                    working: "Saving the world and turning off…",
                    done: `${server.name} is off. The world was saved.`,
                  }
                : {
                    working:
                      "Saving the world and restarting… this can take a minute.",
                    done: `${server.name} restarted and is on.`,
                  },
            );
          }}
        />
      ) : null}
    </>
  );
}
function backupProblem(code: string) {
  return code === "node_unavailable"
    ? "nothing was there to take it"
    : code === "save_failed"
      ? "the server didn't answer (it may have been off)"
      : code === "interrupted" || code === "cancelled"
        ? "it was cut short"
        : "the copy couldn't be checked";
}
function Backups({ family, server }: { family: Family; server: ServerView }) {
  const data = usePolled(
    async () => {
      const [status, list] = await Promise.all([
        family.api.backupStatus(server.id),
        family.api.backups(server.id).catch((): BackupListView | null => null),
      ]);
      return { status, list };
    },
    10000,
    family.lost,
  );
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null),
    [busy, setBusy] = useState(false),
    [time, setTime] = useState("04:00");
  const status: BackupStatusView | null = data.value?.status ?? null,
    policy = status?.policy ?? null,
    line = backupLine(status),
    items = data.value?.list?.items ?? [],
    running = Boolean(status?.open_occurrence);
  async function attempt(work: () => Promise<string>) {
    setBusy(true);
    setNote(null);
    try {
      setNote({ ok: true, text: await work() });
      data.refresh();
    } catch (error) {
      if (!family.lost(error)) setNote({ ok: false, text: friendly(error) });
    } finally {
      setBusy(false);
    }
  }
  if (!data.value && !data.failed)
    return <p className="fam-quiet">Checking backups…</p>;
  if (!status)
    return (
      <p className="fam-status fam-status-failed" role="alert">
        We couldn't load the backups. Check your connection and try again.
      </p>
    );
  return (
    <>
      <Card>
        <p className="fam-line">
          {line.text} <span aria-hidden="true">{line.ok ? "✓" : "⚠"}</span>
        </p>
        <p className="fam-line">
          Copy kept elsewhere:{" "}
          {policy?.health.offhost === "healthy" ? "yes ✓" : "not set up"}
        </p>
        <p className="fam-line">
          Restore tested:{" "}
          {policy?.health.last_restore_tested_at
            ? ago(policy.health.last_restore_tested_at)
            : "never"}
        </p>
        {note ? (
          <p
            className={`fam-status fam-status-${note.ok ? "done" : "failed"}`}
            role={note.ok ? "status" : "alert"}
          >
            {note.text}
          </p>
        ) : null}
        {running ? (
          <p className="fam-status fam-status-working" role="status">
            A backup is in progress. This can take a few minutes.
          </p>
        ) : null}
        {status.can_manage && policy ? (
          <button
            type="button"
            className="fam-button fam-primary"
            disabled={busy || running}
            onClick={() =>
              void attempt(async () => {
                await family.api.backUpNow(server.id, newKey());
                return "Backup requested. It appears below once it is finished and checked.";
              })
            }
          >
            Back up now
          </button>
        ) : null}
        {policy?.enabled ? (
          <p className="fam-quiet">
            Backups keep the world, players and settings. They run every night
            at {policy.local_time}.
          </p>
        ) : (
          <p className="fam-quiet">
            Nightly backups are not turned on for this server yet.
          </p>
        )}
      </Card>
      {status.can_manage && !policy?.enabled ? (
        <Card title="Turn on nightly backups">
          <form
            className="fam-form"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(async () => {
                await family.api.setBackupPolicy(
                  server.id,
                  {
                    timezone:
                      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                    local_time: time,
                    retention_days: policy?.retention_days ?? 14,
                    offhost_weekday: policy?.offhost_weekday ?? 0,
                    enabled: true,
                  },
                  newKey(),
                );
                return `Nightly backups are on, at ${time} every night.`;
              });
            }}
          >
            <label htmlFor="fam-backup-time">Every night at</label>
            <input
              id="fam-backup-time"
              className="fam-input"
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <p className="fam-quiet">
              Pick a time when nobody is usually playing. Backups are kept for
              at least 14 days.
            </p>
            <button
              type="submit"
              className="fam-button fam-primary"
              disabled={busy}
            >
              Turn on
            </button>
          </form>
        </Card>
      ) : null}
      <Card title="Backups">
        {items.length === 0 ? (
          <p className="fam-quiet">
            No backups yet.
            {policy?.enabled
              ? ` The first one runs tonight at ${policy.local_time}, or tap Back up now.`
              : ""}
          </p>
        ) : (
          <ul className="fam-list">
            {items.slice(0, 30).map((b) => (
              <li key={b.id}>
                <span>
                  {ago(b.completed_at ?? b.created_at)}
                  {b.size_bytes !== null ? ` · ${size(b.size_bytes)}` : ""}
                  <span className="fam-quiet">
                    {" · "}
                    {b.archive_removed_at
                      ? "no longer kept (older backups are cleared automatically)"
                      : b.state === "complete"
                        ? b.verified_at
                          ? "✓ checked"
                          : "finished, not checked"
                        : b.state === "failed"
                          ? `⚠ didn't finish: ${backupProblem(b.occurrence.failure_code)}`
                          : "in progress"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="fam-quiet">
          Putting a backup back (restore) is not available here yet.
        </p>
      </Card>
    </>
  );
}
function Join({ server }: { server: ServerView }) {
  const [shared, setShared] = useState("");
  const bedrock = server.observation?.bedrock ?? null,
    java = server.observation?.java ?? null;
  const steps = bedrock
    ? [
        "Open Minecraft and sign in to Xbox.",
        "Go to Play, then Servers, then Add Server.",
        `Server address: ${bedrock.host}   Port: ${bedrock.port}`,
        'Tap Join. Only people on the "Can join" list get in.',
      ]
    : [];
  async function share() {
    const text = `How to join ${server.name}:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setShared("Copied. Paste it into a message.");
      }
    } catch {
      setShared("Couldn't share from this browser. Copy the steps by hand.");
    }
  }
  return (
    <>
      <Card title="On an iPad, Xbox, Switch or phone">
        {bedrock ? (
          <>
            <ol className="fam-steps">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="fam-quiet">
              The first time, a new player is refused. They then show up under
              Players as asking to join, where a manager can allow them.
            </p>
            <button
              type="button"
              className="fam-button"
              onClick={() => void share()}
            >
              Share these steps
            </button>
            {shared ? (
              <p className="fam-status fam-status-done" role="status">
                {shared}
              </p>
            ) : null}
          </>
        ) : (
          <p className="fam-quiet">Not available for this server yet.</p>
        )}
      </Card>
      <Card title="On a computer (Java)">
        {java ? (
          <ol className="fam-steps">
            <li>Open Minecraft: Java Edition and choose Multiplayer.</li>
            <li>Choose Add Server.</li>
            <li>
              Server address: {java.host}
              {java.port === 25565 ? "" : `:${java.port}`}
            </li>
            <li>Join. Only people on the "Can join" list get in.</li>
          </ol>
        ) : (
          <p className="fam-quiet">Not available for this server yet.</p>
        )}
      </Card>
    </>
  );
}
export function ServerScreen({
  family,
  server,
  tab,
  open,
}: {
  family: Family;
  server: ServerView;
  tab: ServerTab;
  open(tab: string): void;
}) {
  return (
    <>
      <h1 className="fam-title">{server.name}</h1>
      <nav className="fam-tabs" aria-label={`${server.name} sections`}>
        {serverTabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="fam-tab"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => open(key)}
          >
            {label}
          </button>
        ))}
        <a className="fam-tab" href="/advanced">
          Advanced
        </a>
      </nav>
      {tab === "players" ? <Players family={family} server={server} /> : null}
      {tab === "power" ? <Power family={family} server={server} /> : null}
      {tab === "backups" ? <Backups family={family} server={server} /> : null}
      {tab === "join" ? <Join server={server} /> : null}
    </>
  );
}
