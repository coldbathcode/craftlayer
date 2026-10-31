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
COPY packages/core/package.json packages/core/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/sdk/package.json packages/sdk/package.json
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
 && pnpm --filter @craftlayer/db deploy --prod /prod/db

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
