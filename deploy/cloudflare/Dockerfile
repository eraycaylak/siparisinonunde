# syntax=docker/dockerfile:1.7
# Siparişin Önünde — Cloudflare dev container'ı (15 §13): PostgreSQL 16 + API + worker + web tek imajda.
# Derleme bağlamı depo köküdür (wrangler.jsonc image_build_context). Wrangler, image_vars'ı --build-arg olarak geçirir.
# Üretim dağıtımı bu imajı KULLANMAZ (docker/*.Dockerfile + docker-compose.yml, Türkiye'de VPS).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# --- API + worker bağımlılıkları (docker/api.Dockerfile ile aynı) ----------------------------------------
FROM base AS api-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@siparis/api..."

# --- Web derlemesi (docker/web.Dockerfile ile aynı; standalone çıktı) ------------------------------------
FROM base AS web-build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@siparis/web..."
ARG NEXT_PUBLIC_SITE_URL=https://siparisinonunde-dev.example.workers.dev
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    APP_BASE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ROOT_DOMAIN= \
    NEXT_PUBLIC_DEV_TOOLS=1 \
    DEV_TOOLS=1 \
    NEXT_PUBLIC_DEMO_STORE_SLUG=bozok-pide \
    NEXT_PUBLIC_SUPPORT_WHATSAPP= \
    API_INTERNAL_URL=http://127.0.0.1:4000 \
    NODE_ENV=production
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/web ./apps/web
RUN cd apps/web \
    && rm -rf .next .next-* \
    && NEXT_OUTPUT=standalone NEXT_DIST_DIR=.next pnpm exec next build \
    && test -f .next/standalone/apps/web/server.js

# --- Çalışma imajı: resmi PostgreSQL 16 (bookworm) + Node 22 ikilisi ---------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS node-bin

FROM postgres:16-bookworm AS runner
COPY --from=node-bin /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PGDATA=/data/pg \
    UPLOAD_DIR=/data/uploads \
    APP_DIR=/app \
    WEB_DIR=/app/web \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=api-deps --chown=postgres:postgres /app/node_modules ./node_modules
COPY --from=api-deps --chown=postgres:postgres /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=api-deps --chown=postgres:postgres /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=api-deps --chown=postgres:postgres /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=postgres:postgres package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=postgres:postgres packages/core ./packages/core
COPY --chown=postgres:postgres packages/db ./packages/db
COPY --chown=postgres:postgres apps/api ./apps/api
COPY --chown=postgres:postgres scripts ./scripts
COPY --from=web-build --chown=postgres:postgres /app/apps/web/.next/standalone ./web
COPY --from=web-build --chown=postgres:postgres /app/apps/web/.next/static ./web/apps/web/.next/static
COPY --chown=postgres:postgres apps/web/public ./web/apps/web/public
COPY --chown=postgres:postgres --chmod=755 deploy/cloudflare/entrypoint.sh /app/entrypoint.sh
RUN mkdir -p /data && chown postgres:postgres /data
USER postgres
EXPOSE 3000 4000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
