#!/usr/bin/env bash
# Siparişin Önünde — günlük yedek (docs/15-kurulum-ve-isletim.md §8).
# PostgreSQL mantıksal dökümü (pg_dump -Fc, sıkıştırılmış) + yüklenen görseller (uploads birimi).
# 14 günden eski yedekler silinir. Sunucuda, depoyu ve compose'u yöneten `siparis` kullanıcısının crontab'ında
# (root'un değil; `crontab -e` siparis olarak) her gece çalıştırın. Log kullanıcının ev dizinine yazılır:
#   15 3 * * * cd /opt/siparisinonunde && ./scripts/backup.sh >> "$HOME/siparis-backup.log" 2>&1
# Hata olursa betik sıfır dışı kodla çıkar ve syslog'a da yazar: journalctl -t siparis-backup
# Başarılı her yedekten sonra BACKUP_PING_URL (varsa) çağrılır: dış izlemedeki "push" monitörü (Uptime Kuma vb.)
# 26 saat ping gelmezse alarm verir (06 §14.1: yedek yaşı > 26 sa → P2).
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
  set -a; source <(grep -E '^(POSTGRES_USER|POSTGRES_DB|BACKUP_REMOTE|BACKUP_DIR|RETENTION_DAYS|BACKUP_PING_URL)=' .env); set +a
fi
PGUSER="${POSTGRES_USER:-siparis}"
PGDB="${POSTGRES_DB:-siparis}"

# Yedekler kişisel veri içerir: dosyalar 600, klasör 700 (umask klasör oluşturulmadan ÖNCE)
umask 077

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Hata sessiz kalmasın: log + syslog (cron'un e-postası çoğu sunucuda gitmez), yarım dosyaları temizle
on_error() {
  local code=$? line=${1:-?}
  rm -f "$BACKUP_DIR"/*.partial 2>/dev/null || true
  log "HATA: yedek alınamadı (satır $line, çıkış $code)."
  command -v logger >/dev/null 2>&1 && logger -t siparis-backup -p user.err "Yedek alınamadı (satır $line, çıkış $code)" || true
  exit "$code"
}
trap 'on_error $LINENO' ERR

mkdir -p "$BACKUP_DIR"
if [[ ! -w "$BACKUP_DIR" || ! -x "$BACKUP_DIR" ]]; then
  log "HATA: $BACKUP_DIR klasörüne yazılamıyor ($(id -un) kullanıcısı; sahibi $(stat -c %U "$BACKUP_DIR" 2>/dev/null || echo '?'))."
  log "Düzeltin: sudo chown -R $(id -un): $BACKUP_DIR && chmod 700 $BACKUP_DIR"
  command -v logger >/dev/null 2>&1 && logger -t siparis-backup -p user.err "Yedek klasörüne yazılamıyor: $BACKUP_DIR" || true
  exit 1
fi

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
    command -v logger >/dev/null 2>&1 && logger -t siparis-backup -p user.err "rclone yok; ikinci kopya alınmadı" || true
    exit 2
  fi
else
  log "UYARI: BACKUP_REMOTE tanımlı değil; yedeğin ikinci kopyası yok (docs/15 §8)."
fi

# Dış izlemeye "yedek alındı" sinyali (gelmezse izleme alarm verir)
if [[ -n "${BACKUP_PING_URL:-}" ]]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "$BACKUP_PING_URL" || log "UYARI: BACKUP_PING_URL çağrılamadı; dış izleme alarm verebilir."
fi

log "Yedekleme bitti."
