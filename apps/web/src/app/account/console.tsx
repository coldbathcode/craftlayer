"use client";
import {
  type Audit,
  type AuthorityView,
  auditSchema,
  authoritySchema,
  childCreatedSchema,
  type Environment,
  environmentSchema,
  grantSchema,
  inviteSchema,
  itemsSchema,
  type Me,
  type Member,
  memberSchema,
  meSchema,
  okSchema,
  type Project,
  projectSchema,
  type ResourceGrant,
  type Role,
  resetAcceptedSchema,
  roleSchema,
  type SessionItem,
  sessionItemSchema,
  sessionSchema,
  setupSchema,
} from "@craftlayer/contracts";
import { ApiError, identityRequest } from "@craftlayer/sdk";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";
import type { z } from "zod";

// DOM values are transient; no credentials or tenant data are persisted in browser storage.
const value = (data: FormData, name: string) => String(data.get(name) ?? "");
function Field({
  label,
  name,
  type = "text",
  required = true,
  children,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <label className="account-field" htmlFor={id}>
      <span>{label}</span>
      {children ? (
        <select id={id} name={name} required={required}>
          {children}
        </select>
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          autoComplete={
            type === "password"
              ? "new-password"
              : name === "login"
                ? "username"
                : "off"
          }
          minLength={type === "password" ? 12 : undefined}
          maxLength={type === "password" ? 128 : 120}
        />
      )}
    </label>
  );
}
function ActionForm({
  title,
  button,
  busy,
  children,
  onSubmit,
}: {
  title: string;
  button: string;
  busy: boolean;
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<boolean>;
}) {
  return (
    <form
      className="account-card"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        if ((await onSubmit(new FormData(form))) && form.isConnected)
          form.reset();
      }}
    >
      <h2>{title}</h2>
      {children}
      <button type="submit" className="account-button" disabled={busy}>
        {busy ? "Working…" : button}
      </button>
    </form>
  );
}
type Snapshot = {
  authority: AuthorityView | null;
  projects: Project[];
  worlds: Environment[];
  members: Member[];
  roles: Role[];
  audit: Audit[];
  grants: ResourceGrant[];
};
const empty: Snapshot = {
  authority: null,
  projects: [],
  worlds: [],
  members: [],
  roles: [],
  audit: [],
  grants: [],
};
export function IdentityConsole() {
  const [me, setMe] = useState<Me | null>(null),
    [org, setOrg] = useState(""),
    [data, setData] = useState<Snapshot>(empty),
    [mode, setMode] = useState("loading"),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [inviteLink, setInviteLink] = useState(""),
    [sessions, setSessions] = useState<SessionItem[]>([]),
    [fragment, setFragment] = useState({ invite: "", reset: "" });
  const clear = useCallback(() => {
    setMe(null);
    setOrg("");
    setData(empty);
    setInviteLink("");
    setSessions([]);
  }, []);
  async function session() {
    try {
      const result = await identityRequest("/api/v1/auth/me", meSchema);
      setMe(result);
      setOrg((previous) =>
        result.organizations.some((o) => o.id === previous)
          ? previous
          : (result.organizations[0]?.id ?? ""),
      );
      setMode("account");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clear();
        setMode("login");
      } else throw e;
    }
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.hash.slice(1));
    const f = {
      invite: params.get("invite") ?? "",
      reset: params.get("reset") ?? "",
    };
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
    setFragment(f);
    void Promise.allSettled([
      identityRequest("/api/v1/auth/setup", setupSchema, {
        signal: controller.signal,
      }),
      identityRequest("/api/v1/auth/me", meSchema, {
        signal: controller.signal,
      }),
    ]).then(([setup, current]) => {
      if (!active) return;
      if (current.status === "fulfilled") {
        setMe(current.value);
        setOrg(current.value.organizations[0]?.id ?? "");
      }
      if (f.reset) setMode("reset");
      else if (f.invite) setMode("invite");
      else if (current.status === "fulfilled") setMode("account");
      else if (setup.status === "fulfilled")
        setMode(setup.value.required ? "setup" : "login");
      else {
        setMode("login");
        setError(
          "Identity service is unavailable. Check the local services and refresh.",
        );
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    setSessions([]);
    if (!me) return;
    const controller = new AbortController();
    void identityRequest(
      "/api/v1/auth/sessions",
      itemsSchema(sessionItemSchema),
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setSessions(result.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load sessions.");
      });
    return () => controller.abort();
  }, [me]);
  useEffect(() => {
    if (!me || !org) {
      setData(empty);
      return;
    }
    const controller = new AbortController();
    setData(empty);
    setLoading(true);
    setInviteLink("");
    async function load() {
      try {
        const options = { organization: org, signal: controller.signal },
          authority = await identityRequest(
            "/api/v1/auth/authority",
            authoritySchema,
            options,
          );
        const [projects, worlds, members, roles, audit, grants] =
          await Promise.all([
            identityRequest(
              "/api/v1/projects",
              itemsSchema(projectSchema),
              options,
            ),
            identityRequest(
              "/api/v1/environments",
              itemsSchema(environmentSchema),
              options,
            ),
            authority.can_manage_members
              ? identityRequest(
                  "/api/v1/memberships",
                  itemsSchema(memberSchema),
                  options,
                )
              : Promise.resolve({ items: [] }),
            authority.can_manage_roles
              ? identityRequest(
                  "/api/v1/roles",
                  itemsSchema(roleSchema),
                  options,
                )
              : Promise.resolve({ items: [] }),
            authority.can_read_audit
              ? identityRequest(
                  "/api/v1/audit",
                  itemsSchema(auditSchema),
                  options,
                )
              : Promise.resolve({ items: [] }),
            authority.can_manage_members
              ? identityRequest(
                  "/api/v1/resource-grants",
                  itemsSchema(grantSchema),
                  options,
                )
              : Promise.resolve({ items: [] }),
          ]);
        if (!controller.signal.aborted)
          setData({
            authority,
            projects: projects.items,
            worlds: worlds.items,
            members: members.items,
            roles: roles.items,
            audit: audit.items,
            grants: grants.items,
          });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          clear();
          setMode("login");
        }
        setError(
          e instanceof Error ? e.message : "Could not load this organization.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [org, me, clear]);
  async function mutate(
    action: () => Promise<unknown>,
    message: string,
    reload = true,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      if (reload) await session();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clear();
        setMode("login");
      }
      setError(e instanceof Error ? e.message : "Request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function post<T extends z.ZodType>(
    path: string,
    schema: T,
    json: unknown,
    method = "POST",
  ) {
    return identityRequest(path, schema, {
      method,
      json,
      csrf: me?.csrf_token ?? "",
      organization: org,
    });
  }
  const a = data.authority;
  return (
    <div className="shell account-shell">
      <a className="skip" href="#account-main">
        Skip to account
      </a>
      <header className="header">
        <a className="brand" href="/">
          ▦ CraftLayer<span className="edition">CORE</span>
        </a>
        <nav aria-label="Account navigation">
          <a href="/">Overview</a>
          <a href="/servers">Servers</a>
          {me && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                void mutate(
                  async () => {
                    await post("/api/v1/auth/logout", okSchema, {});
                    clear();
                    setMode("login");
                  },
                  "Signed out.",
                  false,
                )
              }
            >
              Sign out
            </button>
          )}
        </nav>
      </header>
      <main id="account-main">
        <div className="account-heading">
          <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
          <h1>
            {mode === "setup"
              ? "Make yourself at home."
              : mode === "account"
                ? `Hello, ${me?.user.login ?? "friend"}.`
                : "A place for your people."}
          </h1>
          <p>Local accounts. Clear permissions. Your world stays yours.</p>
        </div>
        <div aria-live="polite">
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="account-notice" role="status">
              {notice}
            </p>
          )}
        </div>
        {mode === "loading" && <p role="status">Checking your session…</p>}
        {mode === "setup" && (
          <ActionForm
            title="Set up your instance"
            button="Create owner account"
            busy={busy}
            onSubmit={(form) =>
              mutate(
                () =>
                  identityRequest("/api/v1/auth/bootstrap", sessionSchema, {
                    method: "POST",
                    json: {
                      token: value(form, "token"),
                      login: value(form, "login"),
                      password: value(form, "password"),
                      ...(value(form, "email")
                        ? { email: value(form, "email") }
                        : {}),
                    },
                  }),
                "Your private instance is ready.",
              )
            }
          >
            <p className="account-help">
              On the host, run <code>pnpm cli owner bootstrap-token</code> to
              retrieve your private setup token. This setup works once.
            </p>
            <Field label="Setup token" name="token" type="password" />
            <Field label="Owner login" name="login" />
            <Field
              label="Owner email (optional)"
              name="email"
              type="email"
              required={false}
            />
            <Field label="Owner password" name="password" type="password" />
            <p className="account-help">
              Use 12–128 characters. Keep your local recovery configuration
              private.
            </p>
          </ActionForm>
        )}
        {mode === "login" && (
          <div className="account-auth">
            <ActionForm
              title="Welcome back"
              button="Sign in"
              busy={busy}
              onSubmit={(form) =>
                mutate(
                  () =>
                    identityRequest("/api/v1/auth/login", sessionSchema, {
                      method: "POST",
                      json: {
                        login: value(form, "login"),
                        password: value(form, "password"),
                      },
                    }),
                  "Signed in.",
                )
              }
            >
              <Field label="Login" name="login" />
              <Field label="Password" name="password" type="password" />
            </ActionForm>
            <button
              type="button"
              className="text-button"
              onClick={() => setMode("forgot")}
            >
              Forgot your password?
            </button>
          </div>
        )}
        {mode === "forgot" && (
          <ActionForm
            title="Request a password reset"
            button="Request reset"
            busy={busy}
            onSubmit={(form) =>
              mutate(
                () =>
                  identityRequest(
                    "/api/v1/auth/password-reset/request",
                    resetAcceptedSchema,
                    { method: "POST", json: { login: value(form, "login") } },
                  ),
                "If email recovery is configured, instructions will be sent. Otherwise ask your instance owner.",
                false,
              )
            }
          >
            <p className="account-help">
              Email recovery is optional. Child accounts are recovered by an
              adult administrator.
            </p>
            <Field label="Login or email" name="login" />
            <button
              type="button"
              className="text-button"
              onClick={() => setMode("login")}
            >
              Back to sign in
            </button>
          </ActionForm>
        )}
        {mode === "reset" && (
          <ActionForm
            title="Choose a new password"
            button="Change password"
            busy={busy}
            onSubmit={(form) =>
              mutate(
                async () => {
                  await identityRequest(
                    "/api/v1/auth/password-reset/consume",
                    okSchema,
                    {
                      method: "POST",
                      json: {
                        token: fragment.reset,
                        password: value(form, "password"),
                      },
                    },
                  );
                  clear();
                  setFragment({ invite: "", reset: "" });
                  setMode("login");
                },
                "Password changed. Sign in with your new password.",
                false,
              )
            }
          >
            <Field label="New password" name="password" type="password" />
          </ActionForm>
        )}
        {mode === "invite" && (
          <div className="account-auth">
            {me ? (
              <div className="account-card">
                <h2>Join this organization</h2>
                <p>
                  Accept the invitation as <strong>{me.user.login}</strong>.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  className="account-button"
                  onClick={() =>
                    void mutate(async () => {
                      await identityRequest(
                        "/api/v1/invitations/consume",
                        sessionSchema,
                        {
                          method: "POST",
                          csrf: me.csrf_token,
                          json: { mode: "existing", token: fragment.invite },
                        },
                      );
                      setFragment({ invite: "", reset: "" });
                    }, "Organization joined.")
                  }
                >
                  Join with this account
                </button>
              </div>
            ) : (
              <ActionForm
                title="Accept your invitation"
                button="Create account and join"
                busy={busy}
                onSubmit={(form) =>
                  mutate(async () => {
                    await identityRequest(
                      "/api/v1/invitations/consume",
                      sessionSchema,
                      {
                        method: "POST",
                        json: {
                          mode: "new",
                          token: fragment.invite,
                          login: value(form, "login"),
                          password: value(form, "password"),
                          ...(value(form, "email")
                            ? { email: value(form, "email") }
                            : {}),
                        },
                      },
                    );
                    setFragment({ invite: "", reset: "" });
                  }, "Welcome to your organization.")
                }
              >
                <Field label="Choose a login" name="login" />
                <Field
                  label="Email (optional)"
                  name="email"
                  type="email"
                  required={false}
                />
                <Field
                  label="Choose a password"
                  name="password"
                  type="password"
                />
              </ActionForm>
            )}
          </div>
        )}
        {mode === "account" && me && (
          <>
            <section className="account-toolbar">
              <label>
                Organization
                <select
                  aria-label="Organization"
                  value={org}
                  onChange={(event) => {
                    setData(empty);
                    setInviteLink("");
                    setOrg(event.target.value);
                  }}
                >
                  {me.organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="tag">
                {me.user.account_type === "child"
                  ? "Child account"
                  : me.instance_owner
                    ? "Instance owner"
                    : "Adult account"}
              </span>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(() => session(), "Access refreshed.", false)
                }
              >
                Refresh access
              </button>
            </section>
            {!org && (
              <p className="account-empty">
                You have no active organization membership. Ask an administrator
                for an invitation.
              </p>
            )}
            {loading && <p role="status">Loading this organization…</p>}
            {a && (
              <>
                <section className="account-summary">
                  <article>
                    <span className="eyebrow">ACCESS</span>
                    <h2>
                      {a.account_type === "child"
                        ? "Your assigned worlds"
                        : a.roles.join(" + ") || "Custom permissions"}
                    </h2>
                    <p>
                      {a.account_type === "child"
                        ? "An adult manages your account and worlds. Missions are not available yet."
                        : "Your permissions are checked by the server for every action."}
                    </p>
                  </article>
                  <article>
                    <span className="eyebrow">WORLDS</span>
                    <h2>{data.worlds.length} available</h2>
                    <p>
                      {data.worlds.map((w) => w.name).join(", ") ||
                        "No environments have been assigned yet."}
                    </p>
                  </article>
                </section>
                <div className="account-grid">
                  {me.instance_owner && (
                    <ActionForm
                      title="Create organization"
                      button="Create organization"
                      busy={busy}
                      onSubmit={(form) =>
                        mutate(
                          () =>
                            post("/api/v1/organizations", projectSchema, {
                              name: value(form, "name"),
                            }),
                          "Organization created.",
                        )
                      }
                    >
                      <Field label="Organization name" name="name" />
                    </ActionForm>
                  )}
                  {a.can_create_projects && (
                    <ActionForm
                      title="Create project"
                      button="Create project"
                      busy={busy}
                      onSubmit={(form) =>
                        mutate(
                          () =>
                            post("/api/v1/projects", projectSchema, {
                              name: value(form, "name"),
                            }),
                          "Project created.",
                        )
                      }
                    >
                      <Field label="Project name" name="name" />
                    </ActionForm>
                  )}
                  {a.can_manage_environments && data.projects.length > 0 && (
                    <ActionForm
                      title="Add environment"
                      button="Add environment"
                      busy={busy}
                      onSubmit={(form) =>
                        mutate(
                          () =>
                            post("/api/v1/environments", environmentSchema, {
                              name: value(form, "name"),
                              projectId: value(form, "projectId"),
                              type: value(form, "type"),
                            }),
                          "Environment metadata added.",
                        )
                      }
                    >
                      <p className="account-help">
                        This adds environment details. World connections and bot
                        controls are not available yet.
                      </p>
                      <Field label="Environment name" name="name" />
                      <Field label="Project" name="projectId">
                        {data.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Field>
                      <Field label="Environment type" name="type">
                        <option value="minecraft">Minecraft</option>
                        <option value="coding">Coding</option>
                        <option value="research">Research</option>
                      </Field>
                    </ActionForm>
                  )}
                  {a.can_invite && data.roles.length > 0 && (
                    <ActionForm
                      title="Invite an adult"
                      button="Create invitation"
                      busy={busy}
                      onSubmit={(form) =>
                        mutate(
                          async () => {
                            const invite = await post(
                              "/api/v1/invitations",
                              inviteSchema,
                              { roleId: value(form, "roleId") },
                            );
                            const url = new URL(
                              "/account",
                              window.location.origin,
                            );
                            url.hash = `invite=${encodeURIComponent(invite.token)}`;
                            setInviteLink(url.toString());
                          },
                          "Invitation created. Copy the one-time link below.",
                          false,
                        )
                      }
                    >
                      <Field label="Invitation role" name="roleId">
                        {data.roles
                          .filter((r) => r.name !== "child")
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </Field>
                    </ActionForm>
                  )}
                  {a.can_manage_members &&
                    data.worlds.some((w) => w.type === "minecraft") && (
                      <ActionForm
                        title="Create a child account"
                        button="Create child account"
                        busy={busy}
                        onSubmit={(form) =>
                          mutate(
                            () =>
                              post("/api/v1/children", childCreatedSchema, {
                                login: value(form, "login"),
                                password: value(form, "password"),
                                environmentIds: [value(form, "environmentId")],
                              }),
                            "Child account created.",
                          )
                        }
                      >
                        <p className="account-help">
                          No child email or date of birth is collected.
                        </p>
                        <Field label="Child login" name="login" />
                        <Field
                          label="Child password"
                          name="password"
                          type="password"
                        />
                        <Field
                          label="Assigned Minecraft world"
                          name="environmentId"
                        >
                          {data.worlds
                            .filter((w) => w.type === "minecraft")
                            .map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                        </Field>
                      </ActionForm>
                    )}
                </div>
                {inviteLink && (
                  <section className="account-card account-invite">
                    <h2>One-time invitation</h2>
                    <p>
                      Shown only now. Share privately with the intended adult;
                      it expires in 24 hours.
                    </p>
                    <label>
                      Invitation link
                      <input readOnly value={inviteLink} />
                    </label>
                    <button
                      type="button"
                      className="account-button"
                      onClick={() =>
                        void navigator.clipboard.writeText(inviteLink).then(
                          () => setNotice("Invitation link copied."),
                          () => setError("Copy the link from the field."),
                        )
                      }
                    >
                      Copy invitation link
                    </button>
                  </section>
                )}
                {a.can_manage_members && (
                  <section className="account-card">
                    <h2>People and access</h2>
                    <div className="account-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Login</th>
                            <th>Roles</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.members.map((member) => (
                            <tr key={member.id}>
                              <td>
                                {member.login}
                                <small>{member.account_type}</small>
                              </td>
                              <td>{member.roles.join(", ")}</td>
                              <td>
                                {member.user_disabled_at
                                  ? "Account disabled"
                                  : member.disabled_at
                                    ? "Membership suspended"
                                    : "Active"}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void mutate(
                                      () =>
                                        post(
                                          `/api/v1/memberships/${member.id}/status`,
                                          okSchema,
                                          { disabled: !member.disabled_at },
                                        ),
                                      "Membership updated.",
                                    )
                                  }
                                >
                                  {member.disabled_at
                                    ? "Restore membership"
                                    : "Suspend membership"}
                                </button>
                                {me.instance_owner &&
                                  member.user_id !== me.user.id && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void mutate(
                                          () =>
                                            post(
                                              `/api/v1/users/${member.user_id}/status`,
                                              okSchema,
                                              {
                                                disabled:
                                                  !member.user_disabled_at,
                                              },
                                            ),
                                          "Global account status updated.",
                                        )
                                      }
                                    >
                                      {member.user_disabled_at
                                        ? "Restore account"
                                        : "Disable account"}
                                    </button>
                                  )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                {a.can_manage_roles && data.members.length > 0 && (
                  <div className="account-grid">
                    <ActionForm
                      title="Change an adult’s role"
                      button="Update role"
                      busy={busy}
                      onSubmit={(form) =>
                        mutate(
                          () =>
                            post(
                              `/api/v1/memberships/${value(form, "membershipId")}/roles`,
                              okSchema,
                              { roleIds: [value(form, "roleId")] },
                              "PUT",
                            ),
                          "Role updated.",
                        )
                      }
                    >
                      <Field label="Adult member" name="membershipId">
                        {data.members
                          .filter((m) => m.account_type === "adult")
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.login}
                            </option>
                          ))}
                      </Field>
                      <Field label="New role" name="roleId">
                        {data.roles
                          .filter((r) => r.name !== "child")
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </Field>
                    </ActionForm>
                    {data.members.some((m) => m.account_type === "child") && (
                      <ActionForm
                        title="Reset a child’s password"
                        button="Reset child password"
                        busy={busy}
                        onSubmit={(form) =>
                          mutate(
                            () =>
                              post(
                                `/api/v1/children/${value(form, "membershipId")}/password`,
                                okSchema,
                                { password: value(form, "password") },
                              ),
                            "Child password changed; their existing sessions were revoked.",
                          )
                        }
                      >
                        <Field label="Child member" name="membershipId">
                          {data.members
                            .filter((m) => m.account_type === "child")
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.login}
                              </option>
                            ))}
                        </Field>
                        <Field
                          label="New child password"
                          name="password"
                          type="password"
                        />
                      </ActionForm>
                    )}
                  </div>
                )}
                {a.can_manage_members && data.projects.length > 0 && (
                  <ActionForm
                    title="Assign scoped access"
                    button="Grant access"
                    busy={busy}
                    onSubmit={(form) =>
                      mutate(
                        () =>
                          post("/api/v1/resource-grants", okSchema, {
                            membershipId: value(form, "membershipId"),
                            permission: value(form, "permission"),
                            projectId: value(form, "projectId"),
                            ...(value(form, "environmentId")
                              ? { environmentId: value(form, "environmentId") }
                              : {}),
                          }),
                        "Scoped access granted.",
                      )
                    }
                  >
                    <div className="account-form-row">
                      <Field label="Member" name="membershipId">
                        {data.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.login}
                          </option>
                        ))}
                      </Field>
                      <Field label="Permission" name="permission">
                        {a.permissions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </Field>
                      <Field label="Access project" name="projectId">
                        {data.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Field>
                      <Field
                        label="World (optional for adults)"
                        name="environmentId"
                        required={false}
                      >
                        <option value="">Whole project</option>
                        {data.worlds.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </Field>
                    </div>
                  </ActionForm>
                )}
                {a.can_manage_members && data.grants.length > 0 && (
                  <section className="account-card">
                    <h2>Scoped grants</h2>
                    <ul className="account-list">
                      {data.grants.map((g) => (
                        <li key={g.id}>
                          <span>
                            {data.members.find((m) => m.id === g.membership_id)
                              ?.login ?? "Member"}{" "}
                            · {g.permission}
                            <small>
                              {data.worlds.find(
                                (w) => w.id === g.environment_id,
                              )?.name ??
                                data.projects.find((p) => p.id === g.project_id)
                                  ?.name ??
                                "Scoped resource"}
                            </small>
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                () =>
                                  identityRequest(
                                    `/api/v1/resource-grants/${g.id}`,
                                    okSchema,
                                    {
                                      method: "DELETE",
                                      csrf: me.csrf_token,
                                      organization: org,
                                    },
                                  ),
                                "Grant revoked.",
                              )
                            }
                          >
                            Revoke grant
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {a.can_read_audit && (
                  <section className="account-card">
                    <h2>Audit history</h2>
                    <ol className="account-audit">
                      {data.audit.slice(0, 20).map((event) => (
                        <li key={event.id}>
                          <span>{event.action}</span>
                          <small>
                            {event.outcome} ·{" "}
                            {new Date(event.created_at).toLocaleString()}
                          </small>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}
            <section className="account-card">
              <h2>Your sessions</h2>
              <ul className="account-list">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <span>
                      {s.id === me.current_session_id
                        ? "This session"
                        : "Another session"}
                      <small>{new Date(s.created_at).toLocaleString()}</small>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            identityRequest(
                              `/api/v1/auth/sessions/${s.id}`,
                              okSchema,
                              { method: "DELETE", csrf: me.csrf_token },
                            ),
                          "Session revoked.",
                        )
                      }
                    >
                      Revoke session
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
      <footer>
        <span className="brand small">▦ CraftLayer</span>
        <p>Local accounts · Private by default</p>
        <a href="https://github.com/coldbathcode/craftlayer/blob/main/docs/delivery/status.md">
          Build status ↗
        </a>
      </footer>
    </div>
  );
}
