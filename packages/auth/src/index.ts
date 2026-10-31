import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
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
  ) {
    if (org)
      await client.query(
        "insert into audit_events(organization_id,actor_id,action,target_id,outcome) values($1,$2,$3,$4,$5)",
        [org, actor, action, target, allowed ? "allowed" : "denied"],
      );
    else
      await client.query(
        "insert into instance_audit_events(actor_id,action,target_id,outcome) values($1,$2,$3,$4)",
        [actor, action, target, allowed ? "allowed" : "denied"],
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
        csrf_token: this.csrfToken(token),
      };
    });
  }
  // CHAPTER_METHODS
}

export type IdentityService = Pick<AuthService, keyof AuthService>;
