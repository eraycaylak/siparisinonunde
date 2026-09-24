// API süreci: buildApp + listen(API_PORT).

import { buildApp } from './app';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await buildApp({ config });
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
