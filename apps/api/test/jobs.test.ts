import { jobs, schema, type Database } from '@siparis/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKER_LANES,
  PermanentJobError,
  backoffMs,
  cancelJobs,
  enqueueJob,
  isTransientDbError,
  processDueJobs,
  recoverStaleJobs,
  registerCron,
  registerJobHandler,
  runWorker,
  scheduleCronJobs,
} from '../src/lib/jobs';
import { createTestContext, TEST_DATABASE_URL, type TestContext } from './helpers';

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

describe('worker şeritleri, kapanış ve sağlık ucu', () => {
  it('varsayılan şeritler: WhatsApp ve SMS işleri ana şeritten ayrı', async () => {
    await ctx.db.delete(jobs);
    const samples: [string, string][] = [
      ['wa-outbound', 'wa.send'],
      ['notify', 'platform.alert'],
      ['notify', 'sms.send'],
      ['notify', 'order.alarm_step'],
      ['notify', 'order.notify_customer'],
      ['cron', 'cron.retention'],
      ['wa-inbound', 'wa.inbound'],
    ];
    for (const [queue, type] of samples) await enqueueJob(ctx.db, { queue: queue as 'notify', type, delayMs: 3_600_000 });
    const laneOf: Record<string, string[]> = {};
    for (const lane of DEFAULT_WORKER_LANES) {
      const rows = (await ctx.db.execute<{ type: string }>(sql`select type from jobs where ${lane.where} order by type`)) as unknown as { type: string }[];
      laneOf[lane.name] = rows.map((r) => r.type);
    }
    expect(laneOf).toEqual({
      main: ['cron.retention', 'order.alarm_step', 'order.notify_customer', 'wa.inbound'],
      whatsapp: ['platform.alert', 'wa.send'],
      sms: ['sms.send'],
    });
    await ctx.db.delete(jobs);
  });

  it('yavaş sağlayıcı işi (şerit) alarm işlerini bekletmez', async () => {
    const finished: string[] = [];
    registerJobHandler('test.slow_provider', async () => {
      await new Promise((r) => setTimeout(r, 300));
      finished.push('slow');
    });
    registerJobHandler('test.alarm', async () => {
      finished.push('alarm');
    });
    for (let i = 0; i < 3; i++) await enqueueJob(ctx.db, { queue: 'notify', type: 'test.slow_provider' });
    await enqueueJob(ctx.db, { queue: 'notify', type: 'test.alarm' });
    const controller = new AbortController();
    const done = runWorker({
      db: ctx.db,
      config: ctx.config,
      log,
      signal: controller.signal,
      enableCron: false,
      pollMs: 10,
      lanes: [
        { name: 'main', where: sql`type = 'test.alarm'`, batchSize: 10, housekeeping: true },
        { name: 'provider', where: sql`type = 'test.slow_provider'`, batchSize: 5 },
      ],
    });
    for (let i = 0; i < 100 && !finished.includes('alarm'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(finished[0]).toBe('alarm');
    for (let i = 0; i < 200 && finished.length < 4; i++) await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await done;
    expect(finished.filter((f) => f === 'slow')).toHaveLength(3);
  });

  it('kapanış: sürmekte olan iş biter, alınmış ama başlanmamış işler hemen sıraya döner (deneme sayılmaz)', async () => {
    const controller = new AbortController();
    let n = 0;
    registerJobHandler('test.shutdown', async () => {
      n++;
      controller.abort();
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await enqueueJob(ctx.db, { queue: 'notify', type: 'test.shutdown' }))!);
    const processed = await processDueJobs({ db: ctx.db, config: ctx.config, log, workerId: 'w-kapanis', queues: ['notify'], signal: controller.signal });
    expect(processed).toBe(1);
    expect(n).toBe(1);
    const rows = await Promise.all(ids.map(getJob));
    expect(rows.filter((r) => r.status === 'done')).toHaveLength(1);
    const pending = rows.filter((r) => r.status === 'pending');
    expect(pending).toHaveLength(2);
    expect(pending.every((r) => r.attempts === 0 && r.lockedAt === null)).toBe(true);
    await ctx.db.delete(jobs).where(eq(jobs.type, 'test.shutdown'));
  });

  it('GET /health/worker: vadesi 5 dk\'dan fazla geçmiş iş varsa 503; kuyruk işlenince 200', async () => {
    await ctx.db.delete(jobs).where(eq(jobs.status, 'pending'));
    const fine = await ctx.request({ method: 'GET', url: '/api/v1/health/worker' });
    expect(fine.statusCode, fine.body).toBe(200);
    expect(fine.json()).toMatchObject({ ok: true, db: 'up', jobLagSec: 0, stuckJobs: 0 });
    registerJobHandler('test.overdue', async () => {});
    await enqueueJob(ctx.db, { queue: 'notify', type: 'test.overdue', runAt: new Date(Date.now() - 10 * 60_000) });
    const lagging = await ctx.request({ method: 'GET', url: '/api/v1/health/worker' });
    expect(lagging.statusCode).toBe(503);
    expect(lagging.json().ok).toBe(false);
    expect(lagging.json().jobLagSec).toBeGreaterThanOrEqual(590);
    // API süreç sağlığı etkilenmez (Docker sağlık denetimi)
    expect((await ctx.request({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    await run();
    expect((await ctx.request({ method: 'GET', url: '/api/v1/health/worker' })).statusCode).toBe(200);
  });
});

/** Log çağrılarını seviye + mesajla toplayan sahte logger. */
function captureLog() {
  const lines: { level: string; msg: string; obj: unknown }[] = [];
  const at =
    (level: string) =>
    (obj: unknown, msg?: string) => {
      lines.push({ level, msg: msg ?? (typeof obj === 'string' ? obj : ''), obj });
    };
  const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal') } as Record<string, unknown>;
  logger.child = () => logger;
  return { log: logger as unknown as FastifyBaseLogger, lines };
}

describe('worker döngüsü: geçici veritabanı hataları', () => {
  it('gerçek hatalar: tablo yok (42P01, drizzle sarmalı) ve bağlantı reddi geçici; sözdizimi hatası değil', async () => {
    // Boş şemaya bakan bağlantı: `jobs` görünmez (e2e/dev sıfırlaması sırasındaki durum)
    const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'yok_boyle_sema' } });
    const db = drizzle(client, { schema }) as unknown as Database;
    try {
      const missing = await db.execute(sql`select id from jobs limit 1`).then(
        () => null,
        (e: unknown) => e,
      );
      expect(missing).toBeTruthy();
      expect(String((missing as { cause?: { message?: string } }).cause?.message ?? (missing as Error).message)).toContain('does not exist');
      expect(isTransientDbError(missing)).toBe(true);
      const syntax = await db.execute(sql`selec 1`).then(
        () => null,
        (e: unknown) => e,
      );
      expect(syntax).toBeTruthy();
      expect(isTransientDbError(syntax)).toBe(false);
    } finally {
      await client.end({ timeout: 1 });
    }

    const refused = postgres('postgres://siparis:siparis@127.0.0.1:1/siparis_yok', { max: 1, connect_timeout: 2, onnotice: () => {} });
    try {
      const err = await refused`select 1`.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeTruthy();
      expect(isTransientDbError(err)).toBe(true);
    } finally {
      await refused.end({ timeout: 1 });
    }
    expect(isTransientDbError(new PermanentJobError('x'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });

  it('42P01 sürerken çökmez, bekleyerek yeniden dener, tek uyarı yazar; düzelince bir kez bilgi verir', async () => {
    const tableMissing = Object.assign(new Error('Failed query: update jobs …'), {
      cause: Object.assign(new Error('relation "jobs" does not exist'), { code: '42P01' }),
    });
    let failing = true;
    let calls = 0;
    const fakeDb = {
      execute: async () => {
        calls++;
        if (failing) throw tableMissing;
        return [];
      },
    } as unknown as Database;
    const { log: capture, lines } = captureLog();
    const controller = new AbortController();
    const done = runWorker({
      db: fakeDb,
      config: ctx.config,
      log: capture,
      signal: controller.signal,
      enableCron: false,
      pollMs: 5,
      transientBackoffMs: 1,
      transientBackoffMaxMs: 4,
    });
    await new Promise((r) => setTimeout(r, 150));
    const failedCalls = calls;
    expect(failedCalls).toBeGreaterThan(5); // döngü sürüyor
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
    const warns = lines.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1); // dakikada en çok bir uyarı
    expect(warns[0]!.msg).toContain('geçici olarak erişilemiyor');
    expect(warns[0]!.obj).toMatchObject({ code: '42P01' });

    failing = false;
    await new Promise((r) => setTimeout(r, 60));
    controller.abort();
    await done;
    expect(calls).toBeGreaterThan(failedCalls);
    expect(lines.filter((l) => l.msg.includes('yeniden erişilebilir'))).toHaveLength(1);
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
  });

  it('geçici olmayan hata eskisi gibi hata olarak loglanır', async () => {
    const { log: capture, lines } = captureLog();
    const controller = new AbortController();
    const fakeDb = {
      execute: async () => {
        throw Object.assign(new Error('syntax error'), { code: '42601' });
      },
    } as unknown as Database;
    const done = runWorker({ db: fakeDb, config: ctx.config, log: capture, signal: controller.signal, enableCron: false, pollMs: 5 });
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await done;
    expect(lines.filter((l) => l.level === 'error' && l.msg === 'worker döngü hatası').length).toBeGreaterThanOrEqual(1);
  });
});
