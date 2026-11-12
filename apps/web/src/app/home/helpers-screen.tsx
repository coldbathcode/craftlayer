"use client";
import type {
  AgentRequestView,
  AgentToken,
  ServerActionKind,
  ServerView,
} from "@craftlayer/contracts";
import { ApiError } from "@craftlayer/sdk";
import { type FormEvent, useState } from "react";
import {
  askKinds,
  asksLine,
  askWords,
  day,
  helperReads,
  list,
  readsLine,
  requestText,
  requestWords,
  seenBy,
  serverGroups,
} from "./helper-words";
import { ago, friendly } from "./lib";
import { Card, Confirm, StatusLine } from "./parts";
import type { ActionStatus } from "./use-action";
import { type Family, usePolled } from "./use-family";

const idle: ActionStatus = { kind: "idle" };
const forbidden = (error: unknown) =>
  error instanceof ApiError && error.status === 403;
const lengths = [7, 30, 90] as const;

function Waiting({
  family,
  servers,
}: {
  family: Family;
  servers: ServerView[];
}) {
  const data = usePolled(
    async () => {
      const pages = await Promise.all(
        servers.map((server) =>
          family.api.agentRequests(server.id).then(
            (page) =>
              page.items
                .filter((request) => request.state === "pending")
                .map((request) => ({ request, server })),
            (error) => {
              // A server this person may not look at simply has nothing to show.
              if (forbidden(error)) return [];
              throw error;
            },
          ),
        ),
      );
      return pages.flat();
    },
    10000,
    family.lost,
  );
  const [status, setStatus] = useState<ActionStatus>(idle),
    [busy, setBusy] = useState(false);
  async function decide(
    request: AgentRequestView,
    words: string,
    decision: "approve" | "decline",
  ) {
    setBusy(true);
    setStatus(idle);
    try {
      await family.api.decideAgentRequest(request.id, decision);
      setStatus({
        kind: "done",
        text:
          decision === "approve"
            ? `Approved: ${words}. It can take a moment to happen.`
            : `You said no to ${request.agent_name}. Nothing was changed.`,
      });
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({
        kind: "failed",
        text:
          error instanceof ApiError && error.status === 409
            ? "That request is no longer waiting."
            : friendly(error),
      });
    } finally {
      setBusy(false);
      data.refresh();
    }
  }
  const waiting = data.value ?? [];
  return (
    <Card
      title="Waiting for your OK"
      {...(waiting.length ? { tone: "attention" as const } : {})}
    >
      {!data.value ? (
        data.failed ? (
          <p className="fam-status fam-status-failed" role="alert">
            We couldn't load what is waiting. Check your connection and try
            again.
          </p>
        ) : (
          <p className="fam-quiet">Loading…</p>
        )
      ) : waiting.length === 0 ? (
        <p className="fam-quiet">Nothing is waiting.</p>
      ) : (
        <ul className="fam-list">
          {waiting.map(({ request, server }) => {
            const words = requestWords(request.request, server.name),
              text = requestText(request.request);
            return (
              <li key={request.id}>
                <span>
                  <strong>{request.agent_name}</strong> asks: {words}.
                  {text ? (
                    <span className="fam-quiet">
                      {" "}
                      {request.kind === "say" ? "The message" : "The reason"}{" "}
                      players would see: “{text}”
                    </span>
                  ) : null}
                  {request.reason ? (
                    <span className="fam-quiet">
                      {" "}
                      It says why: “{request.reason}”
                    </span>
                  ) : null}
                  <span className="fam-quiet">
                    {" "}
                    · {ago(request.created_at)}
                  </span>
                </span>
                {request.can_decide ? (
                  <span className="fam-row">
                    <button
                      type="button"
                      className="fam-button fam-primary"
                      disabled={busy}
                      onClick={() => void decide(request, words, "approve")}
                    >
                      Approve
                      <span className="fam-sr">: {words}</span>
                    </button>
                    <button
                      type="button"
                      className="fam-button"
                      disabled={busy}
                      onClick={() => void decide(request, words, "decline")}
                    >
                      No
                      <span className="fam-sr">, don't {words}</span>
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <StatusLine status={status} />
    </Card>
  );
}

function Connect({
  family,
  servers,
  onConnected,
  onCancel,
}: {
  family: Family;
  servers: ServerView[];
  onConnected(name: string, key: string): void;
  onCancel(): void;
}) {
  const choices = serverGroups(servers);
  const [name, setName] = useState(""),
    [where, setWhere] = useState(choices[0]?.key ?? ""),
    [mayAsk, setMayAsk] = useState(false),
    [kinds, setKinds] = useState<ServerActionKind[]>([]),
    [days, setDays] = useState<(typeof lengths)[number]>(30),
    [status, setStatus] = useState<ActionStatus>(idle);
  const busy = status.kind === "working";
  async function submit(event: FormEvent) {
    event.preventDefault();
    const called = name.trim(),
      group = choices.find((c) => c.key === where) ?? choices[0];
    if (!called) {
      setStatus({ kind: "failed", text: "Give the AI helper a name first." });
      return;
    }
    if (!group) return;
    setStatus({ kind: "working", text: `Connecting ${called}…` });
    try {
      const created = await family.api.connectHelper({
        name: called,
        permissions: helperReads,
        projectId: group.projectId,
        environmentId: group.environmentId,
        expiresInDays: days,
        ...(mayAsk && kinds.length ? { mayRequest: kinds } : {}),
      });
      onConnected(created.name, created.token);
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({
        kind: "failed",
        text:
          error instanceof ApiError && error.status === 409
            ? "An AI helper already uses that name. Choose a different name."
            : friendly(error),
      });
    }
  }
  if (choices.length === 0)
    return (
      <Card title="Connect an AI helper">
        <p className="fam-quiet">
          There is no server for an AI helper to see yet.
        </p>
        <div className="fam-row">
          <button type="button" className="fam-button" onClick={onCancel}>
            Close
          </button>
        </div>
      </Card>
    );
  return (
    <Card title="Connect an AI helper">
      <form className="fam-form" onSubmit={(e) => void submit(e)}>
        <label htmlFor="fam-helper-name">Name</label>
        <input
          id="fam-helper-name"
          className="fam-input"
          value={name}
          maxLength={60}
          autoComplete="off"
          placeholder="Claude on my laptop"
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset>
          <legend>Which servers may it see?</legend>
          {choices.map((choice) => (
            <label key={choice.key} className="fam-choice">
              <input
                type="radio"
                name="fam-helper-where"
                checked={where === choice.key}
                onChange={() => setWhere(choice.key)}
              />{" "}
              {list(choice.names)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>What may it do?</legend>
          <label className="fam-choice">
            <input
              type="radio"
              name="fam-helper-mode"
              checked={!mayAsk}
              onChange={() => setMayAsk(false)}
            />{" "}
            Read only
          </label>
          <label className="fam-choice">
            <input
              type="radio"
              name="fam-helper-mode"
              checked={mayAsk}
              onChange={() => setMayAsk(true)}
            />{" "}
            Read, and ask for changes
          </label>
        </fieldset>
        {mayAsk ? (
          <fieldset>
            <legend>It may ask to…</legend>
            {askKinds.map((kind) => (
              <label key={kind} className="fam-choice">
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  onChange={(e) =>
                    setKinds((old) =>
                      e.target.checked
                        ? [...old, kind]
                        : old.filter((k) => k !== kind),
                    )
                  }
                />{" "}
                {askWords[kind]}
              </label>
            ))}
            <p className="fam-quiet">
              Asking is all it can do. Each request waits here for an adult to
              approve.
            </p>
          </fieldset>
        ) : null}
        <fieldset>
          <legend>For how long?</legend>
          {lengths.map((length) => (
            <label key={length} className="fam-choice">
              <input
                type="radio"
                name="fam-helper-days"
                checked={days === length}
                onChange={() => setDays(length)}
              />{" "}
              {length} days
            </label>
          ))}
        </fieldset>
        <p className="fam-quiet">
          It will read {readsLine(helperReads)}. It stops working when the time
          is up, or as soon as you revoke it.
        </p>
        <div className="fam-row">
          <button
            type="submit"
            className="fam-button fam-primary"
            disabled={busy}
          >
            Connect
          </button>
          <button type="button" className="fam-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
      <StatusLine status={status} />
    </Card>
  );
}

/** The key lives only in this component's memory until the adult says it is saved. */
function NewKey({
  name,
  secret,
  onSaved,
}: {
  name: string;
  secret: string;
  onSaved(): void;
}) {
  const [status, setStatus] = useState<ActionStatus>(idle);
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setStatus({ kind: "done", text: "Copied." });
    } catch {
      setStatus({
        kind: "failed",
        text: "We couldn't copy it. Select the key and copy it yourself.",
      });
    }
  }
  return (
    <Card title={`Key for ${name}`} tone="attention">
      <p>
        Give this key to the AI helper now. It is shown only once: we can't show
        it again after you close this.
      </p>
      <p className="fam-key">{secret}</p>
      <div className="fam-row">
        <button
          type="button"
          className="fam-button fam-primary"
          onClick={() => void copy()}
        >
          Copy
        </button>
        <button type="button" className="fam-button" onClick={onSaved}>
          I've saved it
        </button>
      </div>
      <p className="fam-quiet">
        Anyone with this key can read what {name} can read. If it gets lost or
        shared by mistake, revoke {name} and connect it again.
      </p>
      <StatusLine status={status} />
    </Card>
  );
}

function facts(helper: AgentToken, servers: ServerView[]) {
  const sees = seenBy(helper, servers),
    asks = asksLine(helper.may_request);
  return [
    `reads: ${readsLine(helper.permissions)}`,
    ...(sees.length ? [`on ${list(sees)}`] : []),
    asks ? `may ask to: ${asks}` : "read only",
    `until ${day(helper.expires_at)}`,
    helper.last_used_at
      ? `last used ${ago(helper.last_used_at)}`
      : "not used yet",
  ].join(" · ");
}
export function HelpersScreen({
  family,
  servers,
}: {
  family: Family;
  servers: ServerView[];
}) {
  const data = usePolled(
    async () => {
      try {
        return {
          allowed: true as const,
          items: (await family.api.helpers()).items,
        };
      } catch (error) {
        if (forbidden(error)) return { allowed: false as const, items: [] };
        throw error;
      }
    },
    60000,
    family.lost,
  );
  const [connecting, setConnecting] = useState(false),
    [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null),
    [asked, setAsked] = useState<AgentToken | null>(null),
    [status, setStatus] = useState<ActionStatus>(idle);
  async function revoke(helper: AgentToken) {
    setStatus({ kind: "working", text: `Revoking ${helper.name}…` });
    try {
      await family.api.revokeHelper(helper.id);
      setStatus({
        kind: "done",
        text: `${helper.name} is revoked. Its key no longer works.`,
      });
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({ kind: "failed", text: friendly(error) });
    } finally {
      data.refresh();
    }
  }
  const helpers = data.value?.items ?? [],
    active = helpers.filter((h) => h.state === "active"),
    past = helpers.filter((h) => h.state !== "active").slice(0, 5);
  return (
    <>
      <h1 className="fam-title">AI helpers</h1>
      <p className="fam-quiet">
        An AI helper can look, and can only ask for a change. An adult approves
        each one here before anything happens.
      </p>
      <Waiting
        key={servers.map((s) => s.id).join(" ")}
        family={family}
        servers={servers}
      />
      {fresh ? (
        <NewKey
          name={fresh.name}
          secret={fresh.secret}
          onSaved={() => setFresh(null)}
        />
      ) : null}
      <Card title="Connected">
        {!data.value ? (
          data.failed ? (
            <p className="fam-status fam-status-failed" role="alert">
              We couldn't load the AI helpers. Check your connection and try
              again.
            </p>
          ) : (
            <p className="fam-quiet">Loading…</p>
          )
        ) : !data.value.allowed ? (
          <p className="fam-quiet">
            Only a manager can see which AI helpers are connected.
          </p>
        ) : active.length === 0 ? (
          <p className="fam-quiet">No AI helpers are connected.</p>
        ) : (
          <ul className="fam-list">
            {active.map((helper) => (
              <li key={helper.id}>
                <span>
                  <strong>{helper.name}</strong>
                  <span className="fam-quiet"> · {facts(helper, servers)}</span>
                </span>
                {family.manager ? (
                  <button
                    type="button"
                    className="fam-button"
                    disabled={status.kind === "working"}
                    onClick={() => setAsked(helper)}
                  >
                    Revoke<span className="fam-sr"> {helper.name}</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <StatusLine status={status} />
        {family.manager && data.value?.allowed && !connecting ? (
          <div className="fam-row">
            <button
              type="button"
              className="fam-button"
              onClick={() => setConnecting(true)}
            >
              + Connect an AI helper
            </button>
          </div>
        ) : null}
      </Card>
      {family.manager && connecting ? (
        <Connect
          family={family}
          servers={servers}
          onCancel={() => setConnecting(false)}
          onConnected={(name, secret) => {
            setConnecting(false);
            setStatus(idle);
            setFresh({ name, secret });
            data.refresh();
          }}
        />
      ) : null}
      {past.length ? (
        <Card title="No longer connected">
          <ul className="fam-list">
            {past.map((helper) => (
              <li key={helper.id}>
                <span className="fam-quiet">
                  {helper.name} ·{" "}
                  {helper.revoked_at
                    ? `revoked ${day(helper.revoked_at)}`
                    : `ended ${day(helper.expires_at)}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {asked ? (
        <Confirm
          title={`Revoke ${asked.name}?`}
          body={`${asked.name} will stop working straight away and its key can't be used again. To use it later, connect it again with a new key.`}
          confirm="Revoke"
          onCancel={() => setAsked(null)}
          onConfirm={() => {
            const helper = asked;
            setAsked(null);
            void revoke(helper);
          }}
        />
      ) : null}
    </>
  );
}
