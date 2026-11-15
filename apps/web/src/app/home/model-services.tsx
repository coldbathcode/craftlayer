"use client";
import type { ProviderEndpoint } from "@craftlayer/contracts";
import { aiPlayerClient } from "@craftlayer/sdk";
import { type FormEvent, useMemo, useState } from "react";
import { friendly } from "./lib";
import { Card, StatusLine } from "./parts";
import { paidPolicy, roomFor } from "./spending";
import type { ActionStatus } from "./use-action";
import { type Family, usePolled } from "./use-family";

const idle: ActionStatus = { kind: "idle" };
const dollars = (micro: string | number) =>
  `$${(Number(micro) / 1_000_000).toFixed(2)}`;
function toMicro(text: string): string | null {
  const value = Number(text.replace(/^\$/, "").trim());
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return null;
  return Math.round(value * 1_000_000).toString();
}

const flavorWords: Record<ProviderEndpoint["flavor"], string> = {
  openrouter: "OpenRouter: hundreds of models with one key",
  ollama: "Ollama on your own computer: free",
  kong_ai_gateway: "Kong AI Gateway",
  generic: "OpenAI-compatible service",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  google_gemini: "Google Gemini",
};

/**
 * Master plan G10: connect a model service with a pasted key and decide how much
 * paid models may cost per hour, without the API console. The API checks
 * `provider:manage` and `budget:manage` on every call.
 */
export function ModelServices({ family }: { family: Family }) {
  const api = useMemo(
    () => aiPlayerClient(family.organization, family.csrf),
    [family],
  );
  const endpoints = usePolled(() => api.endpoints(), 60000, family.lost);
  const connections = usePolled(() => api.connections(), 30000, family.lost);
  const policy = usePolled(
    () => api.policy("organization", family.organization),
    30000,
    family.lost,
  );
  const [choice, setChoice] = useState(""),
    [secret, setSecret] = useState(""),
    [hourly, setHourly] = useState(""),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [status, setStatus] = useState<ActionStatus>(idle);
  const fail = (error: unknown) => {
    if (!family.lost(error))
      setStatus({ kind: "failed", text: friendly(error) });
  };
  const available = endpoints.value?.items ?? [];
  const chosen = available.find((e) => `${e.kind}/${e.endpoint_id}` === choice);
  const paid = endpoints.value?.paid;

  async function refresh(id: string) {
    setStatus({ kind: "working", text: "Asking for its models…" });
    try {
      const models = await api.refreshModels(id);
      const usable = models.items.filter((m) => m.capabilities.tools === true);
      setCounts((c) => ({ ...c, [id]: usable.length }));
      setStatus({
        kind: "done",
        text: `${usable.length} model${usable.length === 1 ? "" : "s"} an AI player can use.`,
      });
    } catch (error) {
      fail(error);
    }
  }
  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    if (chosen.needs_secret && secret.trim().length < 16)
      return setStatus({
        kind: "failed",
        text: "Paste the whole key from the service's website.",
      });
    setStatus({ kind: "working", text: "Connecting…" });
    try {
      const created = await api.connect({
        kind: chosen.kind,
        endpoint_id: chosen.endpoint_id,
        label: chosen.label,
        ...(chosen.needs_secret ? { secret: secret.trim() } : {}),
      });
      setSecret("");
      setChoice("");
      connections.refresh();
      await refresh(created.id);
    } catch (error) {
      setSecret("");
      fail(error);
    }
  }
  async function toggle(id: string, version: number, enabled: boolean) {
    try {
      await api.setConnectionEnabled(id, version, enabled);
      connections.refresh();
    } catch (error) {
      fail(error);
    }
  }
  async function saveSpending(microUsd: string) {
    setStatus({ kind: "working", text: "Saving…" });
    try {
      const me = family.me.user.id;
      const projects = (await api.projects()).items;
      const current = await api.policy("organization", family.organization);
      await api.setPolicy(
        "organization",
        family.organization,
        current.version,
        paidPolicy(current.policy, microUsd),
      );
      const scopes: Array<["organization" | "user" | "project", string]> = [
        ["organization", family.organization],
        ["user", me],
        ...projects.map((p): ["project", string] => ["project", p.id]),
      ];
      for (const [kind, id] of scopes) {
        const budget = await api.budget(kind, id);
        await api.setBudget(
          kind,
          id,
          budget.version,
          roomFor(budget.limits, microUsd),
        );
      }
      policy.refresh();
      setHourly("");
      setStatus({
        kind: "done",
        text:
          microUsd === "0"
            ? "Only free models now."
            : `Paid models allowed, up to ${dollars(microUsd)} an hour. Each AI player's own daily and total limits still apply.`,
      });
    } catch (error) {
      fail(error);
    }
  }
  function submitSpending(e: FormEvent) {
    e.preventDefault();
    const micro = toMicro(hourly);
    if (!micro || micro === "0")
      return setStatus({
        kind: "failed",
        text: "Enter an amount such as 1.00.",
      });
    if (paid && BigInt(micro) > BigInt(paid.max_micro_usd))
      return setStatus({
        kind: "failed",
        text: `This CraftLayer allows at most ${dollars(paid.max_micro_usd)} an hour.`,
      });
    void saveSpending(micro);
  }

  const current = policy.value?.policy;
  return (
    <Card title="Model services">
      <p className="fam-quiet">
        Where your AI players' thinking happens. Keys are stored sealed and are
        never shown again.
      </p>
      <ul className="fam-list">
        {(connections.value?.items ?? []).map((c) => (
          <li key={c.id}>
            <span>
              {c.label}
              <span className="fam-quiet">
                {" "}
                · {c.enabled ? "on" : "off"}
                {counts[c.id] !== undefined
                  ? ` · ${counts[c.id]} usable model${counts[c.id] === 1 ? "" : "s"}`
                  : ""}
              </span>
            </span>
            <span className="fam-row">
              <button
                type="button"
                className="fam-button"
                onClick={() => void refresh(c.id)}
                disabled={!c.enabled}
              >
                Refresh models
              </button>
              <button
                type="button"
                className="fam-button"
                onClick={() => void toggle(c.id, c.version, !c.enabled)}
              >
                {c.enabled ? "Turn off" : "Turn on"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {endpoints.value && available.length === 0 ? (
        <p className="fam-quiet">
          No model services are set up on this CraftLayer yet. Whoever runs the
          server adds them to its provider settings first.
        </p>
      ) : (
        <form className="fam-form" onSubmit={(e) => void connect(e)}>
          <label htmlFor="fam-model-service">Connect a service</label>
          <select
            id="fam-model-service"
            className="fam-input"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
          >
            <option value="">Choose…</option>
            {available.map((e) => (
              <option
                key={`${e.kind}/${e.endpoint_id}`}
                value={`${e.kind}/${e.endpoint_id}`}
              >
                {e.label} · {flavorWords[e.flavor]}
              </option>
            ))}
          </select>
          {chosen?.needs_secret ? (
            <>
              <label htmlFor="fam-model-key">Its API key</label>
              <input
                id="fam-model-key"
                className="fam-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </>
          ) : null}
          <button type="submit" className="fam-button" disabled={!chosen}>
            Connect
          </button>
        </form>
      )}
      <h3 className="fam-subtitle">Paying for models</h3>
      {!paid ? null : !paid.allowed ? (
        <p className="fam-quiet">
          Paid models are switched off for this CraftLayer. Only free models can
          be used.
        </p>
      ) : (
        <>
          <p>
            {current && !current.free_only && current.max_paid_micro_usd !== "0"
              ? `Paid models allowed, up to ${dollars(current.max_paid_micro_usd)} an hour across the family.`
              : "Only free models for now."}
          </p>
          <form className="fam-form" onSubmit={submitSpending}>
            <label htmlFor="fam-model-hourly">
              Allow paid models, up to this much an hour ($, at most{" "}
              {dollars(paid.max_micro_usd)})
            </label>
            <input
              id="fam-model-hourly"
              className="fam-input"
              inputMode="decimal"
              placeholder="1.00"
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
            />
            <div className="fam-row">
              <button type="submit" className="fam-button">
                Allow paid models
              </button>
              {current && !current.free_only ? (
                <button
                  type="button"
                  className="fam-button"
                  onClick={() => void saveSpending("0")}
                >
                  Free models only
                </button>
              ) : null}
            </div>
          </form>
        </>
      )}
      <StatusLine status={status} />
    </Card>
  );
}
