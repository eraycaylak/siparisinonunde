# syntax=docker/dockerfile:1.7
# Siparişin Önünde — web imajı (Next.js 16: pazarlama + storefront + panel + admin + kurye).
# next build + "standalone" çıktı; yalnız izlenen dosyalar çalışma imajına kopyalanır.
#   docker build -f docker/web.Dockerfile -t siparisinonunde-web \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://siparisinonunde.com \
#     --build-arg NEXT_PUBLIC_ROOT_DOMAIN=siparisinonunde.com .
# ÖNEMLİ: NEXT_PUBLIC_* değişkenleri ve API_INTERNAL_URL (next.config.ts /api rewrite'ı) DERLEME anında
# gömülür; değiştirmek yeniden derleme ister. Bağlam dışı tutulanlar: docker/web.Dockerfile.dockerignore

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# --- Bağımlılıklar ------------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@siparis/web..."

# --- Derleme ------------------------------------------------------------------------------------
FROM deps AS build
# Tarayıcıya gömülen genel ayarlar (14 §3; üretimde DEV_TOOLS=0)
ARG NEXT_PUBLIC_SITE_URL=https://siparisinonunde.com
ARG NEXT_PUBLIC_ROOT_DOMAIN=siparisinonunde.com
ARG NEXT_PUBLIC_DEV_TOOLS=0
ARG NEXT_PUBLIC_DEMO_STORE_SLUG=bozok-pide
# Web sunucusunun API'ye iç ağdan eriştiği adres (compose servis adı)
ARG API_INTERNAL_URL=http://api:4000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN \
    NEXT_PUBLIC_DEV_TOOLS=$NEXT_PUBLIC_DEV_TOOLS \
    NEXT_PUBLIC_DEMO_STORE_SLUG=$NEXT_PUBLIC_DEMO_STORE_SLUG \
    API_INTERNAL_URL=$API_INTERNAL_URL \
    APP_BASE_URL=$NEXT_PUBLIC_SITE_URL \
    DEV_TOOLS=$NEXT_PUBLIC_DEV_TOOLS \
    NODE_ENV=production
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/web ./apps/web
# next.config.ts "output: 'standalone'" içermiyorsa yalnız bu derleme kopyasına eklenir (depodaki dosya değişmez).
# Takip kökü depo köküdür (monorepo: @siparis/core ve kök node_modules izlenir).
RUN cd apps/web \
    && if ! grep -q "output:" next.config.ts; then \
         grep -q "const nextConfig: NextConfig = {" next.config.ts \
           || { echo "next.config.ts beklenen biçimde değil; output: 'standalone' eklenemedi" >&2; exit 1; }; \
         sed -i "s|const nextConfig: NextConfig = {|const nextConfig: NextConfig = {\n  output: 'standalone',\n  outputFileTracingRoot: '/app',|" next.config.ts; \
       fi \
    && rm -rf .next .next-* \
    && NEXT_DIST_DIR=.next pnpm exec next build \
    && test -f .next/standalone/apps/web/server.js

# --- Çalışma imajı ------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/panel/giris" || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
