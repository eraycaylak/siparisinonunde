import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// apps/web birim testleri. Çalıştır: `pnpm --filter @siparis/web test`
// Kapsam raporu: `pnpm --filter @siparis/web test:coverage`
//
// Ortam: varsayılan `node` (testlerin çoğu saf mantık ve metin denetimi; tarayıcı kurmak hepsini yavaşlatır).
// DOM gereken dosyalar başlarına `/** @vitest-environment jsdom */` yazarak kendi ortamını seçer —
// bugün yalnız erişilebilirlik testi (`components/storefront/checkout/checkout-a11y.test.tsx`).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    name: 'web',
    include: ['lib/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}'],
    environment: 'node',

    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    // KAPSAM (denetim 2026-10-04 madde 4.6 · FAZ 4)
    // ⚠️ EŞİKLER HEDEFTİR, ÖLÇÜM DEĞİL — ilk ölçümden sonra ayarlanacak. Gerekçe ve adımlar kök
    // `vitest.config.ts` başındaki nottadır (orada `ESIKLER` ve `KAPSAM_ESIK` anlatılıyor).
    // apps/web eşiği kökten AYRIDIR ve bilerek daha düşüktür: bu ağacın büyük kısmı React bileşeni ve
    // sunucu bileşeni (`app/**`), birim testle değil Playwright e2e ile kapsanır.
    // ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      all: true,
      // Yalnız birim testle kapsanabilen saf mantık ölçülür. `app/**` (Next sunucu bileşenleri, layout, route
      // handler) ve `components/**/*.tsx` bilerek DIŞARIDA: ikisi de e2e'nin alanı, kapsam oranını yanıltır.
      include: ['lib/**/*.ts', 'components/**/*.ts', 'proxy.ts'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts', 'lib/theme-script.ts', 'test/**'],
      thresholds:
        process.env.KAPSAM_ESIK === '1'
          ? { lines: 60, functions: 60, branches: 55, statements: 60, perFile: false, autoUpdate: false }
          : undefined,
    },
  },
});
