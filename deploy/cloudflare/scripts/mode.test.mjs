// src/mode.ts: kipe göre container ve Worker ayarları (00 §12a madde 10; 15 §13). Çalıştır: npm test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { containerEnv, modeSettings } from '../src/mode.ts';

test('canlı ortam (alan adı kipi): üretim kipi, 2FA zorunlu, geliştirici araçları kapalı ve Worker\'da 404, lead formu açık, dizinlenir', () => {
  assert.deepEqual(modeSettings('domain'), {
    deployEnv: 'production',
    devTools: '0',
    adminTotpRequired: 'true',
    publicLeads: '1',
    noindex: false,
    blockDevTools: true,
  });
});

test('gizli staging: dev kipi (simülatör), 2FA isteğe bağlı, noindex, geliştirici araçları parolanın arkasında', () => {
  assert.deepEqual(modeSettings('staging'), {
    deployEnv: 'dev',
    devTools: '1',
    adminTotpRequired: 'false',
    publicLeads: '1',
    noindex: true,
    blockDevTools: false,
  });
});

const INPUTS = {
  APP_BASE_URL: 'https://yemekgelsin.net',
  APP_VERSION: 'abc123',
  DATA_EPOCH: '3',
  SEED_MODE: 'admin',
  DEV_PASSWORD: 'yonetici-parolasi-123',
  SESSION_SECRET: 's'.repeat(64),
  TRACKING_SECRET: 't'.repeat(43),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  WA_VERIFY_TOKEN: 'a'.repeat(32),
  PLATFORM_WA_WEBHOOK_TOKEN: 'b'.repeat(48),
  VAPID_PUBLIC_KEY: 'p'.repeat(87),
  VAPID_PRIVATE_KEY: 'q'.repeat(43),
};

test('containerEnv canlı ortam: DEPLOY_ENV=production, DEV_TOOLS=0, 2FA zorunlu, lead formu açık, seed admin', () => {
  const env = containerEnv('domain', INPUTS, { PLATFORM_WA_PROVIDER: 'mock' });
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.DEPLOY_ENV, 'production');
  assert.equal(env.DEV_TOOLS, '0');
  assert.equal(env.ADMIN_TOTP_REQUIRED, 'true');
  assert.equal(env.PUBLIC_LEADS_ENABLED, '1');
  assert.equal(env.SEED_MODE, 'admin');
  assert.equal(env.SEED_PASSWORD, INPUTS.DEV_PASSWORD);
  assert.equal(env.DATA_EPOCH, '3');
  assert.equal(env.APP_VERSION, 'abc123');
  assert.equal(env.PLATFORM_WA_PROVIDER, 'mock');
  // Mock'ta gösterim numarası verilmez (canlı vitrinde sahte numara görünmesin)
  assert.equal('PLATFORM_WA_DISPLAY_PHONE' in env, false);
  // WhatsApp ortamı geliştirici araçlarını açamaz
  assert.equal(containerEnv('domain', INPUTS, { PLATFORM_WA_PROVIDER: 'mock', DEV_TOOLS: '1' }).DEV_TOOLS, '0');
  // SEED_MODE tanımsız/geçersizse kipin varsayılanı
  assert.equal(containerEnv('domain', { ...INPUTS, SEED_MODE: undefined }, {}).SEED_MODE, 'admin');
  assert.equal(containerEnv('staging', { ...INPUTS, SEED_MODE: 'x' }, {}).SEED_MODE, 'demo');
});

test('containerEnv gizli staging: DEPLOY_ENV=dev, simülatör açık, 2FA isteğe bağlı', () => {
  const env = containerEnv('staging', { ...INPUTS, SEED_MODE: 'demo' }, { PLATFORM_WA_PROVIDER: 'mock' });
  assert.equal(env.DEPLOY_ENV, 'dev');
  assert.equal(env.DEV_TOOLS, '1');
  assert.equal(env.ADMIN_TOTP_REQUIRED, 'false');
  assert.equal(env.SEED_MODE, 'demo');
});

test('Worker ortamı containerEnv ile kurar; eski sabit değerler (DEPLOY_ENV dev, 2FA kapalı) kalmadı', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /this\.envVars = containerEnv\(mode,/);
  assert.doesNotMatch(src, /ADMIN_TOTP_REQUIRED: 'false'/);
  assert.doesNotMatch(src, /env\.DEPLOY_ENV/);
});

test('entrypoint.sh: yedek 2 dakikada bir (değişiklik varsa), kapanışta her durumda', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  assert.match(sh, /BACKUP_INTERVAL_SEC="\$\{BACKUP_INTERVAL_SEC:-120\}"/);
  assert.match(sh, /backup_now force \|\| true\n  pg_ctl/);
  assert.match(sh, /relname <> 'jobs'/);
});

// Yedek zinciri (docs/denetim-2026-10-04-uretim-hazirlik.md FAZ 1.1 + 1.2; docs/15 §13). Kabuk betiği burada
// metin olarak sınanır: container'ı ve R2'yi ayağa kaldırmadan bozulmaması gereken sözleşmeleri çiviler.
test('entrypoint.sh yedek zinciri: her döküm kendi geçici dosyasına, yüklemeden ÖNCE doğrulama, tek yazıcı kilidi', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  // Sabit /tmp/yedek.dump kalmadı: kapanış yedeği ile döngü yedeği aynı dosyaya yazamaz
  assert.doesNotMatch(sh, /dump=\/tmp\/yedek\.dump/);
  assert.match(sh, /dump=\$\(mktemp \/tmp\/yedek-db\.XXXXXX\)/);
  assert.match(sh, /tarball=\$\(mktemp \/tmp\/yedek-uploads\.XXXXXX\)/);
  // Doğrulama upload_backup'tan ÖNCE gelir: döküm okunamıyorsa R2'ye hiç yazılmaz (iyi kopya korunur)
  assert.match(sh, /elif ! pg_restore --list "\$dump" >\/dev\/null 2>&1; then/);
  assert.match(sh, /elif ! tar -tzf "\$tarball" >\/dev\/null 2>&1; then/);
  const dbBlock = sh.slice(sh.indexOf('dump=$(mktemp'), sh.indexOf('rm -f "$dump"'));
  assert.ok(dbBlock.indexOf('pg_restore --list') < dbBlock.indexOf('upload_backup db'));
  // Tek yazıcı: kilit + kapanışta döngüyü önce durdurup bitmesini bekleme
  assert.match(sh, /backup_lock\(\) \{/);
  assert.match(sh, /flock -w "\$BACKUP_LOCK_WAIT_SEC" 9/);
  assert.match(sh, /: >"\$BACKUP_STOP_FILE"/);
  assert.match(sh, /\[ "\$waited" -lt "\$BACKUP_QUIESCE_SEC" \]/);
  // Açılışta önceki turdan kalan geçici döküm ve kilit süpürülür; durum dosyasının KENDİSİ korunur
  assert.match(sh, /rm -rf "\$BACKUP_LOCK_FILE\.d" && rm -f \/tmp\/yedek-db\.\* \/tmp\/yedek-uploads\.\* \/tmp\/geri-db\.\* \/tmp\/geri-uploads\.\* "\$BACKUP_STATE_FILE"\.\*/);
  assert.doesNotMatch(sh, /rm -f "\$BACKUP_STATE_FILE"$/m);
  // Kapanış yedeği hâlâ her durumda alınır ve hemen ardından PostgreSQL kapanır
  assert.match(sh, /backup_now force \|\| true\n  pg_ctl/);
});

test('entrypoint.sh yedek hatası sessiz kalmaz: [ERROR] satırı + /tmp/yedek-durum.json durum dosyası', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  assert.match(sh, /log_error\(\) \{ echo "\[ERROR\] \[baslat\]/);
  assert.match(sh, /BACKUP_STATE_FILE="\$\{BACKUP_STATE_FILE:-\/tmp\/yedek-durum\.json\}"/);
  // Sağlık ucunun okuduğu alanlar ve sıra (backup_state_prev aynı sırayı geri okur)
  assert.match(sh, /"lastSuccessUnix":%s,"lastAttemptUnix":%s,"consecutiveFailures":%s,"lastResult":"%s"/);
  assert.match(sh, /mv -f "\$tmp" "\$BACKUP_STATE_FILE"/);
  // Her hata yolu hem loglanır hem durum dosyasına işlenir
  for (const re of [/backup_state_write hata yedek-hatasi/, /backup_state_write atlandi kilit-alinamadi/,
    /backup_state_write ok yuklendi/, /backup_state_write ok degismedi/]) assert.match(sh, re);
  assert.equal(sh.includes('log "veritabanı yedeği yazılamadı"'), false);
  assert.equal(sh.includes('log "pg_dump başarısız"'), false);
});

test('entrypoint.sh taze açılış kapısı: boş veritabanı R2\'deki iyi yedeği ezemez', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  // fresh=1 dalında zorlamalı ilk yedek YOK (eskiden boş + seed'lenmiş veritabanını hemen R2'ye yazıyordu)
  assert.doesNotMatch(sh, /if \[ "\$fresh" = 1 \]; then\n {2}backup_now force/);
  // Yazma izni bayrağı: taze açılışta kapanır, gerçek veri gelince backup_run açar
  assert.match(sh, /^BACKUP_ARMED=1$/m);
  assert.match(sh, /if \[ "\$fresh" = 1 \]; then\n {2}BACKUP_ARMED=0\n/);
  assert.match(sh, /if \[ "\$BACKUP_ARMED" = 0 \]; then/);
  // Gerçek veri ölçüsü: seed'in kurduğu yönetici ve bayraklar sayılmaz
  assert.match(sh, /real_data_rows\(\) \{/);
  for (const t of ['public.tenants', 'public.orders', 'public.leads', 'totp_enabled_at is not null']) {
    assert.ok(sh.includes(t), `real_data_rows içinde eksik: ${t}`);
  }
  // Veritabanı doluysa üzerine geri yükleme/seed gitmez; sorgu okunamazsa "veri var" sayılır (fail-closed)
  assert.match(sh, /gerçek veri var \(\$rows satır\): yedekten geri yükleme atlandı/);
  assert.match(sh, /'veri var' sayılıyor: geri yükleme atlandı/);
});

test('entrypoint.sh geri yükleme ve migration hatası açılışı DURDURUR (yarım veriyle açılmaz)', () => {
  const sh = readFileSync(new URL('../entrypoint.sh', import.meta.url), 'utf8');
  // İnen döküm geri yüklemeden önce doğrulanır, geri yükleme sessizce atlamaz
  assert.match(sh, /pg_restore --no-owner --no-privileges --exit-on-error -d "\$DB_NAME" "\$dump"/);
  // Yarım veritabanı bırakılmaz: düşür + PostgreSQL'i kapat + sıfır dışı çık
  assert.match(sh, /restore_abort\(\) \{\n {2}dropdb --if-exists "\$DB_NAME"/);
  assert.equal((sh.match(/restore_abort$/gm) || []).length, 3);
  // Göç hatası ölümcül (set -e'ye bırakılmadı, açıkça loglanıp çıkılıyor)
  assert.match(sh, /if ! node --import tsx "\$APP_DIR\/packages\/db\/src\/migrate\.ts"; then/);
  assert.match(sh, /log_error "migration başarısız: container açılmıyor/);
  // Görsellerin geri yüklenememesi artık sessiz değil (ama ölümcül de değil)
  assert.match(sh, /log_error "görsel yedeği açılamadı/);
});
