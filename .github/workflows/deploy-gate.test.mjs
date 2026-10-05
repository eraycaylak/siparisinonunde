// Dağıtım kapısının DEĞİŞMEZLERİ (denetim 2026-10-04 · B4, B5 · FAZ 0.5 + 0.6 + 0.7).
//
// Bu dosya iş akışı YAML'larını veri olarak okur ve kapının sökülmediğini doğrular. Davranışsal karşılığı şudur:
// kapıyı kaldıran (testleri koşmayı bırakan, `needs: testler`i silen, geri alma adımını çıkaran) ya da test
// veritabanının adresini iş akışıyla kod arasında UYUMSUZ hâle getiren bir değişiklik buradan kırmızı döner.
// Kapı kırmızı → dağıtım hiç başlamaz, yani bu testin kendisi de dağıtımdan önce koşar (testler.yml son adım).
//
// Neden YAML ayrıştırıcısı yok: deponun kökünde `yaml` bağımlılığı yok (vitest/wrangler altındaki kopyaya güvenmek
// kırılgan olurdu). Bunun yerine metin üzerinde çapa (anchor) denetimi + GERÇEK kaynak dosyalarla çapraz karşılaştırma
// yapılır; değerli kısım ikincisidir: apps/api/test/helpers.ts'teki varsayılan değişirse CI servisi sessizce yanlış
// veritabanına bağlanmaz, bu test kırmızı yanar.
//
// Çalıştır: node --test .github/workflows/deploy-gate.test.mjs  (testler.yml "Dağıtım kapısı değişmezleri" adımı)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const GATE = '.github/workflows/testler.yml';
const CF = '.github/workflows/deploy-dev-cloudflare.yml';
const VPS = '.github/workflows/deploy-production.yml';
/** İki dağıtım iş akışı: ikisinde de aynı kapı ve aynı politika olmalı. */
const DEPLOY_WORKFLOWS = [CF, VPS];

const gate = read(GATE);
const files = new Map([
  [GATE, gate],
  [CF, read(CF)],
  [VPS, read(VPS)],
]);
const src = (p) => files.get(p);

/** "şu metni aynen içeriyor mu" denetimi (girintiyi de kapsar: çapa metinleri girintisiz yazılır). */
function has(text, needle) {
  return text.includes(needle);
}

test('kapı iş akışı çağrılabilir ve elle çalıştırılabilir, `ref` girdisi alır', () => {
  assert.ok(has(gate, 'workflow_call:'), 'testler.yml `workflow_call` ile çağrılabilir olmalı');
  assert.ok(has(gate, 'workflow_dispatch:'), 'kapı dağıtmadan elle de koşulabilmeli');
  // `ref`: geri alma dağıtımında kapı, dalın son hâlinin değil DAĞITILAN sürümün testlerini koşmalı.
  assert.ok(/inputs:\s*\n\s*ref:/.test(gate), 'kapı `ref` girdisi almalı');
  assert.ok(has(gate, "ref: ${{ inputs.ref || github.sha }}"), 'kapı checkout adımı `ref` girdisini kullanmalı');
});

test('kapı gerçek PostgreSQL 16 servisiyle koşar ve sağlık kontrolü bekler', () => {
  assert.ok(has(gate, 'image: postgres:16'), 'PostgreSQL 16 servisi olmalı (üretimdeki sürüm)');
  assert.ok(has(gate, '--health-cmd'), 'servis sağlık komutu olmalı: GitHub, healthy olana kadar adımları başlatmaz');
  assert.ok(has(gate, 'pg_isready'), 'sağlık komutu pg_isready olmalı');
  assert.ok(/--health-retries\s+\d+/.test(gate), 'sağlık denemesi sayısı verilmeli');
  assert.ok(has(gate, '- 5432:5432'), '5432 runner üzerine açılmalı (testler localhost üzerinden bağlanır)');
});

test('servis kimlik bilgileri apps/api/test/helpers.ts varsayılanıyla birebir aynı', () => {
  // Kapının en kolay sessizce bozulacağı yer burası: helpers.ts varsayılanı değişirse testler CI'da var olmayan bir
  // veritabanına bağlanmaya çalışır ve 897 vaka "bağlantı hatası" diye kırmızı yanar (ya da yanlış veritabanına yazar).
  const helpers = read('apps/api/test/helpers.ts');
  const m = helpers.match(/TEST_DATABASE_URL\s*=\s*process\.env\.TEST_DATABASE_URL\s*\?\?\s*'([^']+)'/);
  assert.ok(m, 'apps/api/test/helpers.ts içinde TEST_DATABASE_URL varsayılanı bulunamadı');
  const url = new URL(m[1]);

  assert.equal(url.port, '5432', 'helpers.ts varsayılanı 5432 beklemiyor; servis portunu da güncelleyin');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'test veritabanı yerel olmalı');
  const dbName = url.pathname.replace(/^\//, '');

  assert.ok(has(gate, `POSTGRES_USER: ${url.username}`), `servis POSTGRES_USER=${url.username} olmalı (helpers.ts)`);
  assert.ok(has(gate, `POSTGRES_PASSWORD: ${url.password}`), 'servis POSTGRES_PASSWORD helpers.ts ile aynı olmalı');
  assert.ok(has(gate, `POSTGRES_DB: ${dbName}`), `servis POSTGRES_DB=${dbName} olmalı (helpers.ts)`);
  assert.ok(has(gate, `TEST_DATABASE_URL: ${m[1]}`), 'kapıdaki TEST_DATABASE_URL helpers.ts varsayılanıyla aynı olmalı');
  assert.ok(has(gate, `pg_isready -U ${url.username} -d ${dbName}`), 'sağlık komutu aynı kullanıcı/veritabanını yoklamalı');

  // Sıfırlama güvenliği: ad *_test kalıbına uymalı (packages/db/src/reset.ts RESETTABLE_DB_NAME), yoksa kapı yalnız
  // ALLOW_DB_RESET=1 sayesinde çalışır ve o bayrak bir gün kalkarsa sessizce kırılır.
  assert.match(dbName, /_(dev|test)(_s\d+)?$/, 'test veritabanı adı sıfırlanabilir kalıba uymalı');
});

test('kapı tür denetimini ve tüm test takımlarını koşar', () => {
  assert.ok(has(gate, 'pnpm typecheck'), 'tür denetimi koşmalı: üretimde tsx ile çalışıyoruz, tür hatası derlemede yakalanmıyor');
  assert.ok(/run:\s*pnpm test\s*$/m.test(gate), 'core + db + api testleri (`pnpm test`) koşmalı');
  assert.ok(has(gate, 'pnpm --filter @siparis/web test'), 'web birim testleri koşmalı');
  assert.ok(has(gate, 'pnpm test:vps'), 'dağıtım betikleri testleri koşmalı');
  assert.ok(has(gate, 'node --test .github/workflows/deploy-gate.test.mjs'), 'kapı kendi değişmezlerini de koşmalı');
  // Geri alma yolu: `ref` ile kapıdan ÖNCEki bir commit'e dönülürse bu dosya çalışma ağacında yoktur. Varlık
  // denetimi olmazsa `node --test` çöker, kapı kırmızı yanar ve ACİL GERİ ALIŞ hiç başlamaz.
  assert.ok(has(gate, 'if [ -f .github/workflows/deploy-gate.test.mjs ]'), 'değişmez adımı dosya varlığını denetlemeli');
  // Veritabanı sıfırlama izni ve üretim koruması (packages/db/src/reset.ts).
  assert.ok(has(gate, "ALLOW_DB_RESET: '1'"), 'CLAUDE.md komutuyla aynı olsun: ALLOW_DB_RESET=1');
  assert.ok(has(gate, 'NODE_ENV: test'), 'NODE_ENV=test olmalı: reset.ts üretimde sıfırlamayı tümden reddeder');
});

test('kapı yasal metin denetimini de koşar (künye, sürüm, yer tutucu)', () => {
  // Künye ve yasal metin sürümü yayına hazır olmadan canlıya çıkılmasın (denetim B1/B2/B12). Adım bugün
  // `continue-on-error: true` ile SARI yanar (gerçek şirket bilgisi girilmedi); bilgiler girilince o satır
  // kaldırılacak. Bu test adımın VARLIĞINI denetler, bu yüzden `continue-on-error` kaldırıldığında da geçer.
  assert.ok(has(gate, 'pnpm check:legal'), 'kapı yasal metin denetimini koşmalı (pnpm check:legal)');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts?.['check:legal'], 'package.json içinde check:legal betiği olmalı');
  // Bulgu varken adım sessiz kalmasın: iş akışı özetine uyarı bloğu yazan adım da yerinde olmalı.
  assert.ok(has(gate, "steps.yasal.outcome != 'success'"), 'bulgu varken iş akışı özetine uyarı yazan adım olmalı');
});

test('kapı pnpm sürümünü package.json packageManager alanından alır (tek kaynak)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.packageManager?.startsWith('pnpm@'), 'package.json packageManager alanı pnpm sürümünü sabitlemeli');
  assert.ok(has(gate, 'pnpm/action-setup@v4'), 'pnpm kurulumu pnpm/action-setup ile yapılmalı');
  // Sürüm iş akışına YAZILMAMALI: iki yerde sabitlenirse biri eskir ve lockfile uyuşmazlığı CI'da patlar.
  const pinned = pkg.packageManager.split('@')[1];
  assert.ok(!has(gate, `version: ${pinned}`), 'pnpm sürümü iş akışında ikinci kez sabitlenmemeli');
});

test('kapı ile dağıtım işleri aynı Node sürümünü kullanır', () => {
  const engines = JSON.parse(read('package.json')).engines?.node ?? '';
  assert.match(engines, /22/, 'package.json engines.node 22 bekliyor olmalı');
  for (const [name, text] of files) {
    const versions = [...text.matchAll(/node-version:\s*(\S+)/g)].map((x) => x[1]);
    assert.ok(versions.length > 0, `${name}: setup-node adımı yok`);
    for (const v of versions) {
      assert.equal(v, '22', `${name}: node-version ${v}; depo 22 kullanıyor`);
    }
  }
});

test('her iki dağıtım iş akışı kapıyı çağırır ve BEKLER', () => {
  for (const name of DEPLOY_WORKFLOWS) {
    const text = src(name);
    assert.ok(has(text, 'uses: ./.github/workflows/testler.yml'), `${name}: kapı iş akışını çağırmıyor`);
    // Kapı kırmızıysa GitHub başarısız bir `needs` işinden sonraki işi çalıştırmaz → dağıtım HİÇ başlamaz.
    assert.ok(has(text, 'needs: [kontrol, testler]'), `${name}: deploy işi "needs: [kontrol, testler]" olmalı`);
    // `if:` içinde always()/success() hileleri kapıyı etkisiz kılar.
    assert.ok(!/if:.*always\(\)/.test(text.split('\n').filter((l) => l.includes('needs.kontrol.outputs.ready')).join('\n')),
      `${name}: deploy işinin if'inde always() olmamalı, yoksa kapı etkisiz kalır`);
    assert.ok(has(text, 'ref: ${{ inputs.ref || github.sha }}'), `${name}: kapı dağıtılan sürümün testlerini koşmalı`);
  }
});

test('her iki dağıtım iş akışı elle sürüm seçmeye (`ref`) izin verir', () => {
  for (const name of DEPLOY_WORKFLOWS) {
    const text = src(name);
    assert.ok(/workflow_dispatch:\s*\n\s*inputs:/.test(text), `${name}: workflow_dispatch girdisi yok`);
    assert.ok(/\n\s{6}ref:\n/.test(text), `${name}: \`ref\` girdisi yok (elle geri alma yolu)`);
    assert.ok(has(text, 'ref: ${{ inputs.ref || github.sha }}'), `${name}: checkout \`ref\` girdisini kullanmıyor`);
  }
});

test('iki dağıtım iş akışı AYNI eşzamanlılık grubunda ve yarım dağıtım kesilmiyor', () => {
  // İkisi de yemekgelsin.net'e dağıtıyor; üst üste çalışırlarsa iki ayrı veritabanında iki ayrı sipariş gerçeği
  // oluşur (denetim bulgu 17, split-brain).
  const groups = DEPLOY_WORKFLOWS.map((name) => src(name).match(/concurrency:\s*\n\s*group:\s*(\S+)/)?.[1]);
  assert.ok(groups[0], `${CF}: concurrency grubu yok`);
  assert.equal(groups[0], groups[1], 'iki dağıtım iş akışının eşzamanlılık grubu aynı olmalı');
  for (const name of DEPLOY_WORKFLOWS) {
    assert.ok(has(src(name), 'cancel-in-progress: false'), `${name}: yarım dağıtım iptal edilmemeli`);
  }
});

test('her iki dağıtım işi production ortamından geçer (zorunlu inceleyici buradan açılır)', () => {
  for (const name of DEPLOY_WORKFLOWS) {
    assert.ok(has(src(name), 'environment: production'), `${name}: deploy işi \`environment: production\` demiyor`);
  }
});

test('Cloudflare yolunda duman testi kırmızıysa otomatik geri alma var', () => {
  const text = src(CF);
  assert.ok(has(text, 'wrangler rollback'), 'geri alma adımı yok');
  // --message verildiğinde wrangler onay/mesaj için etkileşimli soru sormaz; CI'da şart.
  assert.ok(/wrangler rollback[^\n]*--message/.test(text), 'wrangler rollback --message ile çağrılmalı (etkileşimsiz)');
  // Yalnız dağıtım DENENDİYSE koşar; iş zaman aşımına düşse/kesilse de koşar (fail-open olmasın); duman testi
  // YEŞİL geçtikten sonra eklenen bir adım kırmızı yanarsa SAĞLAM dağıtımı geri almaz.
  assert.ok(
    has(
      text,
      "if: ${{ (failure() || cancelled()) && steps.dagit.outputs.attempted == 'true' && steps.duman.outcome != 'success' }}",
    ),
    'geri alma koşulu: (failure() || cancelled()) + attempted + duman testi yeşil DEĞİLSE',
  );
  assert.ok(/^\s+id: duman$/m.test(text), 'duman testi adımının `id: duman` kimliği olmalı (geri alma koşulu okur)');
  // Dağıtım denendi işareti, wrangler deploy'dan ÖNCE yazılmalı: wrangler Worker'ı imaj/rollout adımlarından önce
  // etkinleştirir, deploy hata verse bile yeni Worker canlı olabilir.
  const flag = text.indexOf('attempted=true');
  const deploy = text.indexOf('npx wrangler deploy');
  assert.ok(flag > 0 && deploy > 0 && flag < deploy, '`attempted=true` işareti wrangler deploy satırından önce olmalı');
  // Operatöre yarım geri alışın sınırı yazılmalı: container imajı ve veritabanı geri ALINMIYOR.
  assert.ok(has(text, 'Container imajı geri ALINMADI'), 'özet, container imajının geri alınmadığını söylemeli');
  assert.ok(has(text, 'Veritabanı geri alınmadı'), 'özet, veritabanının geri alınmadığını söylemeli');
  assert.ok(has(text, '$GITHUB_STEP_SUMMARY'), 'geri alma sonucu iş akışı özetine yazılmalı');
});

test('Cloudflare duman testi GERÇEKTEN dağıtılan sürümü arar (github.sha değil)', () => {
  // `ref` ile eski bir sürüme dönüldüğünde github.sha iş akışını tetikleyen commit'tir. APP_VERSION ve duman
  // testinin karşılaştırması bunu kullanırsa geri alma dağıtımı 20 dk boyunca hiç gelmeyecek bir sürümü bekler.
  const text = src(CF);
  assert.ok(has(text, 'APP_VERSION="$DEPLOY_SHA"'), 'APP_VERSION dağıtılan commit olmalı');
  assert.ok(has(text, 'DEPLOY_SHA=$sha'), 'dağıtılan commit `git rev-parse HEAD` ile belirlenmeli');
  assert.ok(!/"\$ver"\s*=\s*"\$GITHUB_SHA"/.test(text), 'duman testi sürüm karşılaştırması $GITHUB_SHA kullanmamalı');
  assert.ok(/"\$ver"\s*=\s*"\$DEPLOY_SHA"/.test(text), 'duman testi $DEPLOY_SHA ile karşılaştırmalı');
});

test('`ref` girdisi hiçbir kabuk komutuna gömülmüyor (betik enjeksiyonu)', () => {
  // `workflow_dispatch` girdisi serbest metindir. `run:` içine `${{ inputs.ref }}` yazmak, iş akışını çalıştırabilen
  // birine runner üzerinde komut çalıştırma imkânı verir — ve bu runner'da CLOUDFLARE_API_TOKEN ile SSH parolası var.
  // İzinli tek kullanım: `with: ref:` (actions/checkout ve kapı çağrısı), yani `uses:` adımlarının parametresi.
  for (const [name, text] of files) {
    const uses = text.split('\n').filter((l) => l.includes('${{ inputs.ref'));
    assert.ok(uses.length > 0, `${name}: \`ref\` girdisi hiç kullanılmıyor`);
    for (const line of uses) {
      assert.match(line, /^\s*ref:\s*\$\{\{/, `${name}: \`inputs.ref\` yalnız "ref:" parametresinde kullanılabilir → ${line.trim()}`);
    }
  }
});

test('dağıtım iş akışlarında gizli değer ya da kişisel veri sabitlenmemiş', () => {
  // CLAUDE.md kural 7 ve görev kısıtı: sırlar, gerçek telefon/adres koda yazılmaz.
  for (const [name, text] of files) {
    // Yorum satırlarındaki örnek numara (ör. "905321234567") kasıtlı belgedir; secret ATAMASI olmamalı.
    const assignments = text
      .split('\n')
      .filter((l) => /^\s*(WA_PHONE|VPS_PASSWORD|DEV_PASSWORD|ADMIN_PASSWORD|CLOUDFLARE_API_TOKEN|TWILIO_AUTH_TOKEN|D360_API_KEY|META_WA_TOKEN|META_APP_SECRET|SSHPASS):/.test(l))
      .filter((l) => !/\$\{\{\s*secrets\./.test(l));
    assert.deepEqual(assignments, [], `${name}: gizli değer secret dışından geliyor → ${assignments.join(' | ')}`);
  }
});
