"use client";
import {
  environmentSchema,
  itemsSchema,
  type NodeView,
  type ProvisionPlan,
  type ServerTemplate,
} from "@craftlayer/contracts";
import { ApiError, identityRequest, nodeClient } from "@craftlayer/sdk";
import { type FormEvent, useEffect, useRef, useState } from "react";

export function ProvisionPlanner({
  node,
  organization,
  csrf,
  onSessionFailure,
}: {
  node: NodeView;
  organization: string;
  csrf: string;
  onSessionFailure: (e: unknown) => void;
}) {
  const [template, setTemplate] = useState<ServerTemplate | null>(null),
    [environments, setEnvironments] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [environment, setEnvironment] = useState(""),
    [name, setName] = useState("Family Survival"),
    [javaPort, setJavaPort] = useState("25565"),
    [bedrockPort, setBedrockPort] = useState("19132"),
    [plan, setPlan] = useState<ProvisionPlan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const generation = useRef(0),
    abortRequest = useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly retries a failed bootstrap without remounting the form.
  useEffect(() => {
    const abort = new AbortController();
    generation.current++;
    setLoading(true);
    setError("");
    setPlan(null);
    setTemplate(null);
    setEnvironments([]);
    setEnvironment("");
    void Promise.all([
      nodeClient(organization, csrf, abort.signal).templates(node.id),
      identityRequest("/api/v1/environments", itemsSchema(environmentSchema), {
        organization,
        signal: abort.signal,
      }),
    ])
      .then(([templates, worlds]) => {
        if (abort.signal.aborted) return;
        const choices = worlds.items.filter(
          (e) => e.project_id === node.project_id && e.type === "minecraft",
        );
        setTemplate(templates.items[0] ?? null);
        setEnvironments(choices);
        setEnvironment(choices[0]?.id ?? "");
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          if (e instanceof ApiError && e.status === 401) onSessionFailure(e);
          else
            setError(
              "The planner could not load your authorized template and worlds. Check your permissions and retry.",
            );
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      abortRequest.current?.abort();
      generation.current++;
    };
  }, [
    organization,
    csrf,
    node.id,
    node.project_id,
    revision,
    onSessionFailure,
  ]);
  function changed() {
    generation.current++;
    abortRequest.current?.abort();
    setPlan(null);
    setError("");
    setBusy(false);
  }
  async function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!template || !environment || busy) return;
    const current = ++generation.current,
      abort = new AbortController();
    abortRequest.current?.abort();
    abortRequest.current = abort;
    setBusy(true);
    setError("");
    setPlan(null);
    try {
      const result = await nodeClient(organization, csrf, abort.signal).plan({
        node_id: node.id,
        environment_id: environment,
        template_id: template.id,
        name,
        java_port: Number(javaPort),
        bedrock_port: Number(bedrockPort),
      });
      if (!abort.signal.aborted && generation.current === current)
        setPlan(result);
    } catch (e) {
      if (!abort.signal.aborted && generation.current === current) {
        if (e instanceof ApiError && e.status === 401) onSessionFailure(e);
        else
          setError(
            "Preview denied or unavailable. Check current project, world and deployment permissions, then try again.",
          );
      }
    } finally {
      if (!abort.signal.aborted && generation.current === current)
        setBusy(false);
    }
  }
  const expired = plan !== null && Date.parse(plan.expires_at) <= Date.now();
  return (
    <article
      className="server-panel provision-planner"
      id="provision-plan"
      aria-label="Minecraft deployment planner"
    >
      <div className="server-panel-title">
        <h3>Plan a Minecraft server</h3>
        <span className="server-pill">PREVIEW</span>
      </div>
      <p className="server-subtle">
        Choose a separate new world on {node.name}. Preview requirements and
        conflicts before any resources are created.
      </p>
      {loading ? (
        <p role="status">Loading your template and worlds…</p>
      ) : error && !template ? (
        <>
          <p role="alert" className="server-error">
            {error}
          </p>
          <button
            className="server-secondary"
            type="button"
            onClick={() => setRevision((v) => v + 1)}
          >
            Reload planner
          </button>
        </>
      ) : !template ? (
        <p>No approved planning template is available.</p>
      ) : (
        <>
          <div className="provision-template">
            <div>
              <p className="eyebrow">FAMILY SURVIVAL</p>
              <h4>A world of your own.</h4>
              <p>Paper · Java + Bedrock crossplay</p>
            </div>
            <div>
              <strong>4 GiB heap</strong>
              <span>6 GiB container · 2 CPU cores</span>
              <span>20 GiB world quota · daily backups</span>
            </div>
          </div>
          <p className="server-subtle">
            Online authentication · enforced allowlist · private server control
            · empty operator list. These are planned settings; no game server
            has been started.
          </p>
          {!environments.length ? (
            <p>
              Create a Minecraft world in this project through{" "}
              <a className="server-link" href="/account">
                Account ↗
              </a>{" "}
              to select its access scope.
            </p>
          ) : (
            <form onSubmit={(e) => void preview(e)} className="provision-form">
              <label>
                Server name
                <input
                  value={name}
                  maxLength={80}
                  required
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setName(e.target.value);
                  }}
                />
              </label>
              <label>
                World access scope
                <select
                  value={environment}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setEnvironment(e.target.value);
                  }}
                >
                  {environments.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Java TCP port
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  required
                  value={javaPort}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setJavaPort(e.target.value);
                  }}
                />
              </label>
              <label>
                Bedrock UDP port
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  required
                  value={bedrockPort}
                  disabled={busy}
                  onChange={(e) => {
                    changed();
                    setBedrockPort(e.target.value);
                  }}
                />
              </label>
              <button className="server-solid" type="submit" disabled={busy}>
                {busy ? "Checking requirements…" : "Preview deployment"}
              </button>
            </form>
          )}
          {error && template ? (
            <p className="server-error" role="alert">
              {error}
            </p>
          ) : null}
          {plan ? (
            <section
              className="provision-result"
              aria-label="Deployment preview"
            >
              <p role="status" className="server-message">
                Preview calculated. No resources created or reserved.
              </p>
              <h4>Server creation is blocked.</h4>
              <p className="server-subtle">
                {expired
                  ? "This preview expired. Calculate it again for current host facts."
                  : `Calculated ${new Date(plan.calculated_at).toLocaleTimeString()} · valid for 30 seconds.`}{" "}
                All required checks and approvals must pass before creation can
                be enabled.
              </p>
              <ul className="provision-checks">
                {plan.gates.map((g) => (
                  <li key={g.id} className={`provision-check ${g.state}`}>
                    <span aria-hidden="true">
                      {g.state === "passed"
                        ? "✓"
                        : g.state === "failed"
                          ? "×"
                          : "○"}
                    </span>
                    <div>
                      <strong>{g.title}</strong>
                      <span>
                        {g.state === "passed"
                          ? "Checked"
                          : g.state === "failed"
                            ? "Blocked"
                            : "Not verified"}
                      </span>
                      <p>{g.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <details>
                <summary>Version manifest and preview identity</summary>
                <p>
                  The candidate versions below are pinned, with compatibility
                  and a complete runnable image still awaiting qualification.
                </p>
                <ul>
                  {template.artifacts.map((a) => (
                    <li key={a.component}>
                      {a.component} {a.version} · build {a.build}
                      <code className="node-id">SHA-256 {a.sha256}</code>
                    </li>
                  ))}
                </ul>
                <p className="node-id">Plan {plan.plan_hash}</p>
                <p className="server-subtle">
                  This digest identifies a preview. It is not an approval,
                  reservation or deployment operation. The Minecraft EULA
                  remains unaccepted.
                </p>
              </details>
            </section>
          ) : null}
        </>
      )}
    </article>
  );
}
