#!/usr/bin/env bash
# Siparişin Önünde — Cloudflare dev container'ı (15 §13): PostgreSQL + API + worker + web tek container'da.
#
# Container diski geçicidir: her başlangıçta boş bir veritabanı kurulur ve son yedek R2'den geri yüklenir.
# Yedek, Worker'daki "yedek.internal" çıkış işleyicisi üzerinden R2'ye yazılır/okunur (deploy/cloudflare/src/index.ts).
# Sıra: PostgreSQL → yedekten geri yükle → migrate → seed (idempotent) → api + worker + web → 10 dk'da bir yedek.
# SIGTERM (uyku, yeniden dağıtım): uygulamalar durur, son yedek alınır, PostgreSQL kapanır.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app}"
WEB_DIR="${WEB_DIR:-/app/web}"
PGDATA="${PGDATA:-/data/pg}"
PGPORT="${PGPORT:-5432}"
UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
BACKUP_URL="${BACKUP_URL:-http://yedek.internal}"
BACKUP_INTERVAL_SEC="${BACKUP_INTERVAL_SEC:-600}"
DB_NAME=siparis
export PGHOST=127.0.0.1 PGPORT PGUSER=siparis PGPASSWORD=siparis
export DATABASE_URL="postgres://siparis:siparis@127.0.0.1:${PGPORT}/${DB_NAME}"
export UPLOAD_DIR

log() { echo "[baslat] $(date -u +%H:%M:%S) $*"; }

APP_PIDS=()
BACKUP_LOOP_PID=""
DB_READY=0
SHUTTING_DOWN=0

# --- Yedek (R2) -------------------------------------------------------------------------------------

# GET <yol> → dosya. 0 = bulundu, 2 = yedek yok (404), 1 = hata (ağ/sunucu).
fetch_backup() {
  local path="$1" out="$2" code
  code=$(curl -sS --max-time 120 -o "$out" -w '%{http_code}' "$BACKUP_URL/$path" 2>/dev/null) || code=000
  case "$code" in
    200) return 0 ;;
    404) rm -f "$out"; return 2 ;;
    *) log "yedek okunamadı ($path, HTTP $code)"; rm -f "$out"; return 1 ;;
  esac
}

# Geçici hata ile boş veritabanını yedeğin üzerine yazmamak için: "yok" (404) kesinleşene kadar yeniden dene.
fetch_backup_retry() {
  local path="$1" out="$2" i rc
  for i in 1 2 3 4 5 6; do
    rc=0; fetch_backup "$path" "$out" || rc=$?
    [ "$rc" -ne 1 ] && return "$rc"
    sleep $((i * 5))
  done
  return 1
}

upload_backup() {
  local path="$1" file="$2"
  [ -s "$file" ] || { log "boş yedek gönderilmedi ($path)"; return 1; }
  curl -fsS --max-time 300 -X PUT --data-binary @"$file" -H 'content-type: application/octet-stream' "$BACKUP_URL/$path" >/dev/null
}

backup_now() {
  [ "$DB_READY" = 1 ] || return 0
  local dump=/tmp/yedek.dump tarball=/tmp/yukleme.tar.gz
  if pg_dump -Fc -d "$DB_NAME" -f "$dump"; then
    upload_backup db "$dump" && log "veritabanı yedeği R2'ye yazıldı ($(du -h "$dump" | cut -f1))" || log "veritabanı yedeği yazılamadı"
  else
    log "pg_dump başarısız"
  fi
  if [ -d "$UPLOAD_DIR" ] && [ -n "$(ls -A "$UPLOAD_DIR" 2>/dev/null)" ]; then
    tar -czf "$tarball" -C "$UPLOAD_DIR" . && upload_backup uploads "$tarball" || log "görsel yedeği yazılamadı"
  fi
  rm -f "$dump" "$tarball"
}

backup_loop() {
  while true; do
    sleep "$BACKUP_INTERVAL_SEC"
    backup_now || true
  done
}

# --- Kapanış ----------------------------------------------------------------------------------------

shutdown() {
  local code="${1:-0}"
  [ "$SHUTTING_DOWN" = 1 ] && return
  SHUTTING_DOWN=1
  log "kapanıyor"
  [ -n "$BACKUP_LOOP_PID" ] && kill "$BACKUP_LOOP_PID" 2>/dev/null || true
  local pid
  for pid in "${APP_PIDS[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${APP_PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  backup_now || true
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  log "kapandı"
  exit "$code"
}
trap 'shutdown 0' TERM INT

# --- PostgreSQL -------------------------------------------------------------------------------------

mkdir -p "$PGDATA" "$UPLOAD_DIR"
chmod 700 "$PGDATA"
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "PostgreSQL ilk kurulum"
  pwfile=$(mktemp)
  echo siparis >"$pwfile"
  initdb -D "$PGDATA" -U siparis --pwfile="$pwfile" -A scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
  rm -f "$pwfile"
fi
# 1 GiB'lık "basic" örnek için ölçülü ayarlar; yalnız 127.0.0.1 dinlenir
pg_ctl -D "$PGDATA" -w -l /tmp/postgres.log \
  -o "-c listen_addresses=127.0.0.1 -c port=$PGPORT -c unix_socket_directories='' -c shared_buffers=48MB -c max_connections=40 -c work_mem=2MB -c maintenance_work_mem=32MB -c timezone=UTC" \
  start >/dev/null
log "PostgreSQL çalışıyor"

fresh=0
if ! psql -d postgres -Atc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
  createdb "$DB_NAME"
  rc=0; fetch_backup_retry db /tmp/geri.dump || rc=$?
  case "$rc" in
    0)
      log "son yedek geri yükleniyor"
      pg_restore --no-owner --no-privileges -d "$DB_NAME" /tmp/geri.dump
      rm -f /tmp/geri.dump
      ;;
    2) log "yedek yok: yeni veritabanı"; fresh=1 ;;
    *)
      # Yedek sunucusuna ulaşılamıyorsa boş veritabanıyla açılıp iyi yedeğin üzerine yazmayız
      log "HATA: yedek okunamadı; container yeniden denenecek"
      pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
      exit 1
      ;;
  esac
  rc=0; fetch_backup_retry uploads /tmp/geri.tar.gz || rc=$?
  if [ "$rc" = 0 ]; then
    tar -xzf /tmp/geri.tar.gz -C "$UPLOAD_DIR" && log "görseller geri yüklendi"
    rm -f /tmp/geri.tar.gz
  fi
fi
DB_READY=1

cd "$APP_DIR/apps/api"
log "migration"
node --import tsx "$APP_DIR/packages/db/src/migrate.ts"
# Seed her açılışta çalışır: işletme başına idempotenttir (var olan demo işletme atlanır), yedekten dönen ortama
# sonradan eklenen demo işletmeler (ör. ortak numaranın ikinci dükkanı Çamlık Döner) de böylece gelir. Yedekten dönen
# ortamda seed hatası (ör. elle açılmış kayıtla çakışma) açılışı durdurmaz: demo eksik kalır ama site açılır.
log "demo verisi (seed; var olanlar atlanır)"
if [ "$fresh" = 1 ]; then
  node --import tsx "$APP_DIR/packages/db/src/seed.ts"
else
  node --import tsx "$APP_DIR/packages/db/src/seed.ts" || log "UYARI: seed başarısız; var olan veriyle devam ediliyor"
fi
if [ "$fresh" = 1 ]; then
  backup_now || true
fi

# --- Uygulamalar ------------------------------------------------------------------------------------

log "api, worker ve web başlatılıyor"
API_PORT=4000 API_HOST=0.0.0.0 NODE_OPTIONS="--max-old-space-size=256" node --import tsx src/server.ts &
APP_PIDS+=($!)
NODE_OPTIONS="--max-old-space-size=192" node --import tsx src/worker.ts &
APP_PIDS+=($!)
(cd "$WEB_DIR" && PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS="--max-old-space-size=256" exec node apps/web/server.js) &
APP_PIDS+=($!)

backup_loop &
BACKUP_LOOP_PID=$!

# Uygulamalardan biri düşerse son yedeği alıp çık; platform container'ı yeniden başlatır
set +e
wait -n "${APP_PIDS[@]}"
status=$?
set -e
[ "$SHUTTING_DOWN" = 1 ] && exit 0
log "bir süreç durdu (çıkış kodu $status)"
shutdown 1
