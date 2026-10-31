import { AuthError, type IdentityService } from "@craftlayer/auth";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

const password = z.string().min(1).max(128),
  login = z.string().min(3).max(64),
  id = z.uuid();
export const sessionCookie = "craftlayer_session";
export async function registerAuth(
  app: FastifyInstance,
  auth: IdentityService,
  publicUrl: string,
) {
  const origin = new URL(publicUrl).origin,
    secure = origin.startsWith("https:");
  await app.register(cookie);
  const api = app.withTypeProvider<ZodTypeProvider>();
  const token = (request: FastifyRequest) =>
    request.cookies[sessionCookie] ?? "";
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
    return { user: result.user, csrf_token: result.csrf_token };
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
  // CHAPTER_ROUTES
}
