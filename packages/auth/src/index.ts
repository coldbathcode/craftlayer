import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  type AccessScope,
  type Authority,
  canAccess,
  childPermissions,
  organizationPermissions,
  type Permission,
} from "@craftlayer/core";
import { hash, verify } from "@node-rs/argon2";
import pg from "pg";
import { z } from "zod";

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
export const loginName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
export const newPassword = z.string().min(12).max(128);
export const hashPolicy = {
  algorithm: 2, // Argon2id; the library exposes ambient const enums.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
export interface PublicUser {
  id: string;
  login: string;
  account_type: "adult" | "child";
  email: string | null;
}
export interface Principal {
  authorityExpiresAt?: number;
  user: PublicUser;
  userVersion: number;
  sessionId: string;
}
interface UserRow extends PublicUser {
  password_hash: string;
  auth_version: number;
  disabled_at: Date | null;
}
export interface AuthOptions {
  databaseUrl: string;
  bootstrapToken: string;
  recoveryToken: string;
  csrfSecret: string;
  clock?: () => Date;
  deliverReset?:
    | ((recipient: string, token: string) => Promise<void>)
    | undefined;
}
export interface SessionResult {
  cookieToken: string;
  csrf_token: string;
  user: PublicUser;
}
export class AuthService {
  #pool: pg.Pool;
  #options: AuthOptions;
  #dummyHash = "";
  #ready = false;
  #jobs = 0;
  constructor(options: AuthOptions) {
    const url = new URL(options.databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.username !== "craftlayer_identity"
    )
      throw new Error("Restricted identity database role required");
    for (const value of [
      options.bootstrapToken,
      options.recoveryToken,
      options.csrfSecret,
    ])
      if (!/^[a-f0-9]{64}$/.test(value))
        throw new Error(
          "Strong local identity secrets required; values omitted",
        );
    this.#options = options;
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
      idleTimeoutMillis: 10000,
    });
  }
  async close() {
    await this.#pool.end();
  }
  private now() {
    return this.#options.clock?.() ?? new Date();
  }
  private ensureReady() {
    if (!this.#ready)
      throw new AuthError(
        503,
        "AUTH_UNAVAILABLE",
        "Identity service unavailable.",
      );
  }
  private async transaction<T>(
    operation: (client: pg.PoolClient) => Promise<T>,
    org?: string,
    user?: string,
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      if (org)
        await client.query("select set_config('app.organization_id',$1,true)", [
          org,
        ]);
      if (user)
        await client.query("select set_config('app.user_id',$1,true)", [user]);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  private async audit(
    client: pg.PoolClient,
    actor: string | null,
    action: string,
    target: string | null = null,
    allowed = true,
    org?: string,
    details: Record<string, string | boolean | string[]> = {},
  ) {
    if (
      Object.keys(details).some(
        (key) =>
          ![
            "role_ids",
            "disabled",
            "project_id",
            "environment_id",
            "permission",
          ].includes(key),
      ) ||
      JSON.stringify(details).length > 2048
    )
      throw new Error("Unsafe audit detail");
    if (org)
      await client.query(
        "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,$5,$6::jsonb)",
        [
          org,
          actor,
          action,
          target,
          allowed ? "allowed" : "denied",
          JSON.stringify(details),
        ],
      );
    else
      await client.query(
        "insert into instance_audit_events(actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,$5::jsonb)",
        [
          actor,
          action,
          target,
          allowed ? "allowed" : "denied",
          JSON.stringify(details),
        ],
      );
  }
  private async rate(
    operation: string,
    source: string,
    limit: number,
    period = 60000,
  ) {
    const bucket = createHmac("sha256", this.#options.csrfSecret)
      .update(`${operation}/${source.slice(0, 128)}`)
      .digest("hex");
    const now = this.now();
    const r = await this.#pool.query<{ attempts: number }>(
      "insert into auth_rate_limits(bucket,window_started_at,attempts) values($1,$2,1) on conflict(bucket) do update set window_started_at=case when auth_rate_limits.window_started_at < $3 then $2 else auth_rate_limits.window_started_at end, attempts=case when auth_rate_limits.window_started_at < $3 then 1 else auth_rate_limits.attempts+1 end returning attempts",
      [bucket, now, new Date(now.getTime() - period)],
    );
    if ((r.rows[0]?.attempts ?? limit + 1) > limit)
      throw new AuthError(
        429,
        "RATE_LIMITED",
        "Too many attempts. Try again later.",
      );
  }
  private async passwordJob<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#jobs >= 2)
      throw new AuthError(429, "HASH_CAPACITY", "Please try again shortly.");
    this.#jobs++;
    try {
      return await operation();
    } finally {
      this.#jobs--;
    }
  }
  private async hashPassword(password: string) {
    if (!newPassword.safeParse(password).success)
      throw new AuthError(
        400,
        "PASSWORD_POLICY",
        "Use a password between 12 and 128 characters.",
      );
    return this.passwordJob(() => hash(password, hashPolicy));
  }
  private publicUser(user: PublicUser): PublicUser {
    return {
      id: user.id,
      login: user.login,
      account_type: user.account_type,
      email: user.email,
    };
  }
  async initialize() {
    if (this.#ready) return;
    await this.#pool.query(
      "insert into installation_settings(id,bootstrap_hash,recovery_hash) values(true,$1,$2) on conflict(id) do nothing",
      [
        digest(this.#options.bootstrapToken),
        digest(this.#options.recoveryToken),
      ],
    );
    const settings = await this.#pool.query<{ recovery_hash: string }>(
      "select recovery_hash from installation_settings where id=true",
    );
    if (settings.rows[0]?.recovery_hash !== digest(this.#options.recoveryToken))
      throw new Error("Recovery configuration mismatch; values omitted");
    this.#dummyHash = await hash(randomBytes(32), hashPolicy);
    await this.pruneRecovery();
    this.#ready = true;
  }
  async setupStatus() {
    this.ensureReady();
    const r = await this.#pool.query(
      "select bootstrapped_at from installation_settings where id=true",
    );
    return { required: !r.rows[0]?.bootstrapped_at };
  }
  private async seedRoles(client: pg.PoolClient, org: string) {
    const names = await client.query<{ role_name: string }>(
      "select distinct role_name from built_in_role_permissions",
    );
    for (const { role_name } of names.rows) {
      const role = await client.query<{ id: string }>(
        "insert into roles(id,organization_id,name,built_in) values($1,$2,$3,true) on conflict(organization_id,name) do update set name=excluded.name returning id",
        [randomUUID(), org, role_name],
      );
      await client.query(
        "insert into role_permissions(organization_id,role_id,permission) select $1,$2,permission from built_in_role_permissions where role_name=$3 on conflict do nothing",
        [org, role.rows[0]?.id, role_name],
      );
    }
  }
  private async newSession(
    client: pg.PoolClient,
    user: UserRow,
    previous?: string,
  ): Promise<SessionResult> {
    if (previous)
      await client.query(
        "update sessions set revoked_at=$2 where token_hash=$1",
        [digest(previous), this.now()],
      );
    const cookieToken = randomBytes(32).toString("base64url"),
      now = this.now();
    await client.query(
      "insert into sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at,created_at) values($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        user.id,
        digest(cookieToken),
        user.auth_version,
        new Date(now.getTime() + 1800000),
        new Date(now.getTime() + 43200000),
        now,
      ],
    );
    return {
      cookieToken,
      csrf_token: this.csrfToken(cookieToken),
      user: this.publicUser(user),
    };
  }
  csrfToken(cookieToken: string) {
    return createHmac("sha256", this.#options.csrfSecret)
      .update(`csrf/${cookieToken}`)
      .digest("base64url");
  }
  verifyCsrf(cookieToken: string, csrf: string) {
    return csrf.length === 43 && equal(this.csrfToken(cookieToken), csrf);
  }
  async bootstrap(
    input: {
      token: string;
      login: string;
      password: string;
      email?: string | undefined;
    },
    source: string,
  ): Promise<SessionResult> {
    this.ensureReady();
    await this.rate("bootstrap", source, 10);
    const login = loginName.parse(input.login);
    const settings = await this.#pool.query<{
      bootstrap_hash: string | null;
      bootstrapped_at: Date | null;
    }>(
      "select bootstrap_hash,bootstrapped_at from installation_settings where id=true",
    );
    if (
      settings.rows[0]?.bootstrapped_at ||
      !equal(digest(input.token), settings.rows[0]?.bootstrap_hash ?? "")
    )
      throw new AuthError(
        403,
        "BOOTSTRAP_DENIED",
        "Setup is unavailable or the setup token is invalid.",
      );
    const passwordHash = await this.hashPassword(input.password);
    return this.transaction(async (client) => {
      const current = await client.query(
        "select bootstrap_hash,bootstrapped_at from installation_settings where id=true for update",
      );
      if (
        current.rows[0]?.bootstrapped_at ||
        !equal(digest(input.token), current.rows[0]?.bootstrap_hash ?? "")
      )
        throw new AuthError(
          403,
          "BOOTSTRAP_DENIED",
          "Setup is unavailable or the setup token is invalid.",
        );
      const id = randomUUID(),
        org = randomUUID(),
        member = randomUUID();
      const user = await client.query<UserRow>(
        "insert into users(id,login,email,account_type,password_hash) values($1,$2,$3,'adult',$4) returning *",
        [id, login, input.email?.trim().toLowerCase() ?? null, passwordHash],
      );
      await client.query("insert into instance_owners(user_id) values($1)", [
        id,
      ]);
      await client.query("select set_config('app.organization_id',$1,true)", [
        org,
      ]);
      await client.query(
        "insert into organizations(id,name) values($1,'My organization')",
        [org],
      );
      await this.seedRoles(client, org);
      await client.query(
        "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
        [member, org, id],
      );
      await client.query(
        "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name='org_admin' and built_in=true",
        [org, member],
      );
      await client.query(
        "update installation_settings set bootstrapped_at=$1,bootstrap_hash=null where id=true",
        [this.now()],
      );
      await this.audit(client, id, "instance.bootstrapped");
      await this.audit(client, id, "organization.created", org, true, org);
      return this.newSession(client, user.rows[0] as UserRow);
    });
  }
  async login(
    input: { login: string; password: string },
    source: string,
    previous?: string,
  ): Promise<SessionResult> {
    this.ensureReady();
    await this.rate("login-ip", source, 30);
    await this.rate("login-name", input.login.trim().toLowerCase(), 10, 900000);
    const result = await this.#pool.query<UserRow>(
      "select * from users where login=$1",
      [input.login.trim().toLowerCase()],
    );
    const user = result.rows[0];
    const valid = await this.passwordJob(() =>
      verify(user?.password_hash ?? this.#dummyHash, input.password).catch(
        () => false,
      ),
    );
    if (!valid || !user || user.disabled_at) {
      await this.transaction((client) =>
        this.audit(client, user?.id ?? null, "auth.login", null, false),
      );
      throw new AuthError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid login or password.",
      );
    }
    return this.transaction(async (client) => {
      const current = (
        await client.query<UserRow>(
          "select * from users where id=$1 for update",
          [user.id],
        )
      ).rows[0];
      if (
        !current ||
        current.disabled_at ||
        current.password_hash !== user.password_hash
      )
        throw new AuthError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid login or password.",
        );
      await this.audit(client, user.id, "auth.login");
      return this.newSession(client, current, previous);
    });
  }
  private async sessionIn(
    client: pg.PoolClient,
    token: string,
  ): Promise<Principal> {
    this.ensureReady();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AuthError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const now = this.now();
    const result = await client.query<UserRow & { session_id: string }>(
      "select u.*,s.id as session_id from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.revoked_at is null and s.expires_at>$2 and s.idle_expires_at>$2 and u.disabled_at is null and s.auth_version=u.auth_version for share of u for update of s",
      [digest(token), now],
    );
    const row = result.rows[0];
    if (!row)
      throw new AuthError(401, "UNAUTHENTICATED", "Sign in to continue.");
    await client.query(
      "update sessions set idle_expires_at=least(expires_at,$2) where id=$1",
      [row.session_id, new Date(now.getTime() + 1800000)],
    );
    return {
      user: this.publicUser(row),
      userVersion: row.auth_version,
      sessionId: row.session_id,
    };
  }
  async authenticate(token: string) {
    this.ensureReady();
    return this.transaction((client) => this.sessionIn(client, token));
  }
  async logout(token: string) {
    this.ensureReady();
    return this.transaction(async (client) => {
      const p = await this.sessionIn(client, token);
      await client.query("update sessions set revoked_at=$2 where id=$1", [
        p.sessionId,
        this.now(),
      ]);
      await this.audit(client, p.user.id, "auth.logout");
    });
  }
  async listSessions(token: string) {
    return this.transaction(async (client) => {
      const p = await this.sessionIn(client, token);
      return (
        await client.query(
          "select id,created_at,expires_at from sessions where user_id=$1 and revoked_at is null and expires_at>$2 and idle_expires_at>$2 order by created_at desc limit 100",
          [p.user.id, this.now()],
        )
      ).rows;
    });
  }
  async revokeSession(token: string, id: string) {
    return this.transaction(async (client) => {
      const p = await this.sessionIn(client, token);
      const r = await client.query(
        "update sessions set revoked_at=$3 where id=$1 and user_id=$2 and revoked_at is null",
        [id, p.user.id, this.now()],
      );
      if (!r.rowCount)
        throw new AuthError(404, "NOT_FOUND", "Session not found.");
      await this.audit(client, p.user.id, "session.revoked", id);
    });
  }
  async me(token: string) {
    return this.transaction(async (client) => {
      const p = await this.sessionIn(client, token);
      await client.query("select set_config('app.user_id',$1,true)", [
        p.user.id,
      ]);
      const memberships = await client.query<{ organization_id: string }>(
        "select organization_id from memberships where user_id=$1 and disabled_at is null limit 100",
        [p.user.id],
      );
      const organizations = [];
      for (const m of memberships.rows) {
        await client.query("select set_config('app.organization_id',$1,true)", [
          m.organization_id,
        ]);
        const org = (
          await client.query("select id,name from organizations where id=$1", [
            m.organization_id,
          ])
        ).rows[0];
        if (org) organizations.push(org);
      }
      const owner = await client.query(
        "select 1 from instance_owners where user_id=$1",
        [p.user.id],
      );
      return {
        user: p.user,
        organizations,
        instance_owner: !!owner.rowCount,
        current_session_id: p.sessionId,
        csrf_token: this.csrfToken(token),
      };
    });
  }
  private async authority(client: pg.PoolClient, p: Principal, org: string) {
    await client.query("select set_config('app.organization_id',$1,true)", [
      org,
    ]);
    const member = (
      await client.query<{ id: string; auth_version: number }>(
        "select id,auth_version from memberships where organization_id=$1 and user_id=$2 and disabled_at is null for share",
        [org, p.user.id],
      )
    ).rows[0];
    if (!member)
      throw new AuthError(404, "NOT_FOUND", "Organization not found.");
    const roles = await client.query<{ name: string; built_in: boolean }>(
      "select r.name,r.built_in from membership_roles mr join roles r on r.organization_id=mr.organization_id and r.id=mr.role_id where mr.organization_id=$1 and mr.membership_id=$2",
      [org, member.id],
    );
    const permissions = await client.query<{ permission: string }>(
      "select distinct rp.permission from membership_roles mr join role_permissions rp on rp.organization_id=mr.organization_id and rp.role_id=mr.role_id where mr.organization_id=$1 and mr.membership_id=$2",
      [org, member.id],
    );
    const grants = await client.query<{
      permission: string;
      project_id: string;
      environment_id: string | null;
    }>(
      "select permission,project_id,environment_id from resource_grants where organization_id=$1 and membership_id=$2",
      [org, member.id],
    );
    const a: Authority = {
      accountType: p.user.account_type,
      permissions: permissions.rows.map((x) => x.permission),
      roles: roles.rows.filter((x) => x.built_in).map((x) => x.name),
      orgAdmin: roles.rows.some((x) => x.built_in && x.name === "org_admin"),
      grants: grants.rows.map((x) => ({
        permission: x.permission,
        projectId: x.project_id,
        environmentId: x.environment_id,
      })),
    };
    return { member, a };
  }
  private async canonicalScope(
    client: pg.PoolClient,
    org: string,
    scope: { kind: "organization" | "project" | "environment"; id: string },
  ): Promise<AccessScope> {
    if (!z.uuid().safeParse(scope.id).success)
      throw new AuthError(404, "NOT_FOUND", "Resource not found.");
    if (scope.kind === "organization") {
      if (scope.id !== org)
        throw new AuthError(404, "NOT_FOUND", "Resource not found.");
      return scope;
    }
    if (scope.kind === "project") {
      if (
        !(
          await client.query(
            "select id from projects where organization_id=$1 and id=$2",
            [org, scope.id],
          )
        ).rowCount
      )
        throw new AuthError(404, "NOT_FOUND", "Project not found.");
      return scope;
    }
    const r = (
      await client.query<{ project_id: string; type: string }>(
        "select project_id,type from environments where organization_id=$1 and id=$2",
        [org, scope.id],
      )
    ).rows[0];
    if (!r) throw new AuthError(404, "NOT_FOUND", "Environment not found.");
    return { ...scope, projectId: r.project_id, environmentType: r.type };
  }
  private async orgAction<T>(
    token: string,
    org: string,
    permission: string,
    scope: { kind: "organization" | "project" | "environment"; id: string },
    operation: (
      client: pg.PoolClient,
      p: Principal,
      a: Authority,
      member: { id: string; auth_version: number },
    ) => Promise<T>,
    write = false,
  ): Promise<T> {
    this.ensureReady();
    if (!z.uuid().safeParse(org).success)
      throw new AuthError(404, "NOT_FOUND", "Organization not found.");
    let actor: string | null = null;
    try {
      return await this.transaction(async (client) => {
        if (write)
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1,74618003))",
            [org],
          );
        const p = await this.sessionIn(client, token);
        actor = p.user.id;
        const { member, a } = await this.authority(client, p, org);
        const canonical = await this.canonicalScope(client, org, scope);
        if (!canAccess(a, permission, canonical))
          throw new AuthError(
            403,
            "PERMISSION_DENIED",
            "You do not have permission for this action.",
          );
        return operation(client, p, a, member);
      });
    } catch (error) {
      if (error instanceof AuthError && [403, 404].includes(error.status))
        await this.transaction((client) =>
          this.audit(client, actor, "access.denied", null, false),
        );
      throw error;
    }
  }
  async authorize(
    token: string,
    org: string,
    permission: Permission,
    scope: { kind: "organization" | "project" | "environment"; id: string },
  ) {
    return this.orgAction(
      token,
      org,
      permission,
      scope,
      async (_c, p, _a, member) => ({
        userId: p.user.id,
        organizationId: org,
        membershipId: member.id,
        membershipVersion: member.auth_version,
      }),
    );
  }
  /** Server composition hook: bounded SQL callbacks only; never perform network I/O here. */
  async guardOrganization<T>(
    token: string,
    org: string,
    permission: Permission,
    operation: (principal: Principal) => Promise<T>,
  ): Promise<T> {
    return this.orgAction(
      token,
      org,
      permission,
      { kind: "organization", id: org },
      async (_client, principal) => operation(principal),
    );
  }
  /** Scoped server composition hook; only bounded local/SQL decisions under current authority. */
  async guardResource<T>(
    token: string,
    org: string,
    permission: Permission,
    scope: { kind: "organization" | "project" | "environment"; id: string },
    operation: (principal: Principal, authority: Authority) => Promise<T>,
  ): Promise<T> {
    return this.orgAction(
      token,
      org,
      permission,
      scope,
      async (_client, principal, authority) => operation(principal, authority),
    );
  }
  /** Owner-only composition hook; does not expose the identity database client. */
  async guardInstance<T>(
    token: string,
    operation: (principal: Principal) => Promise<T>,
  ): Promise<T> {
    this.ensureReady();
    return this.transaction(async (client) => {
      const p = await this.sessionIn(client, token);
      if (
        p.user.account_type !== "adult" ||
        !(
          await client.query("select 1 from instance_owners where user_id=$1", [
            p.user.id,
          ])
        ).rowCount
      )
        throw new AuthError(
          403,
          "INSTANCE_PERMISSION_DENIED",
          "Instance owner permission required.",
        );
      return operation(p);
    });
  }
  /** Protected local recovery capability, intentionally unavailable as an HTTP route. */
  async guardLocalRecovery<T>(
    token: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.ensureReady();
    return this.transaction(async (client) => {
      const row = (
        await client.query<{ recovery_hash: string }>(
          "select recovery_hash from installation_settings where id=true and bootstrapped_at is not null",
        )
      ).rows[0];
      if (!row || !equal(digest(token), row.recovery_hash))
        throw new AuthError(
          403,
          "RECOVERY_DENIED",
          "Local owner recovery credential is invalid.",
        );
      return operation();
    });
  }
  async createOrganization(token: string, name: string) {
    name = z.string().trim().min(1).max(120).parse(name);
    return this.transaction(async (client) => {
      const p = await this.sessionIn(client, token);
      if (
        p.user.account_type !== "adult" ||
        !(
          await client.query("select 1 from instance_owners where user_id=$1", [
            p.user.id,
          ])
        ).rowCount
      )
        throw new AuthError(
          403,
          "INSTANCE_PERMISSION_DENIED",
          "Instance owner permission required.",
        );
      const org = randomUUID(),
        member = randomUUID();
      await client.query("select set_config('app.organization_id',$1,true)", [
        org,
      ]);
      await client.query("insert into organizations(id,name) values($1,$2)", [
        org,
        name,
      ]);
      await this.seedRoles(client, org);
      await client.query(
        "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
        [member, org, p.user.id],
      );
      await client.query(
        "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name='org_admin' and built_in=true",
        [org, member],
      );
      await this.audit(
        client,
        p.user.id,
        "organization.created",
        org,
        true,
        org,
      );
      return { id: org, name };
    });
  }
  async createProject(token: string, org: string, name: string) {
    name = z.string().trim().min(1).max(120).parse(name);
    return this.orgAction(
      token,
      org,
      "project:create",
      { kind: "organization", id: org },
      async (client, p) => {
        const id = randomUUID();
        await client.query(
          "insert into projects(id,organization_id,name) values($1,$2,$3)",
          [id, org, name],
        );
        await this.audit(client, p.user.id, "project.created", id, true, org);
        return { id, name };
      },
      true,
    );
  }
  async listProjects(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "organization:read",
      { kind: "organization", id: org },
      async (client, _p, a) => {
        const r = await client.query<{ id: string; name: string }>(
          "select id,name from projects where organization_id=$1 order by created_at limit 100",
          [org],
        );
        return r.rows.filter((x) =>
          canAccess(a, "project:read", { kind: "project", id: x.id }),
        );
      },
    );
  }
  async getProject(token: string, org: string, id: string) {
    return this.orgAction(
      token,
      org,
      "project:read",
      { kind: "project", id },
      async (client) =>
        (
          await client.query(
            "select id,name from projects where organization_id=$1 and id=$2",
            [org, id],
          )
        ).rows[0],
    );
  }
  async createEnvironment(
    token: string,
    org: string,
    input: {
      projectId: string;
      name: string;
      type: "minecraft" | "coding" | "research" | "simulation";
    },
  ) {
    const value = z
      .strictObject({
        projectId: z.uuid(),
        name: z.string().trim().min(1).max(120),
        type: z.enum(["minecraft", "coding", "research", "simulation"]),
      })
      .parse(input);
    return this.orgAction(
      token,
      org,
      "environment:admin",
      { kind: "project", id: value.projectId },
      async (client, p) => {
        const id = randomUUID();
        await client.query(
          "insert into environments(id,organization_id,project_id,name,type) values($1,$2,$3,$4,$5)",
          [id, org, value.projectId, value.name, value.type],
        );
        await this.audit(
          client,
          p.user.id,
          "environment.created",
          id,
          true,
          org,
        );
        return {
          id,
          name: value.name,
          project_id: value.projectId,
          type: value.type,
        };
      },
      true,
    );
  }
  async listEnvironments(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "organization:read",
      { kind: "organization", id: org },
      async (client, _p, a) => {
        const r = await client.query<{
          id: string;
          name: string;
          project_id: string;
          type: string;
        }>(
          "select id,name,project_id,type from environments where organization_id=$1 limit 100",
          [org],
        );
        return r.rows.filter((x) =>
          canAccess(a, "environment:read", {
            kind: "environment",
            id: x.id,
            projectId: x.project_id,
            environmentType: x.type,
          }),
        );
      },
    );
  }
  async getEnvironment(token: string, org: string, id: string) {
    return this.orgAction(
      token,
      org,
      "environment:read",
      { kind: "environment", id },
      async (client) =>
        (
          await client.query(
            "select id,name,project_id,type from environments where organization_id=$1 and id=$2",
            [org, id],
          )
        ).rows[0],
    );
  }
  private grantBody(grant: ExecutionGrant) {
    return JSON.stringify([
      grant.version,
      grant.id,
      grant.userId,
      grant.organizationId,
      grant.membershipId,
      grant.sessionId,
      grant.userVersion,
      grant.membershipVersion,
      grant.permission,
      grant.resource.kind,
      grant.resource.id,
      grant.issuedAt,
      grant.expiresAt,
    ]);
  }
  private grantSignature(grant: ExecutionGrant) {
    return createHmac("sha256", this.#options.csrfSecret)
      .update(`grant/v1/${this.grantBody(grant)}`)
      .digest("base64url");
  }
  async issueExecutionGrant(
    token: string,
    org: string,
    permission: Permission,
    scope: { kind: "organization" | "project" | "environment"; id: string },
  ): Promise<ExecutionGrant> {
    return this.orgAction(
      token,
      org,
      permission,
      scope,
      async (client, p, _a, member) => {
        const issuedAt = this.now().getTime();
        const grant: ExecutionGrant = {
          version: 1,
          id: randomUUID(),
          userId: p.user.id,
          organizationId: org,
          membershipId: member.id,
          sessionId: p.sessionId,
          userVersion: p.userVersion,
          membershipVersion: member.auth_version,
          permission: z.enum(organizationPermissions).parse(permission),
          resource: scope,
          issuedAt,
          expiresAt: issuedAt + 3600000,
          signature: "",
        };
        grant.signature = this.grantSignature(grant);
        await this.audit(
          client,
          p.user.id,
          "execution.grant_issued",
          grant.id,
          true,
          org,
        );
        return grant;
      },
    );
  }
  async guardExecution<T>(
    value: ExecutionGrant,
    operation: (principal: Principal) => Promise<T>,
  ): Promise<T> {
    return this.guardExecutions([value], operation);
  }
  /** Validate one principal's related scopes without nested identity pool leases. */
  async guardExecutions<T>(
    values: readonly ExecutionGrant[],
    operation: (principal: Principal) => Promise<T>,
  ): Promise<T> {
    return this.guardExecutionGroups([values], async (principals) => {
      const principal = principals[0];
      if (!principal)
        throw new AuthError(
          403,
          "GRANT_DENIED",
          "Execution grants are invalid.",
        );
      return operation(principal);
    });
  }

  /**
   * Validate two distinct current adults in one identity transaction.
   * Callers must supply every required permission and bind the grants to their
   * canonical request/reviewer; this primitive does not record an approval.
   * Keep callbacks bounded and do not acquire another identity lease inside them.
   */
  async guardIndependentExecutions<T>(
    original: readonly ExecutionGrant[],
    reviewer: readonly ExecutionGrant[],
    operation: (original: Principal, reviewer: Principal) => Promise<T>,
  ): Promise<T> {
    return this.guardExecutionGroups(
      [original, reviewer],
      async (principals) => {
        const first = principals[0],
          second = principals[1];
        if (!first || !second)
          throw new AuthError(
            403,
            "GRANT_DENIED",
            "Execution grants are invalid.",
          );
        return operation(first, second);
      },
    );
  }

  private async guardExecutionGroups<T>(
    values: readonly (readonly ExecutionGrant[])[],
    operation: (principals: readonly Principal[]) => Promise<T>,
  ): Promise<T> {
    this.ensureReady();
    const parsed = z
      .array(z.array(executionGrantSchema).min(1).max(4))
      .min(1)
      .max(2)
      .safeParse(values);
    if (!parsed.success)
      throw new AuthError(403, "GRANT_DENIED", "Execution grants are invalid.");
    const groups = parsed.data.map((grants, index) => {
        const anchor = grants[0];
        if (!anchor)
          throw new AuthError(
            403,
            "GRANT_DENIED",
            "Execution grants are invalid.",
          );
        return { grants, anchor, index };
      }),
      first = groups[0];
    if (
      !first ||
      new Set(groups.map((g) => g.anchor.userId)).size !== groups.length
    )
      throw new AuthError(
        403,
        "GRANT_DENIED",
        "Independent authority requires distinct principals.",
      );
    const now = this.now().getTime();
    for (const { grants, anchor } of groups)
      for (const grant of grants)
        if (
          grant.organizationId !== first.anchor.organizationId ||
          grant.userId !== anchor.userId ||
          grant.sessionId !== anchor.sessionId ||
          grant.issuedAt > now ||
          grant.expiresAt <= now ||
          grant.expiresAt - grant.issuedAt > 3600000 ||
          !equal(grant.signature, this.grantSignature(grant))
        )
          throw new AuthError(
            403,
            "GRANT_DENIED",
            "Execution grant is invalid or expired.",
          );
    // Stable principal lock order, preserving caller order in the returned pair.
    groups.sort((a, b) => (a.anchor.userId < b.anchor.userId ? -1 : 1));
    return this.transaction(async (client) => {
      const principals: Principal[] = [];
      for (const { grants, index } of groups) {
        let principal: Principal | undefined;
        for (const grant of grants) {
          const result = await client.query<
            UserRow & { authority_expires_at: Date }
          >(
            "select u.*,least(s.expires_at,s.idle_expires_at) as authority_expires_at from users u join sessions s on s.user_id=u.id where u.id=$1 and s.id=$2 and s.revoked_at is null and s.expires_at>$3 and s.idle_expires_at>$3 and s.auth_version=u.auth_version and u.auth_version=$4 and u.disabled_at is null for share of u,s",
            [grant.userId, grant.sessionId, this.now(), grant.userVersion],
          );
          const user = result.rows[0];
          if (!user)
            throw new AuthError(
              403,
              "GRANT_DENIED",
              "Execution authority was revoked.",
            );
          const p: Principal = {
            user: this.publicUser(user),
            sessionId: grant.sessionId,
            authorityExpiresAt: Math.min(
              user.authority_expires_at.getTime(),
              grant.expiresAt,
            ),
            userVersion: user.auth_version,
          };
          const { member, a } = await this.authority(
            client,
            p,
            grant.organizationId,
          );
          if (
            member.id !== grant.membershipId ||
            member.auth_version !== grant.membershipVersion ||
            !canAccess(
              a,
              grant.permission,
              await this.canonicalScope(
                client,
                grant.organizationId,
                grant.resource,
              ),
            )
          )
            throw new AuthError(
              403,
              "GRANT_DENIED",
              "Execution authority changed.",
            );

          principal = p;
        }
        if (
          !principal ||
          (groups.length === 2 && principal.user.account_type !== "adult")
        )
          throw new AuthError(
            403,
            "GRANT_DENIED",
            "Independent authority requires current adults.",
          );
        principal.authorityExpiresAt = Math.min(
          ...grants.map((g) => g.expiresAt),
          principal.authorityExpiresAt ?? 0,
        );
        principals[index] = principal;
      }
      // The first principal can expire while we wait for the second one's
      // locks. Recheck the entire set immediately before entering the callback.
      const checkedAt = this.now().getTime();
      if (
        principals.some((p) => (p.authorityExpiresAt ?? 0) <= checkedAt) ||
        groups.some(({ grants }) => grants.some((g) => g.issuedAt > checkedAt))
      )
        throw new AuthError(
          403,
          "GRANT_DENIED",
          "Execution authority expired or clock moved backwards.",
        );
      return operation(principals);
    });
  }

  async revalidateExecutionGrant(value: ExecutionGrant) {
    return this.guardExecution(value, async () => true);
  }
  private async roleFor(client: pg.PoolClient, org: string, id: string) {
    const role = (
      await client.query<{ id: string; name: string; built_in: boolean }>(
        "select id,name,built_in from roles where organization_id=$1 and id=$2",
        [org, id],
      )
    ).rows[0];
    if (!role) throw new AuthError(404, "NOT_FOUND", "Role not found.");
    const permissions = (
      await client.query<{ permission: string }>(
        "select permission from role_permissions where organization_id=$1 and role_id=$2",
        [org, id],
      )
    ).rows.map((x) => x.permission);
    return { ...role, permissions };
  }
  private mayDelegate(a: Authority, permissions: string[]) {
    if (permissions.some((permission) => !a.permissions.includes(permission)))
      throw new AuthError(
        403,
        "DELEGATION_DENIED",
        "Cannot grant permissions you do not hold.",
      );
  }
  async listMembers(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "membership:manage",
      { kind: "organization", id: org },
      async (client) =>
        (
          await client.query(
            "select m.id,m.user_id,u.login,u.account_type,m.disabled_at,u.disabled_at as user_disabled_at,coalesce(array_agg(r.name) filter(where r.name is not null),'{}') as roles from memberships m join users u on u.id=m.user_id left join membership_roles mr on mr.organization_id=m.organization_id and mr.membership_id=m.id left join roles r on r.organization_id=mr.organization_id and r.id=mr.role_id where m.organization_id=$1 group by m.id,u.id order by m.created_at limit 100",
            [org],
          )
        ).rows,
    );
  }
  async listRoles(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "role:manage",
      { kind: "organization", id: org },
      async (client) =>
        (
          await client.query(
            "select r.id,r.name,r.built_in,coalesce(array_agg(rp.permission) filter(where rp.permission is not null),'{}') as permissions from roles r left join role_permissions rp on rp.organization_id=r.organization_id and rp.role_id=r.id where r.organization_id=$1 group by r.id order by r.name limit 100",
            [org],
          )
        ).rows,
    );
  }
  async createRole(
    token: string,
    org: string,
    input: { name: string; permissions: string[] },
  ) {
    const value = z
      .strictObject({
        name: z.string().trim().min(1).max(80),
        permissions: z
          .array(z.enum(organizationPermissions))
          .min(1)
          .max(organizationPermissions.length),
      })
      .parse(input);
    return this.orgAction(
      token,
      org,
      "role:manage",
      { kind: "organization", id: org },
      async (client, p, a) => {
        this.mayDelegate(a, value.permissions);
        const id = randomUUID();
        await client.query(
          "insert into roles(id,organization_id,name) values($1,$2,$3)",
          [id, org, value.name],
        );
        for (const permission of new Set(value.permissions))
          await client.query(
            "insert into role_permissions(organization_id,role_id,permission) values($1,$2,$3)",
            [org, id, permission],
          );
        await this.audit(client, p.user.id, "role.created", id, true, org);
        return { id, name: value.name, permissions: value.permissions };
      },
      true,
    );
  }
  private async memberFor(client: pg.PoolClient, org: string, id: string) {
    const row = (
      await client.query<{
        id: string;
        user_id: string;
        account_type: "adult" | "child";
        disabled_at: Date | null;
      }>(
        "select m.id,m.user_id,m.disabled_at,u.account_type from memberships m join users u on u.id=m.user_id where m.organization_id=$1 and m.id=$2 for update of m",
        [org, id],
      )
    ).rows[0];
    if (!row) throw new AuthError(404, "NOT_FOUND", "Membership not found.");
    return row;
  }
  private async protectOrgAdmin(
    client: pg.PoolClient,
    org: string,
    id: string,
    keepsAdmin: boolean,
  ) {
    if (keepsAdmin) return;
    const admins = await client.query<{ id: string }>(
      "select m.id from memberships m join users u on u.id=m.user_id join membership_roles mr on mr.organization_id=m.organization_id and mr.membership_id=m.id join roles r on r.organization_id=mr.organization_id and r.id=mr.role_id where m.organization_id=$1 and m.disabled_at is null and u.disabled_at is null and u.account_type='adult' and r.name='org_admin' and r.built_in=true",
      [org],
    );
    if (
      admins.rows.some((m) => m.id === id) &&
      !admins.rows.some((m) => m.id !== id)
    )
      throw new AuthError(
        409,
        "LAST_ORG_ADMIN",
        "Keep at least one active adult organization administrator.",
      );
  }
  async setMemberRoles(
    token: string,
    org: string,
    memberId: string,
    roleIds: string[],
  ) {
    const ids = [...new Set(z.array(z.uuid()).min(1).max(5).parse(roleIds))];
    return this.orgAction(
      token,
      org,
      "role:manage",
      { kind: "organization", id: org },
      async (client, p, a) => {
        const target = await this.memberFor(client, org, memberId),
          roles = [];
        for (const id of ids) {
          const role = await this.roleFor(client, org, id);
          this.mayDelegate(a, role.permissions);
          roles.push(role);
        }
        if (
          target.account_type === "child" &&
          (!roles.some((r) => r.name === "child" && r.built_in) ||
            roles.some((r) =>
              r.permissions.some(
                (permission) => !childPermissions.includes(permission),
              ),
            ))
        )
          throw new AuthError(
            400,
            "CHILD_ROLE_RESTRICTED",
            "Child accounts retain the child role and child-safe permissions only.",
          );
        await this.protectOrgAdmin(
          client,
          org,
          memberId,
          roles.some((r) => r.name === "org_admin" && r.built_in),
        );
        await client.query(
          "delete from membership_roles where organization_id=$1 and membership_id=$2",
          [org, memberId],
        );
        for (const role of roles)
          await client.query(
            "insert into membership_roles(organization_id,membership_id,role_id) values($1,$2,$3)",
            [org, memberId, role.id],
          );
        await client.query(
          "update memberships set auth_version=auth_version+1 where organization_id=$1 and id=$2",
          [org, memberId],
        );
        await this.audit(
          client,
          p.user.id,
          "membership.roles_changed",
          memberId,
          true,
          org,
          { role_ids: ids },
        );
        return { ok: true };
      },
      true,
    );
  }
  async setMembershipDisabled(
    token: string,
    org: string,
    memberId: string,
    disabled: boolean,
  ) {
    return this.orgAction(
      token,
      org,
      "membership:manage",
      { kind: "organization", id: org },
      async (client, p) => {
        await this.memberFor(client, org, memberId);
        await this.protectOrgAdmin(client, org, memberId, !disabled);
        await client.query(
          "update memberships set disabled_at=$3,auth_version=auth_version+1 where organization_id=$1 and id=$2",
          [org, memberId, disabled ? this.now() : null],
        );
        await this.audit(
          client,
          p.user.id,
          "membership.status_changed",
          memberId,
          true,
          org,
          { disabled },
        );
        return { ok: true };
      },
      true,
    );
  }
  async addResourceGrant(
    token: string,
    org: string,
    input: {
      membershipId: string;
      permission: string;
      projectId: string;
      environmentId?: string | undefined;
    },
  ) {
    const value = z
      .strictObject({
        membershipId: z.uuid(),
        permission: z.enum(organizationPermissions),
        projectId: z.uuid(),
        environmentId: z.uuid().optional(),
      })
      .parse(input);
    return this.orgAction(
      token,
      org,
      "membership:manage",
      { kind: "organization", id: org },
      async (client, p, a) => {
        const target = await this.memberFor(client, org, value.membershipId);
        this.mayDelegate(a, [value.permission]);
        const scope = await this.canonicalScope(
          client,
          org,
          value.environmentId
            ? { kind: "environment", id: value.environmentId }
            : { kind: "project", id: value.projectId },
        );
        if (scope.kind === "environment" && scope.projectId !== value.projectId)
          throw new AuthError(404, "NOT_FOUND", "Environment not found.");
        if (!canAccess(a, value.permission, scope))
          throw new AuthError(
            403,
            "DELEGATION_DENIED",
            "Cannot delegate beyond your resource scope.",
          );
        if (
          target.account_type === "child" &&
          (!value.environmentId ||
            scope.environmentType !== "minecraft" ||
            !childPermissions.includes(value.permission))
        )
          throw new AuthError(
            400,
            "CHILD_SCOPE_RESTRICTED",
            "Child access is limited to assigned Minecraft worlds.",
          );
        const id = randomUUID();
        await client.query(
          "insert into resource_grants(id,organization_id,membership_id,permission,project_id,environment_id) values($1,$2,$3,$4,$5,$6) on conflict do nothing",
          [
            id,
            org,
            value.membershipId,
            value.permission,
            value.projectId,
            value.environmentId ?? null,
          ],
        );
        await client.query(
          "update memberships set auth_version=auth_version+1 where organization_id=$1 and id=$2",
          [org, value.membershipId],
        );
        await this.audit(
          client,
          p.user.id,
          "resource.granted",
          value.membershipId,
          true,
          org,
          { permission: value.permission, project_id: value.projectId },
        );
        return { ok: true };
      },
      true,
    );
  }
  async createInvitation(token: string, org: string, roleId: string) {
    return this.orgAction(
      token,
      org,
      "user:invite",
      { kind: "organization", id: org },
      async (client, p, a) => {
        const role = await this.roleFor(client, org, roleId);
        this.mayDelegate(a, role.permissions);
        if (role.name === "child" && role.built_in)
          throw new AuthError(
            400,
            "CHILD_ONBOARDING_REQUIRED",
            "Create child accounts through adult-managed onboarding.",
          );
        const id = randomUUID(),
          inviteToken = `${org}.${randomBytes(32).toString("hex")}`,
          expiresAt = new Date(this.now().getTime() + 86400000);
        await client.query(
          "insert into invitations(id,organization_id,role_id,token_hash,expires_at,created_by) values($1,$2,$3,$4,$5,$6)",
          [id, org, roleId, digest(inviteToken), expiresAt, p.user.id],
        );
        await this.audit(
          client,
          p.user.id,
          "invitation.created",
          id,
          true,
          org,
        );
        return { id, token: inviteToken, expires_at: expiresAt.toISOString() };
      },
      true,
    );
  }
  async consumeInvitation(
    input: {
      token: string;
      login?: string | undefined;
      password?: string | undefined;
      email?: string | undefined;
    },
    source: string,
    existingSession?: string,
  ): Promise<SessionResult> {
    this.ensureReady();
    await this.rate("invite-consume", source, 20);
    const parts = input.token.split(".");
    const org = parts[0] ?? "";
    if (
      parts.length !== 2 ||
      !z.uuid().safeParse(org).success ||
      !/^[a-f0-9]{64}$/.test(parts[1] ?? "")
    )
      throw new AuthError(
        400,
        "INVITATION_INVALID",
        "Invitation is invalid or expired.",
      );
    const passwordHash = existingSession
      ? null
      : await this.hashPassword(input.password ?? "");
    try {
      return await this.transaction(async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1,74618003))",
          [org],
        );
        await client.query("select set_config('app.organization_id',$1,true)", [
          org,
        ]);
        const invite = (
          await client.query<{
            id: string;
            role_id: string;
            created_by: string;
          }>(
            "select id,role_id,created_by from invitations where organization_id=$1 and token_hash=$2 and consumed_at is null and revoked_at is null and expires_at>$3 for update",
            [org, digest(input.token), this.now()],
          )
        ).rows[0];
        if (!invite)
          throw new AuthError(
            400,
            "INVITATION_INVALID",
            "Invitation is invalid or expired.",
          );
        const inviter = (
          await client.query<UserRow>(
            "select * from users where id=$1 and disabled_at is null for share",
            [invite.created_by],
          )
        ).rows[0];
        if (!inviter)
          throw new AuthError(
            400,
            "INVITATION_INVALID",
            "Invitation is unavailable.",
          );
        const { a } = await this.authority(
          client,
          {
            user: this.publicUser(inviter),
            userVersion: inviter.auth_version,
            sessionId: "",
          },
          org,
        );
        if (!canAccess(a, "user:invite", { kind: "organization", id: org }))
          throw new AuthError(
            400,
            "INVITATION_INVALID",
            "Invitation is unavailable.",
          );
        const role = await this.roleFor(client, org, invite.role_id);
        this.mayDelegate(a, role.permissions);
        let user: UserRow;
        if (existingSession) {
          const p = await this.sessionIn(client, existingSession);
          if (p.user.account_type !== "adult")
            throw new AuthError(
              403,
              "CHILD_INVITE_DENIED",
              "An adult account is required.",
            );
          user = (
            await client.query<UserRow>("select * from users where id=$1", [
              p.user.id,
            ])
          ).rows[0] as UserRow;
        } else {
          const login = loginName.parse(input.login);
          user = (
            await client.query<UserRow>(
              "insert into users(id,login,email,account_type,password_hash) values($1,$2,$3,'adult',$4) returning *",
              [
                randomUUID(),
                login,
                input.email?.trim().toLowerCase() ?? null,
                passwordHash,
              ],
            )
          ).rows[0] as UserRow;
        }
        const existing = (
          await client.query<{ id: string; disabled_at: Date | null }>(
            "select id,disabled_at from memberships where organization_id=$1 and user_id=$2",
            [org, user.id],
          )
        ).rows[0];
        if (existing?.disabled_at)
          throw new AuthError(
            403,
            "MEMBERSHIP_DISABLED",
            "Ask an organization administrator to restore access.",
          );
        const member = existing?.id ?? randomUUID();
        if (!existing)
          await client.query(
            "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
            [member, org, user.id],
          );
        await client.query(
          "insert into membership_roles(organization_id,membership_id,role_id) values($1,$2,$3) on conflict do nothing",
          [org, member, role.id],
        );
        await client.query(
          "update memberships set auth_version=auth_version+1 where organization_id=$1 and id=$2",
          [org, member],
        );
        await client.query(
          "update invitations set consumed_at=$2 where id=$1",
          [invite.id, this.now()],
        );
        await this.audit(
          client,
          user.id,
          "invitation.consumed",
          invite.id,
          true,
          org,
        );
        return this.newSession(client, user, existingSession);
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new AuthError(
          409,
          "INVITATION_CONFLICT",
          "Invitation cannot be used with these details.",
        );
      throw error;
    }
  }
  async setUserDisabled(token: string, userId: string, disabled: boolean) {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(74618002)");
      const p = await this.sessionIn(client, token);
      if (
        p.user.account_type !== "adult" ||
        !(
          await client.query("select 1 from instance_owners where user_id=$1", [
            p.user.id,
          ])
        ).rowCount
      )
        throw new AuthError(
          403,
          "INSTANCE_PERMISSION_DENIED",
          "Instance owner permission required.",
        );
      if (disabled) {
        const owners = await client.query<{ user_id: string }>(
          "select o.user_id from instance_owners o join users u on u.id=o.user_id where u.disabled_at is null",
        );
        if (
          owners.rows.some((x) => x.user_id === userId) &&
          !owners.rows.some((x) => x.user_id !== userId)
        )
          throw new AuthError(
            409,
            "LAST_OWNER",
            "Keep at least one active instance owner.",
          );
      }
      const user = await client.query(
        "update users set disabled_at=$2,auth_version=auth_version+1 where id=$1 returning id",
        [userId, disabled ? this.now() : null],
      );
      if (!user.rowCount)
        throw new AuthError(404, "NOT_FOUND", "User not found.");
      await client.query("update sessions set revoked_at=$2 where user_id=$1", [
        userId,
        this.now(),
      ]);
      await this.audit(
        client,
        p.user.id,
        "user.status_changed",
        userId,
        true,
        undefined,
        { disabled },
      );
      return { ok: true };
    });
  }

  async listResourceGrants(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "membership:manage",
      { kind: "organization", id: org },
      async (client) =>
        (
          await client.query(
            "select id,membership_id,permission,project_id,environment_id from resource_grants where organization_id=$1 order by id limit 100",
            [org],
          )
        ).rows,
    );
  }
  async removeResourceGrant(token: string, org: string, id: string) {
    return this.orgAction(
      token,
      org,
      "membership:manage",
      { kind: "organization", id: org },
      async (client, p) => {
        const result = await client.query<{ membership_id: string }>(
          "delete from resource_grants where organization_id=$1 and id=$2 returning membership_id",
          [org, id],
        );
        const member = result.rows[0]?.membership_id;
        if (!member) throw new AuthError(404, "NOT_FOUND", "Grant not found.");
        await client.query(
          "update memberships set auth_version=auth_version+1 where organization_id=$1 and id=$2",
          [org, member],
        );
        await this.audit(client, p.user.id, "resource.revoked", id, true, org);
        return { ok: true };
      },
      true,
    );
  }
  async listInvitations(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "user:invite",
      { kind: "organization", id: org },
      async (client) =>
        (
          await client.query(
            "select id,role_id,expires_at,consumed_at,revoked_at from invitations where organization_id=$1 order by expires_at desc limit 100",
            [org],
          )
        ).rows,
    );
  }
  async revokeInvitation(token: string, org: string, id: string) {
    return this.orgAction(
      token,
      org,
      "user:invite",
      { kind: "organization", id: org },
      async (client, p) => {
        const result = await client.query(
          "update invitations set revoked_at=$3 where organization_id=$1 and id=$2 and consumed_at is null and revoked_at is null",
          [org, id, this.now()],
        );
        if (!result.rowCount)
          throw new AuthError(404, "NOT_FOUND", "Invitation not found.");
        await this.audit(
          client,
          p.user.id,
          "invitation.revoked",
          id,
          true,
          org,
        );
        return { ok: true };
      },
      true,
    );
  }

  private sealReset(value: { recipient: string; token: string }, id: string) {
    const nonce = randomBytes(12),
      key = Buffer.from(
        hkdfSync(
          "sha256",
          Buffer.from(this.#options.csrfSecret, "hex"),
          Buffer.alloc(0),
          "craftlayer/recovery-mail/v1",
          32,
        ),
      ),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }
  private openReset(
    payload: Buffer,
    id: string,
  ): { recipient: string; token: string } {
    const key = Buffer.from(
        hkdfSync(
          "sha256",
          Buffer.from(this.#options.csrfSecret, "hex"),
          Buffer.alloc(0),
          "craftlayer/recovery-mail/v1",
          32,
        ),
      ),
      decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(payload.subarray(12, 28));
    return z
      .strictObject({
        recipient: z.email(),
        token: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(payload.subarray(28)),
            decipher.final(),
          ]).toString("utf8"),
        ),
      );
  }
  async requestPasswordReset(login: string, source: string) {
    this.ensureReady();
    await this.rate("reset-ip", source, 10);
    await this.rate("reset-name", login.trim().toLowerCase(), 5, 900000);
    await this.pruneRecovery();
    const started = performance.now();
    if (this.#options.deliverReset)
      await this.transaction(async (client) => {
        const user = (
          await client.query<UserRow>(
            "select * from users where login=$1 or email=$1 for update",
            [login.trim().toLowerCase()],
          )
        ).rows[0];
        if (!user?.email || user.disabled_at || user.account_type !== "adult")
          return;
        await client.query(
          "update password_reset_tokens set consumed_at=$2 where user_id=$1 and consumed_at is null",
          [user.id, this.now()],
        );
        const id = randomUUID(),
          token = randomBytes(32).toString("hex"),
          expires = new Date(this.now().getTime() + 1800000);
        await client.query(
          "insert into password_reset_tokens(id,user_id,token_hash,expires_at) values($1,$2,$3,$4)",
          [id, user.id, digest(token), expires],
        );
        await client.query(
          "insert into identity_mail_outbox(token_id,payload,next_attempt_at) values($1,$2,$3)",
          [
            id,
            this.sealReset({ recipient: user.email, token }, id),
            this.now(),
          ],
        );
        await this.audit(client, null, "password_reset.requested", user.id);
      });
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 30 - (performance.now() - started))),
    );
    return {
      accepted: true,
      message: "If email recovery is available, instructions will be sent.",
    };
  }
  async flushResetMail() {
    if (!this.#options.deliverReset) return 0;
    this.ensureReady();
    await this.pruneRecovery();
    let delivered = 0;
    for (let i = 0; i < 5; i++) {
      const lease = randomUUID();
      const item = await this.transaction(async (client) => {
        const row = (
          await client.query<{ token_id: string; payload: Buffer }>(
            "select o.token_id,o.payload from identity_mail_outbox o join password_reset_tokens t on t.id=o.token_id where o.delivered_at is null and o.attempts<3 and o.next_attempt_at<=$1 and (o.lease_expires_at is null or o.lease_expires_at<$1) and t.expires_at>$1 and t.consumed_at is null order by o.next_attempt_at for update of o skip locked limit 1",
            [this.now()],
          )
        ).rows[0];
        if (row)
          await client.query(
            "update identity_mail_outbox set attempts=attempts+1,lease_id=$2,lease_expires_at=$3 where token_id=$1",
            [row.token_id, lease, new Date(this.now().getTime() + 60000)],
          );
        return row;
      });
      if (!item) break;
      try {
        const value = this.openReset(item.payload, item.token_id);
        await this.#options.deliverReset(value.recipient, value.token);
        await this.#pool.query(
          "update identity_mail_outbox set delivered_at=$3,payload=$4,lease_id=null,lease_expires_at=null where token_id=$1 and lease_id=$2",
          [item.token_id, lease, this.now(), Buffer.alloc(0)],
        );
        delivered++;
      } catch {
        await this.#pool.query(
          "update identity_mail_outbox set next_attempt_at=$3,lease_id=null,lease_expires_at=null where token_id=$1 and lease_id=$2",
          [item.token_id, lease, new Date(this.now().getTime() + 300000)],
        );
      }
    }
    return delivered;
  }
  private async replacePassword(
    client: pg.PoolClient,
    userId: string,
    passwordHash: string,
  ) {
    await client.query("select id from users where id=$1 for update", [userId]);
    await client.query(
      "update users set password_hash=$2,auth_version=auth_version+1 where id=$1",
      [userId, passwordHash],
    );
    await client.query("update sessions set revoked_at=$2 where user_id=$1", [
      userId,
      this.now(),
    ]);
    await client.query(
      "update password_reset_tokens set consumed_at=$2 where user_id=$1 and consumed_at is null",
      [userId, this.now()],
    );
    await client.query(
      "delete from identity_mail_outbox where token_id in(select id from password_reset_tokens where user_id=$1)",
      [userId],
    );
  }
  async consumePasswordReset(token: string, password: string, source: string) {
    this.ensureReady();
    await this.rate("reset-consume", source, 20);
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new AuthError(
        400,
        "RESET_INVALID",
        "Reset token is invalid or expired.",
      );
    const passwordHash = await this.hashPassword(password);
    return this.transaction(async (client) => {
      const lookup = (
        await client.query<{ user_id: string }>(
          "select user_id from password_reset_tokens where token_hash=$1",
          [digest(token)],
        )
      ).rows[0];
      if (!lookup)
        throw new AuthError(
          400,
          "RESET_INVALID",
          "Reset token is invalid or expired.",
        );
      const user = (
        await client.query<UserRow>(
          "select * from users where id=$1 for update",
          [lookup.user_id],
        )
      ).rows[0];
      const reset = (
        await client.query(
          "select id from password_reset_tokens where token_hash=$1 and consumed_at is null and expires_at>$2 for update",
          [digest(token), this.now()],
        )
      ).rows[0];
      if (!reset || !user || user.disabled_at || user.account_type !== "adult")
        throw new AuthError(
          400,
          "RESET_INVALID",
          "Reset token is invalid or expired.",
        );
      await this.replacePassword(client, user.id, passwordHash);
      await this.audit(client, user.id, "password_reset.consumed", user.id);
      return { ok: true };
    });
  }
  async recoverPassword(
    recoveryToken: string,
    login: string,
    password: string,
  ) {
    this.ensureReady();
    const settings = (
      await this.#pool.query<{ recovery_hash: string }>(
        "select recovery_hash from installation_settings where id=true and bootstrapped_at is not null",
      )
    ).rows[0];
    if (!settings || !equal(digest(recoveryToken), settings.recovery_hash))
      throw new AuthError(
        403,
        "RECOVERY_DENIED",
        "Local owner recovery credential is invalid.",
      );
    const passwordHash = await this.hashPassword(password);
    return this.transaction(async (client) => {
      const user = (
        await client.query<UserRow>(
          "select * from users where login=$1 for update",
          [loginName.parse(login)],
        )
      ).rows[0];
      if (!user) throw new AuthError(404, "NOT_FOUND", "User not found.");
      await this.replacePassword(client, user.id, passwordHash);
      await this.audit(client, null, "owner.password_recovered", user.id);
      return { ok: true };
    });
  }
  async createChild(
    token: string,
    org: string,
    input: { login: string; password: string; environmentIds: string[] },
  ) {
    const value = z
      .strictObject({
        login: loginName,
        password: newPassword,
        environmentIds: z.array(z.uuid()).min(1).max(10),
      })
      .parse(input);
    await this.authorize(token, org, "membership:manage", {
      kind: "organization",
      id: org,
    });
    const passwordHash = await this.hashPassword(value.password);
    return this.orgAction(
      token,
      org,
      "membership:manage",
      { kind: "organization", id: org },
      async (client, p) => {
        const worlds = [];
        for (const id of new Set(value.environmentIds)) {
          const world = await this.canonicalScope(client, org, {
            kind: "environment",
            id,
          });
          if (world.environmentType !== "minecraft")
            throw new AuthError(
              400,
              "CHILD_WORLD_REQUIRED",
              "Child accounts use assigned Minecraft worlds only.",
            );
          worlds.push(world);
        }
        const id = randomUUID(),
          memberId = randomUUID();
        await client.query(
          "insert into users(id,login,account_type,password_hash) values($1,$2,'child',$3)",
          [id, value.login, passwordHash],
        );
        await client.query(
          "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
          [memberId, org, id],
        );
        await client.query(
          "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name='child' and built_in=true",
          [org, memberId],
        );
        for (const world of worlds)
          for (const permission of childPermissions.filter(
            (p) => p !== "organization:read",
          ))
            await client.query(
              "insert into resource_grants(id,organization_id,membership_id,permission,project_id,environment_id) values($1,$2,$3,$4,$5,$6)",
              [
                randomUUID(),
                org,
                memberId,
                permission,
                world.projectId,
                world.id,
              ],
            );
        await this.audit(client, p.user.id, "child.created", id, true, org);
        return {
          id,
          login: value.login,
          membership_id: memberId,
          account_type: "child" as const,
        };
      },
      true,
    );
  }
  async resetChildPassword(
    token: string,
    org: string,
    memberId: string,
    password: string,
  ) {
    await this.authorize(token, org, "membership:manage", {
      kind: "organization",
      id: org,
    });
    const passwordHash = await this.hashPassword(password);
    return this.orgAction(
      token,
      org,
      "membership:manage",
      { kind: "organization", id: org },
      async (client, p) => {
        const child = await this.memberFor(client, org, memberId);
        if (child.account_type !== "child")
          throw new AuthError(
            403,
            "CHILD_ACCOUNT_REQUIRED",
            "Adult accounts use email or instance-owner recovery.",
          );
        await this.replacePassword(client, child.user_id, passwordHash);
        await this.audit(
          client,
          p.user.id,
          "child.password_reset",
          child.user_id,
          true,
          org,
        );
        return { ok: true };
      },
      true,
    );
  }

  private async pruneRecovery() {
    await this.#pool.query(
      "delete from identity_mail_outbox where token_id in(select o.token_id from identity_mail_outbox o join password_reset_tokens t on t.id=o.token_id where t.expires_at<=$1 or t.consumed_at is not null limit 500)",
      [this.now()],
    );
    await this.#pool.query(
      "delete from password_reset_tokens where id in(select t.id from password_reset_tokens t where t.expires_at<=$1 and not exists(select 1 from identity_mail_outbox o where o.token_id=t.id) limit 500)",
      [this.now()],
    );
    await this.#pool.query(
      "delete from auth_rate_limits where bucket in(select bucket from auth_rate_limits where window_started_at<$1 limit 500)",
      [new Date(this.now().getTime() - 86400000)],
    );
  }

  async authorityView(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "organization:read",
      { kind: "organization", id: org },
      async (_c, _p, a, member) => ({
        account_type: a.accountType,
        membership_version: member.auth_version,
        roles: a.roles,
        permissions: a.permissions.filter(
          (permission) =>
            a.accountType !== "child" || childPermissions.includes(permission),
        ),
        can_manage_members: canAccess(a, "membership:manage", {
          kind: "organization",
          id: org,
        }),
        can_manage_roles: canAccess(a, "role:manage", {
          kind: "organization",
          id: org,
        }),
        can_create_projects: canAccess(a, "project:create", {
          kind: "organization",
          id: org,
        }),
        can_manage_environments: canAccess(a, "environment:admin", {
          kind: "organization",
          id: org,
        }),
        can_invite: canAccess(a, "user:invite", {
          kind: "organization",
          id: org,
        }),
        can_read_audit: canAccess(a, "audit:read", {
          kind: "organization",
          id: org,
        }),
      }),
    );
  }
  async listAudit(token: string, org: string) {
    return this.orgAction(
      token,
      org,
      "audit:read",
      { kind: "organization", id: org },
      async (client) =>
        (
          await client.query(
            "select id,actor_id,action,target_id,outcome,created_at,details from audit_events where organization_id=$1 order by id desc limit 100",
            [org],
          )
        ).rows,
    );
  }
  async recordDenied(token: string, source: string) {
    this.ensureReady();
    await this.rate("denial-audit", source, 100);
    const principal = await this.authenticate(token).catch(() => null);
    await this.transaction((client) =>
      this.audit(
        client,
        principal?.user.id ?? null,
        "http.access_denied",
        null,
        false,
      ),
    );
  }

  // CHAPTER_METHODS
}

export const executionGrantSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  userId: z.uuid(),
  organizationId: z.uuid(),
  membershipId: z.uuid(),
  sessionId: z.uuid(),
  userVersion: z.number().int().positive(),
  membershipVersion: z.number().int().positive(),
  permission: z.enum(organizationPermissions),
  resource: z.strictObject({
    kind: z.enum(["organization", "project", "environment"]),
    id: z.uuid(),
  }),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  signature: z.string().max(43),
});
export type ExecutionGrant = z.infer<typeof executionGrantSchema>;

export type IdentityService = Pick<AuthService, keyof AuthService>;

export { createResetDelivery } from "./mail.js";
