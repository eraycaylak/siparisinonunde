// Playwright globalSetup: e2e veritabanını sıfırlar (packages/db betikleri: reset + migrate + seed),
// demo şubelerini (Bozok, Çamlık Döner) saatten bağımsız açık yapar (00:00–23:59) ve next dev'in ilk derlemesini ısıtır.
// Not: Playwright webServer'ları globalSetup'tan ÖNCE başlatır; API/worker yeniden bağlanmaya dayanıklıdır.

import type { FullConfig } from '@playwright/test';
import { ensureDatabase, makeBranchAlwaysOpen, runDbScript } from './support/db';
import { DEMO, DONER, WEB_URL } from './support/env';

/** next dev rotaları ilk istekte derler; testlerde zaman aşımı olmasın diye önceden istenir. */
const WARM_ROUTES = [
  '/',
  `/s/${DEMO.slug}`,
  `/s/${DEMO.slug}/siparis`,
  '/t/e2e-isitma',
  '/dev/whatsapp',
  '/panel/giris',
  '/panel',
  '/panel/kayit',
  '/panel/kurulum',
  '/panel/kuryeler',
  '/kurye/giris',
  '/kurye',
  '/admin/giris',
  '/admin/isletmeler',
];

async function warmUp(): Promise<void> {
  for (const path of WARM_ROUTES) {
    try {
      await fetch(`${WEB_URL}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    } catch {
      // ısıtma başarısızsa test kendi zaman aşımıyla dener
    }
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  await ensureDatabase();
  runDbScript('reset');
  runDbScript('migrate');
  runDbScript('seed');
  await makeBranchAlwaysOpen(DEMO.slug);
  // Ortak numaranın ikinci dükkanı (09-ortak-numara): seçilince karşılama gelsin (kapalı bilgisi değil)
  await makeBranchAlwaysOpen(DONER.slug);
  if (process.env.E2E_SKIP_WARMUP !== '1') await warmUp();
}
