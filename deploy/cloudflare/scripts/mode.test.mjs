// src/mode.ts: kipe göre container ve Worker ayarları (00 §12a madde 10; 15 §13). Çalıştır: npm test.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { containerEnv, modeSettings } from '../src/mode.ts';
import { stripJsonc } from './jsonc.mjs';

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

// --- Beyaz liste kapısı (denetim 2026-10-04 sonrası; 15 §13) -----------------------------------------
// containerEnv KAPALI bir beyaz listedir: orada yazmayan hiçbir Worker vars/secret'ı container'a geçmez.
// Faz 0–4'te eklenen künye, canary ve WhatsApp kotası değişkenleri listeye yazılmadığı için canlıda hiç
// devreye girmemişti — künye eksik kalınca sipariş ucu kalıcı 503 döndüğü, duman testi de sipariş ucunu
// denemediği için dağıtım YEŞİL yanarken vitrin sipariş almıyordu. Aşağıdaki vakalar aynı sapmayı bir daha
// sessiz bırakmaz: apps/api'nin OKUDUĞU her ortam değişkeni ya containerEnv çıktısında olmalı ya da
// GEREKÇESİYLE kapsam dışı listesinde bulunmalıdır. Yeni bir değişken eklerken bu test kırmızı yanar.

const ROOT = new URL('../../../', import.meta.url);

/** apps/api/src altındaki tüm .ts dosyalarının içeriği (tek dizge; adayları adıyla arar). */
function apiSourceText() {
  const dir = new URL('apps/api/src/', ROOT);
  const names = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  return names
    .filter((n) => n.endsWith('.ts'))
    .map((n) => readFileSync(new URL(n, dir), 'utf8'))
    .join('\n');
}

/** configSchema'nın (apps/api/src/config.ts) üst düzey anahtarları. */
function configSchemaKeys() {
  const src = readFileSync(new URL('apps/api/src/config.ts', ROOT), 'utf8');
  const start = src.indexOf('export const configSchema = z.object({');
  assert.ok(start > 0, 'apps/api/src/config.ts içinde configSchema bulunamadı (ad değişti mi?)');
  const block = src.slice(start, src.indexOf('\n});', start));
  const keys = [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
  assert.ok(keys.length > 20, `configSchema anahtarları okunamadı (${keys.length} bulundu)`);
  return keys;
}

/** Kaynakta `env.X` / `process.env.X` / `env['X']` olarak okunan BÜYÜK_HARF değişken adları. */
function envNamesReadIn(text) {
  return [...text.matchAll(/(?:process\.)?env(?:\.|\[')([A-Z][A-Z0-9_]{2,})/g)].map((m) => m[1]);
}

/** Dizge dizisi içeren bir TypeScript sabitinin elemanları (ör. REQUIRED_LEGAL_ENTITY_ENVS). */
function stringArrayConst(path, name) {
  const src = readFileSync(new URL(path, ROOT), 'utf8');
  const start = src.indexOf(`${name} = [`);
  assert.ok(start > 0, `${path} içinde ${name} bulunamadı (ad değişti mi?)`);
  const block = src.slice(start, src.indexOf(']', start));
  return [...block.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]);
}

/**
 * Container'a BİLEREK geçirilmeyen değişkenler ve gerekçeleri. Buraya bir ad eklemek "bu değişken canlı
 * ortamda tanımsız kalacak" demektir; gerekçesi olmayan hiçbir ad eklenmemelidir.
 */
const SCOPE_OUT = new Map([
  ['DATABASE_URL', 'entrypoint.sh container içindeki PostgreSQL için kurar (127.0.0.1)'],
  ['TEST_DATABASE_URL', 'yalnız yerel test koşumu'],
  ['API_PORT', 'entrypoint.sh sabit 4000 verir (Worker da bu portu proxy\'ler)'],
  ['API_HOST', 'entrypoint.sh sabit 0.0.0.0 verir'],
  ['WEB_PORT', 'Dockerfile/entrypoint.sh sabit 3000 verir'],
  ['WA_APP_SECRET', 'src/whatsapp-env.ts sağlayıcıya göre yazar (whatsapp-env.test.mjs sınar)'],
  ['PLATFORM_WA_PROVIDER', 'src/whatsapp-env.ts yazar'],
  ['PLATFORM_WA_API_KEY', 'src/whatsapp-env.ts yazar'],
  ['PLATFORM_WA_PHONE_NUMBER_ID', 'src/whatsapp-env.ts yazar'],
  ['PLATFORM_WA_WABA_ID', 'src/whatsapp-env.ts yazar'],
  ['PLATFORM_WA_DISPLAY_PHONE', 'src/whatsapp-env.ts yazar'],
  ['NETGSM_USERCODE', 'SMS_PROVIDER canlı ortamda mock: Netgsm hesabı bağlanmadı (15 §7)'],
  ['NETGSM_PASSWORD', 'SMS_PROVIDER canlı ortamda mock'],
  ['NETGSM_HEADER', 'SMS_PROVIDER canlı ortamda mock'],
  ['ANTHROPIC_API_KEY', 'Faz 2 (AI); canlı ortamda kapalı'],
  ['BACKUP_STATE_FILE', 'entrypoint.sh varsayılanı /tmp/yedek-durum.json (15 §13)'],
  ['BACKUP_STATUS_FILE', 'yalnız geriye dönük ad; kod BACKUP_STATE_FILE\'ı önce okur'],
  ['HEALTH_MAX_BACKUP_AGE_SEC', 'koddaki varsayılan eşik yeterli (15 §10)'],
  ['HEALTH_MIN_DISK_FREE_PCT', 'koddaki varsayılan eşik yeterli (15 §10)'],
  ['HEALTH_MAX_MEM_USED_PCT', 'koddaki varsayılan eşik yeterli (15 §10)'],
  ['HEALTH_DISK_PATH', 'verilmezse UPLOAD_DIR kullanılır; tek container\'da aynı disk'],
  ['SSE_MAX_PER_BRANCH', 'koddaki varsayılan sınır yeterli'],
  ['SSE_MAX_PER_TENANT', 'koddaki varsayılan sınır yeterli'],
]);

/** Beyaz listedeki her değişkene değer verilmiş girdi: çıktıda hepsi görünmeli. */
const FULL_INPUTS = {
  ...INPUTS,
  ALERT_WEBHOOK_URL: 'https://uyari.example.com/kanca',
  ALERT_MIN_SEVERITY: 'warning',
  LEGAL_ENTITY_NAME: 'ÖRNEK GIDA - AD SOYAD',
  LEGAL_ENTITY_TYPE: 'Şahıs şirketi',
  LEGAL_ENTITY_ADDRESS: 'Örnek Mah. Örnek Sk. No:1, Merkez / Yozgat',
  LEGAL_ENTITY_PHONE: '+90 354 000 00 00',
  LEGAL_ENTITY_TAX_OFFICE: 'Yozgat',
  LEGAL_ENTITY_TAX_NO: '11111111111',
  LEGAL_ENTITY_MERSIS: '0000000000000000',
  LEGAL_ENTITY_CHAMBER: 'Yozgat Ticaret ve Sanayi Odası',
  LEGAL_ENTITY_KEP: 'ornek@hs01.kep.tr',
  LEGAL_SUPPORT_EMAIL: 'destek@yemekgelsin.net',
  CANARY_ENABLED: '1',
  CANARY_STALE_ALERT: '0',
  WABA_CONVERSATION_CAP: '1000',
  WABA_SHED_NONCRITICAL: '1',
};

test('beyaz liste kapısı: apps/api configSchema\'daki her anahtar container\'a geçer ya da gerekçeli kapsam dışıdır', () => {
  const env = containerEnv('domain', FULL_INPUTS, { PLATFORM_WA_PROVIDER: 'mock' });
  const eksik = configSchemaKeys().filter((k) => !(k in env) && !SCOPE_OUT.has(k));
  assert.deepEqual(
    eksik,
    [],
    `containerEnv beyaz listesine eklenmemiş config anahtar(lar)ı: ${eksik.join(', ')}. ` +
      'Container\'a geçmesi gerekiyorsa src/mode.ts ContainerInputs + PASSTHROUGH_KEYS\'e ekleyin; ' +
      'gerekmiyorsa bu testteki SCOPE_OUT listesine GEREKÇESİYLE yazın.',
  );
});

test('beyaz liste kapısı: apps/api kaynağında process.env ile okunan her değişken container\'a geçer ya da gerekçeli kapsam dışıdır', () => {
  const env = containerEnv('domain', FULL_INPUTS, { PLATFORM_WA_PROVIDER: 'mock' });
  const okunan = [...new Set(envNamesReadIn(apiSourceText()))];
  // Regex gerçekten çalışıyor mu (kaynak taşınırsa test sessizce "temiz" görünmesin)
  assert.ok(okunan.includes('CANARY_ENABLED'), 'apps/api kaynağı taranamadı: CANARY_ENABLED bulunamadı');
  const eksik = okunan.filter((k) => !(k in env) && !SCOPE_OUT.has(k));
  assert.deepEqual(eksik, [], `apps/api okuyor ama container'a geçmiyor: ${eksik.join(', ')}`);
});

test('beyaz liste kapısı: künyenin (6563 m.3) tüm alanları container\'a geçer — zorunlusu eksikse sipariş ucu 503', () => {
  const env = containerEnv('domain', FULL_INPUTS, { PLATFORM_WA_PROVIDER: 'mock' });
  // apps/api kapısının zorunlu saydığı alanlar
  const zorunlu = stringArrayConst('apps/api/src/services/orders/legal-gate.ts', 'REQUIRED_LEGAL_ENTITY_ENVS');
  assert.equal(zorunlu.length, 6, `REQUIRED_LEGAL_ENTITY_ENVS 6 alan bekleniyordu, ${zorunlu.length} bulundu`);
  for (const name of zorunlu) assert.ok(name in env, `künye zorunlu alanı container'a geçmiyor: ${name}`);
  // apps/web künye sayfasının okuduğu alanların TAMAMI (isteğe bağlı olanlar da): biri düşerse künyede "Yok" yazar
  const site = readFileSync(new URL('apps/web/lib/site.ts', ROOT), 'utf8');
  const blok = site.slice(site.indexOf('const LEGAL_ENTITY_FIELDS = {'), site.indexOf('} satisfies Record<string, LegalEntityFieldSpec>'));
  const tumu = [...new Set([...blok.matchAll(/env: '([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]))];
  assert.equal(tumu.length, 10, `site.ts LEGAL_ENTITY_FIELDS 10 alan bekleniyordu, ${tumu.length} bulundu`);
  for (const name of tumu) assert.ok(name in env, `künye alanı container'a geçmiyor: ${name}`);
  assert.equal(env.LEGAL_ENTITY_NAME, FULL_INPUTS.LEGAL_ENTITY_NAME);
  assert.equal(env.LEGAL_SUPPORT_EMAIL, 'destek@yemekgelsin.net');
});

test('beyaz liste: boş ve yalnız boşluktan oluşan değer DEĞİŞKEN OLARAK YAZILMAZ (tanımlı-ama-geçersiz üretmez)', () => {
  const env = containerEnv('domain', { ...FULL_INPUTS, LEGAL_ENTITY_MERSIS: '', LEGAL_ENTITY_KEP: '   ', CANARY_ENABLED: undefined }, {});
  assert.equal('LEGAL_ENTITY_MERSIS' in env, false);
  assert.equal('LEGAL_ENTITY_KEP' in env, false);
  assert.equal('CANARY_ENABLED' in env, false);
  // Verilen değerlerin kenar boşlukları kırpılır (kopyala-yapıştır kazası künyeye geçmesin)
  assert.equal(containerEnv('domain', { ...FULL_INPUTS, LEGAL_ENTITY_TAX_NO: ' 11111111111 ' }, {}).LEGAL_ENTITY_TAX_NO, '11111111111');
});

test('beyaz liste: wrangler.jsonc\'ye TIRNAKSIZ girilmiş sayı container\'ı düşürmez (metne çevrilir)', () => {
  // vars elle düzenlenir ve JSON tırnaksız sayıyı kabul eder: `"WABA_CONVERSATION_CAP": 1000`. Worker'da bu bir
  // number'dır; çıplak .trim() Durable Object yapıcısında TypeError atar ve container HİÇ açılmaz (tüm site iner).
  const env = containerEnv('domain', { ...FULL_INPUTS, WABA_CONVERSATION_CAP: 1000, LEGAL_ENTITY_TAX_NO: 11111111111 }, {});
  assert.equal(env.WABA_CONVERSATION_CAP, '1000');
  assert.equal(env.LEGAL_ENTITY_TAX_NO, '11111111111');
  // Değerlerin tamamı dizge olmalı: container ortamı Record<string, string>'dir
  for (const [k, v] of Object.entries(env)) assert.equal(typeof v, 'string', `dizge olmayan değer: ${k}`);
});

test('beyaz liste kip ayarlarını EZEMEZ: DEV_TOOLS, 2FA, DEPLOY_ENV ve seed yalnız kipten gelir', () => {
  const src = readFileSync(new URL('../src/mode.ts', import.meta.url), 'utf8');
  const blok = src.slice(src.indexOf('const PASSTHROUGH_KEYS'), src.indexOf('];', src.indexOf('const PASSTHROUGH_KEYS')));
  for (const korunan of ['DEV_TOOLS', 'DEPLOY_ENV', 'ADMIN_TOTP_REQUIRED', 'SEED_MODE', 'PUBLIC_LEADS_ENABLED', 'NODE_ENV']) {
    assert.equal(blok.includes(`'${korunan}'`), false, `${korunan} beyaz listeye girmemeli: kip ayarı olmaktan çıkar`);
  }
  // Gövdede de beyaz liste kip ayarlarından ÖNCE yazılır (sıra bozulursa elle verilen değer kipi ezer)
  assert.ok(src.indexOf('...passthroughEnv(env)') < src.indexOf('DEV_TOOLS: settings.devTools'));
  // Staging'de de aynı: elle verilmiş bir değer 2FA'yı açamaz/kapatamaz
  assert.equal(containerEnv('staging', FULL_INPUTS, {}).ADMIN_TOTP_REQUIRED, 'false');
  assert.equal(containerEnv('domain', FULL_INPUTS, {}).ADMIN_TOTP_REQUIRED, 'true');
});

test('wrangler.jsonc: künye, canary ve kota değişkenleri vars\'ta TANIMLI ama DEĞERİ YAZILI DEĞİL (Eray doldurur)', () => {
  const config = JSON.parse(stripJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
  const vars = config.vars ?? {};
  const beklenen = [
    'LEGAL_ENTITY_NAME', 'LEGAL_ENTITY_TYPE', 'LEGAL_ENTITY_ADDRESS', 'LEGAL_ENTITY_PHONE',
    'LEGAL_ENTITY_TAX_OFFICE', 'LEGAL_ENTITY_TAX_NO', 'LEGAL_ENTITY_MERSIS', 'LEGAL_ENTITY_CHAMBER',
    'LEGAL_ENTITY_KEP', 'LEGAL_SUPPORT_EMAIL', 'CANARY_ENABLED', 'CANARY_STALE_ALERT',
    'WABA_CONVERSATION_CAP', 'WABA_SHED_NONCRITICAL',
  ];
  for (const name of beklenen) {
    assert.ok(name in vars, `wrangler.jsonc vars içinde eksik: ${name} (operatör nereye yazacağını bulamaz)`);
  }
  // Künye değerleri depoda tutulmaz: boş kalmaları SIFIR sipariş değil, fail-closed 503 demektir (bilinçli)
  assert.equal(vars.LEGAL_ENTITY_NAME, '', 'künye değeri depoya yazılmamalı (şirket belgesinden girilir)');
});

// Künyenin İKİNCİ yarısı: web tarafı. /kunye ve /yasal/* dinamik API kullanmayan sunucu bileşenleridir, yani
// `next build` bunları statik HTML'e çevirir — çalışma zamanı ortam değişkeni o HTML'i DEĞİŞTİREMEZ. Bu yüzden
// künye, isteğe bağlı VPS yolunda derleme argümanı olarak geçer (docker-compose.yml → docker/web.Dockerfile).
// Bu vaka o zinciri çivileyerek "API kapısı açıldı ama sayfa hâlâ 'Eksik yapılandırma' basıyor" durumunun
// sessizce geri dönmesini engeller (15 §4).
test('künye web derlemesine de geçer: docker-compose web.build.args → docker/web.Dockerfile ARG/ENV (VPS yolu)', () => {
  const site = readFileSync(new URL('apps/web/lib/site.ts', ROOT), 'utf8');
  const blok = site.slice(site.indexOf('const LEGAL_ENTITY_FIELDS = {'), site.indexOf('} satisfies Record<string, LegalEntityFieldSpec>'));
  const alanlar = [...new Set([...blok.matchAll(/env: '([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]))];
  assert.equal(alanlar.length, 10, `site.ts LEGAL_ENTITY_FIELDS 10 alan bekleniyordu, ${alanlar.length} bulundu`);

  const compose = readFileSync(new URL('docker-compose.yml', ROOT), 'utf8');
  const web = compose.slice(compose.indexOf('\n  web:'), compose.indexOf('\n  caddy:'));
  const dockerfile = readFileSync(new URL('docker/web.Dockerfile', ROOT), 'utf8');
  for (const name of alanlar) {
    assert.match(web, new RegExp(`^ {8}${name}: \\$\\{${name}:-\\}$`, 'm'), `docker-compose web.build.args içinde eksik: ${name}`);
    // Derleme aşaması VE çalışma imajı: statik HTML ile çalışan sürecin ortamı tek kaynaktan beslenir
    assert.equal((dockerfile.match(new RegExp(`^ARG ${name}=$`, 'gm')) ?? []).length, 2, `docker/web.Dockerfile'da ${name} için iki ARG bekleniyor (derleme + çalışma imajı)`);
    assert.equal((dockerfile.match(new RegExp(`${name}="\\$${name}"`, 'g')) ?? []).length, 2, `docker/web.Dockerfile'da ${name} ENV olarak iki kez yazılmalı (tırnaklı: adres ve unvan boşluk içerir)`);
  }
  // Künye web servisine ÇALIŞMA zamanı değişkeni olarak verilmez: statik sayfayı değiştirmez, yalnız ayrışma üretir
  const env = web.slice(web.indexOf('    environment:'), web.indexOf('    depends_on:'));
  for (const name of alanlar) assert.equal(env.includes(name), false, `web.environment künye taşımamalı: ${name}`);
});
