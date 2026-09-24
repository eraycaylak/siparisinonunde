// Ortak test fikstürü: tüm sayfalardaki yakalanmamış istemci hatalarını (pageerror) toplar ve testi düşürür;
// konsol hatalarını rapora ek olarak yazar. Ek tarayıcı bağlamları `openContext` ile açılmalı ki izlensin.

import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';

interface ErrorLog {
  pageErrors: string[];
  consoleErrors: string[];
}

const IGNORED_CONSOLE = [
  // Oturumsuz /auth/me ve beklenen 4xx yanıtları tarayıcı konsoluna "Failed to load resource" düşer
  /Failed to load resource: the server responded with a status of (401|403|404|409|410|429)/,
  // Başsız Chromium'da ses/Wake Lock izinleri
  /AudioContext|NotAllowedError|Wake Lock/i,
];

function watch(context: BrowserContext, log: ErrorLog): void {
  const attach = (page: Page) => {
    page.on('pageerror', (err) => log.pageErrors.push(`${page.url()} → ${err.name}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      log.consoleErrors.push(`${page.url()} → ${text.slice(0, 500)}`);
    });
  };
  context.pages().forEach(attach);
  context.on('page', attach);
}

export const test = base.extend<{ errorLog: ErrorLog; openContext: (options?: BrowserContextOptions) => Promise<BrowserContext> }>({
  errorLog: [
    async ({ context }, use, testInfo) => {
      const log: ErrorLog = { pageErrors: [], consoleErrors: [] };
      watch(context, log);
      await use(log);
      if (log.consoleErrors.length) {
        await testInfo.attach('konsol-hatalari.txt', { body: log.consoleErrors.join('\n'), contentType: 'text/plain' });
        // E2E_PRINT_CONSOLE=1: konsol hatalarını çıktıya da yaz (tanılama)
        if (process.env.E2E_PRINT_CONSOLE === '1') console.log(`[konsol] ${testInfo.title}\n  ${log.consoleErrors.join('\n  ')}`);
      }
      expect(log.pageErrors, 'Yakalanmamış istemci hatası (pageerror)').toEqual([]);
    },
    { auto: true },
  ],
  openContext: async ({ browser, errorLog }, use) => {
    const opened: BrowserContext[] = [];
    await use(async (options) => {
      const ctx = await (browser as Browser).newContext(options);
      watch(ctx, errorLog);
      opened.push(ctx);
      return ctx;
    });
    for (const ctx of opened) await ctx.close().catch(() => {});
  },
});

export { expect };
