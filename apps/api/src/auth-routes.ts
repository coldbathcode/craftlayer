import { AuthError, type IdentityService, loginName } from "@craftlayer/auth";
import {
  agentTokenRequestSchema,
  errorSchema,
  identityResponseContracts,
  mfaCodeSchema,
} from "@craftlayer/contracts";
import { organizationPermissions } from "@craftlayer/core";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

const password = z.string().min(1).max(128),
  login = loginName,
  id = z.uuid();
export const sessionCookie = "craftlayer_session";
/** Browser sessions arrive as a cookie. External AI agents present a scoped
 * `cla_` token as a bearer header; it is explicit, so CSRF/Origin checks that
 * protect ambient cookies do not apply to it. Any other bearer is ignored. */
export const agentBearer = (request: FastifyRequest) => {
  const header = request.headers.authorization;
  return typeof header === "string" &&
    /^Bearer cla_[A-Za-z0-9_-]{43}$/.test(header)
    ? header.slice(7)
    : "";
};
export const requestToken = (request: FastifyRequest) =>
  agentBearer(request) || (request.cookies?.[sessionCookie] ?? "");
export async function registerAuth(
  app: FastifyInstance,
  auth: IdentityService,
  publicUrl: string,
) {
  const origin = new URL(publicUrl).origin,
    secure = origin.startsWith("https:");
  await app.register(cookie);
  app.addHook("preSerialization", async (_request, _reply, payload) =>
    JSON.parse(JSON.stringify(payload)),
  );
  app.addHook("onRoute", (route) => {
    const method = Array.isArray(route.method) ? route.method[0] : route.method;
    const key =
      `${method} ${route.url}` as keyof typeof identityResponseContracts;
    const response = identityResponseContracts[key];
    if (response)
      route.schema = {
        ...route.schema,
        response: {
          200: response,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          429: errorSchema,
          500: errorSchema,
          503: errorSchema,
        },
      };
  });
  const api = app.withTypeProvider<ZodTypeProvider>();
  const token = requestToken;
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    maxAge: 43200,
  };
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/")) return;
    reply.header("Cache-Control", "no-store");
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    // Worker RPC accepts only registered bearer identity; cookie sessions never authorize it.
    if (request.routeOptions.url?.startsWith("/api/v1/worker/")) return;
    // An explicit agent bearer is not ambient browser authority.
    if (agentBearer(request)) return;
    if (request.headers.origin !== origin)
      throw new AuthError(
        403,
        "ORIGIN_DENIED",
        "Request origin is not allowed.",
      );
    const publicMutation = [
      "/api/v1/auth/login",
      "/api/v1/auth/bootstrap",
      "/api/v1/invitations/consume",
      "/api/v1/auth/password-reset/request",
      "/api/v1/auth/password-reset/consume",
    ].includes(request.url.split("?")[0] ?? "");
    if (
      !publicMutation &&
      token(request) &&
      !auth.verifyCsrf(
        token(request),
        String(request.headers["x-csrf-token"] ?? ""),
      )
    )
      throw new AuthError(
        403,
        "CSRF_DENIED",
        "Refresh your session and try again.",
      );
  });
  const sendSession = (
    reply: FastifyReply,
    result: Awaited<ReturnType<IdentityService["login"]>>,
  ) => {
    reply.setCookie(sessionCookie, result.cookieToken, cookieOptions);
    return {
      user: result.user,
      csrf_token: result.csrf_token,
      mfa: result.mfa,
    };
  };
  api.get("/api/v1/auth/setup", async () => auth.setupStatus());
  api.post(
    "/api/v1/auth/bootstrap",
    {
      schema: {
        body: z.strictObject({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          login,
          password: z.string().min(12).max(128),
          email: z.email().max(254).optional(),
        }),
      },
    },
    async (request, reply) =>
      sendSession(reply, await auth.bootstrap(request.body, request.ip)),
  );
  api.post(
    "/api/v1/auth/login",
    { schema: { body: z.strictObject({ login, password }) } },
    async (request, reply) =>
      sendSession(
        reply,
        await auth.login(request.body, request.ip, token(request) || undefined),
      ),
  );
  api.get("/api/v1/auth/me", async (request) => auth.me(token(request)));
  // Two-factor sign-in. Setup/confirm/verify work on a pending session; disable needs a full one.
  api.post("/api/v1/auth/mfa/setup", async (request) =>
    auth.totpSetup(token(request)),
  );
  api.post(
    "/api/v1/auth/mfa/confirm",
    { schema: { body: mfaCodeSchema } },
    async (request) =>
      auth.totpConfirm(token(request), request.body.code, request.ip),
  );
  api.post(
    "/api/v1/auth/mfa/verify",
    { schema: { body: mfaCodeSchema } },
    async (request) =>
      auth.mfaVerify(token(request), request.body.code, request.ip),
  );
  api.post(
    "/api/v1/auth/mfa/disable",
    { schema: { body: mfaCodeSchema } },
    async (request) => {
      await auth.totpDisable(token(request), request.body.code, request.ip);
      return { ok: true };
    },
  );
  api.post("/api/v1/auth/logout", async (request, reply) => {
    await auth.logout(token(request));
    reply.clearCookie(sessionCookie, cookieOptions);
    return { ok: true };
  });
  api.get("/api/v1/auth/sessions", async (request) => ({
    items: await auth.listSessions(token(request)),
  }));
  api.delete(
    "/api/v1/auth/sessions/:id",
    { schema: { params: z.strictObject({ id }) } },
    async (request) => {
      await auth.revokeSession(token(request), request.params.id);
      return { ok: true };
    },
  );
  const organization = (request: FastifyRequest) => {
    const value = request.headers["x-craftlayer-organization"];
    if (typeof value !== "string" || !z.uuid().safeParse(value).success)
      throw new AuthError(
        400,
        "ORGANIZATION_REQUIRED",
        "Select an organization.",
      );
    return value;
  };
  api.get("/api/v1/organizations", async (request) => ({
    items: (await auth.me(token(request))).organizations,
  }));
  api.post(
    "/api/v1/organizations",
    {
      schema: {
        body: z.strictObject({ name: z.string().trim().min(1).max(120) }),
      },
    },
    async (request) =>
      auth.createOrganization(token(request), request.body.name),
  );
  api.get("/api/v1/projects", async (request) => ({
    items: await auth.listProjects(token(request), organization(request)),
  }));
  api.post(
    "/api/v1/projects",
    {
      schema: {
        body: z.strictObject({ name: z.string().trim().min(1).max(120) }),
      },
    },
    async (request) =>
      auth.createProject(
        token(request),
        organization(request),
        request.body.name,
      ),
  );
  api.get(
    "/api/v1/projects/:id",
    { schema: { params: z.strictObject({ id }) } },
    async (request) =>
      auth.getProject(token(request), organization(request), request.params.id),
  );
  api.get("/api/v1/environments", async (request) => ({
    items: await auth.listEnvironments(token(request), organization(request)),
  }));
  api.get(
    "/api/v1/environments/:id",
    { schema: { params: z.strictObject({ id }) } },
    async (request) =>
      auth.getEnvironment(
        token(request),
        organization(request),
        request.params.id,
      ),
  );
  api.post(
    "/api/v1/environments",
    {
      schema: {
        body: z.strictObject({
          projectId: id,
          name: z.string().trim().min(1).max(120),
          type: z.enum(["minecraft", "coding", "research", "simulation"]),
        }),
      },
    },
    async (request) =>
      auth.createEnvironment(
        token(request),
        organization(request),
        request.body,
      ),
  );

  api.get("/api/v1/memberships", async (request) => ({
    items: await auth.listMembers(token(request), organization(request)),
  }));
  api.get("/api/v1/users", async (request) => ({
    items: await auth.listMembers(token(request), organization(request)),
  }));
  api.get("/api/v1/roles", async (request) => ({
    items: await auth.listRoles(token(request), organization(request)),
  }));
  api.post(
    "/api/v1/roles",
    {
      schema: {
        body: z.strictObject({
          name: z.string().trim().min(1).max(80),
          permissions: z
            .array(z.enum(organizationPermissions))
            .min(1)
            .max(organizationPermissions.length),
        }),
      },
    },
    async (request) =>
      auth.createRole(token(request), organization(request), request.body),
  );
  api.put(
    "/api/v1/memberships/:id/roles",
    {
      schema: {
        params: z.strictObject({ id }),
        body: z.strictObject({ roleIds: z.array(id).min(1).max(5) }),
      },
    },
    async (request) =>
      auth.setMemberRoles(
        token(request),
        organization(request),
        request.params.id,
        request.body.roleIds,
      ),
  );
  api.post(
    "/api/v1/memberships/:id/status",
    {
      schema: {
        params: z.strictObject({ id }),
        body: z.strictObject({ disabled: z.boolean() }),
      },
    },
    async (request) =>
      auth.setMembershipDisabled(
        token(request),
        organization(request),
        request.params.id,
        request.body.disabled,
      ),
  );
  api.post(
    "/api/v1/users/:id/status",
    {
      schema: {
        params: z.strictObject({ id }),
        body: z.strictObject({ disabled: z.boolean() }),
      },
    },
    async (request) =>
      auth.setUserDisabled(
        token(request),
        request.params.id,
        request.body.disabled,
      ),
  );
  api.get("/api/v1/resource-grants", async (request) => ({
    items: await auth.listResourceGrants(token(request), organization(request)),
  }));
  api.post(
    "/api/v1/resource-grants",
    {
      schema: {
        body: z.strictObject({
          membershipId: id,
          permission: z.enum(organizationPermissions),
          projectId: id,
          environmentId: id.optional(),
        }),
      },
    },
    async (request) =>
      auth.addResourceGrant(
        token(request),
        organization(request),
        request.body,
      ),
  );
  api.delete(
    "/api/v1/resource-grants/:id",
    { schema: { params: z.strictObject({ id }) } },
    async (request) =>
      auth.removeResourceGrant(
        token(request),
        organization(request),
        request.params.id,
      ),
  );
  api.get("/api/v1/invitations", async (request) => ({
    items: await auth.listInvitations(token(request), organization(request)),
  }));
  api.post(
    "/api/v1/invitations",
    { schema: { body: z.strictObject({ roleId: id }) } },
    async (request) =>
      auth.createInvitation(
        token(request),
        organization(request),
        request.body.roleId,
      ),
  );
  api.delete(
    "/api/v1/invitations/:id",
    { schema: { params: z.strictObject({ id }) } },
    async (request) =>
      auth.revokeInvitation(
        token(request),
        organization(request),
        request.params.id,
      ),
  );
  api.post(
    "/api/v1/invitations/consume",
    {
      schema: {
        body: z.discriminatedUnion("mode", [
          z.strictObject({
            mode: z.literal("new"),
            token: z.string().max(110),
            login,
            password: z.string().min(12).max(128),
            email: z.email().max(254).optional(),
          }),
          z.strictObject({
            mode: z.literal("existing"),
            token: z.string().max(110),
          }),
        ]),
      },
    },
    async (request, reply) => {
      if (
        request.body.mode === "existing" &&
        !auth.verifyCsrf(
          token(request),
          String(request.headers["x-csrf-token"] ?? ""),
        )
      )
        throw new AuthError(
          403,
          "CSRF_DENIED",
          "Refresh your session and try again.",
        );
      return sendSession(
        reply,
        await auth.consumeInvitation(
          request.body,
          request.ip,
          request.body.mode === "existing" ? token(request) : undefined,
        ),
      );
    },
  );

  api.post(
    "/api/v1/auth/password-reset/request",
    {
      schema: {
        body: z.strictObject({ login: z.string().trim().min(1).max(254) }),
      },
    },
    async (request) =>
      auth.requestPasswordReset(request.body.login, request.ip),
  );
  api.post(
    "/api/v1/auth/password-reset/consume",
    {
      schema: {
        body: z.strictObject({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          password: z.string().min(12).max(128),
        }),
      },
    },
    async (request) =>
      auth.consumePasswordReset(
        request.body.token,
        request.body.password,
        request.ip,
      ),
  );
  api.post(
    "/api/v1/children",
    {
      schema: {
        body: z.strictObject({
          login,
          password: z.string().min(12).max(128),
          environmentIds: z.array(id).min(1).max(10),
        }),
      },
    },
    async (request) =>
      auth.createChild(token(request), organization(request), request.body),
  );
  api.post(
    "/api/v1/children/:id/password",
    {
      schema: {
        params: z.strictObject({ id }),
        body: z.strictObject({ password: z.string().min(12).max(128) }),
      },
    },
    async (request) =>
      auth.resetChildPassword(
        token(request),
        organization(request),
        request.params.id,
        request.body.password,
      ),
  );
  api.get("/api/v1/agent-tokens", async (request) => ({
    items: await auth.listAgentTokens(token(request), organization(request)),
  }));
  api.post(
    "/api/v1/agent-tokens",
    { schema: { body: agentTokenRequestSchema } },
    async (request) =>
      auth.createAgentToken(
        token(request),
        organization(request),
        request.body,
      ),
  );
  api.delete(
    "/api/v1/agent-tokens/:id",
    { schema: { params: z.strictObject({ id }) } },
    async (request) => {
      await auth.revokeAgentToken(
        token(request),
        organization(request),
        request.params.id,
      );
      return { ok: true };
    },
  );
  api.get("/api/v1/auth/authority", async (request) =>
    auth.authorityView(token(request), organization(request)),
  );
  api.get("/api/v1/audit", async (request) => ({
    items: await auth.listAudit(token(request), organization(request)),
  }));
  // CHAPTER_ROUTES
}
