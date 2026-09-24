# syntax=docker/dockerfile:1.7
# Siparişin Önünde — API + worker imajı (14 §1, §11 dilim 6). Aynı imaj iki süreci çalıştırır:
#   api     : node --import tsx src/server.ts   (varsayılan komut)
#   worker  : node --import tsx src/worker.ts
#   migrate : node --import tsx /app/packages/db/src/migrate.ts
#   admin   : node --import tsx /app/scripts/create-admin.ts --email ...
# TypeScript derlenmez; tsx (kök devDependency) ile çalışır. Derleme bağlamı depo köküdür:
#   docker build -f docker/api.Dockerfile -t siparisinonunde-api .
# Bağlam dışı tutulanlar: docker/api.Dockerfile.dockerignore

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# --- Bağımlılıklar: yalnız manifestler (katman önbelleği) ------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# "@siparis/api..." = API + iş bağımlılıkları (core, db) + kök (tsx). Web bağımlılıkları kurulmaz.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@siparis/api..."

# --- Çalışma imajı -------------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    API_PORT=4000 \
    API_HOST=0.0.0.0 \
    UPLOAD_DIR=/data/uploads
# pg_dump/psql yedekleme betikleri ayrı (postgres) konteynerde çalışır; burada gerekmez.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/db ./packages/db
COPY apps/api ./apps/api
COPY scripts ./scripts
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/api/v1/health" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "src/server.ts"]
