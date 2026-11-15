import type { AiPlayers } from "@craftlayer/ai-players";
import { AuthError } from "@craftlayer/auth";
import {
  aiPlayerAssignments,
  aiPlayerHostCreated,
  aiPlayerHostList,
  aiPlayerInput,
  aiPlayerInstruction,
  aiPlayerList,
  aiPlayerMemory,
  aiPlayerMemoryInput,
  aiPlayerMemoryList,
  aiPlayerPending,
  aiPlayerReport,
  aiPlayerTaskInput,
  aiPlayerThink,
  aiPlayerThought,
  aiPlayerTranscript,
  aiPlayerUpdate,
  aiPlayerView,
  aiPlayerWorkerMessages,
  errorSchema,
} from "@craftlayer/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requestToken } from "./auth-routes.js";

export type AiPlayerApi = Pick<
  AiPlayers,
  | "list"
  | "get"
  | "create"
  | "update"
  | "remove"
  | "setTasks"
  | "start"
  | "stop"
  | "clearStop"
  | "instruct"
  | "transcript"
  | "memories"
  | "addMemory"
  | "forgetMemory"
  | "createHost"
  | "listHosts"
  | "revokeHost"
  | "host"
  | "assignments"
  | "report"
  | "pending"
  | "post"
  | "ownerChat"
  | "memoriesFor"
  | "remember"
  | "think"
>;

/** Master plan G3: owner routes for AI players, and the worker host routes. */
export async function registerAiPlayers(
  app: FastifyInstance,
  players: AiPlayerApi,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const token = requestToken;
  const org = (r: FastifyRequest) => {
    const v = z.uuid().safeParse(r.headers["x-craftlayer-organization"]);
    if (!v.success)
      throw new AuthError(
        400,
        "ORGANIZATION_REQUIRED",
        "Select an organization.",
      );
    return v.data;
  };
  const errors = {
    400: errorSchema,
    401: errorSchema,
    403: errorSchema,
    404: errorSchema,
    409: errorSchema,
    429: errorSchema,
    500: errorSchema,
    502: errorSchema,
    503: errorSchema,
  };
  const id = z.strictObject({ id: z.uuid() });
  const ok = <T extends z.ZodType>(schema: T) => ({ 200: schema, ...errors });

  api.get(
    "/api/v1/ai-players",
    { schema: { response: ok(aiPlayerList) } },
    (r) => players.list(token(r), org(r)),
  );
  api.post(
    "/api/v1/ai-players",
    {
      schema: {
        body: aiPlayerInput,
        response: { 201: aiPlayerView, ...errors },
      },
    },
    async (r, reply) =>
      reply.code(201).send(await players.create(token(r), org(r), r.body)),
  );
  api.get(
    "/api/v1/ai-players/:id",
    { schema: { params: id, response: ok(aiPlayerView) } },
    (r) => players.get(token(r), org(r), r.params.id),
  );
  api.patch(
    "/api/v1/ai-players/:id",
    {
      schema: { params: id, body: aiPlayerUpdate, response: ok(aiPlayerView) },
    },
    (r) => players.update(token(r), org(r), r.params.id, r.body),
  );
  api.delete(
    "/api/v1/ai-players/:id",
    {
      schema: {
        params: id,
        response: ok(z.strictObject({ removed: z.literal(true) })),
      },
    },
    (r) => players.remove(token(r), org(r), r.params.id),
  );
  api.put(
    "/api/v1/ai-players/:id/tasks",
    {
      schema: {
        params: id,
        body: z.strictObject({ tasks: z.array(aiPlayerTaskInput).max(32) }),
        response: ok(aiPlayerView),
      },
    },
    (r) => players.setTasks(token(r), org(r), r.params.id, r.body.tasks),
  );
  for (const [path, action] of [
    ["start", "start"],
    ["stop", "stop"],
    ["clear-stop", "clearStop"],
  ] as const)
    api.post(
      `/api/v1/ai-players/:id/${path}`,
      { schema: { params: id, response: ok(aiPlayerView) } },
      (r) => players[action](token(r), org(r), r.params.id),
    );
  api.post(
    "/api/v1/ai-players/:id/instructions",
    {
      schema: {
        params: id,
        body: aiPlayerInstruction,
        response: { 202: z.strictObject({ id: z.uuid() }), ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(await players.instruct(token(r), org(r), r.params.id, r.body)),
  );
  api.get(
    "/api/v1/ai-players/:id/transcript",
    {
      schema: {
        params: id,
        querystring: z.strictObject({
          after: z.coerce.number().int().min(0).default(0),
        }),
        response: ok(aiPlayerTranscript),
      },
    },
    (r) => players.transcript(token(r), org(r), r.params.id, r.query.after),
  );
  api.get(
    "/api/v1/ai-players/:id/memories",
    { schema: { params: id, response: ok(aiPlayerMemoryList) } },
    (r) => players.memories(token(r), org(r), r.params.id),
  );
  api.post(
    "/api/v1/ai-players/:id/memories",
    {
      schema: {
        params: id,
        body: aiPlayerMemoryInput,
        response: { 201: aiPlayerMemory, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(201)
        .send(await players.addMemory(token(r), org(r), r.params.id, r.body)),
  );
  api.delete(
    "/api/v1/ai-players/:id/memories/:memory",
    {
      schema: {
        params: z.strictObject({ id: z.uuid(), memory: z.uuid() }),
        response: ok(z.strictObject({ forgotten: z.literal(true) })),
      },
    },
    (r) => players.forgetMemory(token(r), org(r), r.params.id, r.params.memory),
  );
  api.get(
    "/api/v1/ai-player-hosts",
    { schema: { response: ok(aiPlayerHostList) } },
    (r) => players.listHosts(token(r), org(r)),
  );
  api.post(
    "/api/v1/ai-player-hosts",
    {
      schema: {
        body: z.strictObject({ label: z.string().trim().min(1).max(80) }),
        response: { 201: aiPlayerHostCreated, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(201)
        .send(await players.createHost(token(r), org(r), r.body.label)),
  );
  api.post(
    "/api/v1/ai-player-hosts/:id/revoke",
    {
      schema: {
        params: id,
        response: ok(z.strictObject({ revoked: z.literal(true) })),
      },
    },
    (r) => players.revokeHost(token(r), org(r), r.params.id),
  );

  // Worker host routes: bearer host token, never a browser session.
  const host = (r: FastifyRequest) => {
    const header = r.headers.authorization;
    const match =
      typeof header === "string"
        ? /^Bearer (clah_\S{1,200})$/.exec(header)
        : null;
    if (!match?.[1])
      throw new AuthError(
        401,
        "UNAUTHENTICATED",
        "Worker host token is invalid or revoked.",
      );
    return players.host(match[1]);
  };
  const player = z.strictObject({ id: z.uuid() });
  api.get(
    "/api/v1/ai-player-host/assignments",
    { schema: { response: ok(aiPlayerAssignments) } },
    async (r) => players.assignments(await host(r)),
  );
  api.post(
    "/api/v1/ai-player-host/players/:id/status",
    {
      schema: {
        params: player,
        body: aiPlayerReport,
        response: ok(z.strictObject({ ok: z.literal(true) })),
      },
    },
    async (r) => players.report(await host(r), r.params.id, r.body),
  );
  api.post(
    "/api/v1/ai-player-host/players/:id/pending",
    { schema: { params: player, response: ok(aiPlayerPending) } },
    async (r) => players.pending(await host(r), r.params.id),
  );
  api.post(
    "/api/v1/ai-player-host/players/:id/messages",
    {
      bodyLimit: 65536,
      schema: {
        params: player,
        body: aiPlayerWorkerMessages,
        response: ok(z.strictObject({ ok: z.literal(true) })),
      },
    },
    async (r) => players.post(await host(r), r.params.id, r.body),
  );
  api.post(
    "/api/v1/ai-player-host/players/:id/owner-chat",
    {
      schema: {
        params: player,
        body: z.strictObject({
          author: z.string().trim().min(1).max(64),
          body: z.string().min(1).max(2000),
        }),
        response: { 202: z.strictObject({ id: z.uuid() }), ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(202)
        .send(
          await players.ownerChat(
            await host(r),
            r.params.id,
            r.body.author,
            r.body.body,
          ),
        ),
  );
  api.get(
    "/api/v1/ai-player-host/players/:id/memories",
    { schema: { params: player, response: ok(aiPlayerMemoryList) } },
    async (r) => players.memoriesFor(await host(r), r.params.id),
  );
  api.post(
    "/api/v1/ai-player-host/players/:id/memories",
    {
      schema: {
        params: player,
        body: aiPlayerMemoryInput,
        response: { 201: aiPlayerMemory, ...errors },
      },
    },
    async (r, reply) =>
      reply
        .code(201)
        .send(await players.remember(await host(r), r.params.id, r.body)),
  );
  api.post(
    "/api/v1/ai-player-host/players/:id/think",
    {
      bodyLimit: 262144,
      schema: {
        params: player,
        body: aiPlayerThink,
        response: ok(aiPlayerThought),
      },
    },
    async (r) => players.think(await host(r), r.params.id, r.body),
  );
}
