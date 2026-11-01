import { AuthError } from "@craftlayer/auth";
import {
  errorSchema,
  eventCursor,
  runtimeEventPage,
} from "@craftlayer/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { RuntimeApi } from "./runtime-routes.js";

export async function registerRuntimeStreams(
  app: FastifyInstance,
  runtime: RuntimeApi,
  publicUrl: string,
) {
  const api = app.withTypeProvider<ZodTypeProvider>(),
    origin = new URL(publicUrl).origin,
    active = new Map<string, number>(),
    organizations = new Map<string, number>(),
    closers = new Set<() => void>();
  const query = z.strictObject({
      environment_id: z.uuid(),
      mission_id: z.uuid().optional(),
      cursor: eventCursor.optional(),
    }),
    errors = {
      400: errorSchema,
      401: errorSchema,
      403: errorSchema,
      404: errorSchema,
      429: errorSchema,
      500: errorSchema,
    };
  const requestScope = (headers: Record<string, unknown>) => {
    if (
      (headers.origin && headers.origin !== origin) ||
      headers["sec-fetch-site"] === "cross-site"
    )
      throw new AuthError(403, "ORIGIN_DENIED", "Stream origin denied.");
    const org = z.uuid().safeParse(headers["x-craftlayer-organization"]);
    if (!org.success)
      throw new AuthError(
        400,
        "ORGANIZATION_REQUIRED",
        "Select an organization.",
      );
    return org.data;
  };
  api.get(
    "/api/v1/events",
    {
      schema: {
        querystring: query,
        response: { ...errors, 200: runtimeEventPage },
      },
    },
    (r) =>
      runtime.eventPage(
        r.cookies.craftlayer_session ?? "",
        requestScope(r.headers),
        r.query.environment_id,
        r.query.cursor,
        r.query.mission_id,
      ),
  );
  api.get(
    "/api/v1/events/stream",
    {
      schema: { querystring: query, response: { ...errors, 200: z.string() } },
    },
    async (r, reply) => {
      const org = requestScope(r.headers),
        last = r.headers["last-event-id"];
      if (last && r.query.cursor && last !== r.query.cursor)
        throw new AuthError(400, "CURSOR_CONFLICT", "Use one replay cursor.");
      const cursor =
          r.query.cursor ?? (last ? eventCursor.parse(last) : undefined),
        session = await runtime.openEvents(
          r.cookies.craftlayer_session ?? "",
          org,
          r.query.environment_id,
          cursor,
          r.query.mission_id,
        );
      if (
        closers.size >= 32 ||
        (active.get(session.key) ?? 0) >= 2 ||
        (organizations.get(org) ?? 0) >= 8
      )
        throw new AuthError(
          429,
          "STREAM_CAPACITY",
          "Stream connection limit reached.",
        );
      active.set(session.key, (active.get(session.key) ?? 0) + 1);
      organizations.set(org, (organizations.get(org) ?? 0) + 1);
      let timer: ReturnType<typeof setInterval> | undefined,
        busy = false,
        closed = false,
        started = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        closers.delete(close);
        const count = (active.get(session.key) ?? 1) - 1;
        if (count) active.set(session.key, count);
        else active.delete(session.key);
        const remaining = (organizations.get(org) ?? 1) - 1;
        if (remaining) organizations.set(org, remaining);
        else organizations.delete(org);
        if (started && !reply.raw.destroyed) reply.raw.end();
      };
      closers.add(close);
      reply.raw.once("close", close);
      const write = (frame: string) => {
        if (closed || reply.raw.destroyed) return false;
        if (reply.raw.writableLength + Buffer.byteLength(frame) > 65536) {
          close();
          return false;
        }
        if (!reply.raw.write(frame)) {
          close();
          return false;
        }
        return true;
      };
      const poll = async () => {
        if (busy || closed) return;
        busy = true;
        try {
          await session.poll((page) => {
            if (closed) return;
            if (!started) {
              reply.hijack();
              for (const [key, value] of Object.entries(reply.getHeaders()))
                if (value !== undefined)
                  reply.raw.setHeader(
                    key,
                    Array.isArray(value) ? value.map(String) : String(value),
                  );
              reply.raw.writeHead(200, {
                "content-type": "text/event-stream; charset=utf-8",
                "cache-control": "no-store",
                "x-accel-buffering": "no",
                "x-content-type-options": "nosniff",
              });
              started = true;
            }
            if (
              page.snapshot !== null &&
              !write(
                `event: snapshot\ndata: ${JSON.stringify({ snapshot: page.snapshot, truncated: page.snapshot_truncated, resync_required: page.resync_required, cursor: page.cursor })}\n\n`,
              )
            )
              return;
            for (const event of page.items)
              if (
                !write(
                  `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                )
              )
                return;
            write(
              `id: ${page.cursor}\nevent: cursor\ndata: ${JSON.stringify({ cursor: page.cursor, has_more: page.has_more })}\n\n`,
            );
          });
        } catch (error) {
          if (!started) {
            close();
            throw error;
          }
          // Never include exception details, resource IDs or a last payload after authority loss.
          close();
        } finally {
          busy = false;
        }
      };
      try {
        await poll();
        if (!closed) {
          timer = setInterval(() => {
            void poll().catch(close);
          }, 500);
          timer.unref();
        }
      } catch (error) {
        close();
        throw error;
      }
    },
  );
  app.addHook("preClose", async () => {
    for (const close of [...closers]) close();
  });
}
