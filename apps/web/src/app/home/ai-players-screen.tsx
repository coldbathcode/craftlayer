"use client";
import type {
  AiPlayerMemoryInput,
  AiPlayerTaskInput,
  AiPlayerView,
  ModelDescriptor,
} from "@craftlayer/contracts";
import { ApiError, aiPlayerClient } from "@craftlayer/sdk";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ago, friendly } from "./lib";
import { ModelServices } from "./model-services";
import { Card, Confirm, StatusLine } from "./parts";
import { fillDays, spendCsv } from "./spending";
import type { ActionStatus } from "./use-action";
import { type Family, usePolled } from "./use-family";

const idle: ActionStatus = { kind: "idle" };
export const dollars = (micro: string | number) =>
  `$${(Number(micro) / 1_000_000).toFixed(2)}`;
export function toMicro(text: string): string | null {
  const value = Number(text.replace(/^\$/, "").trim());
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return null;
  return Math.round(value * 1_000_000).toString();
}
const stateWords: Record<string, string> = {
  online: "In the game",
  connecting: "Joining…",
  offline: "Not in the game",
  sign_in_required: "Waiting for you to sign in",
  stopped: "Stopped",
  out_of_budget: "Reached its spending limit",
  error: "Having trouble",
};
function refused(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "AI_PLAYER_MODEL_UNAVAILABLE")
      return "That model isn't available on that connection. Refresh the models or pick another.";
    if (error.code === "AI_PLAYER_MODEL_NO_TOOLS")
      return "That model can't use tools, which an AI player needs. Pick another.";
    if (
      error.code === "AI_PLAYER_CONFLICT" ||
      error.code === "AI_PLAYER_VERSION_CONFLICT"
    )
      return error.message;
  }
  return friendly(error);
}

export function AiPlayersScreen({
  family,
  selected,
}: {
  family: Family;
  selected: string | null;
}) {
  const api = useMemo(
    () => aiPlayerClient(family.organization, family.csrf),
    [family],
  );
  const players = usePolled(() => api.list(), 5000, family.lost);
  const [creating, setCreating] = useState(false);
  const list = players.value?.players ?? [];
  const current = selected ? list.find((p) => p.id === selected) : null;
  if (selected && players.value && !current)
    return (
      <Card>
        <p>That AI player isn't here any more.</p>
        <a className="fam-link" href="#/ai-players">
          Back to AI players
        </a>
      </Card>
    );
  if (current)
    return (
      <>
        <a className="fam-back" href="#/ai-players">
          ← AI players
        </a>
        <PlayerDetail
          family={family}
          player={current}
          refresh={players.refresh}
        />
      </>
    );
  return (
    <>
      <h1 className="fam-title">AI players</h1>
      <p className="fam-quiet">
        Named AI players that join your world, take your instructions and
        remember things. Each one has its own spending limit.
      </p>
      {!players.value ? (
        players.failed ? (
          <p className="fam-status fam-status-failed" role="alert">
            We couldn't load your AI players. Check your connection and try
            again.
          </p>
        ) : (
          <p className="fam-quiet">Loading…</p>
        )
      ) : (
        list.map((p) => (
          <PlayerCard
            key={p.id}
            family={family}
            player={p}
            refresh={players.refresh}
          />
        ))
      )}
      {creating ? (
        <CreatePlayer
          family={family}
          onDone={() => {
            setCreating(false);
            players.refresh();
          }}
        />
      ) : (
        <button
          type="button"
          className="fam-button"
          onClick={() => setCreating(true)}
        >
          Create an AI player
        </button>
      )}
      <ModelServices family={family} />
      <Hosts family={family} />
    </>
  );
}

function SpendMeter({ player }: { player: AiPlayerView }) {
  const s = player.spend;
  const today = Number(s.today_micro) + Number(s.today_reserved_micro);
  const pct = Math.min(
    100,
    Number(s.daily_limit_micro)
      ? (today / Number(s.daily_limit_micro)) * 100
      : 100,
  );
  return (
    <div className="fam-line">
      <span>
        Today {dollars(today)} of {dollars(s.daily_limit_micro)} · Total{" "}
        {dollars(s.total_micro)} of {dollars(s.total_limit_micro)} ·{" "}
        {s.calls_today} model call{s.calls_today === 1 ? "" : "s"} today
      </span>
      <meter
        min={0}
        max={100}
        value={pct}
        low={60}
        high={80}
        optimum={0}
        aria-label="Spent today"
      />
      {s.exhausted ? (
        <strong>
          {" "}
          Limit reached: it won't think again until a limit allows it.
        </strong>
      ) : s.warning ? (
        <strong> Over 80% of a limit used.</strong>
      ) : null}
    </div>
  );
}
function StatusWords({ player }: { player: AiPlayerView }) {
  const s = player.status;
  if (player.stop_latched) return <span>Stopped by an adult</span>;
  if (!s)
    return (
      <span>
        {player.desired_state === "running" ? "Starting…" : "Not started"}
      </span>
    );
  if (s.stale) return <span>Not heard from since {ago(s.reported_at)}</span>;
  return (
    <span>
      {stateWords[s.state] ?? s.state}
      {s.detail.activity && s.state === "online"
        ? ` · ${s.detail.activity}`
        : ""}
    </span>
  );
}
function SignIn({ player }: { player: AiPlayerView }) {
  const code = player.status?.detail.sign_in;
  if (player.status?.state !== "sign_in_required" || !code) return null;
  return (
    <p className="fam-status fam-status-working" role="status">
      Sign in with your Microsoft account so {player.name} can join: open{" "}
      <a className="fam-link" href={code.url} target="_blank" rel="noreferrer">
        {code.url}
      </a>{" "}
      and enter the code <strong className="fam-key">{code.code}</strong> (until{" "}
      {ago(code.expires_at)}).
    </p>
  );
}
function Controls({
  family,
  player,
  refresh,
}: {
  family: Family;
  player: AiPlayerView;
  refresh(): void;
}) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const [status, setStatus] = useState<ActionStatus>(idle),
    [busy, setBusy] = useState(false);
  async function act(kind: "start" | "stop" | "clearStop", done: string) {
    setBusy(true);
    setStatus(idle);
    try {
      await api[kind](player.id);
      setStatus({ kind: "done", text: done });
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({ kind: "failed", text: refused(error) });
    } finally {
      setBusy(false);
      refresh();
    }
  }
  return (
    <>
      <div className="fam-row">
        {player.desired_state === "running" ? (
          <button
            type="button"
            className="fam-button fam-danger"
            disabled={busy}
            onClick={() =>
              void act(
                "stop",
                `${player.name} is stopping. It leaves the game within a few seconds.`,
              )
            }
          >
            Stop
          </button>
        ) : player.stop_latched ? (
          <button
            type="button"
            className="fam-button"
            disabled={busy}
            onClick={() =>
              void act(
                "clearStop",
                "The stop is cleared. Start it when you're ready.",
              )
            }
          >
            Clear the stop
          </button>
        ) : (
          <button
            type="button"
            className="fam-button"
            disabled={busy}
            onClick={() =>
              void act("start", `${player.name} is joining the game.`)
            }
          >
            Start
          </button>
        )}
      </div>
      <StatusLine status={status} />
    </>
  );
}
function PlayerCard({
  family,
  player,
  refresh,
}: {
  family: Family;
  player: AiPlayerView;
  refresh(): void;
}) {
  return (
    <Card title={player.name}>
      <p>
        <StatusWords player={player} />
      </p>
      <SignIn player={player} />
      <SpendMeter player={player} />
      <p className="fam-quiet">
        Model: {player.model_id} · In game as {player.mc_username}
      </p>
      <div className="fam-row">
        <a className="fam-button" href={`#/ai-players/${player.id}`}>
          Talk and settings
        </a>
      </div>
      <Controls family={family} player={player} refresh={refresh} />
    </Card>
  );
}

const tabs = [
  ["talk", "Talk"],
  ["memory", "Memory"],
  ["tasks", "Master tasks"],
  ["spending", "Spending"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof tabs)[number][0];
function PlayerDetail({
  family,
  player,
  refresh,
}: {
  family: Family;
  player: AiPlayerView;
  refresh(): void;
}) {
  const [tab, setTab] = useState<Tab>("talk");
  return (
    <>
      <h1 className="fam-title">{player.name}</h1>
      <p>
        <StatusWords player={player} />
      </p>
      <SignIn player={player} />
      <SpendMeter player={player} />
      <Controls family={family} player={player} refresh={refresh} />
      <div className="fam-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            className="fam-tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "talk" ? <Talk family={family} player={player} /> : null}
      {tab === "memory" ? <MemoryTab family={family} player={player} /> : null}
      {tab === "tasks" ? (
        <Tasks family={family} player={player} refresh={refresh} />
      ) : null}
      {tab === "spending" ? (
        <SpendingTab family={family} player={player} />
      ) : null}
      {tab === "settings" ? (
        <Settings family={family} player={player} refresh={refresh} />
      ) : null}
    </>
  );
}

function SpendingTab({
  family,
  player,
}: {
  family: Family;
  player: AiPlayerView;
}) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const history = usePolled(
    () => api.spendHistory(player.id, 30),
    60000,
    family.lost,
  );
  if (!history.value)
    return (
      <Card>
        <p className="fam-quiet">
          {history.failed
            ? "We couldn't load the spending history."
            : "Loading…"}
        </p>
      </Card>
    );
  const days = fillDays(history.value.days, 30, new Date());
  const amount = (d: (typeof days)[number]) =>
    Number(d.used_micro) + Number(d.reserved_micro);
  const top = Math.max(
    Number(player.spend.daily_limit_micro),
    ...days.map(amount),
    1,
  );
  const total = days.reduce((n, d) => n + amount(d), 0);
  const calls = days.reduce((n, d) => n + d.calls, 0);
  function download() {
    const blob = new Blob([spendCsv(player.name, history.value?.days ?? [])], {
      type: "text/csv",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${player.name.replace(/[^a-z0-9_-]+/gi, "-")}-spending.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  const w = 600,
    h = 140,
    bar = w / days.length,
    limitY = h - (Number(player.spend.daily_limit_micro) / top) * h;
  return (
    <Card title="Last 30 days">
      <p>
        {dollars(total)} on {calls} model call{calls === 1 ? "" : "s"}. The
        dashed line is the daily limit (
        {dollars(player.spend.daily_limit_micro)}).
      </p>
      <svg
        className="fam-spend-chart"
        viewBox={`0 0 ${w} ${h + 18}`}
        role="img"
        aria-label={`Daily spending for the last 30 days, ${dollars(total)} in total`}
      >
        {days.map((d, i) => {
          const value = amount(d),
            height = (value / top) * h;
          return (
            <rect
              key={d.day}
              x={i * bar + 1}
              y={h - height}
              width={Math.max(bar - 2, 1)}
              height={height}
              className="fam-spend-bar"
            >
              <title>{`${d.day}: ${dollars(value)}, ${d.calls} calls`}</title>
            </rect>
          );
        })}
        <line
          x1={0}
          x2={w}
          y1={limitY}
          y2={limitY}
          className="fam-spend-limit"
        />
        <text x={0} y={h + 14} className="fam-spend-axis">
          {days[0]?.day.slice(5)}
        </text>
        <text x={w} y={h + 14} textAnchor="end" className="fam-spend-axis">
          today
        </text>
      </svg>
      <details>
        <summary>Day by day</summary>
        <table className="fam-table">
          <thead>
            <tr>
              <th scope="col">Day (UTC)</th>
              <th scope="col">Spent</th>
              <th scope="col">Calls</th>
              <th scope="col">Tokens in / out</th>
            </tr>
          </thead>
          <tbody>
            {history.value.days
              .slice()
              .reverse()
              .map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td>{dollars(amount(d))}</td>
                  <td>{d.calls}</td>
                  <td>
                    {d.input_tokens.toLocaleString()} /{" "}
                    {d.output_tokens.toLocaleString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
      <button
        type="button"
        className="fam-button"
        onClick={download}
        disabled={history.value.days.length === 0}
      >
        Download as a spreadsheet (CSV)
      </button>
    </Card>
  );
}

const directionWords: Record<string, string> = {
  instruction: "You",
  reply: "",
  event: "",
  decision: "Did",
  system: "CraftLayer",
};
function Talk({ family, player }: { family: Family; player: AiPlayerView }) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const transcript = usePolled(
    () => api.transcript(player.id),
    3000,
    family.lost,
  );
  const [text, setText] = useState(""),
    [status, setStatus] = useState<ActionStatus>(idle),
    [details, setDetails] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setStatus(idle);
    try {
      await api.instruct(player.id, text.trim());
      setText("");
      transcript.refresh();
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({ kind: "failed", text: refused(error) });
    }
  }
  const messages = (transcript.value?.messages ?? []).filter(
    (m) => details || m.direction !== "decision",
  );
  return (
    <Card title={`Talk to ${player.name}`}>
      <ol className="fam-list" aria-live="polite">
        {messages.slice(-60).map((m) => (
          <li key={m.id}>
            <span>
              <strong>
                {m.direction === "instruction"
                  ? m.author
                  : m.direction === "system"
                    ? "CraftLayer"
                    : `${player.name}${directionWords[m.direction] ? ` (${directionWords[m.direction]})` : ""}`}
                :
              </strong>{" "}
              {m.body}
              <span className="fam-quiet">
                {" "}
                · {ago(m.created_at)}
                {m.channel === "game" ? " · in game" : ""}
              </span>
            </span>
          </li>
        ))}
        {messages.length === 0 ? (
          <li className="fam-quiet">Nothing said yet.</li>
        ) : null}
      </ol>
      <label className="fam-choice">
        <input
          type="checkbox"
          checked={details}
          onChange={(e) => setDetails(e.target.checked)}
        />{" "}
        Show what it did step by step
      </label>
      <form className="fam-form" onSubmit={(e) => void send(e)}>
        <label htmlFor="fam-ai-say">Your instruction</label>
        <input
          id="fam-ai-say"
          className="fam-input"
          value={text}
          maxLength={2000}
          autoComplete="off"
          placeholder={`${player.name}, collect 16 logs and put them in the chest by the farm`}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="fam-button"
          disabled={player.desired_state !== "running"}
        >
          Send
        </button>
        {player.desired_state !== "running" ? (
          <p className="fam-quiet">
            Start {player.name} to give it instructions.
          </p>
        ) : null}
      </form>
      <StatusLine status={status} />
    </Card>
  );
}

function MemoryTab({
  family,
  player,
}: {
  family: Family;
  player: AiPlayerView;
}) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const memories = usePolled(() => api.memories(player.id), 15000, family.lost);
  const [kind, setKind] = useState<AiPlayerMemoryInput["kind"]>("note"),
    [content, setContent] = useState(""),
    [status, setStatus] = useState<ActionStatus>(idle);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      await api.addMemory(player.id, {
        kind,
        content: content.trim(),
        tags: [],
        position: null,
      });
      setContent("");
      setStatus({
        kind: "done",
        text: "Saved. It will use this from its next step.",
      });
      memories.refresh();
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({ kind: "failed", text: friendly(error) });
    }
  }
  async function forget(id: string) {
    try {
      await api.forgetMemory(player.id, id);
      memories.refresh();
    } catch (error) {
      if (!family.lost(error))
        setStatus({ kind: "failed", text: friendly(error) });
    }
  }
  return (
    <Card title="What it remembers">
      <ul className="fam-list">
        {(memories.value?.memories ?? []).map((m) => (
          <li key={m.id}>
            <span>
              <strong>{m.kind}</strong> {m.content}
              {m.position
                ? ` (at ${m.position.x}, ${m.position.y}, ${m.position.z})`
                : ""}
              <span className="fam-quiet">
                {" "}
                · {m.source === "owner" ? "from you" : "it noted"}{" "}
                {ago(m.created_at)}
              </span>
            </span>
            <button
              type="button"
              className="fam-button"
              onClick={() => void forget(m.id)}
            >
              Forget
            </button>
          </li>
        ))}
        {memories.value && memories.value.memories.length === 0 ? (
          <li className="fam-quiet">Nothing yet.</li>
        ) : null}
      </ul>
      <form className="fam-form" onSubmit={(e) => void add(e)}>
        <label htmlFor="fam-ai-mem-kind">Tell it something to remember</label>
        <select
          id="fam-ai-mem-kind"
          className="fam-input"
          value={kind}
          onChange={(e) =>
            setKind(e.target.value as AiPlayerMemoryInput["kind"])
          }
        >
          <option value="note">A note</option>
          <option value="place">A place</option>
          <option value="person">A person</option>
          <option value="fact">A fact</option>
          <option value="lesson">A lesson</option>
        </select>
        <input
          className="fam-input"
          aria-label="What to remember"
          value={content}
          maxLength={500}
          placeholder="The wood chest is next to the farm, at 120 64 -40"
          onChange={(e) => setContent(e.target.value)}
        />
        <button type="submit" className="fam-button">
          Remember this
        </button>
      </form>
      <StatusLine status={status} />
    </Card>
  );
}

function Tasks({
  family,
  player,
  refresh,
}: {
  family: Family;
  player: AiPlayerView;
  refresh(): void;
}) {
  const api = aiPlayerClient(family.organization, family.csrf);
  type Row = AiPlayerTaskInput & { key: string };
  const [rows, setRows] = useState<Row[]>(
    player.tasks.map(({ id, ...t }) => ({ ...t, key: id })),
  );
  const [status, setStatus] = useState<ActionStatus>(idle);
  const edit = (i: number, patch: Partial<Row>) =>
    setRows((old) => old.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    try {
      await api.setTasks(
        player.id,
        rows
          .filter((r) => r.title.trim() && r.goal.trim())
          .map(({ key: _key, ...task }) => task),
      );
      setStatus({
        kind: "done",
        text: "Saved. It uses these when nobody is instructing it.",
      });
      refresh();
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({ kind: "failed", text: friendly(error) });
    }
  }
  return (
    <Card title="Master tasks">
      <p className="fam-quiet">
        Jobs {player.name} may do by itself when nobody is instructing it.
        Higher priority goes first. Your direct instructions always come first.
      </p>
      {rows.map((r, i) => (
        <fieldset key={r.key} className="fam-form">
          <legend>Task {i + 1}</legend>
          <input
            className="fam-input"
            aria-label="Title"
            value={r.title}
            maxLength={80}
            placeholder="Keep the wood chest stocked"
            onChange={(e) => edit(i, { title: e.target.value })}
          />
          <input
            className="fam-input"
            aria-label="What to do"
            value={r.goal}
            maxLength={500}
            placeholder="Collect logs until the chest at 120 64 -40 has 64"
            onChange={(e) => edit(i, { goal: e.target.value })}
          />
          <label className="fam-choice">
            Priority{" "}
            <input
              type="number"
              min={1}
              max={100}
              className="fam-input"
              value={r.priority}
              onChange={(e) =>
                edit(i, { priority: Number(e.target.value) || 1 })
              }
            />
          </label>
          <select
            className="fam-input"
            aria-label="When"
            value={r.condition ?? "always"}
            onChange={(e) =>
              edit(i, {
                condition: e.target.value as AiPlayerTaskInput["condition"],
              })
            }
          >
            <option value="always">Any time</option>
            <option value="owner_online">Only when I'm in the game</option>
            <option value="day">Only in the daytime</option>
            <option value="night">Only at night</option>
          </select>
          <label className="fam-choice">
            <input
              type="checkbox"
              checked={r.enabled ?? true}
              onChange={(e) => edit(i, { enabled: e.target.checked })}
            />{" "}
            Allowed
          </label>
          <button
            type="button"
            className="fam-button"
            onClick={() => setRows((old) => old.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </fieldset>
      ))}
      <div className="fam-row">
        <button
          type="button"
          className="fam-button"
          disabled={rows.length >= 32}
          onClick={() =>
            setRows((old) => [
              ...old,
              {
                key: crypto.randomUUID(),
                title: "",
                goal: "",
                priority: 50,
                condition: "always",
                enabled: true,
              },
            ])
          }
        >
          Add a task
        </button>
        <button
          type="button"
          className="fam-button"
          onClick={() => void save()}
        >
          Save tasks
        </button>
      </div>
      <StatusLine status={status} />
    </Card>
  );
}

function ModelPicker({
  family,
  connection,
  model,
  onChange,
}: {
  family: Family;
  connection: string;
  model: string;
  onChange(connection: string, model: string): void;
}) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const connections = usePolled(() => api.connections(), 60000, family.lost);
  const models = usePolled<ModelDescriptor[]>(
    () =>
      connection
        ? api.models(connection).then((r) => r.items)
        : Promise.resolve([]),
    60000,
    family.lost,
  );
  const price = (m: ModelDescriptor) => {
    const p = m.pricing.dimensions;
    if (m.classification === "operator_local") return "free (your computer)";
    if (!p.input || !p.output) return "price unknown";
    return `$${(Number(p.input.amount) * 1e6).toFixed(2)} in / $${(Number(p.output.amount) * 1e6).toFixed(2)} out per million tokens`;
  };
  const refreshModels = models.refresh;
  useEffect(() => {
    void connection;
    refreshModels();
  }, [connection, refreshModels]);
  const usable = (models.value ?? []).filter(
    (m) => m.capabilities.tools === true,
  );
  return (
    <>
      <label htmlFor="fam-ai-conn">Where the model runs</label>
      <select
        id="fam-ai-conn"
        className="fam-input"
        value={connection}
        onChange={(e) => onChange(e.target.value, "")}
      >
        <option value="">Choose…</option>
        {(connections.value?.items ?? [])
          .filter((c) => c.enabled)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} (
              {c.kind === "openai_compatible"
                ? "OpenAI-compatible / Kong"
                : c.kind}
              )
            </option>
          ))}
      </select>
      <label htmlFor="fam-ai-model">Model</label>
      <select
        id="fam-ai-model"
        className="fam-input"
        value={model}
        onChange={(e) => onChange(connection, e.target.value)}
      >
        <option value="">Choose…</option>
        {usable.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id} · {price(m)}
          </option>
        ))}
      </select>
      {connection && models.value && usable.length === 0 ? (
        <p className="fam-quiet">
          No tool-capable models here yet. Refresh the service's models under
          Model services below.
        </p>
      ) : null}
    </>
  );
}

function Settings({
  family,
  player,
  refresh,
}: {
  family: Family;
  player: AiPlayerView;
  refresh(): void;
}) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const [persona, setPersona] = useState(player.persona),
    [rules, setRules] = useState(player.rules),
    [connection, setConnection] = useState(player.connection_id),
    [model, setModel] = useState(player.model_id),
    [daily, setDaily] = useState(
      (Number(player.daily_limit_micro) / 1e6).toFixed(2),
    ),
    [total, setTotal] = useState(
      (Number(player.total_limit_micro) / 1e6).toFixed(2),
    ),
    [names, setNames] = useState(
      player.instructors.map((i) => i.value).join(", "),
    ),
    [status, setStatus] = useState<ActionStatus>(idle),
    [removing, setRemoving] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    const dailyMicro = toMicro(daily),
      totalMicro = toMicro(total);
    if (!dailyMicro || !totalMicro) {
      setStatus({
        kind: "failed",
        text: "Limits must be dollar amounts, like 1.00.",
      });
      return;
    }
    try {
      await api.update(player.id, {
        expected_version: player.version,
        persona,
        rules,
        connection_id: connection,
        model_id: model,
        daily_limit_micro: dailyMicro,
        total_limit_micro: totalMicro,
        instructors: names
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
          .slice(0, 8)
          .map((value) => ({ kind: "name" as const, value, label: "" })),
      });
      setStatus({
        kind: "done",
        text: "Saved. A running player uses the new settings from its next step.",
      });
      refresh();
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({ kind: "failed", text: refused(error) });
    }
  }
  return (
    <Card title="Settings">
      <form className="fam-form" onSubmit={(e) => void save(e)}>
        <label htmlFor="fam-ai-persona">Personality</label>
        <textarea
          id="fam-ai-persona"
          className="fam-input"
          rows={3}
          maxLength={2000}
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
        <label htmlFor="fam-ai-rules">Standing rules</label>
        <textarea
          id="fam-ai-rules"
          className="fam-input"
          rows={3}
          maxLength={2000}
          value={rules}
          placeholder="Never break blocks near the spawn house. Ask before going far away."
          onChange={(e) => setRules(e.target.value)}
        />
        <ModelPicker
          family={family}
          connection={connection}
          model={model}
          onChange={(c, m) => {
            setConnection(c);
            setModel(m);
          }}
        />
        <label htmlFor="fam-ai-daily">Spending limit per day ($)</label>
        <input
          id="fam-ai-daily"
          className="fam-input"
          inputMode="decimal"
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
        />
        <label htmlFor="fam-ai-total">Total spending limit ($)</label>
        <input
          id="fam-ai-total"
          className="fam-input"
          inputMode="decimal"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
        <label htmlFor="fam-ai-names">
          Your in-game names (it takes instructions only from these)
        </label>
        <input
          id="fam-ai-names"
          className="fam-input"
          value={names}
          placeholder=".YourGamertag, YourJavaName"
          onChange={(e) => setNames(e.target.value)}
        />
        <p className="fam-quiet">
          In the game, start a message with its name ("{player.name}, follow
          me") or whisper to it. Joins {player.game_host}:{player.game_port} as{" "}
          {player.mc_username} (
          {player.mc_auth === "microsoft"
            ? "your Microsoft account"
            : "offline test world"}
          ).
        </p>
        <button type="submit" className="fam-button">
          Save settings
        </button>
      </form>
      <StatusLine status={status} />
      {player.desired_state === "stopped" ? (
        <button
          type="button"
          className="fam-button fam-danger"
          onClick={() => setRemoving(true)}
        >
          Remove {player.name}
        </button>
      ) : null}
      {removing ? (
        <Confirm
          title={`Remove ${player.name}?`}
          body="Its memory, conversation and spending history are removed too."
          confirm="Remove"
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            void api
              .remove(player.id)
              .then(() => {
                window.location.hash = "#/ai-players";
                refresh();
              })
              .catch((error) => {
                if (!family.lost(error))
                  setStatus({ kind: "failed", text: refused(error) });
              });
          }}
        />
      ) : null}
    </Card>
  );
}

function CreatePlayer({ family, onDone }: { family: Family; onDone(): void }) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const hosts = usePolled(() => api.hosts(), 30000, family.lost);
  const projects = usePolled(() => api.projects(), 60000, family.lost);
  const [form, setForm] = useState({
    name: "",
    persona: "Cheerful, curious and helpful. Loves building and gathering.",
    connection: "",
    model: "",
    host: "",
    gameHost: "",
    gamePort: "25565",
    username: "",
    auth: "microsoft" as "microsoft" | "offline",
    names: "",
    daily: "1.00",
    total: "10.00",
    project: "",
  });
  const [status, setStatus] = useState<ActionStatus>(idle);
  const set = (patch: Partial<typeof form>) =>
    setForm((old) => ({ ...old, ...patch }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    const daily = toMicro(form.daily),
      total = toMicro(form.total);
    if (
      !form.name.trim() ||
      !form.connection ||
      !form.model ||
      !form.username ||
      !form.gameHost ||
      !daily ||
      !total
    ) {
      setStatus({
        kind: "failed",
        text: "Fill in the name, model, server address, Minecraft name and limits.",
      });
      return;
    }
    const project = form.project || projects.value?.items[0]?.id;
    if (!project) {
      setStatus({
        kind: "failed",
        text: "Create a project in Advanced first.",
      });
      return;
    }
    try {
      await api.create({
        name: form.name.trim(),
        project_id: project,
        persona: form.persona,
        rules: "",
        connection_id: form.connection,
        model_id: form.model,
        host_id: form.host || null,
        game_host: form.gameHost.trim(),
        game_port: Number(form.gamePort) || 25565,
        game_version: "26.1",
        mc_username: form.username.trim(),
        mc_auth: form.auth,
        instructors: form.names
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
          .slice(0, 8)
          .map((value) => ({ kind: "name" as const, value, label: "" })),
        daily_limit_micro: daily,
        total_limit_micro: total,
      });
      onDone();
    } catch (error) {
      if (family.lost(error)) return;
      setStatus({ kind: "failed", text: refused(error) });
    }
  }
  return (
    <Card title="Create an AI player">
      <form className="fam-form" onSubmit={(e) => void submit(e)}>
        <label htmlFor="fam-ai-new-name">Name</label>
        <input
          id="fam-ai-new-name"
          className="fam-input"
          maxLength={32}
          placeholder="Pip"
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <label htmlFor="fam-ai-new-persona">Personality</label>
        <textarea
          id="fam-ai-new-persona"
          className="fam-input"
          rows={2}
          maxLength={2000}
          value={form.persona}
          onChange={(e) => set({ persona: e.target.value })}
        />
        <ModelPicker
          family={family}
          connection={form.connection}
          model={form.model}
          onChange={(connection, model) => set({ connection, model })}
        />
        <fieldset>
          <legend>How it signs in to Minecraft</legend>
          <label className="fam-choice">
            <input
              type="radio"
              checked={form.auth === "microsoft"}
              onChange={() => set({ auth: "microsoft" })}
            />{" "}
            With my Microsoft account (you'll get a code to approve on first
            start)
          </label>
          <label className="fam-choice">
            <input
              type="radio"
              checked={form.auth === "offline"}
              onChange={() => set({ auth: "offline" })}
            />{" "}
            Offline (private test worlds only)
          </label>
        </fieldset>
        <label htmlFor="fam-ai-new-user">Minecraft name</label>
        <input
          id="fam-ai-new-user"
          className="fam-input"
          maxLength={16}
          placeholder="Your Java name"
          value={form.username}
          onChange={(e) => set({ username: e.target.value })}
        />
        <label htmlFor="fam-ai-new-host">Server address</label>
        <input
          id="fam-ai-new-host"
          className="fam-input"
          placeholder="minecraft (inside Docker) or 100.x.y.z"
          value={form.gameHost}
          onChange={(e) => set({ gameHost: e.target.value })}
        />
        <label htmlFor="fam-ai-new-port">Server port</label>
        <input
          id="fam-ai-new-port"
          className="fam-input"
          inputMode="numeric"
          value={form.gamePort}
          onChange={(e) => set({ gamePort: e.target.value })}
        />
        <label htmlFor="fam-ai-new-names">
          Your in-game names (it takes instructions only from these)
        </label>
        <input
          id="fam-ai-new-names"
          className="fam-input"
          placeholder=".YourGamertag"
          value={form.names}
          onChange={(e) => set({ names: e.target.value })}
        />
        <label htmlFor="fam-ai-new-daily">Spending limit per day ($)</label>
        <input
          id="fam-ai-new-daily"
          className="fam-input"
          inputMode="decimal"
          value={form.daily}
          onChange={(e) => set({ daily: e.target.value })}
        />
        <label htmlFor="fam-ai-new-total">Total spending limit ($)</label>
        <input
          id="fam-ai-new-total"
          className="fam-input"
          inputMode="decimal"
          value={form.total}
          onChange={(e) => set({ total: e.target.value })}
        />
        <label htmlFor="fam-ai-new-runner">Which computer runs it</label>
        <select
          id="fam-ai-new-runner"
          className="fam-input"
          value={form.host}
          onChange={(e) => set({ host: e.target.value })}
        >
          <option value="">Choose later</option>
          {(hosts.value?.hosts ?? [])
            .filter((h) => !h.revoked)
            .map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
        </select>
        <div className="fam-row">
          <button type="submit" className="fam-button">
            Create
          </button>
          <button type="button" className="fam-button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
      <StatusLine status={status} />
    </Card>
  );
}

function Hosts({ family }: { family: Family }) {
  const api = aiPlayerClient(family.organization, family.csrf);
  const hosts = usePolled(() => api.hosts(), 30000, family.lost);
  const [label, setLabel] = useState(""),
    [token, setToken] = useState<string | null>(null),
    [status, setStatus] = useState<ActionStatus>(idle);
  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await api.createHost(label.trim() || "My computer");
      setToken(created.token);
      setLabel("");
      hosts.refresh();
    } catch (error) {
      if (!family.lost(error))
        setStatus({ kind: "failed", text: friendly(error) });
    }
  }
  async function revoke(id: string) {
    try {
      await api.revokeHost(id);
      hosts.refresh();
    } catch (error) {
      if (!family.lost(error))
        setStatus({ kind: "failed", text: friendly(error) });
    }
  }
  return (
    <Card title="Computers that run AI players">
      <ul className="fam-list">
        {(hosts.value?.hosts ?? []).map((h) => (
          <li key={h.id}>
            <span>
              {h.label}
              <span className="fam-quiet">
                {" "}
                · {h.revoked ? "removed" : `last seen ${ago(h.last_seen_at)}`}
              </span>
            </span>
            {h.revoked ? null : (
              <button
                type="button"
                className="fam-button"
                onClick={() => void revoke(h.id)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {token ? (
        <div className="fam-status fam-status-working" role="status">
          <p>
            Copy this key now; it is shown only once. Save it in a file only you
            can read (chmod 600) on the computer that runs your AI players, then
            start the AI player program there.
          </p>
          <code className="fam-key">{token}</code>
          <button
            type="button"
            className="fam-button"
            onClick={() => setToken(null)}
          >
            I've saved it
          </button>
        </div>
      ) : (
        <form className="fam-form" onSubmit={(e) => void create(e)}>
          <label htmlFor="fam-ai-host-label">Add a computer</label>
          <input
            id="fam-ai-host-label"
            className="fam-input"
            maxLength={80}
            placeholder="Family VPS"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" className="fam-button">
            Add and get its key
          </button>
        </form>
      )}
      <StatusLine status={status} />
    </Card>
  );
}
