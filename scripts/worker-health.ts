// Worker sağlık denetimi (docker-compose.yml worker healthcheck'i): vadesi WORKER_HEALTH_MAX_LAG_SEC'ten
// (varsayılan 300 sn) fazla geçmiş ve hâlâ bekleyen iş varsa worker işlemiyor demektir → çıkış kodu 1.
// Kuyruk boşsa sağlıklıdır. Veritabanına erişilemezse de 1 döner.
//   node --import tsx /app/scripts/worker-health.ts

import { createDb } from '../packages/db/src/client';

const maxLagSec = Number(process.env.WORKER_HEALTH_MAX_LAG_SEC ?? 300);

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL yok');
    return 1;
  }
  const handle = createDb(url, { max: 1, applicationName: 'worker-health' });
  try {
    const [row] = await handle.sql<{ lag: number | null; stuck: number }[]>`
      select
        extract(epoch from (now() - min(run_at) filter (where status = 'pending' and run_at <= now())))::int as lag,
        count(*) filter (where status = 'running' and locked_at < now() - interval '10 minutes')::int as stuck
      from jobs
      where status in ('pending', 'running')`;
    const lag = row?.lag ?? 0;
    if (lag > maxLagSec) {
      console.error(`Bekleyen iş gecikmesi ${lag} sn (> ${maxLagSec})`);
      return 1;
    }
    console.log(`ok (gecikme ${lag} sn, takılı ${row?.stuck ?? 0})`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exit(await main());
