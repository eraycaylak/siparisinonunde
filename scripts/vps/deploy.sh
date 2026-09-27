#!/usr/bin/env bash
# Yemek Gelsin — canlı ortam dağıtımı, sunucu tarafı (00 §12a madde 10; 15 §14). Root olarak çalışır. Canlı ortam iş akışı
# (.github/workflows/deploy-production.yml) yükler ve alt komutlarla çağırır; elle de kullanılabilir.
#
#   deploy.sh checkout <depo-adresi> <commit>  kodu /opt/yemekgelsin/app'e getirir ve TAM o commit'e geçer
#   deploy.sh env-get                          mevcut .env'i stdout'a yazar (yoksa boş)
#   deploy.sh env-put <dosya>                  dosyayı .env olarak yerleştirir (root, 600) ve kaynağı siler
#   deploy.sh up [<parola-dosyası>]            disk denetimi → derle → yapılandırmayı yeni imajla denetle → (varsa)
#                                              güncelleme öncesi veritabanı yedeği → docker compose up -d (önce migrate)
#                                              → Caddyfile değiştiyse caddy'yi yeniden oluştur → sağlık bekle → bayraklar
#                                              (bootstrap-production.ts) → ilk yönetici (create-admin --if-missing) →
#                                              günlük yedek cron'u → eski imajları ve derleme önbelleğini temizle
#   deploy.sh status                           servislerin durumu
#   deploy.sh diag [servis…]                   tanı: tam günlükleri sunucuya kaydeder ($BASE/deploy-logs, 600) ve yalnız
#                                              süzülmüş özeti yazar (aşağıda "Günlükler")
#   deploy.sh sanitize-logs                    stdin'deki günlüğü süzer (test ve elle kullanım; root gerekmez)
#
# Günlükler: bu betiğin çıktısı GitHub Actions'a (Türkiye dışı) gider. Servis günlükleri kişisel veri içerebilir (Caddy
# erişim günlüğünde istemci IP'si, API istek günlüğünde remoteAddress; CLAUDE.md kural 7), bu yüzden ham günlük ASLA
# yazılmaz: JSON satırlarından yalnız uyarı/hata düzeyindekiler istek/IP alanları olmadan (düzey, kaynak, ileti, hata),
# Caddy'nin HTTP günlükleri (http.log.*) hiç; düz metinde IP, telefon ve e-posta maskelenir. Tam günlük sunucuda kalır.
#
# Çalışan konteynerlere dokunmadan ÖNCE: .env derleme değişkenleri (docker compose config), imaj derlemesi ve uygulamanın
# kendi yapılandırma denetimi (scripts/check-config.ts, yeni imajla) geçmeli; biri başarısızsa eski sürüm çalışmaya devam
# eder. <parola-dosyası> tek satırda ilk yöneticinin parolasını içerir (ADMIN_PASSWORD; okununca silinir). Yönetici zaten
# varsa parolasına ve iki adımlı doğrulamasına dokunulmaz.

set -Eeuo pipefail

BASE=/opt/yemekgelsin
APP="$BASE/app"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@yemekgelsin.net}"
ADMIN_NAME="${ADMIN_NAME:-Platform Yöneticisi}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-900}"
# Derleme ve yedekten önce diskte en az bu kadar boş yer olmalı (yüzde; pgdata aynı diskte, dolarsa PostgreSQL durur)
MIN_FREE_PERCENT="${MIN_FREE_PERCENT:-15}"
LOG_DIR="$BASE/deploy-logs"

log() { printf '[dağıtım] %s %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[dağıtım] HATA: %s\n' "$*" >&2; exit 1; }
trap 'die "satır $LINENO başarısız (çıkış $?)"' ERR

require_root() { [[ $EUID -eq 0 ]] || die "root olarak çalıştırın."; }

compose() { (cd "$APP" && docker compose "$@"); }

# --- Günlük süzgeci (kişisel veri GitHub'a gitmesin; açıklama dosyanın başında) -----------------------------------
# JSON satırı: Caddy http.log.* (erişim/istek günlükleri) atlanır; pino (sayı) ya da Caddy (metin) düzeyi uyarı/hata
# değilse atlanır; kalanlardan yalnız düzey | kaynak | ileti | hata iletisi yazılır (req, remoteAddress, remote_ip,
# headers, uri gibi alanlar hiç yazılmaz). JSON olmayan satır olduğu gibi geçer, sonra maskelenir.
# shellcheck disable=SC2016  # jq programı: $ değişkenleri jq'nindir, kabuk açmaz
LOG_FILTER_JQ='
def lvl: if type == "number" then (if . >= 50 then "error" elif . >= 40 then "warn" else "info" end)
         elif type == "string" then ascii_downcase else "info" end;
def str: if . == null then "" elif type == "string" then . else tojson end;
. as $raw
| (try fromjson catch null) as $j
| if ($j | type) == "object" then
    if (($j.logger // "") | str | startswith("http.log")) then empty
    else ($j.level | lvl) as $l
    | if ($l | test("^(warn|warning|error|fatal|panic|critical|dpanic)$")) then
        [($l | ascii_upcase), ($j.logger // $j.name // "" | str), ($j.msg // $j.message // "" | str),
         ((if ($j.err | type) == "object" then ($j.err.message // $j.err.type) else $j.err end) // $j.error // "" | str)]
        | map(select(. != "")) | join(" | ")
      else empty end
    end
  else $raw end'

sanitize_logs() {
  local filtered
  if command -v jq >/dev/null 2>&1; then
    filtered=$(jq -rR "$LOG_FILTER_JQ" 2>/dev/null || true)
  else
    # jq yoksa JSON satırları (ayrıştırılamadığı için) hiç yazılmaz
    filtered=$(grep -v '^[[:space:]]*{' || true)
  fi
  printf '%s\n' "$filtered" | sed -E \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<e-posta>/g' \
    -e 's/([0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}/<ip>/g' \
    -e 's/([0-9a-fA-F]{1,4}:)+:([0-9a-fA-F]{1,4})?/<ip>/g' \
    -e 's/([0-9]{1,3}\.){3}[0-9]{1,3}/<ip>/g' \
    -e 's/\+?(90 ?)?0?5[0-9]{2} [0-9]{3} [0-9]{2} [0-9]{2}/<tel>/g' \
    -e 's/\+?[0-9]{10,15}/<no>/g'
}

# Tanı: tam günlük sunucuda (600), çıktıda yalnız süzülmüş özet
cmd_diag() {
  local svcs=("$@") stamp file svc
  [[ ${#svcs[@]} -gt 0 ]] || svcs=(migrate api worker web caddy)
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$LOG_DIR/$stamp.log"
  (
    umask 077
    install -d -m 700 "$LOG_DIR"
    {
      compose ps -a 2>&1 || true
      for svc in "${svcs[@]}" postgres; do
        echo "===== $svc ====="
        compose logs --no-color --timestamps --tail 1000 "$svc" 2>&1 || true
      done
    } >"$file"
  )
  # Son 20 dosya kalır
  find "$LOG_DIR" -maxdepth 1 -name '*.log' -type f | sort | head -n -20 | xargs -r rm -f
  echo "----- servisler -----"
  compose ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' 2>&1 || compose ps -a 2>&1 || true
  for svc in "${svcs[@]}"; do
    echo "----- $svc: son 300 satırdaki uyarı/hatalar (süzülmüş; IP, telefon, e-posta maskeli) -----"
    compose logs --no-color --no-log-prefix --tail 300 "$svc" 2>&1 | sanitize_logs | tail -n 40 || true
  done
  echo "Tam günlükler yalnız sunucuda: $file (root, 600). Kişisel veri içerebilir; GitHub'a kopyalamayın."
}

cmd_checkout() {
  local repo="${1:?depo adresi}" sha="${2:?commit}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "commit tam SHA olmalı (40 hex): $sha"
  install -d -m 755 "$APP"
  if [[ ! -d "$APP/.git" ]]; then
    log "depo hazırlanıyor: $APP"
    git -C "$APP" init -q
    git -C "$APP" remote add origin "$repo"
  else
    git -C "$APP" remote set-url origin "$repo"
  fi
  local previous=""
  previous=$(git -C "$APP" rev-parse --verify -q HEAD || true)
  log "commit getiriliyor: ${sha:0:12}"
  git -C "$APP" fetch -q --depth=1 origin "$sha"
  # İzlenen dosyalardaki yerel değişiklikler atılır; .env, backups/ gibi git dışı dosyalara dokunulmaz
  git -C "$APP" checkout -q --force --detach "$sha"
  [[ "$(git -C "$APP" rev-parse HEAD)" == "$sha" ]] || die "checkout sonrası commit uyuşmuyor"
  log "kod hazır: ${sha:0:12}${previous:+ (önceki ${previous:0:12})}"
}

cmd_env_get() {
  [[ -f "$APP/.env" ]] && cat "$APP/.env"
  return 0
}

# .env'deki bir değer (tek tırnak soyulur; scripts/vps/env-merge.mjs biçimi)
env_value() {
  local line
  line=$(grep -E "^$2=" "$1" 2>/dev/null | tail -n 1 || true)
  line="${line#*=}"
  line="${line#\'}"
  printf '%s' "${line%\'}"
}

# Değişirse veri kaybı ya da kesinti olan gizli değerler: sunucu tarafında da korunur
PROTECTED_KEYS=(POSTGRES_PASSWORD ENCRYPTION_KEY TRACKING_SECRET SESSION_SECRET WA_VERIFY_TOKEN PLATFORM_WA_WEBHOOK_TOKEN)

cmd_env_put() {
  local src="${1:?dosya}" k old new
  [[ -s "$src" ]] || die ".env kaynağı boş ya da yok: $src"
  install -d -m 755 "$APP"
  if [[ -f "$APP/.env" ]]; then
    for k in "${PROTECTED_KEYS[@]}"; do
      old=$(env_value "$APP/.env" "$k")
      new=$(env_value "$src" "$k")
      if [[ -n "$old" && "$old" != "$new" ]]; then
        rm -f "$src"
        die "$k değişecekti; .env'e dokunulmadı (gizli anahtarlar korunur). Bilerek değiştirmek için sunucudaki .env'i elle düzenleyin (15 §14)."
      fi
    done
    install -d -m 700 "$BASE/env-backups"
    install -m 600 "$APP/.env" "$BASE/env-backups/env.$(date -u +%Y%m%dT%H%M%SZ)"
    # Son 10 kopya kalır
    find "$BASE/env-backups" -maxdepth 1 -name 'env.*' -type f | sort | head -n -10 | xargs -r rm -f
  elif docker volume inspect siparisinonunde_pgdata >/dev/null 2>&1; then
    rm -f "$src"
    die "Veritabanı birimi (siparisinonunde_pgdata) var ama $APP/.env yok: yeni üretilen POSTGRES_PASSWORD veritabanına uymaz. Eski .env'i geri koyun ($BASE/env-backups/ altındaki son kopya) ve iş akışını yeniden çalıştırın (15 §14)."
  fi
  install -m 600 -o root -g root "$src" "$APP/.env"
  rm -f "$src"
  log ".env yerleştirildi (600, root; önceki kopya $BASE/env-backups/)"
}

# Servisin sağlık durumu: healthy | starting | unhealthy | running | exited | yok
svc_state() {
  local id
  id=$(compose ps -q "$1" 2>/dev/null | head -1)
  [[ -n "$id" ]] || { echo yok; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo yok
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) all svc st line
  while :; do
    all=1
    line=""
    for svc in postgres api worker web caddy; do
      st=$(svc_state "$svc")
      line+="$svc=$st "
      case "$svc:$st" in
        caddy:running) ;;
        *:healthy) ;;
        *) all=0 ;;
      esac
    done
    if [[ $all -eq 1 ]]; then
      log "servisler sağlıklı: $line"
      return 0
    fi
    if [[ $SECONDS -ge $deadline ]]; then
      log "servisler $HEALTH_TIMEOUT sn içinde sağlıklı olmadı: $line"
      cmd_diag migrate api worker web caddy || true
      return 1
    fi
    log "bekleniyor: $line"
    sleep 10
  done
}

# Caddyfile tek dosya olarak bağlanır (docker-compose.yml): git checkout değişen dosyayı yeni inode ile yazar, çalışan
# caddy eski inode'u okumaya devam eder ve `compose up -d` onu yeniden oluşturmaz (imaj ve compose ayarı aynı). İçerik
# konteynerdekinden farklıysa caddy yeniden oluşturulur (birkaç saniyelik kesinti; sertifikalar caddy_data'da kalır).
sync_caddyfile() {
  local want have=""
  want=$(sha256sum "$APP/Caddyfile" | cut -d' ' -f1)
  have=$(compose exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | sha256sum | cut -d' ' -f1) || have=""
  if [[ "$want" != "$have" ]]; then
    log "Caddyfile değişti (ya da caddy okunamadı); caddy yeniden oluşturuluyor"
    compose up -d --no-deps --force-recreate caddy
  fi
}

# Boş yer: Docker veri dizini ve $BASE (yedekler, pgdata aynı diskte olabilir) için en az MIN_FREE_PERCENT
check_disk() {
  local path root line used avail
  root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
  for path in "$BASE" "$root"; do
    [[ -e "$path" ]] || continue
    line=$(df -Pk "$path" | awk 'NR==2 {gsub("%", "", $5); print $5, $4}')
    used=${line% *}
    avail=${line#* }
    if (( 100 - used < MIN_FREE_PERCENT )); then
      die "diskte yer az ($path: %$((100 - used)) boş, $((avail / 1024 / 1024)) GB; en az %$MIN_FREE_PERCENT gerekir). Çalışan servislere dokunulmadı. Yer açın: 'docker system prune' (kullanılmayan imajlar), $BASE/backups altındaki eski pre-deploy-* dökümleri; sonra iş akışını yeniden çalıştırın (15 §14)."
    fi
  done
}

install_backup_cron() {
  local cronfile=/etc/cron.d/yemekgelsin-backup
  local body
  body="# Yemek Gelsin — günlük yedek (scripts/backup.sh; 15 §8, §14). Sunucu saat dilimi Europe/Istanbul: her gece 03:30.
# PostgreSQL dökümü + görseller $BASE/backups altına (izin 700/600), 14 günden eskiler silinir. Yedekler Türkiye'deki bu
# sunucuda kalır; ikinci Türkiye lokasyonu için .env BACKUP_REMOTE (rclone). Canlı ortam iş akışı yazar.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root cd $APP && /bin/bash scripts/backup.sh >> /var/log/yemekgelsin-backup.log 2>&1"
  if [[ "$(cat "$cronfile" 2>/dev/null)" != "$body" ]]; then
    printf '%s\n' "$body" >"$cronfile"
    chmod 644 "$cronfile"
    log "yedek cron'u kuruldu: her gece 03:30 (Europe/Istanbul) → $BASE/backups"
  fi
  cat >/etc/logrotate.d/yemekgelsin-backup <<'ROTATE'
/var/log/yemekgelsin-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
ROTATE
}

cmd_up() {
  local secret_file="${1:-}" admin_password=""
  if [[ -n "$secret_file" ]]; then
    [[ -f "$secret_file" ]] || die "parola dosyası yok: $secret_file"
    IFS= read -r admin_password <"$secret_file" || true
    rm -f "$secret_file"
  fi
  [[ -f "$APP/.env" ]] || die "$APP/.env yok (önce env-put)."
  [[ -f "$APP/docker-compose.yml" ]] || die "$APP/docker-compose.yml yok (önce checkout)."
  cd "$APP"

  log "1/8 disk ve compose yapılandırması (.env değişkenleri)"
  check_disk
  compose config -q || die ".env compose için eksik/hatalı (ör. POSTGRES_PASSWORD, DOMAIN, ACME_EMAIL, CLOUDFLARE_API_TOKEN). Çalışan servislere dokunulmadı."

  log "2/8 imajlar derleniyor (api, web, caddy; çalışan servisler etkilenmez)"
  compose build --pull

  log "3/8 yapılandırma denetimi (yeni imajla, apps/api/src/config.ts kuralları)"
  if ! compose run --rm --no-deps -T api node --import tsx /app/scripts/check-config.ts; then
    die "uygulama yapılandırması geçersiz; çalışan servislere dokunulmadı (yukarıdaki 'Hata:' satırı)."
  fi

  if [[ "$(svc_state postgres)" == "healthy" ]]; then
    # Yalnız veritabanı (migration görsellere dokunmaz); son 5 pre-deploy dökümü kalır (backup.sh --pre-deploy)
    log "4/8 güncelleme öncesi veritabanı yedeği (migration'lar yalnız ileri yönlüdür)"
    /bin/bash scripts/backup.sh --pre-deploy || die "güncelleme öncesi yedek alınamadı; dağıtım durduruldu (çalışan sürüm etkilenmedi)."
  else
    log "4/8 ilk kurulum: veritabanı yok, yedek atlandı"
  fi

  log "5/8 docker compose up -d (önce migrate, sonra api/worker, web, caddy)"
  if ! compose up -d --remove-orphans; then
    cmd_diag migrate api worker || true
    die "docker compose up başarısız (süzülmüş günlük özeti yukarıda; tam günlük sunucuda)."
  fi
  sync_caddyfile

  log "6/8 sağlık denetimi (en çok $HEALTH_TIMEOUT sn)"
  wait_healthy || die "servisler sağlıklı değil (günlükler yukarıda)."

  log "7/8 bayraklar (üretim varsayılanları; var olanlara dokunulmaz) ve ilk platform yöneticisi"
  compose exec -T api node --import tsx /app/scripts/bootstrap-production.ts || die "bootstrap-production.ts başarısız."
  # Parola komut satırına yazılmaz: `docker exec -e ADMIN_PASSWORD` değeri bu sürecin ortamından alır
  local rc=0 api_id
  api_id=$(compose ps -q api | head -1)
  [[ -n "$api_id" ]] || die "api konteyneri bulunamadı."
  ADMIN_PASSWORD="$admin_password" docker exec -i -e ADMIN_PASSWORD "$api_id" node --import tsx /app/scripts/create-admin.ts \
    --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" --if-missing </dev/null || rc=$?
  admin_password=""
  case "$rc" in
    0) ;;
    3) die "$ADMIN_EMAIL platform yöneticisi olmayan bir hesaba ait; yetki verilmedi. Sunucuda elle inceleyin (15 §14)." ;;
    *) die "create-admin başarısız (çıkış $rc)." ;;
  esac

  log "8/8 yedek cron'u ve temizlik"
  install_backup_cron
  docker image prune -f >/dev/null 2>&1 || true
  # Derleme önbelleği sınırsız büyümesin (son 7 günün katmanları kalır; derleme hızlı kalır)
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
  local sha
  sha=$(git -C "$APP" rev-parse HEAD 2>/dev/null || echo bilinmiyor)
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$sha" >>"$BASE/deploy-history"
  printf '%s\n' "$sha" >"$BASE/current-sha"
  compose ps
  log "dağıtım tamam: ${sha:0:12}"
}

cmd_status() {
  compose ps -a
  for svc in postgres api worker web caddy; do printf '%s=%s\n' "$svc" "$(svc_state "$svc")"; done
}

sub="${1:-}"
shift || true
[[ "$sub" == "sanitize-logs" ]] || require_root
case "$sub" in
  checkout) cmd_checkout "$@" ;;
  env-get) cmd_env_get ;;
  env-put) cmd_env_put "$@" ;;
  up) cmd_up "$@" ;;
  status) cmd_status ;;
  diag) cmd_diag "$@" ;;
  sanitize-logs) sanitize_logs ;;
  *) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
