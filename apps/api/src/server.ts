// API süreci: buildApp + listen(API_PORT).

import { buildApp } from './app';
import { loadConfig, productionConfigWarnings } from './config';
import { syncSharedWaAccounts } from './services/messaging/shared';

async function main() {
  const config = loadConfig();
  const app = await buildApp({ config });
  for (const w of productionConfigWarnings(config)) app.log.warn(w);
  // Ortak numara (00 §12a madde 8): işletme satırlarının gösterim numarası PLATFORM_WA_DISPLAY_PHONE ile aynı olsun
  const synced = await syncSharedWaAccounts(app.db, config);
  if (synced) app.log.info({ synced }, 'ortak numara satırları güncellendi');
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'API kapanıyor');
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
