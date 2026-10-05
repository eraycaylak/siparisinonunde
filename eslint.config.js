// ESLint (flat config) — Yemek Gelsin monorepo'su · denetim 2026-10-04 madde 4.6 (FAZ 4)
//
// NEDEN BU DOSYA VAR
// Depoda 2026-10-05'e kadar HİÇ linter yoktu: 100 bin satırlık TypeScript yalnız `tsc --noEmit` ile denetleniyordu.
// Tür denetimi yakalamadığı iki sınıf hata üretimde pahalıya patlar:
//   1. Beklenmeyen (unhandled) promise — `await` yazılmamış bir yan etki. Fastify/worker tarafında sipariş mesajı
//      sessizce gönderilmez, hata hiçbir yerde görünmez (`@typescript-eslint/no-floating-promises`).
//   2. React kanca (hook) kuralı ihlali — koşullu `useState`, eksik bağımlılık. Panel ekranı rastgele davranır
//      (`react-hooks/rules-of-hooks`).
//
// TASARIM İLKESİ: "kırmızı deniz" yasak.
// Var olan kodu baştan sona yeniden yazdıracak stil kuralları (satır uzunluğu, tek/çift tırnak, `any` yasağı,
// `import` alfabetik sırası) BİLEREK AÇILMADI. `error` seviyesi YALNIZ gerçek hata / güvenlik açığı anlamına gelen
// kurallara ayrıldı; kalan her şey `warn`. Böylece `pnpm lint` çıktısı okunabilir kalır ve CI kapısı ilerde
// `--max-warnings` ile kademe kademe sıkılabilir.
//
// Prettier / biçimlendirme kuralı EKLENMEDİ (bilinçli): depo bugün Prettier kullanmıyor, biçim kuralı eklemek
// tek seferde 100 bin satırı değiştirir ve `git blame`'i kullanılamaz hâle getirir.
//
// Katmanlar (sırayla, sonraki öncekini ezer):
//   0. yoksayılanlar
//   1. tüm TS/TSX: parser + çekirdek "gerçek hata" kuralları + import düzeni
//   2. tür-farkında (type-aware) kurallar — YALNIZ workspace kaynak ağaçlarında (pahalı; aşağıdaki nota bakın)
//   3. apps/web — React 19 + Next 16
//   4. apps/api + worker — Node
//   5. test dosyaları, dağıtım betikleri, .mjs araçları — gevşetmeler
//
// Çalıştır: `pnpm lint` (düzeltmeleri uygula: `pnpm lint:fix`)

import js from '@eslint/js';
import globals from 'globals';
import importX from 'eslint-plugin-import-x';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

/**
 * CLAUDE.md değişmez kural 1: "Yalnız resmi WhatsApp Cloud API." Resmi olmayan kütüphaneler hiçbir koşulda
 * eklenmez. Bu liste o kararı makine kapısına çevirir: bir ajan ya da katkıcı bunlardan birini import ederse
 * lint kırmızı yanar. (Doküman tek başına bunu engellemiyordu.)
 */
const YASAK_WA_KUTUPHANELERI = [
  '@whiskeysockets/baileys',
  'baileys',
  'whatsapp-web.js',
  'venom-bot',
  'wa-automate',
  '@open-wa/wa-automate',
  'evolution-api',
];

const YASAK_WA_MESAJI =
  'Resmi olmayan WhatsApp kütüphanesi (CLAUDE.md değişmez kural 1). Yalnız WhatsAppProvider üzerinden ' +
  'resmi Cloud API / 360dialog / Twilio kullanılır.';

/**
 * Kural `paths` ile DEĞİL `patterns` ile yazılır: `paths` yalnız TAM ad eşler, yani
 * `import { makeWASocket } from '@whiskeysockets/baileys/lib/socket'` kapıdan sızardı.
 * `<ad>` + `<ad>/**` ikilisi alt yol import'unu da yakalar.
 *
 * SINIR (bilerek kabul): kural yalnız ESM `import`/`export … from` ve `import()` ifadelerini görür.
 * `require('baileys')` ile `package.json`'a bağımlılık eklenmesi buradan geçmez — onların kapısı
 * kod incelemesi ve CLAUDE.md'dir.
 */
const YASAK_WA_IMPORT = [
  'error',
  {
    patterns: [
      {
        group: YASAK_WA_KUTUPHANELERI.flatMap((ad) => [ad, `${ad}/**`]),
        message: YASAK_WA_MESAJI,
      },
    ],
  },
];

/** Tür-farkında kuralların koştuğu ağaçlar — her birinin kendi tsconfig.json'ı vardır. */
const TUR_FARKINDA_DOSYALAR = [
  'packages/*/src/**/*.ts',
  'packages/*/test/**/*.ts',
  'apps/api/src/**/*.ts',
  'apps/api/test/**/*.ts',
  'apps/web/app/**/*.{ts,tsx}',
  'apps/web/components/**/*.{ts,tsx}',
  'apps/web/lib/**/*.{ts,tsx}',
  'apps/web/*.ts',
];

export default tseslint.config(
  // ── 0. Yoksayılanlar ──────────────────────────────────────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-*/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/blob-report/**',
      '**/uploads/**',
      // Üretilmiş / elle yazılmamış dosyalar
      'packages/db/drizzle/**',
      // `apps/web/public/**` TAMAMI yoksayılıyordu ve "üretilmiş dosya" sayıldığı için EL YAZMASI panel service
      // worker'ı (`panel-sw.js`, 106 satır, alarmın t=0 Web Push adımını işler) hiç lint edilmiyordu
      // (denetim 2026-10-05 LOW 3). Yoksayma küçültülmüş/paketlenmiş çıktılarla sınırlandı; service worker
      // aşağıda (katman 5e) Worker globalleriyle kapsama alındı. public altındaki diğer dosyalar görsel ve
      // SVG'dir, ESLint onları zaten hiçbir `files` deseniyle eşlemiyor.
      'apps/web/public/**/*.min.js',
      'deploy/cloudflare/wrangler.generated.jsonc',
    ],
  },

  // ── 1. Tüm TypeScript: parser kurulumu + gerçek hata kuralları ────────────────────────────────────────────
  // `tseslint.configs.recommended` BİLEREK kullanılmadı: içindeki `no-explicit-any` ve `no-unused-vars` bu
  // depoda binlerce bulgu verir ve hiçbiri çalışma zamanı hatası değildir. Kural listesi aşağıda elle seçilidir.
  {
    name: 'yemekgelsin/ts-temel',
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.base, importX.flatConfigs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    settings: {
      // Çözümleyici (resolver) yapılandırılmadı: `import-x/no-unresolved` kapalı, çünkü eksik modülü TypeScript
      // zaten daha iyi yakalıyor. Çözümleme gerektiren kurallar (no-cycle, no-unresolved) bu yüzden kapalı —
      // hem gereksiz hem de monorepo genelinde dakikalar sürüyor.
      'import-x/extensions': ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs'],
    },
    rules: {
      // --- ÇEKİRDEK: yazarın niyetiyle çalışma zamanı davranışının ayrıştığı durumlar (hepsi error) ---
      ...js.configs.recommended.rules,
      // TypeScript bunları kendisi ve daha doğru yapıyor; ESLint'te açık kalmaları yalnız gürültü üretir.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-regex-spaces': 'warn',
      // BOM (U+FEFF) `services/menu/csv.ts` içinde BİLEREK var: Excel UTF-8 Türkçe CSV'yi ancak BOM ile doğru
      // okur. Dizge/şablon/düzenli ifade içindeki görünmez karakter o yüzden serbest; kuralın asıl hedefi KOD
      // içine sızmış kırılmaz boşluk (NBSP) — onu yakalamaya devam eder.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true, skipJSXText: true },
      ],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty-pattern': 'error',

      // --- ÇEKİRDEK: ek gerçek hata sınıfları (recommended'da yok) ---
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      // Bu depodaki TEK kullanım biçimi `do { … } while (again && !closed)`: `closed` bir kapanış dinleyicisinde
      // (closure) güncelleniyor, kural bunu göremiyor (apps/api/src/lib/sse.ts). Gerçek sonsuz döngüyü yine
      // bildirsin diye kapatılmadı, uyarıya indirildi.
      'no-unmodified-loop-condition': 'warn',
      'no-unreachable-loop': 'error',
      // 28 bulgunun tamamı `new Promise((r) => setTimeout(r, ms))` (bekleme) ya da `return resolve()` (erken
      // çıkış) biçimindedir; ikisi de doğru kod. Kuralın gerçek hedefi (executor'dan promise döndürüp düşürmek)
      // kaybolmasın diye kapatılmadı, uyarıya indirildi.
      'no-promise-executor-return': 'warn',
      'no-constructor-return': 'error',
      'no-return-assign': ['error', 'always'],
      'array-callback-return': ['error', { allowImplicit: true }],
      'require-atomic-updates': 'off', // yanlış pozitifi çok (async + closure sayacı)
      eqeqeq: ['warn', 'smart'],

      // --- GÜVENLİK (error) ---
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-debugger': 'error',

      // --- CLAUDE.md değişmez kural 1: resmi olmayan WhatsApp kütüphanesi yasağı ---
      'no-restricted-imports': YASAK_WA_IMPORT,

      // --- TypeScript: tür bilgisi GEREKTİRMEYEN gerçek hata kuralları ---
      '@typescript-eslint/no-array-constructor': 'error',
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-wrapper-object-types': 'error',
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/triple-slash-reference': 'error',
      // Kullanılmayan değişken bir hata DEĞİL ama ölü kod işaretidir → uyarı. `_` önekiyle susturulur.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off', // 40 bin satırda kasıtlı kullanımlar var; türden ödün vermiyor
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-expect-error': false, 'ts-ignore': true }],

      // --- IMPORT DÜZENİ (hepsi warn: biçim, hata değil) ---
      // YALNIZ GRUP SIRASI zorunlu. Bilerek açılmayanlar ve nedenleri:
      //   - `alphabetize`: depoda İKİ farklı yerleşik üslup var. apps/api ve packages/db modül adına göre
      //     alfabetik yazıyor (`@fastify/cookie` → `node:fs` → `pino`), apps/web ise kavramsal sırayla
      //     (`next/*` → `react` → `@siparis/*` → `@/*`). Birini seçmek diğer ağacın yüzlerce dosyasını
      //     değiştirirdi; ikisi de okunabilir.
      //   - `builtin` ve `external` AYNI grupta: apps/api `node:fs`i harici paketlerin arasına alfabetik
      //     yerleştiriyor; bu kasıtlı ve tutarlı.
      //   - `type` ayrı grup DEĞİL: `import type` satırları kullanım yerine göre, değer importlarıyla
      //     karışık yazılıyor (idiomatik TypeScript).
      //   - `newlines-between`: biçim kuralı, hata değil.
      // Kalan bulgular GERÇEKTEN ters sıradır (ör. göreli import'tan sonra gelen harici paket).
      'import-x/order': [
        'warn',
        {
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index'], 'object', 'unknown'],
          pathGroups: [
            // `@siparis/*` workspace paketleri node_modules üzerinden çözülür, yani node için HARİCİdir.
            { pattern: '@siparis/**', group: 'external' },
            // `@/**` yalnız apps/web içindedir ve gerçekten yerel koddur.
            { pattern: '@/**', group: 'internal' },
          ],
          pathGroupsExcludedImportTypes: [],
          'newlines-between': 'ignore',
          alphabetize: { order: 'ignore' },
          warnOnUnassignedImports: false,
        },
      ],
      'import-x/no-duplicates': 'warn',
      'import-x/first': 'warn',
      'import-x/no-empty-named-blocks': 'warn',
      'import-x/no-self-import': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/export': 'error',
      // Çözümleme (resolver) gerektiren pahalı kurallar — bilerek kapalı; bkz. yukarıdaki `settings` notu.
      'import-x/no-unresolved': 'off',
      'import-x/no-cycle': 'off',
      'import-x/namespace': 'off',
      'import-x/named': 'off',
      'import-x/default': 'off',
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },

  // ── 2. Tür-farkında kurallar (type-aware) ─────────────────────────────────────────────────────────────────
  // MALİYET NOTU: tür-farkında lint, ESLint'in TypeScript programını kurmasını gerektirir (tsc kadar pahalı).
  // Bu yüzden kapsam workspace KAYNAK ağaçlarına daraltıldı: `deploy/cloudflare` (ayrı npm kurulumu, kök
  // `pnpm install` onu kurmaz), `e2e/`, `scripts/` ve tüm `.mjs` dosyaları bu katmanın DIŞINDA.
  // Kural seçimi de dar: `no-unsafe-*` ailesi ve `restrict-template-expressions` BİLEREK kapalı — bu depoda
  // binlerce bulgu verir, hiçbiri çalışma zamanı hatası değil.
  {
    name: 'yemekgelsin/ts-tur-farkinda',
    files: TUR_FARKINDA_DOSYALAR,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Bu katmanın VAROLMA SEBEBİ: beklenmeyen promise. `await` yazılmadığı için sessizce düşen yan etki
      // (WhatsApp mesajı, outbox yazımı, yedek) tür denetiminde görünmez.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: true }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // `attributes: false`: React'te `onClick={async () => …}` meşru kullanım, kuralın asıl hedefi
        // `if (promise)` ve `promise && …` gibi her zaman doğru koşullar.
        { checksVoidReturn: { attributes: false, arguments: false } },
      ],
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-duplicate-type-constituents': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      // Fastify rota işleyicileri ve eklentileri GELENEK olarak `async` yazılır (dönüş değeri yanıt gövdesi
      // olur); içinde `await` olmaması hata değildir. 92 bulgunun tamamı bu kalıptı → kapalı.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
    },
  },

  // ── 3. apps/web — React 19 + Next 16 ──────────────────────────────────────────────────────────────────────
  {
    name: 'yemekgelsin/web',
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,

      // --- React: gerçek hata (error) ---
      'react/jsx-key': ['error', { checkFragmentShorthand: true }],
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-unknown-property': 'error',
      // Güvenlik: `target="_blank"` + `rel` yoksa açılan sayfa `window.opener` ile ana sayfayı yönlendirebilir.
      // `allowReferrer: true`: depodaki 6 bağlantının HEPSİNDE `rel="noopener"` var, yani ters sekme ele
      // geçirme (reverse tabnabbing) riski kapalı. `noreferrer` ayrıca Referer başlığını da keser; bu bağlantılar
      // işletmenin kendi yasal sayfalarına gittiği için gizlilik kazancı yok. Eksik `noopener` HÂLÂ hata.
      'react/jsx-no-target-blank': ['error', { allowReferrer: true, enforceDynamicLinks: 'always' }],
      'react/void-dom-elements-no-children': 'error',

      // --- React kancaları: rules-of-hooks gerçek hata, exhaustive-deps uyarı ---
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // --- Bilerek KAPALI ---
      // Türkçe arayüz metinleri kesme işareti ("işletmenin", "Eray'ın") ve tırnak içeriyor; bu kural her birini
      // &apos;/&quot; yazmaya zorlar. JSX metninde ikisi de güvenlidir, yalnız gürültü üretir.
      'react/no-unescaped-entities': 'off',
      'react/prop-types': 'off', // TypeScript
      'react/react-in-jsx-scope': 'off', // React 19 + yeni JSX çalışma zamanı
      'react/display-name': 'off',
      // App Router'da `pages/` dizini yok; kural yanlış pozitif verir.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // ── 4. apps/api + worker + packages — Node tarafı ─────────────────────────────────────────────────────────
  {
    name: 'yemekgelsin/api-node',
    files: ['apps/api/**/*.ts', 'packages/*/src/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Sunucu günlüğü pino üzerinden gider (CLAUDE.md kural 7: telefon/adres maskelenir). Çıplak `console`
      // maskelemeyi atlar ve üretim günlüğünde yapılandırılmamış satır bırakır → uyarı.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // NOT: `eslint-plugin-n` (Node kuralları: no-process-exit, no-unsupported-features) BİLEREK EKLENMEDİ.
      // Node sürüm kuralı `package.json engines` + tür denetimiyle zaten kapalı; eklenti bu depoda büyük oranda
      // `process.exit` kullanan CLI betiklerinde yanlış pozitif verir. Gerekirse FAZ 5'te eklenir.
    },
  },

  // ── 5. Gevşetmeler ────────────────────────────────────────────────────────────────────────────────────────
  // 5a. Testler: `console` serbest, kullanılmayan değişken serbest (kurulum yardımcıları).
  {
    name: 'yemekgelsin/testler',
    files: [
      '**/*.test.{ts,tsx,mts}',
      '**/test/**/*.{ts,tsx}',
      'e2e/**/*.ts',
      'apps/web/test/**/*.{ts,tsx}',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // XSS testleri `javascript:alert(1)` gibi dizgeleri BİLEREK kurar ve reddedildiğini doğrular.
      'no-script-url': 'off',
      // `new Promise((r) => (resolve = r))` — testlerde elle çözülen promise yakalama kalıbı.
      'no-return-assign': 'off',
    },
  },

  // 5b. CLI betikleri ve dağıtım araçları: `console` ÇIKTININ KENDİSİ, uyarı olmamalı.
  // `packages/db/src/{migrate,seed,reset}.ts` de buraya girer: üçü de `node --import tsx` ile ELLE çalıştırılan
  // giriş noktasıdır, pino'ya bağlı değildir ve çıktısı operatörün ekranıdır (aynı üçü `vitest.config.ts`
  // kapsam listesinde de "CLI giriş noktaları" diye dışarıda bırakılmıştır — tek sınıflandırma).
  {
    name: 'yemekgelsin/betikler',
    files: [
      'scripts/**/*.{ts,mjs}',
      'deploy/cloudflare/scripts/**/*.mjs',
      '*.config.{ts,js,mjs}',
      'eslint.config.js',
      'packages/db/src/migrate.ts',
      'packages/db/src/seed.ts',
      'packages/db/src/reset.ts',
    ],
    rules: { 'no-console': 'off' },
  },

  // 5c. Düz JavaScript araçları (.mjs): tür-farkında katmanın dışında, TS kuralları uygulanmaz.
  {
    name: 'yemekgelsin/mjs',
    files: ['**/*.mjs', '**/*.js'],
    // Panel service worker'ı buradan ÇIKARILDI (katman 5e): bu katmanın Node globalleri ve `sourceType: 'module'`
    // ayarı birleşik yapılandırmada orada da geçerli olurdu (flat config `globals` nesnelerini BİRLEŞTİRİR), yani
    // `self` Node'da da tanımlı olduğu için tarayıcı globali yazım hataları `no-undef`ten kaçardı.
    ignores: ['apps/web/public/panel-sw.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-regex-spaces': 'warn',
      // Katman 1 YALNIZ `**/*.{ts,tsx,mts,cts}` dosyalarını kapsar; yasak buraya ayrıca yazılmazsa
      // CLAUDE.md değişmez kural 1'in makine kapısı düz JavaScript dosyalarında hiç yoktur.
      'no-restricted-imports': YASAK_WA_IMPORT,
    },
  },

  // 5d. Cloudflare Worker kabuğu: ayrı npm kurulumu (kök `pnpm install` onu kurmaz) ve Worker çalışma zamanı
  // globalleri. Tür-farkında katmanın dışında bırakıldı — bkz. katman 2 maliyet notu.
  {
    name: 'yemekgelsin/cf-worker',
    files: ['deploy/cloudflare/src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
    },
    rules: { 'no-console': 'off' },
  },

  // 5e. Panel service worker'ı (`apps/web/public/panel-sw.js`): EL YAZMASI, üretilmiş değil — alarmın t=0 Web Push
  // adımını ve bildirim tıklamasını o işler. Katman 5c (`**/*.js`) onu Node globalleriyle ve `sourceType: 'module'`
  // ile görürdü; ikisi de yanlış: dosya KLASİK (non-module) service worker'dır, çalışma zamanı globalleri
  // `self`/`clients`/`registration`'dır. Doğru global kümesi olmadan `no-undef` sahte hatalar üretir (ya da
  // `self` Node'da da tanımlı olduğu için GERÇEK yazım hatasını kaçırır).
  {
    name: 'yemekgelsin/panel-sw',
    files: ['apps/web/public/panel-sw.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      // Klasik service worker: `importScripts` dünyası, `import` yok (`register(…)` çağrısında `type: 'module'`
      // VERİLMİYOR — components/push/push-client.ts).
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
    rules: {
      // Service worker'da `console` tarayıcı konsoluna gider; pino yok, maskeleme kuralı da yok (yük zaten
      // kişisel veri taşımıyor: 06 §7.3 — yalnız kind/title/body/url/tag/orderId).
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-restricted-imports': YASAK_WA_IMPORT,
    },
  },
);
