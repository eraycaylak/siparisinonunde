// entrypoint.sh — yarım geri yükleme kapısı (04.10.2026 denetimi, dört mercek turu HIGH + MEDIUM).
//
// Kanıtlanan senaryo: `pg_restore` sürerken container zorla ölürse açılışta yarım veritabanı "gerçek veri" sayılıyor
// ve 120 saniye içinde alınan yedek R2'deki İYİ `son.dump`'ın ve o günün kopyasının üzerine yazılıyordu. İkinci bulgu:
// "veritabanı var ama 0 satır" dalında şeması kurulu bir DB'ye `pg_restore --exit-on-error` çakışıyor → bir tur kesinti.
//
// Kabuk betiği burada METİN olarak sınanır (mode.test.mjs'teki entrypoint.sh testleriyle aynı yaklaşım): container'ı,
// PostgreSQL'i ve R2'yi ayağa kaldırmadan bozulmaması gereken sözleşmeleri çiviler. Çalıştır: node --test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');

test('geri yükleme izi KALICI yerde: /tmp değil, PGDATA\'nın yanı (yerinde yeniden başlatmada /tmp silinebilir)', () => {
  assert.match(sh, /RESTORE_FLAG_FILE="\$\{RESTORE_FLAG_FILE:-\$\(dirname "\$PGDATA"\)\/geri-yukleme-suruyor\}"/);
  // İşaret /tmp altında OLMAMALI: yarım veritabanı PGDATA'da ayakta kalırken iz silinirse koruma yok sayılır
  assert.doesNotMatch(sh, /RESTORE_FLAG_FILE="\$\{RESTORE_FLAG_FILE:-\/tmp/);
  // Açılıştaki /tmp süpürmesi izi silmez (süpürülen dosyalar tek tek sayılıdır, joker dizin değil)
  const sweep = sh.match(/^rm -rf "\$BACKUP_LOCK_FILE\.d" && rm -f .*$/m);
  assert.ok(sweep, 'açılış süpürme satırı bulunamadı');
  assert.doesNotMatch(sweep[0], /RESTORE_FLAG_FILE|geri-yukleme-suruyor/);
});

test('iz pg_restore\'dan ÖNCE konur, başarıda silinir (sıra bozulamaz)', () => {
  // Yalnız restore_from_backup gövdesine bakılır: restore_flag_clear ayrıca restore_abort içinde de çağrılır
  const fn = sh.slice(sh.indexOf('restore_from_backup() {'), sh.indexOf('# --- Kapanış'));
  const set = fn.indexOf('restore_flag_set');
  const restore = fn.indexOf('pg_restore --no-owner --no-privileges --exit-on-error');
  const clear = fn.indexOf('restore_flag_clear');
  assert.ok(set > 0 && restore > 0 && clear > 0, 'izi koy/geri yükle/izi sil satırları bulunamadı');
  assert.ok(set < restore, 'iz pg_restore çağrısından ÖNCE konmalı');
  assert.ok(restore < clear, 'iz ancak geri yükleme bittikten SONRA silinmeli');
  // İz dosyası diske indirilir: düğüm çökmesinde de kalsın
  assert.match(sh, /restore_flag_set\(\) \{\n {2}if printf 'baslangic=%s epoch=%s\\n'/);
  assert.match(sh, /sync 2>\/dev\/null \|\| true/);
  assert.match(sh, /restore_flag_clear\(\) \{\n {2}rm -f "\$RESTORE_FLAG_FILE"/);
});

test('iz yazılamazsa koruma yerine R2 yazması DONDURULUR (fail-closed)', () => {
  const fn = sh.slice(sh.indexOf('restore_flag_set() {'), sh.indexOf('restore_flag_clear() {'));
  assert.match(fn, /BACKUP_FROZEN=1/);
  assert.match(fn, /log_error "geri yükleme izi yazılamadı/);
  assert.match(fn, /send_alert geri_yukleme_izi_yazilamadi/);
});

test('açılış kapısı izi SATIR SAYISINDAN ÖNCE sorar: yarım veri "gerçek veri" sayılmaz', () => {
  const gate = sh.slice(sh.indexOf('fresh=0'), sh.indexOf('DB_READY=1'));
  // İz kapısı ilk dal; satır sayısı kapısı artık `elif`
  assert.match(gate, /^if \[ -e "\$RESTORE_FLAG_FILE" \]; then$/m);
  assert.match(gate, /^elif psql -d postgres -Atc "select 1 from pg_database where datname = '\$DB_NAME'" \| grep -q 1; then$/m);
  assert.ok(gate.indexOf('[ -e "$RESTORE_FLAG_FILE" ]') < gate.indexOf('rows=$(real_data_rows)'),
    'iz kapısı satır sayısı okunmadan ÖNCE gelmeli');
  // Dört zorunlu davranış: dondur, logla, uyar, durum dosyasına işle
  const branch = gate.slice(gate.indexOf('if [ -e "$RESTORE_FLAG_FILE" ]'), gate.indexOf('elif psql -d postgres'));
  assert.match(branch, /BACKUP_FROZEN=1/);
  assert.match(branch, /log_error "YARIM GERİ YÜKLEME:/);
  assert.match(branch, /send_alert yarim_geri_yukleme/);
  assert.match(branch, /backup_state_write atlandi yarim-geri-yukleme/);
  // Bu dalda veriye DOKUNULMAZ: ne geri yükleme ne de düşürme/kurma çağrısı
  assert.doesNotMatch(branch, /restore_from_backup/);
  assert.doesNotMatch(branch, /dropdb|createdb/);
});

test('donmuş zincir force ile de yazamaz ve kendiliğinden açılmaz (silahsız kipin aksine)', () => {
  assert.match(sh, /^BACKUP_FROZEN=0$/m);
  const run = sh.slice(sh.indexOf('backup_run() {'), sh.indexOf('fp=$(db_fingerprint)'));
  // Dondurma kapısı silahsız kip kapısından ÖNCE: yarım veride satır sayısına hiç bakılmaz
  assert.ok(run.indexOf('[ "$BACKUP_FROZEN" = 1 ]') < run.indexOf('[ "$BACKUP_ARMED" = 0 ]'),
    'BACKUP_FROZEN kapısı BACKUP_ARMED kapısından önce gelmeli');
  assert.match(run, /if \[ "\$BACKUP_FROZEN" = 1 \]; then\n {4}log_error "yedek zinciri DONDURULDU/);
  assert.match(run, /backup_state_write atlandi yarim-geri-yukleme\n {4}return 1/);
  // Donma geri alınmaz: betikte BACKUP_FROZEN'ı 0'a çeken hiçbir satır yoktur (ilk atama dışında)
  assert.equal((sh.match(/BACKUP_FROZEN=0/g) || []).length, 1);
});

test('"şema kurulu + 0 satır" dalı veritabanını sıfırdan kurar (bir tur kesinti biter)', () => {
  const gate = sh.slice(sh.indexOf('fresh=0'), sh.indexOf('DB_READY=1'));
  const zero = gate.slice(gate.indexOf('    0)'), gate.indexOf("    '')"));
  assert.ok(zero.indexOf('dropdb --if-exists "$DB_NAME"') < zero.indexOf('restore_from_backup'),
    'geri yüklemeden ÖNCE düşür+kur gelmeli');
  assert.match(zero, /if dropdb --if-exists "\$DB_NAME" >\/dev\/null 2>&1 && createdb "\$DB_NAME"; then/);
  // Düşürme/kurma başarısızsa açılış yine de denenir; sessiz kalmaz
  assert.match(zero, /log_error "boş veritabanı sıfırdan kurulamadı/);
  assert.match(zero, /restore_from_backup/);
});

test('restore_abort izi YALNIZ yarım veritabanı gerçekten düştüyse siler', () => {
  const fn = sh.slice(sh.indexOf('restore_abort() {'), sh.indexOf('# R2\'deki son yedeği indirip'));
  // dropdb denenir, sonra veritabanı gerçekten gitti mi diye SORULUR
  assert.ok(fn.indexOf('dropdb --if-exists') < fn.indexOf('select 1 from pg_database'));
  assert.match(fn, /else\n {4}restore_flag_clear\n {2}fi/);
  // Düşmediyse iz bilerek bırakılır (sonraki açılış donar) ve bu loglanır
  assert.match(fn, /log_error "yarım veritabanı düşürülemedi: geri yükleme izi bırakıldı/);
  // Kapanış sırası korunur: PostgreSQL durdurulur, sıfır dışı çıkılır
  assert.match(fn, /pg_ctl -D "\$PGDATA" -m fast -w stop >\/dev\/null 2>&1 \|\| true\n {2}exit 1/);
});

test('send_alert: yalnız http/https, kişisel veri yok, açılışı durdurmaz', () => {
  const fn = sh.slice(sh.indexOf('send_alert() {'), sh.indexOf('# Yedek yolu dönemi taşır'));
  assert.match(fn, /url="\$\{ALERT_WEBHOOK_URL:-\}"/);
  assert.match(fn, /http:\/\/\*\|https:\/\/\*\) ;;/);
  assert.match(fn, /''\) return 0 ;;/);
  // apps/api/src/lib/alert.ts ile aynı alan adları; kaynağı `service` ayırır
  assert.match(fn, /"service":"yemekgelsin-container","env":"%s","kind":"%s","severity":"critical","message":"%s","data":%s,"at":"%s"/);
  assert.match(fn, /--max-time 5 -X POST/);
  // Gönderilemezse yalnız loglanır (ateşle-ve-unut: açılış uyarı kanalı yüzünden durmaz)
  assert.match(fn, /log_error "uyarı gönderilemedi \(ALERT_WEBHOOK_URL, \$kind\)/);
  // Uyarı gövdelerinde telefon/adres/isim gibi alan YOKTUR: yalnız dönem, satır sayısı ve işaret yolu
  for (const m of sh.match(/send_alert [a-z_]+ \\?\n?.*/g) || []) {
    assert.doesNotMatch(m, /telefon|phone|adres|address|musteri|customer/i);
  }
});

test('durum dosyası not sözlüğü yeni notu içerir (docs/15 §13 ile aynı liste)', () => {
  assert.match(sh, /kilit-alinamadi, yedek-hatasi, veri-sayisi-okunamadi, yarim-geri-yukleme/);
});
