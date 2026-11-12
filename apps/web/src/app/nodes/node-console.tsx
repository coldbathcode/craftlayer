"use client";
import {
  authoritySchema,
  itemsSchema,
  type Me,
  meSchema,
  type NodeView,
  projectSchema,
} from "@craftlayer/contracts";
import { ApiError, identityRequest, nodeClient } from "@craftlayer/sdk";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { HostServers } from "./host-servers";
import { ProvisionPlanner } from "./provision-planner";

type Project = { id: string; name: string };
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString() : "Not reported";
const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GiB`;
function state(node: NodeView) {
  if (
    node.state === "enrolling" &&
    Date.parse(node.enrollment_expires_at) <= Date.now()
  )
    return "Enrollment expired";
  return {
    awaiting_enrollment: "Awaiting agent",
    online: "Connected · read-only",
    offline: "Disconnected",
    revoked: "Revoked",
    credential_expired: "Credentials expired",
  }[node.connection];
}
export function NodeConsole() {
  const [me, setMe] = useState<Me | null>(null),
    [authBusy, setAuthBusy] = useState(true),
    [org, setOrg] = useState(""),
    [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState(""),
    [canEnroll, setCanEnroll] = useState(false),
    [permitted, setPermitted] = useState(false);
  const [nodes, setNodes] = useState<NodeView[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [name, setName] = useState("Family VPS"),
    [publicKey, setPublicKey] = useState(""),
    [certificate, setCertificate] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [rotationKey, setRotationKey] = useState(""),
    [rotationCertificate, setRotationCertificate] = useState("");
  const generation = useRef(0),
    scope = useRef(""),
    selected = nodes.find((n) => n.id === selectedId) ?? null;
  const reset = useCallback(() => {
    generation.current++;
    setNodes([]);
    setSelectedId("");
    setCursor(null);
    setError("");
    setMessage("");
    setBusy(false);
    setLoading(false);
    setConfirmation("");
    setRotationKey("");
    setRotationCertificate("");
  }, []);
  const failure = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        reset();
        setMe(null);
        setOrg("");
        setProject("");
        setError("Your session ended. Sign in again.");
      } else
        setError(
          e instanceof ApiError
            ? e.message
            : "Host management is unavailable. Refresh and try again.",
        );
    },
    [reset],
  );
  useEffect(() => {
    const abort = new AbortController();
    void identityRequest("/api/v1/auth/me", meSchema, { signal: abort.signal })
      .then((v) => {
        if (!abort.signal.aborted) {
          setMe(v);
          if (v.user.account_type === "adult")
            setOrg(v.organizations[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (
          !abort.signal.aborted &&
          !(e instanceof ApiError && e.status === 401)
        )
          failure(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setAuthBusy(false);
      });
    return () => abort.abort();
  }, [failure]);
  useEffect(() => {
    reset();
    setProjects([]);
    setProject("");
    setCanEnroll(false);
    setPermitted(false);
    if (me?.user.account_type !== "adult" || !org) return;
    const abort = new AbortController();
    void Promise.all([
      identityRequest("/api/v1/projects", itemsSchema(projectSchema), {
        organization: org,
        signal: abort.signal,
      }),
      identityRequest("/api/v1/auth/authority", authoritySchema, {
        organization: org,
        signal: abort.signal,
      }),
    ])
      .then(([p, a]) => {
        if (abort.signal.aborted) return;
        setProjects(p.items);
        setProject(p.items[0]?.id ?? "");
        setCanEnroll(a.permissions.includes("node:enroll"));
        setPermitted(a.permissions.includes("node:read"));
      })
      .catch((e) => {
        if (!abort.signal.aborted) failure(e);
      });
    return () => abort.abort();
  }, [me, org, reset, failure]);
  const load = useCallback(
    async (after?: string, signal?: AbortSignal) => {
      if (!me || !org || !project || !permitted) return;
      const epoch = generation.current,
        key = `${org}:${project}`;
      setLoading(true);
      try {
        const page = await nodeClient(org, me.csrf_token, signal).list(
          project,
          after,
        );
        if (
          signal?.aborted ||
          generation.current !== epoch ||
          scope.current !== key
        )
          return;
        setNodes((old) =>
          after
            ? [
                ...old,
                ...page.items.filter((n) => !old.some((v) => v.id === n.id)),
              ]
            : page.items,
        );
        setCursor(page.next_cursor);
        setSelectedId((old) =>
          after || page.items.some((n) => n.id === old)
            ? old
            : (page.items[0]?.id ?? ""),
        );
        setError("");
      } catch (e) {
        if (!signal?.aborted && generation.current === epoch) {
          setNodes([]);
          failure(e);
        }
      } finally {
        if (!signal?.aborted && generation.current === epoch) setLoading(false);
      }
    },
    [me, org, project, permitted, failure],
  );
  useEffect(() => {
    scope.current = `${org}:${project}`;
    reset();
    if (!project || !permitted) return;
    const abort = new AbortController();
    void load(undefined, abort.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void load(undefined, abort.signal);
    }, 10000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [org, project, permitted, load, reset]);
  async function mutate(
    fn: (api: ReturnType<typeof nodeClient>) => Promise<string>,
  ) {
    if (!me || busy) return;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const text = await fn(nodeClient(org, me.csrf_token));
      if (epoch === generation.current) {
        setMessage(text);
        await load();
      }
    } catch (e) {
      if (epoch === generation.current) failure(e);
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  function enroll(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void mutate(async (api) => {
      const receipt = await api.enroll(
        {
          project_id: project,
          name,
          public_key: publicKey.trim(),
          certificate_sha256: certificate.trim().toLowerCase(),
        },
        crypto.randomUUID(),
      );
      setPublicKey("");
      setCertificate("");
      return `Enrollment approved. Start the matching agent within five minutes. Node ${receipt.node_id}.`;
    });
  }
  const capacity = selected?.capacity,
    capacityFresh =
      capacity &&
      Date.now() - Date.parse(capacity.observed_at) <= 30000 &&
      selected?.connection === "online";
  return (
    <main className="server-shell node-shell" id="main">
      <a className="skip" href="#node-content">
        Skip to hosts
      </a>
      <header className="server-header">
        <a className="brand" href="/">
          <span className="mark">C</span>CraftLayer
          <span className="edition">CORE</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="/servers">Servers</a>
          <a aria-current="page" href="/nodes">
            Hosts
          </a>
          <a href="/account">Account</a>
        </nav>
      </header>
      <section className="server-hero node-hero">
        <div>
          <p className="eyebrow">
            <span />
            YOUR HARDWARE · YOUR CONTROL
          </p>
          <h1>
            A home for
            <br />
            <em>every world.</em>
          </h1>
          <p>
            Connect trusted Docker hosts. See their capacity.
            <br />
            Keep game data and administrative access protected.
          </p>
        </div>
        <div className="node-illustration" aria-hidden="true">
          <div>
            <i />
            <span />
            <span />
          </div>
          <div>
            <i />
            <span />
            <span />
          </div>
          <div>
            <i />
            <span />
            <span />
          </div>
          <small>PRIVATE · OUTBOUND CONNECTION</small>
        </div>
      </section>
      {error ? (
        <p className="server-error" role="alert">
          {error}
        </p>
      ) : null}
      {authBusy ? (
        <p role="status">Checking your session…</p>
      ) : !me ? (
        <section className="server-empty" id="node-content">
          <h2>Sign in to manage your hosts.</h2>
          <p>
            Host enrollment and administration require an authorized adult
            account.
          </p>
          <a className="primary" href="/account">
            Go to your account ↗
          </a>
        </section>
      ) : me.user.account_type === "child" ? (
        <section className="server-empty" id="node-content">
          <h2>Hosts are managed by your adult.</h2>
          <p>
            Infrastructure and credentials are available only to authorized
            adults.
          </p>
          <a href="/account" className="primary">
            Your account ↗
          </a>
        </section>
      ) : (
        <>
          <div className="server-toolbar">
            <label>
              Organization
              <select
                value={org}
                onChange={(e) => {
                  reset();
                  setProject("");
                  setOrg(e.target.value);
                }}
              >
                {me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                value={project}
                onChange={(e) => {
                  reset();
                  setProject(e.target.value);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="server-user">
              Signed in as <strong>{me.user.login}</strong>
            </span>
          </div>
          {!permitted ? (
            <section className="server-empty" id="node-content">
              <h2>Host access needs permission.</h2>
              <p>
                Your adult role needs node read access for this project. Server
                observation access does not grant infrastructure rights.
              </p>
            </section>
          ) : !project ? (
            <section className="server-empty" id="node-content">
              <h2>Choose a project for your hosts.</h2>
              <a className="server-link" href="/account">
                Create a project in Account ↗
              </a>
            </section>
          ) : (
            <div className="server-workspace" id="node-content">
              <aside className="server-sidebar" aria-label="Registered hosts">
                <div className="server-section-label">
                  <span>YOUR HOSTS</span>
                  <span>{nodes.length}</span>
                </div>
                {loading && !nodes.length ? (
                  <p role="status">Loading hosts…</p>
                ) : !nodes.length ? (
                  <p className="server-subtle">
                    No host is registered in this project.
                  </p>
                ) : (
                  nodes.map((n) => (
                    <button
                      type="button"
                      key={n.id}
                      aria-pressed={selectedId === n.id}
                      className={`server-selector ${selectedId === n.id ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedId(n.id);
                        setConfirmation("");
                        setRotationKey("");
                        setRotationCertificate("");
                      }}
                    >
                      <span
                        className={`server-dot ${n.connection === "online" ? "online" : ""}`}
                      />
                      <span>
                        <strong>{n.name}</strong>
                        <small>{state(n)}</small>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))
                )}
                {cursor ? (
                  <button
                    type="button"
                    className="server-text-button"
                    disabled={loading}
                    onClick={() => void load(cursor)}
                  >
                    Load more hosts
                  </button>
                ) : null}
                <div className="server-side-note">
                  <span aria-hidden="true">◇</span>
                  <p>
                    Agents connect outward.
                    <br />
                    No Docker or node-management port belongs on the public
                    internet.
                  </p>
                </div>
                {canEnroll ? (
                  <form className="server-adopt" onSubmit={enroll}>
                    <h2>Connect a host</h2>
                    <p>
                      Approve the public identity generated on your host. Keep
                      private keys on that host.
                    </p>
                    <label>
                      Host name
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={80}
                        required
                        disabled={busy}
                      />
                    </label>
                    <label>
                      Public signing key
                      <input
                        value={publicKey}
                        onChange={(e) => setPublicKey(e.target.value)}
                        required
                        pattern="[A-Za-z0-9_-]{59}"
                        disabled={busy}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Client certificate SHA-256
                      <input
                        value={certificate}
                        onChange={(e) => setCertificate(e.target.value)}
                        required
                        pattern="[a-fA-F0-9]{64}"
                        disabled={busy}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <button
                      type="submit"
                      className="server-solid"
                      disabled={busy}
                    >
                      Approve host enrollment
                    </button>
                    <p>One use · expires in five minutes · inventory only</p>
                  </form>
                ) : null}
              </aside>
              <section className="server-detail" aria-label="Host details">
                {selected ? (
                  <>
                    <div className="server-detail-heading">
                      <div>
                        <p className="eyebrow">REGISTERED DOCKER HOST</p>
                        <h2>{selected.name}</h2>
                        <p className="server-subtle">
                          Last connection · {when(selected.last_seen_at)}
                        </p>
                      </div>
                      <span className="server-state">{state(selected)}</span>
                    </div>
                    <div className="server-notice">
                      <strong>Private trust, before provisioning.</strong>
                      <p>
                        This connection verifies the agent identity. It does not
                        prove player access, backups, effective network
                        isolation or safe provisioning.
                      </p>
                    </div>
                    {selected.state === "enrolling" ? (
                      <div className="server-plan">
                        <strong>Waiting for the matching agent.</strong>
                        <p>
                          Enrollment expires{" "}
                          {when(selected.enrollment_expires_at)}. Use this node
                          ID in the agent’s private configuration:
                        </p>
                        <code className="node-id">{selected.id}</code>
                        <p>
                          Mutual TLS and the approved signing key are both
                          required. Never paste a private key here.
                        </p>
                      </div>
                    ) : null}
                    <div className="server-facts node-facts">
                      <article>
                        <span>HOST CPU</span>
                        <strong>
                          {capacity ? `${capacity.cpu_count} cores` : "Unknown"}
                        </strong>
                        <p>
                          {capacity
                            ? `${capacity.architecture} · Docker API ${capacity.docker_api}`
                            : "Awaiting a host report"}
                        </p>
                      </article>
                      <article>
                        <span>HOST MEMORY</span>
                        <strong>
                          {capacity ? gb(capacity.memory_total_mb) : "Unknown"}
                        </strong>
                        <p>
                          {capacity
                            ? `${gb(capacity.memory_reserved_mb)} declared container limits`
                            : "No capacity assumed"}
                        </p>
                      </article>
                      <article>
                        <span>CONTAINER INVENTORY</span>
                        <strong>{capacity?.container_count ?? "—"}</strong>
                        <p>
                          {capacity
                            ? `${capacity.unbounded_containers} without a memory limit`
                            : "All workloads must be considered"}
                        </p>
                      </article>
                    </div>
                    <div className="node-report-label">
                      <span className="server-dot" />
                      <p>
                        {capacity
                          ? `${capacityFresh ? "Recent" : "Stale / disconnected"} host report · ${when(capacity.observed_at)}`
                          : "Inventory is not available. No free capacity is assumed."}
                      </p>
                    </div>
                    <div className="server-lower">
                      <article className="server-panel">
                        <h3>Published Docker ports</h3>
                        <p className="server-subtle">
                          Native host services and effective firewall exposure
                          still need checks.
                        </p>
                        {capacity?.occupied_ports.length ? (
                          <ul className="node-ports">
                            {capacity.occupied_ports.map((p) => (
                              <li key={`${p.host_ip}:${p.port}:${p.protocol}`}>
                                <code>
                                  {p.host_ip}:{p.port}
                                </code>
                                <span>{p.protocol.toUpperCase()}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="server-subtle">
                            No reported Docker bindings. This does not prove a
                            port is available.
                          </p>
                        )}
                      </article>
                      <article className="server-panel">
                        <h3>Provisioning gates</h3>
                        <ul className="node-gates">
                          <li>
                            <span>○</span>Full host port/conflict inventory
                          </li>
                          <li>
                            <span>○</span>Verified storage quota and headroom
                          </li>
                          <li>
                            <span>○</span>Approved image and player policy
                          </li>
                          <li>
                            <span>○</span>Backup and recovery qualification
                          </li>
                        </ul>
                        <p className="server-subtle">
                          Server creation stays unavailable until these checks
                          and the constrained broker are ready.
                        </p>
                      </article>
                    </div>
                    <article className="server-panel">
                      <div className="server-panel-title">
                        <h3>Credential health</h3>
                        <span className="server-pill">
                          mTLS + SIGNED PROOFS
                        </span>
                      </div>
                      <dl>
                        <dt>Generation</dt>
                        <dd>{selected.credential_version}</dd>
                        <dt>Expires</dt>
                        <dd>{when(selected.credential_expires_at)}</dd>
                        <dt>Node ID</dt>
                        <dd className="node-id">{selected.id}</dd>
                      </dl>
                      <p className="server-subtle">
                        Rotate before expiry. A credential change never starts
                        or stops a game server.
                      </p>
                    </article>
                    {selected.state === "active" ? (
                      <HostServers
                        key={`${org}:${selected.id}`}
                        node={selected}
                        organization={org}
                        csrf={me.csrf_token}
                        onSessionFailure={failure}
                      />
                    ) : null}
                    {selected.can_plan ? (
                      <ProvisionPlanner
                        key={`${org}:${selected.id}:${selected.version}`}
                        node={selected}
                        organization={org}
                        csrf={me.csrf_token}
                        onSessionFailure={failure}
                      />
                    ) : null}
                    <div className="server-actions">
                      <button
                        type="button"
                        className="server-secondary"
                        disabled={loading || busy}
                        onClick={() => void load()}
                      >
                        Refresh hosts
                      </button>
                      <a className="server-link" href="/servers">
                        View servers ↗
                      </a>
                    </div>
                    {selected.can_rotate ? (
                      <details className="server-unregister">
                        <summary>Rotate credentials</summary>
                        <form
                          className="node-rotation"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void mutate(async (api) => {
                              await api.rotate(
                                selected.id,
                                {
                                  expected_version: selected.version,
                                  public_key: rotationKey.trim(),
                                  certificate_sha256: rotationCertificate
                                    .trim()
                                    .toLowerCase(),
                                },
                                crypto.randomUUID(),
                              );
                              setRotationKey("");
                              setRotationCertificate("");
                              return "Credentials rotated. The old certificate and key can no longer report. Restart the agent with its new identity.";
                            });
                          }}
                        >
                          <p>
                            Generate a new signing key and signed client
                            certificate on the host. Replacing the approved
                            identity disconnects its old credentials
                            immediately.
                          </p>
                          <label>
                            New public signing key
                            <input
                              required
                              pattern="[A-Za-z0-9_-]{59}"
                              value={rotationKey}
                              onChange={(e) => setRotationKey(e.target.value)}
                              disabled={busy}
                            />
                          </label>
                          <label>
                            New client certificate SHA-256
                            <input
                              required
                              pattern="[a-fA-F0-9]{64}"
                              value={rotationCertificate}
                              onChange={(e) =>
                                setRotationCertificate(e.target.value)
                              }
                              disabled={busy}
                            />
                          </label>
                          <button
                            className="server-secondary"
                            type="submit"
                            disabled={busy}
                          >
                            Rotate host credentials
                          </button>
                        </form>
                      </details>
                    ) : null}
                    {selected.can_revoke ? (
                      <details className="server-unregister">
                        <summary>Revoke host connection</summary>
                        <p>
                          This blocks future accepted agent messages.
                          Containers, worlds and backups remain on the host.
                        </p>
                        <label>
                          Type {selected.name} to revoke
                          <input
                            value={confirmation}
                            onChange={(e) => setConfirmation(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="server-secondary"
                          disabled={busy || confirmation !== selected.name}
                          onClick={() =>
                            void mutate(async (api) => {
                              await api.revoke(
                                selected.id,
                                selected.version,
                                crypto.randomUUID(),
                              );
                              setConfirmation("");
                              return "Host connection revoked. No container or world was stopped, removed or changed.";
                            })
                          }
                        >
                          Revoke host credentials
                        </button>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <div className="server-empty server-detail-empty">
                    <p className="eyebrow">A TRUSTED CONNECTION COMES FIRST</p>
                    <h2>Bring your hardware into view.</h2>
                    <p>
                      Approve a host identity, then run its outbound agent.
                      World files stay on their existing host.
                    </p>
                    <span className="server-pill">NO PUBLIC ADMIN PORTS</span>
                  </div>
                )}
                {message ? (
                  <p className="server-message" role="status">
                    {message}
                  </p>
                ) : null}
              </section>
            </div>
          )}
        </>
      )}
      <footer className="server-footer">
        <span>CraftLayer Core · Your hardware. Your worlds.</span>
        <span>Private node control · No Cloud dependency</span>
      </footer>
    </main>
  );
}
