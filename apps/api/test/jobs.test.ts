import { jobs } from '@siparis/db';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PermanentJobError,
  backoffMs,
  cancelJobs,
  enqueueJob,
  processDueJobs,
  recoverStaleJobs,
  registerCron,
  registerJobHandler,
  scheduleCronJobs,
} from '../src/lib/jobs';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
const log = pino({ level: 'silent' });

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const run = (now?: Date) => processDueJobs({ db: ctx.db, config: ctx.config, log, now, queues: ['notify'] });
const getJob = async (id: string) => (await ctx.db.select().from(jobs).where(eq(jobs.id, id)))[0]!;

describe('jobs', () => {
  it('enqueue + işleme: işleyici yükü alır, iş done olur', async () => {
    const seen: unknown[] = [];
    registerJobHandler<{ orderId: string }>('test.echo', async (payload, { job }) => {
      seen.push({ payload, attempts: job.attempts });
    });
    const id = await enqueueJob(ctx.db, { queue: 'notify', type: 'test.echo', payload: { orderId: 'o1' } });
    expect(id).toBeTruthy();
    expect(await run()).toBe(1);
    expect(seen).toEqual([{ payload: { orderId: 'o1' }, attempts: 1 }]);
    const job = await getJob(id!);
    expect(job.status).toBe('done');
    expect(job.finishedAt).toBeInstanceOf(Date);
    expect(await run()).toBe(0);
  });

  it('run_at gelecekteyse beklenir (sahte saat)', async () => {
    let count = 0;
    registerJobHandler('test.later', async () => {
      count++;
    });
    const id = await enqueueJob(ctx.db, { queue: 'notify', type: 'test.later', delayMs: 60_000 });
    expect(await run()).toBe(0);
    const job = await getJob(id!);
    expect(await run(new Date(job.runAt.getTime() - 1000))).toBe(0);
    expect(await run(new Date(job.runAt.getTime() + 1000))).toBe(1);
    expect(count).toBe(1);
  });

  it('dedupe: aynı anahtar ikinci kez eklenmez (bitmiş olsa bile)', async () => {
    registerJobHandler('test.dedupe', async () => {});
    const a = await enqueueJob(ctx.db, { queue: 'notify', type: 'test.dedupe', dedupeKey: 'alarm:o1:3' });
    const b = await enqueueJob(ctx.db, { queue: 'notify', type: 'test.dedupe', dedupeKey: 'alarm:o1:3' });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    await run();
    expect(await enqueueJob(ctx.db, { queue: 'notify', type: 'test.dedupe', dedupeKey: 'alarm:o1:3' })).toBeNull();
    const rows = await ctx.db.select().from(jobs).where(eq(jobs.type, 'test.dedupe'));
    expect(rows).toHaveLength(1);
  });

  it('retry: hata → üstel geri çekilme; deneme sınırında failed', async () => {
    let calls = 0;
    registerJobHandler('test.flaky', async () => {
      calls++;
      throw new Error('geçici hata');
    });
    const id = await enqueueJob(ctx.db, { queue: 'notify', type: 'test.flaky', maxAttempts: 2 });
    await run();
    let job = await getJob(id!);
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('geçici hata');
    expect(job.lockedAt).toBeNull();
    const delay = job.runAt.getTime() - Date.now();
    expect(delay).toBeGreaterThan(backoffMs(1) - 2000);
    // Vakti gelmeden alınmaz; sahte saatle ilerlet
    expect(await run()).toBe(0);
    await run(new Date(job.runAt.getTime() + 10));
    job = await getJob(id!);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(3)).toBe(20000);
    expect(backoffMs(20)).toBe(600000);
  });

  it('PermanentJobError doğrudan failed; kayıtsız tür hata olarak işlenir', async () => {
    registerJobHandler('test.permanent', async () => {
      throw new PermanentJobError('geçersiz yük');
    });
    const id = await enqueueJob(ctx.db, { queue: 'notify', type: 'test.permanent' });
    const unknown = await enqueueJob(ctx.db, { queue: 'notify', type: 'test.no_handler', maxAttempts: 1 });
    await run();
    expect((await getJob(id!)).status).toBe('failed');
    const u = await getJob(unknown!);
    expect(u.status).toBe('failed');
    expect(u.lastError).toContain('Kayıtlı işleyici yok');
  });

  it('cancel: dedupe anahtarıyla ve tür+sipariş ile; anahtar serbest kalır', async () => {
    let ran = 0;
    registerJobHandler('order.test_finalize', async () => {
      ran++;
    });
    const a = await enqueueJob(ctx.db, {
      queue: 'notify',
      type: 'order.test_finalize',
      payload: { orderId: 'o-9' },
      delayMs: 30_000,
      dedupeKey: 'finalize:o-9',
    });
    expect(await cancelJobs(ctx.db, { dedupeKey: 'finalize:o-9' })).toBe(1);
    const cancelled = await getJob(a!);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.dedupeKey).toContain('#cancelled:');
    // Aynı anahtarla yeniden eklenebilir (ör. ret → geri al → yeniden ret)
    const b = await enqueueJob(ctx.db, { queue: 'notify', type: 'order.test_finalize', payload: { orderId: 'o-9' }, dedupeKey: 'finalize:o-9' });
    expect(b).toBeTruthy();
    expect(await cancelJobs(ctx.db, { type: 'order.test_finalize', orderId: 'o-9' })).toBe(1);
    expect(await cancelJobs(ctx.db, { type: 'order.test_finalize', orderId: 'o-9' })).toBe(0);
    await run(new Date(Date.now() + 120_000));
    expect(ran).toBe(0);
  });

  it('transaction geri alınırsa iş de eklenmez (outbox)', async () => {
    await expect(
      ctx.db.transaction(async (tx) => {
        await enqueueJob(tx, { queue: 'notify', type: 'test.rollback' });
        throw new Error('iptal');
      }),
    ).rejects.toThrow('iptal');
    expect(await ctx.db.select().from(jobs).where(eq(jobs.type, 'test.rollback'))).toHaveLength(0);
  });

  it('cron: dilim başına tek iş; takılı işler geri alınır', async () => {
    registerCron({ name: 'test-5m', type: 'test.cron', queue: 'images', schedule: { everyMinutes: 5 } });
    registerCron({ name: 'test-daily', type: 'test.cron_daily', queue: 'images', schedule: { dailyAt: '03:00' } });
    const now = new Date('2026-09-24T10:02:00Z'); // İstanbul 13:02
    await scheduleCronJobs(ctx.db, now);
    await scheduleCronJobs(ctx.db, new Date(now.getTime() + 60_000)); // aynı 5 dk dilimi
    const five = await ctx.db.select().from(jobs).where(eq(jobs.type, 'test.cron'));
    expect(five).toHaveLength(1);
    expect(five[0]!.dedupeKey).toMatch(/^cron:test-5m:\d+$/);
    const daily = await ctx.db.select().from(jobs).where(eq(jobs.type, 'test.cron_daily'));
    expect(daily).toHaveLength(1);
    expect(daily[0]!.dedupeKey).toBe('cron:test-daily:2026-09-24');
    // Günlük iş saatinden önce eklenmez
    await scheduleCronJobs(ctx.db, new Date('2026-09-25T23:30:00Z')); // İstanbul 26 Eylül 02:30
    expect(await ctx.db.select().from(jobs).where(eq(jobs.type, 'test.cron_daily'))).toHaveLength(1);

    const stuck = await enqueueJob(ctx.db, { queue: 'print', type: 'test.stuck' });
    await ctx.db.execute(sql`update jobs set status = 'running', locked_at = now() - interval '10 minutes' where id = ${stuck}`);
    expect(await recoverStaleJobs(ctx.db)).toBe(1);
    expect((await getJob(stuck!)).status).toBe('pending');
  });

  it('SKIP LOCKED: iki worker aynı işi iki kez çalıştırmaz', async () => {
    let n = 0;
    registerJobHandler('test.once', async () => {
      n++;
      await new Promise((r) => setTimeout(r, 30));
    });
    for (let i = 0; i < 6; i++) await enqueueJob(ctx.db, { queue: 'notify', type: 'test.once' });
    const [a, b] = await Promise.all([
      processDueJobs({ db: ctx.db, config: ctx.config, log, workerId: 'a', queues: ['notify'] }),
      processDueJobs({ db: ctx.db, config: ctx.config, log, workerId: 'b', queues: ['notify'] }),
    ]);
    expect(a + b).toBe(6);
    expect(n).toBe(6);
  });
});
