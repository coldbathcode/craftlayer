"use client";
import type {
  BackupStatusView,
  KnockView,
  ServerLiveView,
  ServerView,
} from "@craftlayer/contracts";
import { useState } from "react";
import { ago, backupLine, friendly, newKey, playerLabel, powerOf } from "./lib";
import { Card, Confirm, PowerBadge, StatusLine } from "./parts";
import { useServerAction } from "./use-action";
import { type Family, usePolled } from "./use-family";

interface Glance {
  live: ServerLiveView | null;
  knocks: KnockView[];
  backup: BackupStatusView | null;
}
function ServerCard({
  family,
  server,
  open,
}: {
  family: Family;
  server: ServerView;
  open(tab: string): void;
}) {
  const glance = usePolled<Glance>(
    async () => {
      // Each part is optional: a missing one must not blank the whole card.
      const [live, knocks, backup] = await Promise.all([
        family.api.live(server.id).catch(() => null),
        family.api
          .knocks(server.id)
          .then((k) => k.items)
          .catch(() => []),
        family.api.backupStatus(server.id).catch(() => null),
      ]);
      return { live, knocks, backup };
    },
    10000,
    family.lost,
  );
  const action = useServerAction(
    family,
    server.id,
    server.name,
    glance.refresh,
  );
  const [asking, setAsking] = useState(false),
    [knockNote, setKnockNote] = useState(""),
    [hidden, setHidden] = useState<string[]>([]);
  const state = powerOf(server, glance.value?.live ?? null),
    backup = backupLine(glance.value?.backup ?? null),
    knock = glance.value?.knocks.find((k) => !hidden.includes(k.id));
  const names = state.names.map(playerLabel);
  async function allow(k: KnockView) {
    setKnockNote("");
    try {
      await family.api.allowKnock(k.id, newKey());
      setKnockNote(
        `${playerLabel(k.name)} can join ${server.name} now. Ask them to try again.`,
      );
      glance.refresh();
    } catch (error) {
      if (!family.lost(error)) setKnockNote(friendly(error));
    }
  }
  return (
    <>
      {knock ? (
        <Card tone="attention">
          <p>
            <strong>{playerLabel(knock.name)}</strong> is asking to join{" "}
            {server.name}.{" "}
            <span className="fam-quiet">{ago(knock.last_at)}</span>
          </p>
          {knock.can_decide ? (
            <div className="fam-row">
              <button
                type="button"
                className="fam-button fam-primary"
                onClick={() => void allow(knock)}
              >
                Allow
              </button>
              <button
                type="button"
                className="fam-button"
                onClick={() => setHidden((h) => [...h, knock.id])}
              >
                Later
              </button>
            </div>
          ) : null}
        </Card>
      ) : null}
      {knockNote ? (
        <p className="fam-status fam-status-done" role="status">
          {knockNote}
        </p>
      ) : null}
      <Card>
        <h2>{server.name}</h2>
        <p className="fam-line">
          <PowerBadge power={state.power} />
          {state.power === "on" && state.playing !== null ? (
            <>
              {" · "}
              {state.playing === 0
                ? "nobody playing"
                : `${state.playing} playing${names.length ? ` — ${names.join(", ")}` : ""}`}
            </>
          ) : null}
        </p>
        {state.power === "unreachable" ? (
          <p className="fam-quiet">
            We can't reach {server.name} right now. It may still be running.
            Last seen {ago(glance.value?.live?.reported_at)}.
          </p>
        ) : null}
        {!state.live && glance.value ? (
          <p className="fam-quiet">
            This is the last outside check, not live. A manager can connect the
            server helper in Advanced.
          </p>
        ) : null}
        <p className="fam-line">
          {backup.text} <span aria-hidden="true">{backup.ok ? "✓" : "⚠"}</span>
          {backup.ok ? null : (
            <span className="fam-sr"> — needs attention</span>
          )}
        </p>
        <StatusLine status={action.status} />
        <div className="fam-row">
          <button
            type="button"
            className="fam-button"
            onClick={() => open("players")}
          >
            Players
          </button>
          {family.manager && state.live ? (
            state.power === "on" ? (
              <button
                type="button"
                className="fam-button"
                disabled={action.busy}
                onClick={() => setAsking(true)}
              >
                {action.busy ? "Working…" : "Turn off"}
              </button>
            ) : state.power === "off" ? (
              <button
                type="button"
                className="fam-button"
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
                {action.busy ? "Starting…" : "Turn on"}
              </button>
            ) : state.power === "starting" ? (
              <button type="button" className="fam-button" disabled>
                Starting…
              </button>
            ) : null
          ) : null}
          <button
            type="button"
            className="fam-button"
            onClick={() => open("join")}
          >
            How to join
          </button>
        </div>
      </Card>
      {asking ? (
        <Confirm
          title={`Turn off ${server.name}?`}
          body={
            names.length
              ? `${names.join(" and ")} will be disconnected. The world is saved first.`
              : "The world is saved first. Nobody can play until it is turned on again."
          }
          confirm="Turn off"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void action.run(
              { kind: "stop" },
              {
                working: "Saving the world and turning off…",
                done: `${server.name} is off. The world was saved.`,
              },
            );
          }}
        />
      ) : null}
    </>
  );
}
export function HomeScreen({
  family,
  servers,
  open,
}: {
  family: Family;
  servers: ServerView[] | null;
  open(serverId: string, tab: string): void;
}) {
  if (servers === null)
    return <p className="fam-quiet">Loading your servers…</p>;
  if (servers.length === 0)
    return (
      <Card>
        <h2>No servers yet</h2>
        <p>
          When a server is set up it appears here. A manager can register one in{" "}
          <a className="fam-link" href="/advanced">
            Advanced
          </a>
          .
        </p>
      </Card>
    );
  return (
    <>
      {servers.map((server) => (
        <ServerCard
          key={server.id}
          family={family}
          server={server}
          open={(tab) => open(server.id, tab)}
        />
      ))}
    </>
  );
}
