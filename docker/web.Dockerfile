# syntax=docker/dockerfile:1.7
# Yemek Gelsin — web imajı (Next.js 16: pazarlama + storefront + panel + admin + kurye).
# next build + "standalone" çıktı; yalnız izlenen dosyalar çalışma imajına kopyalanır.
#   docker build -f docker/web.Dockerfile -t siparisinonunde-web \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://yemekgelsin.net \
#     --build-arg NEXT_PUBLIC_ROOT_DOMAIN=yemekgelsin.net .
# ÖNEMLİ: NEXT_PUBLIC_* değişkenleri, API_INTERNAL_URL (next.config.ts /api rewrite'ı) ve KÜNYE (LEGAL_*)
# DERLEME anında gömülür; değiştirmek yeniden derleme ister. Bağlam dışı: docker/web.Dockerfile.dockerignore
#
# Künye neden derleme argümanı (karar; 15 §4): /kunye ve /yasal/* sunucu bileşenleridir ve hiçbiri dinamik API
# kullanmadığı için `next build` sırasında STATİK HTML'e çevrilir. Çalışma zamanında verilen bir ortam değişkeni
# bu HTML'i değiştiremez — yani yalnız `environment:` ile verilmiş künye sayfalarda GÖRÜNMEZ ("Eksik
# yapılandırma: LEGAL_ENTITY_*" yazar). Bu yüzden değerler --build-arg ile gelir ve aynı argümanlar çalışma
# imajında da ENV olarak yazılır: statik sayfa ile çalışma ortamı tek kaynaktan beslenir, ayrışamaz.

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
ARG NEXT_PUBLIC_SITE_URL=https://yemekgelsin.net
ARG NEXT_PUBLIC_ROOT_DOMAIN=yemekgelsin.net
ARG NEXT_PUBLIC_DEV_TOOLS=0
# Canlı ortamda demo işletme yok (00 §12a madde 10): boş → pazarlama sitesinde "Demo menüyü aç" kartı gösterilmez
ARG NEXT_PUBLIC_DEMO_STORE_SLUG=
# "Demo ortamı" uyarısı yalnız demo verili ortamlarda (1); varsayılan kapalı
ARG NEXT_PUBLIC_DEMO_BANNER=0
# Platform destek hattı (WhatsApp, E.164 rakamları); giriş ekranı "Parolamı unuttum" bunu gösterir
ARG NEXT_PUBLIC_SUPPORT_WHATSAPP=
# Web sunucusunun API'ye iç ağdan eriştiği adres (compose servis adı)
ARG API_INTERNAL_URL=http://api:4000
# Künye (6563 m.3; apps/web/lib/site.ts LEGAL_ENTITY_FIELDS). Gizli DEĞİL, kanunen kamuya açık — imaj
# katmanında görünmesi sorun değildir. Varsayılan BOŞ: eksik alan uydurulmaz, sayfada "Eksik yapılandırma:
# <değişken>" yazar ve `node --import tsx scripts/check-legal.ts` çıkış kodu 1 verir (15 §4, §12). ⚠️ CI'daki
# yasal denetim adımı künye girilene kadar `continue-on-error: true`, yani bulgu şimdilik dağıtımı DURDURMAZ.
# NEXT_PUBLIC_ öneki KULLANILMAZ: bu sayfalar sunucu bileşenidir, değerlerin tarayıcı paketine gömülmesi gerekmez.
ARG LEGAL_ENTITY_NAME=
ARG LEGAL_ENTITY_TYPE=
ARG LEGAL_ENTITY_ADDRESS=
ARG LEGAL_ENTITY_PHONE=
ARG LEGAL_ENTITY_TAX_OFFICE=
ARG LEGAL_ENTITY_TAX_NO=
ARG LEGAL_ENTITY_MERSIS=
ARG LEGAL_ENTITY_CHAMBER=
ARG LEGAL_ENTITY_KEP=
ARG LEGAL_SUPPORT_EMAIL=
ENV LEGAL_ENTITY_NAME="$LEGAL_ENTITY_NAME" \
    LEGAL_ENTITY_TYPE="$LEGAL_ENTITY_TYPE" \
    LEGAL_ENTITY_ADDRESS="$LEGAL_ENTITY_ADDRESS" \
    LEGAL_ENTITY_PHONE="$LEGAL_ENTITY_PHONE" \
    LEGAL_ENTITY_TAX_OFFICE="$LEGAL_ENTITY_TAX_OFFICE" \
    LEGAL_ENTITY_TAX_NO="$LEGAL_ENTITY_TAX_NO" \
    LEGAL_ENTITY_MERSIS="$LEGAL_ENTITY_MERSIS" \
    LEGAL_ENTITY_CHAMBER="$LEGAL_ENTITY_CHAMBER" \
    LEGAL_ENTITY_KEP="$LEGAL_ENTITY_KEP" \
    LEGAL_SUPPORT_EMAIL="$LEGAL_SUPPORT_EMAIL"
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ROOT_DOMAIN=$NEXT_PUBLIC_ROOT_DOMAIN \
    NEXT_PUBLIC_DEV_TOOLS=$NEXT_PUBLIC_DEV_TOOLS \
    NEXT_PUBLIC_DEMO_STORE_SLUG=$NEXT_PUBLIC_DEMO_STORE_SLUG \
    NEXT_PUBLIC_DEMO_BANNER=$NEXT_PUBLIC_DEMO_BANNER \
    NEXT_PUBLIC_SUPPORT_WHATSAPP=$NEXT_PUBLIC_SUPPORT_WHATSAPP \
    API_INTERNAL_URL=$API_INTERNAL_URL \
    APP_BASE_URL=$NEXT_PUBLIC_SITE_URL \
    DEV_TOOLS=$NEXT_PUBLIC_DEV_TOOLS \
    NODE_ENV=production
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/web ./apps/web
# Standalone çıktı NEXT_OUTPUT ile açılır (next.config.ts); takip kökü depo köküdür (monorepo).
RUN cd apps/web \
    && rm -rf .next .next-* \
    && NEXT_OUTPUT=standalone NEXT_DIST_DIR=.next pnpm exec next build \
    && test -f .next/standalone/apps/web/server.js

# --- Çalışma imajı ------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
# Künye derleme argümanları çalışma imajına da yazılır: statik HTML ile çalışan sürecin ortamı AYNI kaynaktan
# gelir (sayfalar ileride dinamikleşirse ya da bir API/metadata yolu künyeyi okursa değer ayrışmasın). Bu yüzden
# compose `web` servisine ayrıca `environment:` ile künye VERİLMEZ: çalışma zamanında verilen bir değer statik
# sayfayı değiştirmeyeceği için yalnız sessiz bir ayrışma üretirdi.
ARG LEGAL_ENTITY_NAME=
ARG LEGAL_ENTITY_TYPE=
ARG LEGAL_ENTITY_ADDRESS=
ARG LEGAL_ENTITY_PHONE=
ARG LEGAL_ENTITY_TAX_OFFICE=
ARG LEGAL_ENTITY_TAX_NO=
ARG LEGAL_ENTITY_MERSIS=
ARG LEGAL_ENTITY_CHAMBER=
ARG LEGAL_ENTITY_KEP=
ARG LEGAL_SUPPORT_EMAIL=
ENV LEGAL_ENTITY_NAME="$LEGAL_ENTITY_NAME" \
    LEGAL_ENTITY_TYPE="$LEGAL_ENTITY_TYPE" \
    LEGAL_ENTITY_ADDRESS="$LEGAL_ENTITY_ADDRESS" \
    LEGAL_ENTITY_PHONE="$LEGAL_ENTITY_PHONE" \
    LEGAL_ENTITY_TAX_OFFICE="$LEGAL_ENTITY_TAX_OFFICE" \
    LEGAL_ENTITY_TAX_NO="$LEGAL_ENTITY_TAX_NO" \
    LEGAL_ENTITY_MERSIS="$LEGAL_ENTITY_MERSIS" \
    LEGAL_ENTITY_CHAMBER="$LEGAL_ENTITY_CHAMBER" \
    LEGAL_ENTITY_KEP="$LEGAL_ENTITY_KEP" \
    LEGAL_SUPPORT_EMAIL="$LEGAL_SUPPORT_EMAIL"
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
