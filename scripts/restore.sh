#!/usr/bin/env bash
# Siparişin Önünde — yedekten geri yükleme (docs/15-kurulum-ve-isletim.md §8).
#
#   ./scripts/restore.sh backups/db-siparis-20261001T031500Z.dump                 # canlı veritabanına (onay ister)
#   ./scripts/restore.sh --uploads backups/uploads-20261001T031500Z.tar.gz <dump>  # görsellerle birlikte
#   ./scripts/restore.sh --target siparis_tatbikat <dump>                          # AYRI veritabanına (aylık tatbikat)
#   ./scripts/restore.sh --yes <dump>                                              # onay sormadan (dikkat!)
#
# Canlı geri yüklemede api/worker/web durdurulur (sipariş alınamaz), veritabanı dökümdeki hâline döner,
# migration'lar yeniden çalıştırılır ve servisler başlatılır. Tatbikat modunda (--target) servisler çalışmaya
# devam eder; geri yüklenen veritabanında tablo sayıları raporlanır ve istenirse silinir.

set -Eeuo pipefail

cd "$(dirname "$0")/.."

COMPOSE="${COMPOSE:-docker compose}"
TARGET=""
UPLOADS=""
YES=0

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:?--target veritabanı adı ister}"; shift 2 ;;
    --uploads) UPLOADS="${2:?--uploads dosya ister}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) usage 0 ;;
    -*) echo "Bilinmeyen seçenek: $1" >&2; usage 1 ;;
    *) break ;;
  esac
done

DUMP="${1:-}"
[[ -n "$DUMP" && -f "$DUMP" ]] || { echo "Döküm dosyası bulunamadı: ${DUMP:-<yok>}" >&2; usage 1; }
[[ -r "$DUMP" ]] || { echo "Döküm dosyası okunamıyor ($(id -un)): $DUMP — yedeği alan kullanıcıyla çalıştırın ya da: sudo chown $(id -un): $DUMP" >&2; exit 1; }
[[ -z "$UPLOADS" || -f "$UPLOADS" ]] || { echo "Görsel arşivi bulunamadı: $UPLOADS" >&2; exit 1; }
[[ -z "$UPLOADS" || -r "$UPLOADS" ]] || { echo "Görsel arşivi okunamıyor ($(id -un)): $UPLOADS" >&2; exit 1; }

# Güvenlik dökümü kişisel veri içerir: dosya 600, klasör 700
umask 077

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source <(grep -E '^(POSTGRES_USER|POSTGRES_DB)=' .env); set +a
fi
PGUSER="${POSTGRES_USER:-siparis}"
PGDB="${POSTGRES_DB:-siparis}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
psql_c() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "${2:-postgres}" -Atc "$1"; }

log "Döküm doğrulanıyor: $DUMP"
$COMPOSE exec -T postgres pg_restore --list >/dev/null <"$DUMP"

# --- Tatbikat: ayrı veritabanına geri yükle, say, bırak ---------------------------------------------
if [[ -n "$TARGET" ]]; then
  [[ "$TARGET" =~ ^[a-z0-9_]+$ ]] || { echo "Geçersiz veritabanı adı: $TARGET" >&2; exit 1; }
  [[ "$TARGET" != "$PGDB" ]] || { echo "--target canlı veritabanıyla aynı olamaz; canlı geri yükleme için --target vermeyin." >&2; exit 1; }
  log "Tatbikat veritabanı: $TARGET (yeniden oluşturulur)"
  psql_c "drop database if exists $TARGET" >/dev/null 2>&1
  psql_c "create database $TARGET owner $PGUSER" >/dev/null
  $COMPOSE exec -T postgres pg_restore -U "$PGUSER" -d "$TARGET" --no-owner --no-privileges --exit-on-error <"$DUMP"
  log "Geri yüklendi. Özet:"
  psql_c "select 'isletme', count(*)::text from tenants union all select 'siparis', count(*)::text from orders union all select 'son_siparis', coalesce(max(created_at)::text, '-') from orders union all select 'migration', count(*)::text from _migrations" "$TARGET" |
    sed 's/|/: /; s/^/  /'
  log "Tatbikat tamam. Silmek için: $COMPOSE exec postgres dropdb -U $PGUSER $TARGET"
  exit 0
fi

# --- Canlı geri yükleme ----------------------------------------------------------------------------
if [[ "$YES" != 1 ]]; then
  echo "DİKKAT: '$PGDB' veritabanı '$DUMP' dökümündeki hâline dönecek; o andan sonraki siparişler kaybolur."
  echo "api, worker ve web geri yükleme boyunca durur (sipariş alınamaz)."
  read -r -p "Devam etmek için veritabanı adını yazın ($PGDB): " answer
  [[ "$answer" == "$PGDB" ]] || { echo "Vazgeçildi."; exit 1; }
fi

# Servisler durmadan ÖNCE: güvenlik dökümünün yazılacağı klasör yazılabilir mi? (Durduktan sonra yazma hatası
# platformu kapalı bırakmasın.)
mkdir -p backups 2>/dev/null || true
if [[ ! -d backups || ! -w backups || ! -x backups ]]; then
  echo "backups/ klasörüne yazılamıyor ($(id -un)). Düzeltin: sudo chown -R $(id -un): backups && chmod 700 backups" >&2
  exit 1
fi
safety="backups/pre-restore-$PGDB-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Hata olursa: veritabanına dokunulmadıysa servisler yeniden açılır; dokunulduysa ne yapılacağı yazılır
stage="stopping"
on_error() {
  local code=$? line=${1:-?}
  log "HATA: geri yükleme durdu (satır $line, çıkış $code)."
  case "$stage" in
    stopping | safety_dump)
      rm -f "$safety" 2>/dev/null || true
      log "Veritabanı DEĞİŞMEDİ. Servisler yeniden başlatılıyor."
      $COMPOSE up -d api worker web || log "Servisler başlatılamadı: $COMPOSE up -d api worker web"
      ;;
    restoring)
      log "Veritabanı yarım kalmış olabilir; servisler KAPALI. Önceki hâle dönmek için:"
      log "  ./scripts/restore.sh --yes $safety"
      ;;
    *)
      log "Veritabanı geri yüklendi ama sonraki adım başarısız; servisler KAPALI olabilir."
      log "  $COMPOSE logs migrate && $COMPOSE up -d   (önceki hâl: ./scripts/restore.sh --yes $safety)"
      ;;
  esac
  exit "$code"
}
trap 'on_error $LINENO' ERR

log "Servisler durduruluyor (api, worker, web)"
$COMPOSE stop api worker web

# Güvenlik ağı: geri yüklemeden hemen önceki durumun dökümü
stage="safety_dump"
log "Mevcut durumun dökümü alınıyor: $safety"
$COMPOSE exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner --no-privileges >"$safety"
[[ -s "$safety" ]] || { log "Güvenlik dökümü boş: $safety"; false; }

stage="restoring"
log "Veritabanı yeniden oluşturuluyor: $PGDB"
psql_c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PGDB' and pid <> pg_backend_pid()" >/dev/null
psql_c "drop database $PGDB" >/dev/null
psql_c "create database $PGDB owner $PGUSER" >/dev/null
$COMPOSE exec -T postgres pg_restore -U "$PGUSER" -d "$PGDB" --no-owner --no-privileges --exit-on-error <"$DUMP"

stage="restored"
if [[ -n "$UPLOADS" ]]; then
  log "Görseller geri yükleniyor: $UPLOADS"
  $COMPOSE run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/uploads/* && tar -xzf - -C /data' <"$UPLOADS"
fi

log "Migration (döküm eski sürümdense eksikler uygulanır)"
$COMPOSE run --rm migrate

log "Servisler başlatılıyor"
stage="starting"
$COMPOSE up -d api worker web
trap - ERR
log "Geri yükleme bitti. Kontrol: curl -fsS https://\$DOMAIN/api/v1/health ve admin paneli > İşler."
