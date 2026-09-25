// Worker süreci: jobs tablosunu işler (14 §7.2); SIGTERM'de sürmekte olan işi bitirip kapanır (başlanmamış işler
// sıraya geri verilir). Gözetçi: bir şerit uzun süre tur atmazsa süreç çıkar, Docker yeniden başlatır.

import { createDb } from '@siparis/db';
import pino from 'pino';
import { loadConfig, productionConfigWarnings } from './config';
import { registerAllJobs } from './jobs/index';
import { runWorker } from './lib/jobs';

/** Bir şerit bu süre boyunca yeni tura başlamazsa (takılı DB/sağlayıcı çağrısı) süreç yeniden başlatılır. */
const WATCHDOG_STALL_MS = 10 * 60_000;

async function main() {
  const config = loadConfig();
  const log = pino({
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
  });
  for (const w of productionConfigWarnings(config)) log.warn(w);
  const handle = createDb(config.DATABASE_URL, { applicationName: 'siparis-worker', max: 5 });
  registerAllJobs();

  const controller = new AbortController();
  const stop = (signal: string) => {
    log.info({ signal }, 'worker durduruluyor');
    controller.abort();
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  const beats = new Map<string, number>();
  const watchdog = setInterval(() => {
    const now = Date.now();
    for (const [lane, at] of beats) {
      if (now - at > WATCHDOG_STALL_MS) {
        log.fatal({ lane, stalledMs: now - at }, 'worker şeridi takıldı; süreç yeniden başlatılıyor');
        process.exit(1);
      }
    }
  }, 30_000);
  watchdog.unref();

  await runWorker({ db: handle.db, config, log, signal: controller.signal, onHeartbeat: (lane) => beats.set(lane, Date.now()) });
  clearInterval(watchdog);
  await handle.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
