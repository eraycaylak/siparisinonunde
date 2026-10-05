import { defineConfig } from 'vitest/config';

// Kök Vitest yapılandırması. apps/web kendi test düzenini kurar (apps/web/vitest.config.ts).

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// KAPSAM EŞİKLERİ (denetim 2026-10-04 madde 4.6 · FAZ 4)
//
// ⚠️ AŞAĞIDAKİ SAYILAR HEDEFTİR, ÖLÇÜM DEĞİLDİR — İLK ÖLÇÜMDEN SONRA AYARLANACAK.
// `docs/` 2026-10-05'e kadar "%80 kapsam" diyordu ama depoda kapsam HİÇ ölçülmemişti (sağlayıcı kurulu değildi,
// eşik yoktu). Bu turda ölçüm bilerek YAPILMADI: ölçüm `pnpm test`i koşmak demektir, o da paylaşılan
// `siparis_test` veritabanını sıfırlar ve o anda koşan başka işleri bozar.
//
// ERAY'IN YAPACAĞI ADIM (tek seferlik, ~5 dk, başka iş koşmuyorken):
//   1. ALLOW_DB_RESET=1 pnpm test:coverage          → core + db + api gerçek ölçümü
//   2. pnpm --filter @siparis/web test:coverage     → web ölçümü (veritabanı gerekmez)
//   3. Çıkan gerçek yüzdelerin ~5 puan ALTINI bu dosyadaki `ESIKLER`e yazın (bugünkü seviyeyi çivileyen
//      "ratchet" eşiği: kapsamın DÜŞMESİNİ engeller, bir gecede %80'e çıkmayı zorlamaz).
//   4. Eşikleri zorunlu kılın: `.github/workflows/testler.yml` içindeki kapsam adımına `KAPSAM_ESIK: '1'`
//      ortam değişkenini ekleyin (o adım şimdilik orada YOK — bkz. iş akışındaki not).
//
// Eşikler neden varsayılan olarak UYGULANMIYOR: ölçülmemiş bir sayıyı kapıya bağlamak, kapıyı ilk koşuda
// kırmızı yakar ve herkes `continue-on-error` eklemeye başlar. `KAPSAM_ESIK=1` verilmedikçe `--coverage`
// yalnız RAPOR üretir, hiçbir şeyi kırmaz.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `KAPSAM_ESIK=1` verilmedikçe eşikler rapora dönüşür, kapıya dönüşmez. */
const ESIK_ZORUNLU = process.env.KAPSAM_ESIK === '1';

/**
 * Ağaç başına eşik. Paketler ayrı ayrı yapılandırılabilir, çünkü doğaları farklı:
 *  - `packages/core`: saf fonksiyon ve durum makineleri (sipariş FSM, fiyat, telefon). Veritabanı ya da ağ
 *    gerekmez, yani kapsamın yüksek olması BEKLENİR. CLAUDE.md kural 5 durum makineleri için %100 diyor.
 *  - `packages/db`: şema tanımı + göç (migration) çalıştırıcısı. Dosyaların çoğu bildirimdir (`pgTable(...)`),
 *    "satır kapsamı" burada az şey anlatır → eşik bilerek düşük.
 *  - `apps/api`: rota + servis katmanı; testler gerçek PostgreSQL'e karşı koşar. Yüksek ama %100 değil
 *    (hata dalları, sağlayıcı adaptörleri).
 */
const ESIKLER = {
  genel: { lines: 70, functions: 70, branches: 60, statements: 70 },
  core: { lines: 85, functions: 85, branches: 75, statements: 85 },
  db: { lines: 50, functions: 50, branches: 40, statements: 50 },
  api: { lines: 70, functions: 65, branches: 60, statements: 70 },
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          root: './packages/db',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          // API testleri aynı siparis_test veritabanını paylaşır: dosyalar sırayla, tek süreçte.
          fileParallelism: false,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],

    // Kapsam YALNIZ kök düzeyde yapılandırılır (Vitest 3: `projects` içindeki `coverage` yok sayılır).
    // `enabled` yazılmadı: `pnpm test` kapsam ÜRETMEZ (yavaşlatmasın), `pnpm test:coverage` `--coverage` ile açar.
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      // `json-summary` CI özetine yüzde yazmak için; `lcov` dış araçlar için; `text` terminal için.
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      // Test koşmayan dosyalar da sayılsın: aksi hâlde "hiç testi olmayan modül" kapsamı YÜKSELTİR.
      all: true,
      include: ['packages/core/src/**/*.ts', 'packages/db/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        // Yalnız tür/sözleşme tanımı: çalıştırılabilir satırı yok, kapsam oranını yapay şişirir.
        'packages/core/src/contracts/**',
        'packages/db/src/schema/**',
        'packages/db/src/drizzle/**',
        // CLI giriş noktaları: elle çalıştırılır, testten çağrılmaz (göç, tohumlama, sıfırlama).
        'packages/db/src/migrate.ts',
        'packages/db/src/seed.ts',
        'packages/db/src/reset.ts',
        'apps/api/src/server.ts',
        'apps/api/src/worker.ts',
        // Yalnız geliştirme ortamında kayıtlı rotalar (NODE_ENV=production'da hiç yüklenmez).
        'apps/api/src/routes/dev/**',
      ],
      thresholds: ESIK_ZORUNLU
        ? {
            ...ESIKLER.genel,
            // Dosya başına DEĞİL, ağaç toplamı: tek bir yeni dosya kapıyı kırmasın.
            perFile: false,
            // `autoUpdate: false` bilerek: eşiği testin kendisi düşürmesin (sessiz gerileme).
            autoUpdate: false,
            'packages/core/src/**': { ...ESIKLER.core },
            'packages/db/src/**': { ...ESIKLER.db },
            'apps/api/src/**': { ...ESIKLER.api },
          }
        : undefined,
    },
  },
});
