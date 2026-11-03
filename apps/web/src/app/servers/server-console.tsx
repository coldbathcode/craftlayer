"use client";
import {
  type adoptionPlan,
  authoritySchema,
  type Environment,
  environmentSchema,
  itemsSchema,
  type Me,
  meSchema,
  type pendingIdentityEnrollment,
  type playersView,
  type ServerView,
  type serverActivity,
  type targetView,
} from "@craftlayer/contracts";
import { ApiError, identityRequest, minecraftClient } from "@craftlayer/sdk";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { z } from "zod";

type Plan = z.infer<typeof adoptionPlan>;
type Target = z.infer<typeof targetView>;
type Players = z.infer<typeof playersView>;
type Enrollment = z.infer<typeof pendingIdentityEnrollment>;
type Activity = z.infer<typeof serverActivity>;
function observed(server: ServerView) {
  if (!server.registered) return "Registration removed";
  const o = server.observation;
  if (!o) return "Not observed";
  if (o.freshness === "stale") return "Stale observation";
  return o.state === "online"
    ? "Observed online"
    : o.state === "offline"
      ? "Observed offline"
      : "Observation unavailable";
}
function setting(value: boolean | null | undefined) {
  return value === true
    ? "Configured"
    : value === false
      ? "Not configured"
      : "Unknown";
}
function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "No observation yet";
}
function Terrain() {
  return (
    <svg viewBox="0 0 230 130" role="img" aria-label="A quiet block landscape">
      <path d="M10 90 105 35 220 85 125 138Z" fill="#c3cba8" />
      <path d="M10 78 105 23 220 73 125 126Z" fill="#a7bb87" />
      <path d="m125 126 95-53v13l-95 52Z" fill="#6c8b65" />
      <path d="m10 78 115 48v12L10 90Z" fill="#8b956c" />
      <path d="m65 65 39-23 38 17-39 23Z" fill="#ead4a4" />
      <path d="m65 65 38 17v34L65 98Z" fill="#c0a16f" />
      <path d="m103 82 39-23v34l-39 23Z" fill="#ac8b5b" />
      <path d="m59 59 39-28 49 22-45 27Z" fill="#315f47" />
      <path d="m102 80 45-27v9l-45 27Z" fill="#244c3d" />
      <path d="m119 94 10-6v17l-10 6Z" fill="#5c5039" />
      <path d="m174 63 8 4v24l-8-4Z" fill="#876b4b" />
      <path d="m153 44 21-12 27 12-21 13Z" fill="#537b53" />
      <path d="m153 44 27 13v22l-27-12Z" fill="#668a59" />
      <path d="m180 57 21-13v22l-21 13Z" fill="#3d6848" />
    </svg>
  );
}
export function ServerConsole() {
  const [me, setMe] = useState<Me | null>(null),
    [authBusy, setAuthBusy] = useState(true),
    [org, setOrg] = useState(""),
    [worlds, setWorlds] = useState<Environment[]>([]),
    [world, setWorld] = useState("");
  const [servers, setServers] = useState<ServerView[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState(""),
    [targets, setTargets] = useState<Target[]>([]),
    [canAdopt, setCanAdopt] = useState(false),
    [canAudit, setCanAudit] = useState(false),
    [canEnroll, setCanEnroll] = useState(false);
  const [players, setPlayers] = useState<Players | null>(null),
    [activity, setActivity] = useState<Activity["items"]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState("Family survival"),
    [target, setTarget] = useState(""),
    [plan, setPlan] = useState<Plan | null>(null),
    [confirmation, setConfirmation] = useState("");
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]),
    [enrollmentCursor, setEnrollmentCursor] = useState<string | null>(null),
    [enrollmentName, setEnrollmentName] = useState(""),
    [enrollmentEdition, setEnrollmentEdition] = useState<"java" | "bedrock">(
      "java",
    );
  const detailGeneration = useRef(0);
  const generation = useRef(0),
    scope = useRef("");
  const selected = servers.find((s) => s.id === selectedId) ?? null;
  const reset = useCallback(() => {
    generation.current++;
    detailGeneration.current++;
    setServers([]);
    setSelectedId("");
    setCursor(null);
    setTargets([]);
    setPlayers(null);
    setActivity([]);
    setPlan(null);
    setMessage("");
    setError("");
    setBusy(false);
    setConfirmation("");
    setEnrollments([]);
    setEnrollmentCursor(null);
    setEnrollmentName("");
  }, []);
  const failure = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setOrg("");
        setWorld("");
        reset();
        setError("Your session ended. Sign in again to continue.");
      } else
        setError(
          e instanceof ApiError
            ? e.message
            : "The observation service is unavailable. Try again.",
        );
    },
    [reset],
  );
  useEffect(() => {
    const abort = new AbortController();
    identityRequest("/api/v1/auth/me", meSchema, { signal: abort.signal })
      .then((v) => {
        if (abort.signal.aborted) return;
        setMe(v);
        if (v.user.account_type === "adult")
          setOrg(v.organizations[0]?.id ?? "");
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
    if (me?.user.account_type !== "adult" || !org) return;
    const abort = new AbortController();
    setWorlds([]);
    setWorld("");
    reset();
    Promise.all([
      identityRequest("/api/v1/environments", itemsSchema(environmentSchema), {
        organization: org,
        signal: abort.signal,
      }),
      identityRequest("/api/v1/auth/authority", authoritySchema, {
        organization: org,
        signal: abort.signal,
      }),
    ])
      .then(([env, a]) => {
        if (abort.signal.aborted) return;
        const worlds = env.items.filter((e) => e.type === "minecraft");
        setWorlds(worlds);
        setWorld(worlds[0]?.id ?? "");
        setCanAdopt(a.permissions.includes("server:adopt"));
        setCanAudit(a.can_read_audit);
        setCanEnroll(a.permissions.includes("player:enroll"));
      })
      .catch((e) => {
        if (!abort.signal.aborted) failure(e);
      });
    return () => abort.abort();
  }, [me, org, reset, failure]);
  const load = useCallback(
    async (appendCursor?: string, signal?: AbortSignal) => {
      if (!me || !org || !world) return;
      const key = `${org}:${world}`,
        epoch = generation.current;
      const api = minecraftClient(org, me.csrf_token, signal);
      setLoading(true);
      try {
        const [page, sources] = await Promise.all([
          api.list(world, appendCursor),
          canAdopt
            ? api.targets(world).catch(() => ({ items: [] as Target[] }))
            : Promise.resolve({ items: [] as Target[] }),
        ]);
        if (
          signal?.aborted ||
          scope.current !== key ||
          generation.current !== epoch
        )
          return;
        setServers((old) =>
          appendCursor
            ? [
                ...old,
                ...page.items.filter((v) => !old.some((s) => s.id === v.id)),
              ]
            : page.items,
        );
        setCursor(page.next_cursor);
        setTargets(sources.items);
        setTarget((old) =>
          sources.items.some((t) => t.id === old)
            ? old
            : (sources.items[0]?.id ?? ""),
        );
        setSelectedId((old) =>
          page.items.some((s) => s.id === old) || appendCursor
            ? old
            : (page.items[0]?.id ?? ""),
        );
        setError("");
      } catch (e) {
        if (
          !signal?.aborted &&
          scope.current === key &&
          generation.current === epoch
        ) {
          setServers([]);
          setPlayers(null);
          setActivity([]);
          failure(e);
        }
      } finally {
        if (
          !signal?.aborted &&
          scope.current === key &&
          generation.current === epoch
        )
          setLoading(false);
      }
    },
    [me, org, world, canAdopt, failure],
  );
  useEffect(() => {
    scope.current = `${org}:${world}`;
    reset();
    if (!world) return;
    const abort = new AbortController();
    void load(undefined, abort.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void load(undefined, abort.signal);
    }, 30000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [org, world, load, reset]);
  useEffect(() => {
    detailGeneration.current++;
    setPlayers(null);
    setActivity([]);
    setEnrollments([]);
    setEnrollmentCursor(null);
    setConfirmation("");
    if (!selected || !me) return;
    const abort = new AbortController(),
      api = minecraftClient(org, me.csrf_token, abort.signal);
    void api
      .players(selected.id)
      .then((v) => {
        if (!abort.signal.aborted) setPlayers(v);
      })
      .catch((e) => {
        if (!abort.signal.aborted && e instanceof ApiError && e.status === 401)
          failure(e);
      });
    void api
      .identityEnrollments(selected.id)
      .then((v) => {
        if (!abort.signal.aborted) {
          setEnrollments(v.items);
          setEnrollmentCursor(v.next_cursor);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && e instanceof ApiError && e.status === 401)
          failure(e);
      });
    if (canAudit)
      void api
        .activity(selected.id)
        .then((v) => {
          if (!abort.signal.aborted) setActivity(v.items);
        })
        .catch((e) => {
          if (
            !abort.signal.aborted &&
            e instanceof ApiError &&
            e.status === 401
          )
            failure(e);
        });
    return () => abort.abort();
  }, [selected, me, org, canAudit, failure]);
  async function moreEnrollments() {
    if (!me || !selected || !enrollmentCursor || busy) return;
    const epoch = detailGeneration.current;
    setBusy(true);
    try {
      const page = await minecraftClient(
        org,
        me.csrf_token,
      ).identityEnrollments(selected.id, enrollmentCursor);
      if (epoch === detailGeneration.current) {
        setEnrollments((old) => [...old, ...page.items]);
        setEnrollmentCursor(page.next_cursor);
      }
    } catch (e) {
      if (epoch === detailGeneration.current) failure(e);
    } finally {
      setBusy(false);
    }
  }
  async function action(
    fn: (api: ReturnType<typeof minecraftClient>) => Promise<string>,
  ) {
    if (!me || busy) return;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const text = await fn(minecraftClient(org, me.csrf_token));
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
  async function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!me) return;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    try {
      const v = await minecraftClient(org, me.csrf_token).plan({
        environment_id: world,
        target_id: target,
        name,
      });
      if (epoch === generation.current) setPlan(v);
    } catch (e) {
      if (epoch === generation.current) failure(e);
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  }
  return (
    <main id="main" className="server-shell">
      <a className="skip" href="#server-content">
        Skip to server overview
      </a>
      <header className="server-header">
        <a className="brand" href="/" aria-label="CraftLayer home">
          <span className="mark">C</span>CraftLayer
          <span className="edition">CORE</span>
        </a>
        <nav aria-label="Main navigation">
          <a aria-current="page" href="/servers">
            Servers
          </a>
          <a href="/nodes">Hosts</a>
          <a href="/account">Account</a>
        </nav>
      </header>
      <section className="server-hero">
        <div>
          <p className="eyebrow">
            <span />
            YOUR PRIVATE CORNER OF THE WORLD
          </p>
          <h1>
            Family servers.
            <br />
            <em>Clearly in view.</em>
          </h1>
          <p>
            See what’s happening, know what needs attention.
            <br />
            Your worlds stay right where they are.
          </p>
        </div>
        <div className="server-landscape">
          <Terrain />
          <span className="server-pill">READ-ONLY PREVIEW</span>
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
        <section className="server-empty" id="server-content">
          <p className="eyebrow">WELCOME HOME</p>
          <h2>Sign in to see your servers.</h2>
          <p>
            Use your existing CraftLayer account. Your organization controls
            which worlds you can view.
          </p>
          <a className="primary" href="/account">
            Go to your account <span aria-hidden="true">↗</span>
          </a>
        </section>
      ) : me.user.account_type === "child" ? (
        <section className="server-empty" id="server-content">
          <h2>Managed by your adult.</h2>
          <p>
            Server administration is available to authorized adults. Find your
            assigned worlds in your account.
          </p>
          <a className="primary" href="/account">
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
                  setWorld("");
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
              Minecraft world
              <select
                value={world}
                onChange={(e) => {
                  reset();
                  setWorld(e.target.value);
                }}
              >
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="server-user">
              Signed in as <strong>{me.user.login}</strong>
            </span>
          </div>
          {!world ? (
            <section className="server-empty" id="server-content">
              <h2>Give your world a place here.</h2>
              <p>
                Add a Minecraft environment in Account, or ask your
                administrator to assign one to you.
              </p>
              <a className="server-link" href="/account">
                Manage world assignments ↗
              </a>
            </section>
          ) : (
            <div className="server-workspace" id="server-content">
              <aside className="server-sidebar" aria-label="Registered servers">
                <div className="server-section-label">
                  <span>YOUR SERVERS</span>
                  <span>{servers.length}</span>
                </div>
                {loading && !servers.length ? (
                  <p role="status">Loading observations…</p>
                ) : !servers.length ? (
                  <p className="server-subtle">
                    No server registered in this world yet.
                  </p>
                ) : (
                  servers.map((s) => (
                    <button
                      type="button"
                      className={`server-selector ${selectedId === s.id ? "selected" : ""}`}
                      aria-pressed={selectedId === s.id}
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <span
                        className={`server-dot ${s.observation?.state === "online" && s.observation.freshness === "fresh" ? "online" : ""}`}
                      />
                      <span>
                        <strong>{s.name}</strong>
                        <small>{observed(s)}</small>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))
                )}
                {cursor ? (
                  <button
                    type="button"
                    className="server-text-button"
                    onClick={() => void load(cursor)}
                    disabled={loading}
                  >
                    Load more servers
                  </button>
                ) : null}
                <div className="server-side-note">
                  <span aria-hidden="true">◇</span>
                  <p>
                    Observation comes first.
                    <br />
                    Game controls stay unavailable in this preview.
                  </p>
                </div>
                {canAdopt ? (
                  <form className="server-adopt" onSubmit={preview}>
                    <h2>Adopt existing</h2>
                    <p>Register an approved server in place.</p>
                    {targets.length ? (
                      <>
                        <label>
                          Approved source
                          <select
                            disabled={busy}
                            value={target}
                            onChange={(e) => {
                              setTarget(e.target.value);
                              setPlan(null);
                            }}
                          >
                            {targets.map((t) => (
                              <option value={t.id} key={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Display name
                          <input
                            disabled={busy}
                            value={name}
                            maxLength={100}
                            required
                            onChange={(e) => {
                              setName(e.target.value);
                              setPlan(null);
                            }}
                          />
                        </label>
                        <button
                          type="submit"
                          className="server-secondary"
                          disabled={busy}
                        >
                          Preview registration
                        </button>
                      </>
                    ) : (
                      <p className="server-subtle">
                        Ask your instance administrator to connect an approved
                        read-only source.
                      </p>
                    )}
                    {plan ? (
                      <div className="server-plan" role="status">
                        <strong>Ready to register {plan.name}</strong>
                        <p>
                          Source: {plan.target.label}. Registration only; no
                          container or world changes.
                        </p>
                        <button
                          type="button"
                          className="server-solid"
                          disabled={busy}
                          onClick={() =>
                            void action(async (api) => {
                              const r = await api.adopt(
                                {
                                  environment_id: plan.environment_id,
                                  target_id: plan.target.id,
                                  name: plan.name,
                                  plan_hash: plan.plan_hash,
                                },
                                crypto.randomUUID(),
                              );
                              setPlan(null);
                              return `Registration recorded. Operation ${r.operation_id}.`;
                            })
                          }
                        >
                          Register existing server
                        </button>
                      </div>
                    ) : null}
                  </form>
                ) : null}
              </aside>
              <section
                className="server-detail"
                aria-label="Server observation"
              >
                {selected ? (
                  <>
                    <div className="server-detail-heading">
                      <div>
                        <p className="eyebrow">
                          EXISTING SERVER · OBSERVATION ONLY
                        </p>
                        <h2>{selected.name}</h2>
                        <p className="server-subtle">
                          {selected.observation?.source === "java_status"
                            ? "Java status"
                            : "Captured inventory"}{" "}
                          · {when(selected.observation?.observed_at)}
                        </p>
                      </div>
                      <span className="server-state">{observed(selected)}</span>
                    </div>
                    {selected.observation?.data_kind === "synthetic" ? (
                      <div className="server-demo" role="note">
                        <strong>LOCAL PROTOTYPE · SIMULATED SERVER</strong>
                        <p>
                          This is demo data. No Minecraft server is connected.
                          Requests are saved here, but grant no game access.
                        </p>
                      </div>
                    ) : null}
                    <div className="server-notice">
                      <strong>Read-only, by design.</strong>
                      <p>
                        These observations don’t prove player access or backup
                        recovery. Family readiness has not been verified.
                      </p>
                    </div>
                    <div className="server-facts">
                      <article>
                        <span>AUTHENTICATION SETTING</span>
                        <strong>
                          {setting(selected.observation?.online_authentication)}
                        </strong>
                        <p>Captured configuration; not a join test.</p>
                      </article>
                      <article>
                        <span>ALLOWLIST SETTING</span>
                        <strong>
                          {setting(
                            selected.observation?.allowlist_enabled === false ||
                              selected.observation?.enforce_allowlist === false
                              ? false
                              : selected.observation?.allowlist_enabled ===
                                    true &&
                                  selected.observation?.enforce_allowlist ===
                                    true
                                ? true
                                : null,
                          )}
                        </strong>
                        <p>Java & Bedrock enforcement unverified.</p>
                      </article>
                      <article>
                        <span>BACKUP RECOVERY</span>
                        <strong>Not verified</strong>
                        <p>A successful isolated restore is required.</p>
                      </article>
                    </div>
                    <div className="server-notice">
                      <strong>
                        Administrative exposure:{" "}
                        {selected.observation?.rcon_public === true
                          ? "public RCON reported — needs adult attention"
                          : selected.observation?.rcon_public === false
                            ? "RCON captured as private"
                            : "unknown"}
                        .
                      </strong>
                      <p>
                        Network isolation requires a separate check. Only game
                        connection details belong here.
                      </p>
                    </div>
                    <div className="server-lower">
                      <article className="server-panel">
                        <h3>Joining this world</h3>
                        <p className="server-subtle">
                          Game connection details from the approved source.
                        </p>
                        <dl>
                          <dt>Java</dt>
                          <dd>
                            {selected.observation?.java
                              ? `${selected.observation.java.host}:${selected.observation.java.port}`
                              : "Not provided"}
                          </dd>
                          <dt>Bedrock</dt>
                          <dd>
                            {selected.observation?.bedrock
                              ? `${selected.observation.bedrock.host}:${selected.observation.bedrock.port}`
                              : "Not provided"}
                          </dd>
                        </dl>
                      </article>
                      <article className="server-panel">
                        <h3>
                          Last observed players{" "}
                          <span>
                            {selected.observation?.player_count ?? "—"}
                          </span>
                        </h3>
                        <p className="server-subtle">
                          {players?.freshness === "stale"
                            ? "Stale capture. This is not current presence."
                            : "Presence is an observation, not an access approval."}
                        </p>
                        {players?.supported && players.players ? (
                          <ul className="server-players">
                            {players.players.length ? (
                              players.players.map((p) => (
                                <li key={`${p.edition}:${p.name}`}>
                                  <span aria-hidden="true">◈</span>
                                  {p.name}
                                  <small>{p.edition}</small>
                                </li>
                              ))
                            ) : (
                              <li>No players in the last observation.</li>
                            )}
                          </ul>
                        ) : (
                          <p>
                            Player names unavailable from this source or your
                            assigned permissions.
                          </p>
                        )}
                      </article>
                    </div>
                    <article className="server-panel server-enrollments">
                      <div className="server-panel-title">
                        <h3>Players &amp; access</h3>
                        <span className="server-pill">
                          VERIFICATION PENDING
                        </span>
                      </div>
                      <p className="server-subtle">
                        Request an identity check before granting access. A
                        player name is not a verified account. Authentication
                        and allowlist changes are unavailable in this preview.
                      </p>
                      {canEnroll && selected.registered ? (
                        <form
                          className="server-enrollment-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void action(async (api) => {
                              await api.enrollIdentity(
                                selected.id,
                                {
                                  edition: enrollmentEdition,
                                  requested_name: enrollmentName,
                                },
                                crypto.randomUUID(),
                              );
                              setEnrollmentName("");
                              return "Identity request saved. Pending authentication; no game access granted.";
                            });
                          }}
                        >
                          <label>
                            Game edition
                            <select
                              disabled={busy}
                              value={enrollmentEdition}
                              onChange={(e) =>
                                setEnrollmentEdition(
                                  e.target.value as "java" | "bedrock",
                                )
                              }
                            >
                              <option value="java">Java Edition</option>
                              <option value="bedrock">Bedrock Edition</option>
                            </select>
                          </label>
                          <label>
                            Player name
                            <input
                              required
                              value={enrollmentName}
                              maxLength={enrollmentEdition === "java" ? 16 : 32}
                              minLength={enrollmentEdition === "java" ? 3 : 1}
                              disabled={busy}
                              onChange={(e) =>
                                setEnrollmentName(e.target.value)
                              }
                              autoComplete="off"
                              placeholder={
                                enrollmentEdition === "java"
                                  ? "Java username"
                                  : "Xbox gamertag"
                              }
                            />
                          </label>
                          <button
                            type="submit"
                            className="server-solid"
                            disabled={busy || !enrollmentName.trim()}
                          >
                            Request identity check
                          </button>
                        </form>
                      ) : null}
                      {enrollments.length ? (
                        <ul className="server-enrollment-list">
                          {enrollments.map((r) => (
                            <li key={r.id}>
                              <div>
                                <strong>{r.requested_name}</strong>
                                <span>
                                  {r.edition === "java" ? "Java" : "Bedrock"} ·
                                  requested {when(r.created_at)}
                                </span>
                              </div>
                              <span className="server-state">
                                {r.expired
                                  ? "Expired · unverified"
                                  : "Pending · no access"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="server-subtle">
                          No identity requests yet. Only authenticated evidence
                          can move an identity beyond pending.
                        </p>
                      )}
                      {enrollmentCursor ? (
                        <button
                          type="button"
                          className="server-text-button"
                          disabled={busy}
                          onClick={() => void moreEnrollments()}
                        >
                          Load more identity requests
                        </button>
                      ) : null}
                    </article>
                    <article className="server-panel server-audit">
                      <div className="server-panel-title">
                        <h3>Recent activity</h3>
                        <span className="server-subtle">
                          Scoped audit history
                        </span>
                      </div>
                      {activity.length ? (
                        <ol>
                          {activity.map((a) => (
                            <li key={`${a.operation_id}:${a.action}`}>
                              <span>
                                {a.action
                                  .replace("server.", "")
                                  .replaceAll("_", " ")}
                              </span>
                              <time dateTime={a.occurred_at}>
                                {when(a.occurred_at)}
                              </time>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="server-subtle">
                          {canAudit
                            ? "No activity recorded for this server yet."
                            : "Audit history requires an administrator’s permission."}
                        </p>
                      )}
                    </article>
                    <div className="server-actions">
                      {selected.can_observe ? (
                        <button
                          type="button"
                          className="server-solid"
                          disabled={busy}
                          onClick={() =>
                            void action(async (api) => {
                              const r = await api.observe(
                                selected.id,
                                selected.version,
                                crypto.randomUUID(),
                              );
                              const [op, current] = await Promise.all([
                                api.operation(r.operation_id),
                                api.get(selected.id),
                              ]);
                              if (op.state !== "succeeded")
                                return "Observation could not be updated. The prior snapshot is preserved.";
                              const capture = current.observation;
                              if (!capture)
                                return "Source read completed. No observation is available.";
                              const unchanged =
                                selected.observation?.observed_at ===
                                capture.observed_at;
                              return `Source read completed. ${unchanged ? "Source capture time unchanged. " : ""}Latest observation is ${capture.freshness}. Last observed ${when(capture.observed_at)}.`;
                            })
                          }
                        >
                          {busy ? "Working…" : "Observe approved source"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="server-secondary"
                        disabled={loading || busy}
                        onClick={() => void load()}
                      >
                        Refresh overview
                      </button>
                    </div>
                    {selected.can_unregister ? (
                      <details className="server-unregister">
                        <summary>Registration settings</summary>
                        <p>
                          Remove this registration only. The existing server,
                          worlds and audit history are retained.
                        </p>
                        <label>
                          Type {selected.name} to confirm
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
                            void action(async (api) => {
                              await api.unregister(
                                selected.id,
                                selected.version,
                                crypto.randomUUID(),
                              );
                              return "Registration removed. The server and its world were not changed.";
                            })
                          }
                        >
                          Remove registration only
                        </button>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <div className="server-empty server-detail-empty">
                    <Terrain />
                    <h2>A clear view starts here.</h2>
                    <p>
                      Choose a registered server, or adopt an approved existing
                      source. No world is moved or recreated.
                    </p>
                    <span className="server-pill">NO GAME COMMANDS</span>
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
        <span>Private management · No model required</span>
      </footer>
    </main>
  );
}
