// Worker süreci: jobs tablosunu işler (14 §7.2); SIGTERM'de mevcut partiyi bitirip kapanır.

import { createDb } from '@siparis/db';
import pino from 'pino';
import { loadConfig } from './config';
import { registerAllJobs } from './jobs/index';
import { runWorker } from './lib/jobs';

async function main() {
  const config = loadConfig();
  const log = pino({
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
  });
  const handle = createDb(config.DATABASE_URL, { applicationName: 'siparis-worker', max: 5 });
  registerAllJobs();

  const controller = new AbortController();
  const stop = (signal: string) => {
    log.info({ signal }, 'worker durduruluyor');
    controller.abort();
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  await runWorker({ db: handle.db, config, log, signal: controller.signal });
  await handle.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
