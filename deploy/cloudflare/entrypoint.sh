#!/usr/bin/env bash
# Yemek Gelsin — CANLI ORTAM container'ı, Cloudflare (00 §12a madde 10; 15 §13): PostgreSQL + API + worker + web tek
# container'da.
#
# Container diski geçicidir: her başlangıçta boş bir veritabanı kurulur ve son yedek R2'den geri yüklenir.
# Yedek, Worker'daki "yedek.internal" çıkış işleyicisi üzerinden R2'ye yazılır/okunur (deploy/cloudflare/src/index.ts).
# Veri dönemi (DATA_EPOCH) container'a açılışta verilir ve ömrü boyunca sabittir: yedek yolu /e<dönem>/db olur, R2
# anahtarı e3/db/son.dump. Worker dönemi yoldan okur; yeniden dağıtımda kapanan eski container'ın son yedeği yeni
# döneme düşmez. DATA_EPOCH artırılınca yeni container yedek bulamaz, veri sıfırdan kurulur.
# Seed kipi SEED_MODE ile gelir (00 §12a madde 10): admin (canlı ortam) yalnız platform yöneticisini ve bayrakları kurar,
# demo (gizli staging) demo işletmeleri de kurar. SEED_PASSWORD (= DEV_PASSWORD) seed hesaplarının parolasıdır.
# Sıra: PostgreSQL → yedekten geri yükle → migrate → seed (idempotent) → api + worker + web → yedek döngüsü.
#
# Yedek ve dayanıklılık (gerçek veri): döngü BACKUP_INTERVAL_SEC'te bir (varsayılan 120 sn) veritabanında ya da görsellerde
# değişiklik olup olmadığına bakar; yalnız değiştiyse yükler (boştaki ortam R2'ye her 2 dakikada yazmaz). SIGTERM (uyku,
# yeniden dağıtım): uygulamalar durur, son yedek her durumda alınır, PostgreSQL kapanır; platform yeni container'ı eski
# kapanmadan başlatmaz, bu yüzden düzgün kapanış veri kaybettirmez. Bir süreç düşerse de son yedek alınıp çıkılır.
# Beklenmedik çökmede (container'ın zorla sonlanması) son yedekten sonraki en çok ~2 dakikalık veri kaybolabilir.
#
# Veri kaybına karşı dört kapı (docs/denetim-2026-10-04-uretim-hazirlik.md B6/B7/B14 + dört mercek turu):
#   1) TEK YAZICI: her döküm kendi mktemp dosyasına yazılır ve aynı anda iki yedek çalışmaz (flock; kapanışta döngü
#      ÖNCE durdurulur, süren yedeğin bitmesi beklenir). Eskiden ikisi de /tmp/yedek.dump'a yazıyordu.
#   2) YÜKLEMEDEN ÖNCE DOĞRULAMA: döküm `pg_restore --list`, görsel arşivi `tar -tzf` ile okunuyor mu diye denetlenir;
#      okunmuyorsa R2'ye YAZILMAZ — Worker aynı gövdeyi hem son.dump hem gun-<0-6>.dump olarak yazdığından
#      doğrulanmamış bir döküm iki kopyayı birden bozardı. Geri yüklemede indirilen döküm de önce doğrulanır.
#   3) TAZE AÇILIŞ SİLAHSIZDIR: yedek bulunamazsa gerçek veri (işletme/sipariş/lead/2FA) gelene kadar R2'ye hiçbir şey
#      yazılmaz, kapanış yedeği (force) bile; dolu veritabanının üzerine de geri yükleme/seed gitmez (satır sayısı
#      kapısı). Yanlış verilmiş bir DATA_EPOCH ya da R2'nin boş 404'ü canlı veriyi ezemez.
#   4) YARIM GERİ YÜKLEME ZİNCİRİ DONDURUR: pg_restore'dan önce PGDATA'nın yanına (kalıcı birim; /tmp container yerinde
#      yeniden başlarken silinebilir) "geri yükleme sürüyor" izi yazılır, başarıda silinir. Açılışta iz duruyorsa satır
#      sayısına BAKILMADAN "yarım" kabul edilir: R2'ye yazma kalıcı olarak durdurulur (BACKUP_FROZEN), [ERROR] satırı
#      yazılır ve ALERT_WEBHOOK_URL'e uyarı gider. Önceki davranışta yarım veritabanı "gerçek veri" sanılıp 120 saniye
#      içinde R2'deki iyi son.dump'ın ve o günün kopyasının üzerine yazılıyordu. Çözüm: docs/17 §2.8.
# Hata sessiz kalmaz: stderr'e `[ERROR]` satırı + BACKUP_STATE_FILE (/tmp/yedek-durum.json) tek satır JSON durum
# dosyası; sağlık ucu lastBackupAgeSec'i buradan hesaplar (alanlar ve note sözcükleri: docs/15 §13).
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app}"
WEB_DIR="${WEB_DIR:-/app/web}"
PGDATA="${PGDATA:-/data/pg}"
PGPORT="${PGPORT:-5432}"
UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
BACKUP_URL="${BACKUP_URL:-http://yedek.internal}"
BACKUP_INTERVAL_SEC="${BACKUP_INTERVAL_SEC:-120}"
# Yedek zincirinin container içi dosyaları (/tmp): durum dosyasını sağlık ucu okur, kilit iki yedeği birbirinden
# ayırır, dur işareti kapanışta döngüye "yeni tur başlatma" der.
BACKUP_STATE_FILE="${BACKUP_STATE_FILE:-/tmp/yedek-durum.json}"
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/yedek.lock}"
BACKUP_STOP_FILE="${BACKUP_STOP_FILE:-/tmp/yedek-dongu.dur}"
# Kilit beklemesi + kapanışta döngünün bitmesini bekleme; toplamı platformun 15 dk'lık kapanış penceresinin altında
BACKUP_LOCK_WAIT_SEC="${BACKUP_LOCK_WAIT_SEC:-120}"
BACKUP_QUIESCE_SEC="${BACKUP_QUIESCE_SEC:-120}"
# "Geri yükleme sürüyor" işareti: pg_restore'dan ÖNCE yazılır, başarıda silinir. /tmp'ye KONAMAZ — container yerinde
# yeniden başlarsa /tmp silinebilirken yarım veritabanı PGDATA'da ayakta kalır; işaret veriyle AYNI ömürde olmalı,
# bu yüzden PGDATA'nın yanına (kalıcı birim) konur.
RESTORE_FLAG_FILE="${RESTORE_FLAG_FILE:-$(dirname "$PGDATA")/geri-yukleme-suruyor}"
DATA_EPOCH="${DATA_EPOCH:-}"
DB_NAME=siparis
export PGHOST=127.0.0.1 PGPORT PGUSER=siparis PGPASSWORD=siparis
export DATABASE_URL="postgres://siparis:siparis@127.0.0.1:${PGPORT}/${DB_NAME}"
export UPLOAD_DIR

log() { echo "[baslat] $(date -u +%H:%M:%S) $*"; }
# Yedek ve açılış hataları sessiz kalmaz: stderr'e belirgin `[ERROR]` ile yazılır (container logunda aranabilir).
log_error() { echo "[ERROR] [baslat] $(date -u +%H:%M:%S) $*" >&2; }

# Açılış uyarısı (ALERT_WEBHOOK_URL tanımlıysa). Gövde apps/api/src/lib/alert.ts ile AYNI alanları taşır
# (service/env/kind/severity/message/data/at) ki alıcı köprü tek biçim görsün; kaynağı `service` ayırır. Kanal yoksa
# ya da http/https değilse sessizce vazgeçilir: uyarı kanalının yokluğu açılışı DURDURMAZ (ateşle-ve-unut).
# Kişisel veri GÖNDERİLMEZ — yalnız dönem, satır sayısı ve işaret yolu gider (CLAUDE.md kural 7).
# $1 = kind, $2 = tek satır Türkçe mesaj (çift tırnak ve ters bölü kullanmayın), $3 = JSON nesnesi (varsayılan {}).
send_alert() {
  local kind="$1" message="$2" data="${3:-}" url="${ALERT_WEBHOOK_URL:-}"
  [ -n "$data" ] || data='{}'
  case "$url" in
    http://*|https://*) ;;
    '') return 0 ;;
    *) log_error "ALERT_WEBHOOK_URL http/https değil: uyarı gönderilmedi ($kind)"; return 0 ;;
  esac
  printf '{"service":"yemekgelsin-container","env":"%s","kind":"%s","severity":"critical","message":"%s","data":%s,"at":"%s"}' \
    "${DEPLOY_ENV:-}" "$kind" "$message" "$data" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" |
    curl -fsS --max-time 5 -X POST -H 'content-type: application/json' --data-binary @- "$url" >/dev/null 2>&1 ||
    log_error "uyarı gönderilemedi (ALERT_WEBHOOK_URL, $kind): uyarı yalnız günlükte kaldı"
}

# Yedek yolu dönemi taşır: DATA_EPOCH=2 → http://yedek.internal/e2/db; boşsa ilk dönemin öneksiz yolu (/db)
if [ -n "$DATA_EPOCH" ]; then
  if ! [[ "$DATA_EPOCH" =~ ^[0-9]{1,6}$ ]]; then
    log "HATA: DATA_EPOCH geçersiz (\"$DATA_EPOCH\"; yalnız rakam, en çok 6 hane). wrangler.jsonc vars.DATA_EPOCH'u düzeltin."
    exit 1
  fi
  BACKUP_BASE="$BACKUP_URL/e$DATA_EPOCH"
else
  BACKUP_BASE="$BACKUP_URL"
fi

APP_PIDS=()
BACKUP_LOOP_PID=""
DB_READY=0
SHUTTING_DOWN=0
# R2'ye yazma izni: 1 = yaz, 0 = silahsız (taze açılış; gerçek veri gelince backup_run kendiliğinden 1'e çeker)
BACKUP_ARMED=1
# Yedek zincirinin DONDURULMASI: 1 olduğunda R2'ye hiçbir şey yazılmaz ve bu bayrak container ömrü boyunca geri
# alınmaz (silahsız kipin aksine gerçek veri görülünce kendiliğinden açılmaz). Yarım kalmış bir geri yüklemeden
# sonra kullanılır: yarım veritabanı da "gerçek veri" gibi göründüğü için satır sayısı kapısı burada yetmez.
BACKUP_FROZEN=0
# flock util-linux'tan gelir ve imajda vardır; yoksa mkdir atomikliğine dayanan yedek kilide düşülür
HAVE_FLOCK=0
if command -v flock >/dev/null 2>&1; then HAVE_FLOCK=1; fi

# --- Yedek (R2) -------------------------------------------------------------------------------------

# GET <yol> → dosya. 0 = bulundu, 2 = yedek yok (404), 1 = hata (ağ/sunucu).
fetch_backup() {
  local path="$1" out="$2" code
  code=$(curl -sS --max-time 120 -o "$out" -w '%{http_code}' "$BACKUP_BASE/$path" 2>/dev/null) || code=000
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

# PUT <yol> ← dosya. Geçici bir ağ hatası son yedeği kaybettirmesin diye 2 kez yeniden denenir (kapanışta bir
# sonraki tur YOKTUR; --max-time her denemeye ayrı uygulanır).
upload_backup() {
  local path="$1" file="$2"
  [ -s "$file" ] || { log_error "boş yedek gönderilmedi ($path)"; return 1; }
  curl -fsS --max-time 300 --retry 2 --retry-delay 3 --retry-all-errors \
    -X PUT --data-binary @"$file" -H 'content-type: application/octet-stream' "$BACKUP_BASE/$path" >/dev/null
}

# Değişiklik izi (yalnız karşılaştırma için; yedeğin kendisi pg_dump'tır). Veritabanı: kullanıcı tablolarındaki ekleme,
# güncelleme ve silme sayaçlarının toplamı (pg_stat_user_tables). jobs tablosu sayılmaz: worker'ın zamanlanmış işleri onu
# her dakika yazar; asıl veri değişikliği (sipariş, olay günlüğü, outbox, mesaj …) başka tablolara da yazar. İstatistikler
# birkaç saniye gecikebilir: kaçan değişiklik bir sonraki turda yakalanır. Görseller: dosya adı, boyut ve zaman listesi.
db_fingerprint() {
  psql -d "$DB_NAME" -Atc "select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) || ':' || count(*) from pg_stat_user_tables where relname <> 'jobs'" 2>/dev/null || true
}
uploads_fingerprint() {
  if [ -d "$UPLOAD_DIR" ]; then
    { find "$UPLOAD_DIR" -type f -printf '%P %s %T@\n' 2>/dev/null || true; } | LC_ALL=C sort | sha256sum | cut -d' ' -f1
  fi
}

LAST_DB_FP=""
LAST_UPLOADS_FP=""

# Gerçek veri izi: işletme + sipariş + lead + 2FA'sını kurmuş kullanıcı sayısı. Seed'in admin kipinde kurduğu tek
# yönetici ve bayraklar bu sayıya GİRMEZ, yani "boş ama seed'lenmiş" bir veritabanı 0 döner — taze açılış kapısının
# ölçüsü budur. Tablolar henüz yoksa (göçten önce) 0 döner; sorgu hiç çalışmazsa BOŞ string döner ve çağıran taraf
# "veri var" sayar (fail-closed: şüphedeyken üzerine yazmayız).
real_data_rows() {
  psql -d "$DB_NAME" -Atc "select
      (case when to_regclass('public.tenants') is null then 0 else (select count(*) from public.tenants) end)
    + (case when to_regclass('public.orders') is null then 0 else (select count(*) from public.orders) end)
    + (case when to_regclass('public.leads') is null then 0 else (select count(*) from public.leads) end)
    + (case when to_regclass('public.users') is null then 0 else (select count(*) from public.users where totp_enabled_at is not null) end)" 2>/dev/null || true
}

# Durum dosyasındaki iki sayacı geri okur ("<sonBasariUnix> <ardisikHata>"); alan sırası sabittir ve dosyayı yalnız bu
# betik yazar. İki süreç (ana kabuk + döngü) aynı dosyayı paylaştığından sayaçlar değişkende değil DOSYADA tutulur:
# kapanış yedeği, döngünün yazdığı "son başarı" zamanını sıfırlamaz.
backup_state_prev() {
  { sed -n 's/^.*"lastSuccessUnix":\([0-9]*\),.*"consecutiveFailures":\([0-9]*\).*$/\1 \2/p' "$BACKUP_STATE_FILE" 2>/dev/null || true; } | head -1
}

# Tek satır JSON, atomik yazılır (mktemp + mv): iki süreç yazarken dosya hiç yarım görünmez. result: ok|hata|bos|
# atlandi. note (ASCII tek sözcük): yuklendi, degismedi, acilista-geri-yuklendi, taze-acilis-veri-yok,
# kilit-alinamadi, yedek-hatasi, veri-sayisi-okunamadi, yarim-geri-yukleme.
# Sağlık ucu: lastBackupAgeSec = now - lastSuccessUnix.
backup_state_write() {
  local result="$1" note="${2:-}" now="" prev="" ok_at="" fails="" tmp=""
  now=$(date -u +%s)
  prev=$(backup_state_prev)
  ok_at="${prev%% *}"
  fails="${prev##* }"
  case "$ok_at" in ''|*[!0-9]*) ok_at=0 ;; esac
  case "$fails" in ''|*[!0-9]*) fails=0 ;; esac
  if [ "$result" = ok ]; then
    ok_at="$now"
    fails=0
  elif [ "$result" = hata ]; then
    fails=$((fails + 1))
  fi
  tmp=$(mktemp "$BACKUP_STATE_FILE.XXXXXX")
  printf '{"lastSuccessUnix":%s,"lastAttemptUnix":%s,"consecutiveFailures":%s,"lastResult":"%s","note":"%s","epoch":"%s"}\n' \
    "$ok_at" "$now" "$fails" "$result" "$note" "${DATA_EPOCH:-}" >"$tmp"
  mv -f "$tmp" "$BACKUP_STATE_FILE"
}

# Aynı anda iki yedek çalışmaz: kapanış yedeği ile döngü yedeği ne birbirinin geçici dosyasını ne de R2'deki kopyayı
# ezebilir. flock varsa 9 numaralı tanıtıcıyla (süreç ölürse kilit kendiliğinden düşer), yoksa mkdir atomikliğiyle
# kilitlenir. Kilit ÇAĞIRAN kabukta tutulur: yedek alt kabukta çalışsaydı son iz değişkenleri (LAST_*_FP) kaybolur,
# boştaki ortam her turda R2'ye yazardı.
backup_lock() {
  local waited=0 owner=""
  if [ "$HAVE_FLOCK" = 1 ]; then
    exec 9>>"$BACKUP_LOCK_FILE"
    flock -w "$BACKUP_LOCK_WAIT_SEC" 9
    return
  fi
  while [ "$waited" -lt "$BACKUP_LOCK_WAIT_SEC" ]; do
    if mkdir "$BACKUP_LOCK_FILE.d" 2>/dev/null; then
      # $$ alt kabukta ana kabuğun pid'ini verir; gerçek süreç BASHPID'dir
      echo "${BASHPID:-$$}" >"$BACKUP_LOCK_FILE.d/pid"
      return 0
    fi
    owner=$(cat "$BACKUP_LOCK_FILE.d/pid" 2>/dev/null || true)
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -rf "$BACKUP_LOCK_FILE.d"   # kilidi tutan süreç ölmüş; bir sonraki tur alır
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

backup_unlock() {
  if [ "$HAVE_FLOCK" = 1 ]; then
    flock -u 9 2>/dev/null || true
    exec 9>&-
  else
    rm -rf "$BACKUP_LOCK_FILE.d"
  fi
}

# backup_run [force]: force (kapanış, bir sürecin düşmesi) değişiklik olmasa da yükler; döngü yalnız değişiklik varsa.
# İz, dökümden ÖNCE okunur ve yalnız yükleme başarılıysa saklanır: döküm sırasında gelen değişiklik sonraki turda
# yeniden yüklenir. Her döküm KENDİ mktemp dosyasına yazılır (0600; döküm kişisel veri içerir) ve R2'ye gitmeden ÖNCE
# doğrulanır. Kilidi backup_now tutar; doğrudan çağrılmaz.
backup_run() {
  local force="${1:-}" dump="" tarball="" fp="" rows="" uploaded=0 failed=0
  # Donmuş kip (yarım geri yükleme): satır sayısına BAKILMAZ, force da yazamaz. Elle müdahale edilip container yeni
  # bir diskle açılana kadar R2'deki iyi son.dump ve o günün kopyası korunur. Her turda loglanır ve durum dosyasına
  # işlenir. HABER YOLU: send_alert (açılışta bir kez) + bu [ERROR] satırı. Sağlık ucuna GÜVENİLMEZ: yedek yaşı
  # eşiği 503 ÜRETMEZ (yalnız degraded + warnings; apps/api/src/routes/health.ts:211) ve /tmp süpürülmüş bir
  # açılışta lastSuccessUnix 0 kalır → health.ts:163 bunu null'a çevirir → ne backup_stale ne U-28 üretilir.
  if [ "$BACKUP_FROZEN" = 1 ]; then
    log_error "yedek zinciri DONDURULDU (yarım geri yükleme): R2'ye yazılmıyor, iyi yedek korunuyor — docs/17 §2.8"
    backup_state_write atlandi yarim-geri-yukleme
    return 1
  fi
  # Silahsız kip (taze açılış): gerçek veri gelene kadar R2'ye hiçbir şey yazılmaz, force bile yazamaz
  if [ "$BACKUP_ARMED" = 0 ]; then
    rows=$(real_data_rows)
    if [ -z "$rows" ]; then
      log_error "gerçek veri sayısı okunamadı; R2'ye yazma kapalı kalıyor (taze açılış)"
      backup_state_write hata veri-sayisi-okunamadi
      return 1
    fi
    if [ "$rows" = 0 ]; then
      backup_state_write bos taze-acilis-veri-yok
      return 0
    fi
    BACKUP_ARMED=1
    log "gerçek veri geldi ($rows satır): R2 yedeği açıldı"
  fi

  fp=$(db_fingerprint)
  if [ "$force" = force ] || [ -z "$fp" ] || [ "$fp" != "$LAST_DB_FP" ]; then
    dump=$(mktemp /tmp/yedek-db.XXXXXX)
    if ! pg_dump -Fc -d "$DB_NAME" -f "$dump"; then
      log_error "pg_dump başarısız: veritabanı yedeği ALINAMADI (R2'deki kopya korundu)"
      failed=1
    elif ! pg_restore --list "$dump" >/dev/null 2>&1; then
      log_error "döküm doğrulanamadı (pg_restore --list): R2'ye YAZILMADI, iyi yedek korundu"
      failed=1
    elif upload_backup db "$dump"; then
      LAST_DB_FP="$fp"
      uploaded=1
      log "veritabanı yedeği R2'ye yazıldı ($(du -h "$dump" | cut -f1))"
    else
      log_error "veritabanı yedeği R2'ye yazılamadı (yükleme hatası)"
      failed=1
    fi
    rm -f "$dump"
  fi

  fp=$(uploads_fingerprint)
  if [ -d "$UPLOAD_DIR" ] && [ -n "$(ls -A "$UPLOAD_DIR" 2>/dev/null)" ] && { [ "$force" = force ] || [ "$fp" != "$LAST_UPLOADS_FP" ]; }; then
    tarball=$(mktemp /tmp/yedek-uploads.XXXXXX)
    if ! tar -czf "$tarball" -C "$UPLOAD_DIR" .; then
      log_error "görsel arşivi oluşturulamadı (tar)"
      failed=1
    elif ! tar -tzf "$tarball" >/dev/null 2>&1; then
      log_error "görsel arşivi doğrulanamadı (tar -tzf): R2'ye YAZILMADI, iyi kopya korundu"
      failed=1
    elif upload_backup uploads "$tarball"; then
      LAST_UPLOADS_FP="$fp"
      uploaded=1
    else
      log_error "görsel yedeği R2'ye yazılamadı (yükleme hatası)"
      failed=1
    fi
    rm -f "$tarball"
  fi

  if [ "$failed" = 1 ]; then
    backup_state_write hata yedek-hatasi
    return 1
  fi
  # Değişiklik yoksa da zincir sağlıklıdır (R2 veritabanıyla eşittir): boşta duran ortamda sağlık ucu yedek yaşına
  # bakıp boşuna alarm vermesin diye "ok" yazılır; hangisi olduğunu note söyler.
  if [ "$uploaded" = 1 ]; then
    backup_state_write ok yuklendi
  else
    backup_state_write ok degismedi
  fi
  return 0
}

# Tek yazıcı kapısı. Kilit alınamazsa bu tur atlanır: iki pg_dump'ı yan yana koşturmaktansa bir turu kaçırmak yeğdir
# (sonraki tur izi değişmemiş bulup yeniden yükler).
backup_now() {
  [ "$DB_READY" = 1 ] || return 0
  if ! backup_lock; then
    log_error "yedek kilidi ${BACKUP_LOCK_WAIT_SEC} sn'de alınamadı: bu tur atlandı (başka bir yedek sürüyor)"
    backup_state_write atlandi kilit-alinamadi
    return 1
  fi
  local rc=0
  backup_run "${1:-}" || rc=$?
  backup_unlock
  return "$rc"
}

# Döngü ayrı bir alt kabukta çalışır ve son izleri orada tutar (yedekten dönen ortamda boş, yani ilk tur bir kez
# yükler). SIGTERM'de uyku hemen kesilir (bu yüzden `sleep` arka planda + `wait`), ama SÜREN bir yedek YARIDA
# BIRAKILMAZ: bash çalışan komut bitene kadar trap'i bekletir. Kapanış da bu yüzden bozuk bir dökümle karşılaşmaz.
backup_loop() {
  local stop=0 sleep_pid=""
  trap 'stop=1' TERM
  while [ "$stop" = 0 ] && [ ! -e "$BACKUP_STOP_FILE" ]; do
    sleep "$BACKUP_INTERVAL_SEC" &
    sleep_pid=$!
    wait "$sleep_pid" 2>/dev/null || true
    kill "$sleep_pid" 2>/dev/null || true
    if [ "$stop" = 1 ] || [ -e "$BACKUP_STOP_FILE" ]; then
      break
    fi
    backup_now || true
  done
}

# --- Geri yükleme (R2 → veritabanı) -----------------------------------------------------------------

# Geri yükleme izini KOY. Bu satırdan sonra container zorla sonlanırsa (platform öldürür, OOM) veritabanı yarım kalır
# ve PGDATA ile birlikte ayakta kalır; iz de aynı birimde durduğu için sonraki açılış yarımı tanır. `sync` izi diske
# indirir: düğüm çökmesinde de kalır. İz yazılamazsa korumadan vazgeçmeyiz, R2'ye yazmayı DONDURURUZ (fail-closed).
restore_flag_set() {
  if printf 'baslangic=%s epoch=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${DATA_EPOCH:-}" >"$RESTORE_FLAG_FILE" 2>/dev/null; then
    sync 2>/dev/null || true
    return 0
  fi
  BACKUP_FROZEN=1
  log_error "geri yükleme izi yazılamadı ($RESTORE_FLAG_FILE): yarım geri yükleme korumasız kalmasın diye R2'ye yazma DONDURULDU — docs/17 §2.8"
  send_alert geri_yukleme_izi_yazilamadi \
    "Geri yukleme izi yazilamadi: yarim geri yukleme korumasi kurulamadi, R2 yedek zinciri donduruldu (docs/17 2.8)" \
    "{\"epoch\":\"${DATA_EPOCH:-}\",\"isaret\":\"$RESTORE_FLAG_FILE\"}"
}

# Geri yükleme izini KALDIR (geri yükleme tamamlandı). pg_restore bittikten sonra bu satıra gelinene kadarki birkaç
# milisaniyede ölürsek sonraki açılış "yarım" sanar: yanlış alarm bilerek kabul edilir (fail-closed), çözümü docs/17 §2.8.
restore_flag_clear() {
  rm -f "$RESTORE_FLAG_FILE" 2>/dev/null || log_error "geri yükleme izi silinemedi ($RESTORE_FLAG_FILE): sonraki açılış yarım sanabilir"
}

# Geri yükleme yarıda kaldıysa yarım veritabanıyla AÇILMAYIZ: veritabanını düşür, PostgreSQL'i kapat, sıfır dışı çık —
# platform yeniden başlatır, sonraki deneme temiz başlar. Yarım veriyle açılmak, döngünün 2 dakika içinde R2'deki iyi
# yedeğin üzerine yarım veri yazması demektir.
restore_abort() {
  dropdb --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  # Yarım veritabanı GERÇEKTEN düştüyse iz de kalkar: sonraki açılış temiz başlar, boşuna donmaz. Düşmediyse (bağlantı
  # takılı, PostgreSQL hasta) iz bilerek BIRAKILIR — yarım veri hâlâ orada ve R2 korunmalı.
  if psql -d postgres -Atc "select 1 from pg_database where datname = '$DB_NAME'" 2>/dev/null | grep -q 1; then
    log_error "yarım veritabanı düşürülemedi: geri yükleme izi bırakıldı, sonraki açılışta yedek zinciri DONDURULUR ($RESTORE_FLAG_FILE)"
  else
    restore_flag_clear
  fi
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  exit 1
}

# R2'deki son yedeği indirip geri yükler. İndirilen döküm geri yüklemeden ÖNCE doğrulanır (`pg_restore --list`): yarım
# inen bir dosya veritabanını yarım doldurup "açıldı" sayılmasın. `--exit-on-error` ile çalışır: sessizce atlanan nesne
# kalmaz. Yedek hiç yoksa fresh=1 olur (çağıran taraf R2'ye yazmayı kapatır).
restore_from_backup() {
  local dump="" tarball="" rc=0
  dump=$(mktemp /tmp/geri-db.XXXXXX)
  fetch_backup_retry db "$dump" || rc=$?
  case "$rc" in
    0)
      if ! pg_restore --list "$dump" >/dev/null 2>&1; then
        rm -f "$dump"
        log_error "R2'deki yedek bozuk/okunamıyor (pg_restore --list): geri yükleme YAPILMADI, container yeniden denenecek"
        restore_abort
      fi
      log "son yedek geri yükleniyor ($(du -h "$dump" | cut -f1))"
      # İz pg_restore'dan ÖNCE konur: buradan sonra container zorla ölürse yarım veritabanı "gerçek veri" sanılıp
      # 120 saniye içinde R2'deki iyi yedeğin üzerine yazılıyordu (04.10.2026 denetimi, dört mercek turu).
      restore_flag_set
      if ! pg_restore --no-owner --no-privileges --exit-on-error -d "$DB_NAME" "$dump"; then
        rm -f "$dump"
        log_error "geri yükleme başarısız (pg_restore): container yeniden denenecek; sürerse R2'deki gun-<0-6> kopyasını yeni döneme yükleyin (docs/15 §13)"
        restore_abort
      fi
      rm -f "$dump"
      restore_flag_clear
      # R2 ile veritabanı şu an eşit: sağlık ucu ilk 2 dakikada "yedek hiç alınmadı" sanmasın
      backup_state_write ok acilista-geri-yuklendi
      ;;
    2)
      rm -f "$dump"
      fresh=1
      log_error "TAZE AÇILIŞ: $BACKUP_BASE altında yedek YOK. DATA_EPOCH (${DATA_EPOCH:-öneksiz}) yanlış verildiyse önceki dönemin verisi R2'de duruyor, o döneme geri dönün. Gerçek veri gelene kadar R2'ye yazma KAPALI."
      backup_state_write bos taze-acilis-veri-yok
      ;;
    *)
      # Yedek sunucusuna ulaşılamıyorsa boş veritabanıyla açılıp iyi yedeğin üzerine yazmayız
      rm -f "$dump"
      log_error "yedek okunamadı (ağ/sunucu); container yeniden denenecek"
      restore_abort
      ;;
  esac

  rc=0
  tarball=$(mktemp /tmp/geri-uploads.XXXXXX)
  fetch_backup_retry uploads "$tarball" || rc=$?
  case "$rc" in
    0)
      if tar -tzf "$tarball" >/dev/null 2>&1 && tar -xzf "$tarball" -C "$UPLOAD_DIR"; then
        log "görseller geri yüklendi"
      else
        # Ölümcül değil (veri kaybı değil, menü görselleri eksik açılır) ama sessiz de kalmaz
        log_error "görsel yedeği açılamadı (arşiv bozuk): menü görselleri EKSİK açılıyor"
      fi
      ;;
    2) [ "$fresh" = 1 ] || log "görsel yedeği yok (R2'de uploads kopyası bulunmadı)" ;;
    *) log_error "görsel yedeği okunamadı (ağ/sunucu): menü görselleri EKSİK açılıyor" ;;
  esac
  rm -f "$tarball"
}

# --- Kapanış ----------------------------------------------------------------------------------------

shutdown() {
  local code="${1:-0}" waited=0
  [ "$SHUTTING_DOWN" = 1 ] && return
  SHUTTING_DOWN=1
  log "kapanıyor"
  # Kapanış yedeğinden ÖNCE döngü durdurulur ve süren yedeğin bitmesi beklenir: iki pg_dump aynı anda çalışmaz ve
  # bitmek üzere olan doğrulanmış bir yedek yarıda kesilmez. Süre aşılırsa backup_now'ın kilidi ikinci güvencedir.
  : >"$BACKUP_STOP_FILE"
  if [ -n "$BACKUP_LOOP_PID" ]; then
    kill "$BACKUP_LOOP_PID" 2>/dev/null || true
    while kill -0 "$BACKUP_LOOP_PID" 2>/dev/null && [ "$waited" -lt "$BACKUP_QUIESCE_SEC" ]; do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$BACKUP_LOOP_PID" 2>/dev/null; then
      log_error "yedek döngüsü ${BACKUP_QUIESCE_SEC} sn'de durmadı; kapanış yedeği kilidi bekleyecek"
    fi
  fi
  local pid
  for pid in "${APP_PIDS[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${APP_PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  backup_now force || true
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  log "kapandı"
  exit "$code"
}
trap 'shutdown 0' TERM INT

# --- PostgreSQL -------------------------------------------------------------------------------------

mkdir -p "$PGDATA" "$UPLOAD_DIR"
chmod 700 "$PGDATA"
# Yerinde yeniden başlatmada /tmp kalabilir: yarıda kesilmiş yedeğin dökümü birikir, mkdir kilidi takılı kalır (burada
# yedek çalışmıyor, DB_READY=0). Durum dosyasının KENDİSİ silinmez: son başarılı yedek zamanı gerçek bilgidir.
rm -rf "$BACKUP_LOCK_FILE.d" && rm -f /tmp/yedek-db.* /tmp/yedek-uploads.* /tmp/geri-db.* /tmp/geri-uploads.* "$BACKUP_STATE_FILE".* || true
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
log "PostgreSQL çalışıyor (veri dönemi: ${DATA_EPOCH:-öneksiz})"

# Taze açılış kapısı: "taze" dala YALNIZ gerçekten veri yokken girilir. Veritabanı duruyor ve içinde gerçek veri varsa
# üzerine ne geri yükleme ne seed gider; varken boşsa (gerçek veri olmadığı KANITLI) veritabanı sıfırdan kurulup geri
# yükleme yeniden denenir. Yedek hiç bulunamazsa R2'ye yazma kapanır (BACKUP_ARMED=0): yanlış bir DATA_EPOCH veriyi ezemez.
fresh=0
# ÖNCE yarım geri yükleme izi: varsa satır sayısı HİÇBİR ŞEY KANITLAMAZ (yarım döküm de "gerçek veri" gibi görünür,
# çok erken kesilmişse boş görünür). Bu yüzden sayıya bakılmadan "yarım" kabul edilir, yedek zinciri DONDURULUR,
# uyarı gönderilir ve elle müdahale beklenir (docs/17 §2.8). Geri yükleme YENİDEN DENENMEZ, ama migration ve seed
# aşağıda olduğu gibi çalışır (akış bilerek değiştirilmedi): yarım şema değişebilir, R2 ise her durumda korunur.
if [ -e "$RESTORE_FLAG_FILE" ]; then
  BACKUP_FROZEN=1
  rows=$(real_data_rows)
  log_error "YARIM GERİ YÜKLEME: önceki açılışta geri yükleme tamamlanmadı ($RESTORE_FLAG_FILE duruyor: $(tr -d '\n' <"$RESTORE_FLAG_FILE" 2>/dev/null || echo okunamadi)). Veritabanı YARIM olabilir (gerçek veri sayısı: ${rows:-okunamadi}); R2'ye yazma DONDURULDU, iyi yedek korunuyor. Elle müdahale gerekiyor — docs/17 §2.8"
  send_alert yarim_geri_yukleme \
    "Yarim geri yukleme izi acilista bulundu: veritabani yarim olabilir, R2 yedek zinciri donduruldu, elle mudahale gerekiyor (docs/17 2.8)" \
    "{\"epoch\":\"${DATA_EPOCH:-}\",\"gercekVeriSatiri\":\"${rows:-okunamadi}\",\"isaret\":\"$RESTORE_FLAG_FILE\"}"
  backup_state_write atlandi yarim-geri-yukleme
elif psql -d postgres -Atc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
  rows=$(real_data_rows)
  case "$rows" in
    0)
      log "veritabanı var ama gerçek veri yok: yedekten geri yükleme deneniyor"
      # Şeması kurulu boş bir veritabanına `pg_restore --exit-on-error` çakışma hatası verir ("zaten var") ve
      # restore_abort bir tur kesinti yazardı. Gerçek veri olmadığı kanıtlı olduğundan (rows=0) veritabanını düşürüp
      # boşundan kuruyoruz: tek turda temiz geri yükleme, container boşuna çökmez.
      if dropdb --if-exists "$DB_NAME" >/dev/null 2>&1 && createdb "$DB_NAME"; then
        log "boş veritabanı sıfırdan kuruldu (önceki turun şema kalıntısı silindi)"
      else
        log_error "boş veritabanı sıfırdan kurulamadı: geri yükleme yine de denenecek (çakışırsa container yeniden başlar)"
      fi
      restore_from_backup
      ;;
    '')
      log_error "veritabanı sorgulanamadı; 'veri var' sayılıyor: geri yükleme atlandı (üzerine yazmıyoruz)"
      ;;
    *)
      log "veritabanında gerçek veri var ($rows satır): yedekten geri yükleme atlandı"
      ;;
  esac
else
  createdb "$DB_NAME"
  restore_from_backup
fi
DB_READY=1
if [ "$fresh" = 1 ]; then
  BACKUP_ARMED=0
fi

cd "$APP_DIR/apps/api"
log "migration"
# Göç hatası ÖLÜMCÜLDÜR: yarım şemayla açılmak hem API'yi bozar hem de döngünün yarım veriyi R2'ye yazması demektir
if ! node --import tsx "$APP_DIR/packages/db/src/migrate.ts"; then
  log_error "migration başarısız: container açılmıyor (aşağı göç yoktur; dökümü yeni döneme yükleyin — docs/15 §13)"
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
  exit 1
fi
# Seed her açılışta çalışır ve idempotenttir. admin kipinde yalnız platform yöneticisi + bayraklar (var olana dokunmaz,
# parolası DEV_PASSWORD'e eşitlenir); demo kipinde işletme başına (var olan demo işletme atlanır). Yedekten dönen ortamda
# seed hatası açılışı durdurmaz: site var olan veriyle açılır.
log "seed (SEED_MODE=${SEED_MODE:-demo}; var olanlar atlanır)"
if [ "$fresh" = 1 ]; then
  node --import tsx "$APP_DIR/packages/db/src/seed.ts"
else
  node --import tsx "$APP_DIR/packages/db/src/seed.ts" || log "UYARI: seed başarısız; var olan veriyle devam ediliyor"
fi
# Taze açılışta eskiden hemen `backup_now force` çalışırdı: boş + seed'lenmiş veritabanı R2'deki iyi yedeği (hem
# son.dump hem o günün kopyasını) eziyordu. Artık ilk zorlamalı yedek YOKTUR; yazma gerçek veri gelince açılır.

# --- Uygulamalar ------------------------------------------------------------------------------------

log "api, worker ve web başlatılıyor"
API_PORT=4000 API_HOST=0.0.0.0 NODE_OPTIONS="--max-old-space-size=256" node --import tsx src/server.ts &
APP_PIDS+=($!)
NODE_OPTIONS="--max-old-space-size=192" node --import tsx src/worker.ts &
APP_PIDS+=($!)
(cd "$WEB_DIR" && PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS="--max-old-space-size=256" exec node apps/web/server.js) &
APP_PIDS+=($!)

# Önceki bir açılıştan kalmış olabilecek dur işareti döngüyü hemen bitirmesin
rm -f "$BACKUP_STOP_FILE"
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
