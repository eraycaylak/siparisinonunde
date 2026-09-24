#!/usr/bin/env bash
# Siparişin Önünde — günlük yedek (docs/15-kurulum-ve-isletim.md §8).
# PostgreSQL mantıksal dökümü (pg_dump -Fc, sıkıştırılmış) + yüklenen görseller (uploads birimi).
# 14 günden eski yedekler silinir. Sunucuda cron ile her gece çalıştırın:
#   15 3 * * * cd /opt/siparisinonunde && ./scripts/backup.sh >> /var/log/siparis-backup.log 2>&1
#
# İKİNCİ KONUM (00 §10, KVKK — kişisel veri Türkiye'de): yedeğin ikinci bir kopyası BAŞKA bir
# Türkiye lokasyonuna gönderilmelidir. BACKUP_REMOTE tanımlıysa rclone ile kopyalanır, ör.:
#   BACKUP_REMOTE="yedek-istanbul:siparis-yedek"   (rclone config ile tanımlanmış S3 uyumlu yurt içi depo)
# rclone kurulu değilse ya da BACKUP_REMOTE boşsa bu adım atlanır ve uyarı yazılır.
# Not: pg_dump anlık tutarlı döküm verir; saniyelik geri dönüş (PITR) için WAL arşivleme (pgBackRest/WAL-G)
# ayrıca kurulmalıdır (pilot öncesi zorunlu paket, 00 §11).

set -Eeuo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE="${COMPOSE:-docker compose}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# .env'den veritabanı adı/kullanıcısı (yoksa varsayılanlar)
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source <(grep -E '^(POSTGRES_USER|POSTGRES_DB|BACKUP_REMOTE|BACKUP_DIR|RETENTION_DAYS)=' .env); set +a
fi
PGUSER="${POSTGRES_USER:-siparis}"
PGDB="${POSTGRES_DB:-siparis}"

mkdir -p "$BACKUP_DIR"
umask 077

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

db_file="$BACKUP_DIR/db-$PGDB-$STAMP.dump"
tmp_file="$db_file.partial"

log "Veritabanı dökümü: $db_file"
# -T: TTY yok (cron). pg_dump konteyner içinde çalışır; çıktı sunucudaki dosyaya yazılır.
$COMPOSE exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner --no-privileges >"$tmp_file"
# Döküm geçerli mi? (içindekiler listesi okunabilmeli)
$COMPOSE exec -T postgres pg_restore --list >/dev/null <"$tmp_file"
mv "$tmp_file" "$db_file"
log "Tamam: $(du -h "$db_file" | cut -f1)"

uploads_file="$BACKUP_DIR/uploads-$STAMP.tar.gz"
if $COMPOSE ps --status running --services 2>/dev/null | grep -qx api; then
  log "Görseller: $uploads_file"
  $COMPOSE exec -T api tar -czf - -C /data uploads >"$uploads_file.partial"
  mv "$uploads_file.partial" "$uploads_file"
else
  log "UYARI: api konteyneri çalışmıyor; görsel yedeği atlandı."
fi

# Saklama: RETENTION_DAYS günden eski yedekleri sil
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$((RETENTION_DAYS - 1))" -print -delete |
  sed 's/^/silindi: /' || true

# İkinci konuma kopya
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    log "İkinci konuma kopyalanıyor: $BACKUP_REMOTE"
    rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --include "db-*.dump" --include "uploads-*.tar.gz" --max-age 48h
    # Uzak konumda da saklama süresini uygula
    rclone delete "$BACKUP_REMOTE" --min-age "${RETENTION_DAYS}d" || true
  else
    log "UYARI: BACKUP_REMOTE tanımlı ama rclone kurulu değil; ikinci kopya ALINMADI."
    exit 2
  fi
else
  log "UYARI: BACKUP_REMOTE tanımlı değil; yedeğin ikinci kopyası yok (docs/15 §8)."
fi

log "Yedekleme bitti."
