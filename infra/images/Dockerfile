FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /workspace

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/minecraft-node/package.json apps/minecraft-node/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/minecraft-control/package.json packages/minecraft-control/package.json
COPY packages/node-protocol/package.json packages/node-protocol/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ARG CRAFTLAYER_API_ORIGIN=http://api:4000
ENV CRAFTLAYER_API_ORIGIN=$CRAFTLAYER_API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
RUN pnpm --filter @craftlayer/api deploy --prod /prod/api \
 && pnpm --filter @craftlayer/worker deploy --prod /prod/worker \
 && pnpm --filter @craftlayer/db deploy --prod /prod/db \
 && pnpm --filter @craftlayer/minecraft-node deploy --prod /prod/node \
 && pnpm --filter @craftlayer/mcp deploy --prod /prod/mcp

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/api .
USER node
CMD ["node", "dist/main.js"]

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker .
USER node
CMD ["node", "dist/main.js"]

# Node agent: the only privileged piece (Docker socket). Runs outbound-only against the gateway.
FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS node
ENV NODE_ENV=production
# age encrypts backups to the owner's public key for the off-server copy (ADR 0050).
RUN apt-get update && apt-get install -y --no-install-recommends age && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /prod/node .
USER node
CMD ["node", "dist/main.js", "run", "/run/craftlayer-node/config.json"]

# Remote MCP: holds no token, database or key; every caller sends their own agent token.
FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS mcp
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/mcp .
USER node
CMD ["node", "dist/remote-main.js"]

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/db .
USER node
CMD ["node", "dist/migrate.js"]

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone .
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
CMD ["node", "apps/web/server.js"]
