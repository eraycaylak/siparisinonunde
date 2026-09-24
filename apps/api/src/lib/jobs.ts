// Arka plan işleri (14 §7.2): `jobs` tablosu + FOR UPDATE SKIP LOCKED; üstel geri çekilme; cron zamanlayıcı.
// İşleyiciler idempotent yazılır. Kayıt fonksiyonları hem API hem worker sürecinde çağrılır (jobs/index.ts).

import { DEFAULT_TIMEZONE, localDateString, zonedTimeToUtc, type Queue } from '@siparis/core';
import { jobs, type Database } from '@siparis/db';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';

export type JobPayload = Record<string, unknown>;

export interface JobRow {
  id: string;
  queue: Queue;
  type: string;
  payload: JobPayload;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  tenantId: string | null;
  dedupeKey: string | null;
}

export interface JobContext {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
  job: JobRow;
}

export type JobHandler<P = JobPayload> = (payload: P, ctx: JobContext) => Promise<void>;

/** Yeniden denenmeyecek hata (doğrudan `failed`). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

const handlers = new Map<string, JobHandler>();

/** İş türüne işleyici bağlar (aynı tür yeniden kaydedilirse üzerine yazar). */
export function registerJobHandler<P = JobPayload>(type: string, handler: JobHandler<P>): void {
  handlers.set(type, handler as JobHandler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()];
}

export interface EnqueueJobInput {
  queue: Queue;
  type: string;
  payload?: JobPayload;
  /** Belirli an (verilmezse şimdi). */
  runAt?: Date;
  /** DB saatine göre gecikme (runAt yerine). */
  delayMs?: number;
  /** Tekillik: aynı anahtarla bekleyen/biten iş varsa yenisi eklenmez (null döner). */
  dedupeKey?: string | null;
  tenantId?: string | null;
  maxAttempts?: number;
}

/** İş ekler (iş olayıyla aynı transaction'da çağrılmalı — outbox). Tekillik çakışmasında null. */
export async function enqueueJob(tx: Database, input: EnqueueJobInput): Promise<string | null> {
  const runAt =
    input.delayMs != null
      ? sql`now() + (${Math.max(0, Math.round(input.delayMs))} * interval '1 millisecond')`
      : (input.runAt ?? sql`now()`);
  const rows = await tx
    .insert(jobs)
    .values({
      queue: input.queue,
      type: input.type,
      payload: input.payload ?? {},
      runAt,
      dedupeKey: input.dedupeKey ?? null,
      tenantId: input.tenantId ?? null,
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return rows[0]?.id ?? null;
}

export type CancelJobsFilter =
  | { dedupeKey: string }
  | { type: string; orderId: string }
  | { type: string; payload: Record<string, string> };

/**
 * Bekleyen işleri iptal eder; tekillik anahtarı serbest bırakılır (aynı anahtarla yeniden eklenebilir).
 * İptal edilen iş sayısını döner.
 */
export async function cancelJobs(tx: Database, filter: CancelJobsFilter): Promise<number> {
  let where;
  if ('dedupeKey' in filter) {
    where = sql`dedupe_key = ${filter.dedupeKey}`;
  } else if ('orderId' in filter) {
    where = sql`type = ${filter.type} and payload->>'orderId' = ${filter.orderId}`;
  } else {
    where = sql`type = ${filter.type} and payload @> ${JSON.stringify(filter.payload)}::jsonb`;
  }
  const rows = await tx.execute<{ id: string }>(sql`
    update jobs
       set status = 'cancelled',
           dedupe_key = case when dedupe_key is null then null else dedupe_key || '#cancelled:' || id::text end,
           finished_at = now()
     where status = 'pending' and ${where}
     returning id`);
  return (rows as unknown as unknown[]).length;
}

/** Deneme sayısına göre bekleme: 5 sn, 10 sn, 20 sn, 40 sn … en çok 10 dk. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
}

export interface ProcessOptions {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
  workerId?: string;
  limit?: number;
  /** Test için sahte saat (verilmezse DB now()). */
  now?: Date;
  queues?: readonly Queue[];
}

type ClaimedRow = {
  id: string;
  queue: Queue;
  type: string;
  payload: JobPayload;
  run_at: Date | string;
  attempts: number;
  max_attempts: number;
  tenant_id: string | null;
  dedupe_key: string | null;
};

/** Vadesi gelen işleri çekip sırayla çalıştırır; işlenen iş sayısını döner. */
export async function processDueJobs(opts: ProcessOptions): Promise<number> {
  const { db, log } = opts;
  const workerId = opts.workerId ?? `w-${process.pid}`;
  const limit = opts.limit ?? 20;
  const nowExpr = opts.now ? sql`${opts.now.toISOString()}::timestamptz` : sql`now()`;
  const queueFilter = opts.queues?.length
    ? sql`and queue in (${sql.join(opts.queues.map((q) => sql`${q}`), sql`, `)})`
    : sql``;

  const claimed = (await db.execute<ClaimedRow>(sql`
    update jobs
       set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
     where id in (
       select id from jobs
        where status = 'pending' and run_at <= ${nowExpr} ${queueFilter}
        order by run_at, created_at
        for update skip locked
        limit ${limit}
     )
     returning id, queue, type, payload, run_at, attempts, max_attempts, tenant_id, dedupe_key`)) as unknown as ClaimedRow[];

  const rows = [...claimed].sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime());
  for (const r of rows) {
    const job: JobRow = {
      id: r.id,
      queue: r.queue,
      type: r.type,
      payload: r.payload ?? {},
      runAt: new Date(r.run_at),
      attempts: Number(r.attempts),
      maxAttempts: Number(r.max_attempts),
      tenantId: r.tenant_id,
      dedupeKey: r.dedupe_key,
    };
    const jobLog = log.child({ jobId: job.id, jobType: job.type });
    try {
      const handler = handlers.get(job.type);
      if (!handler) throw new Error(`Kayıtlı işleyici yok: ${job.type}`);
      await handler(job.payload, { db, config: opts.config, log: jobLog, job });
      await db.execute(sql`
        update jobs set status = 'done', finished_at = now(), locked_at = null, locked_by = null, last_error = null
         where id = ${job.id}`);
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const permanent = err instanceof PermanentJobError;
      if (permanent || job.attempts >= job.maxAttempts) {
        jobLog.error({ err }, 'iş başarısız (kalıcı)');
        await db.execute(sql`
          update jobs set status = 'failed', finished_at = now(), locked_at = null, locked_by = null,
                          last_error = ${message.slice(0, 2000)}
           where id = ${job.id}`);
      } else {
        const delay = backoffMs(job.attempts);
        jobLog.warn({ err, retryInMs: delay }, 'iş başarısız, yeniden denenecek');
        await db.execute(sql`
          update jobs set status = 'pending', locked_at = null, locked_by = null,
                          last_error = ${message.slice(0, 2000)},
                          run_at = ${nowExpr} + (${delay} * interval '1 millisecond')
           where id = ${job.id}`);
      }
    }
  }
  return rows.length;
}

/** Çöken worker'ın kilitli bıraktığı işleri geri alır. */
export async function recoverStaleJobs(db: Database, staleMs = 5 * 60_000): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    update jobs set status = 'pending', locked_at = null, locked_by = null
     where status = 'running' and locked_at < now() - (${staleMs} * interval '1 millisecond')
     returning id`);
  return (rows as unknown as unknown[]).length;
}

// ---------------------------------------------------------------------------
// Cron

export type CronSchedule = { everyMinutes: number } | { dailyAt: string; timezone?: string };

export interface CronSpec {
  name: string;
  type: string;
  queue?: Queue;
  schedule: CronSchedule;
  payload?: JobPayload;
}

const crons = new Map<string, CronSpec>();

/** Zamanlanmış iş tanımı; worker her 15 sn'de vadesi gelen dilimi `cron:<ad>:<dilim>` tekilliğiyle kuyruğa atar. */
export function registerCron(spec: CronSpec): void {
  crons.set(spec.name, spec);
}

export function registeredCrons(): CronSpec[] {
  return [...crons.values()];
}

/** Vadesi gelen cron dilimlerini kuyruğa ekler; eklenen iş sayısını döner. */
export async function scheduleCronJobs(db: Database, now: Date = new Date()): Promise<number> {
  let added = 0;
  for (const c of crons.values()) {
    let slot: string;
    let runAt: Date;
    if ('everyMinutes' in c.schedule) {
      const period = Math.max(1, c.schedule.everyMinutes) * 60_000;
      const s = Math.floor(now.getTime() / period);
      slot = String(s);
      runAt = new Date(s * period);
    } else {
      const tz = c.schedule.timezone ?? DEFAULT_TIMEZONE;
      const today = localDateString(now, tz);
      const at = zonedTimeToUtc(today, c.schedule.dailyAt, tz);
      if (now < at) continue;
      slot = today;
      runAt = at;
    }
    const id = await enqueueJob(db, {
      queue: c.queue ?? 'cron',
      type: c.type,
      payload: c.payload ?? {},
      runAt,
      dedupeKey: `cron:${c.name}:${slot}`,
    });
    if (id) added++;
  }
  return added;
}

// ---------------------------------------------------------------------------
// Worker döngüsü

export interface RunWorkerOptions {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
  signal: AbortSignal;
  workerId?: string;
  pollMs?: number;
  batchSize?: number;
  queues?: readonly Queue[];
  enableCron?: boolean;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** 250 ms'de bir vadesi gelen işleri işler; `signal` iptal edilince mevcut parti bitince döner. */
export async function runWorker(opts: RunWorkerOptions): Promise<void> {
  const pollMs = opts.pollMs ?? 250;
  const workerId = opts.workerId ?? `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let lastCron = 0;
  let lastRecover = 0;
  opts.log.info({ workerId, handlers: registeredJobTypes(), crons: registeredCrons().map((c) => c.name) }, 'worker başladı');
  while (!opts.signal.aborted) {
    try {
      const now = Date.now();
      if (opts.enableCron !== false && now - lastCron >= 15_000) {
        lastCron = now;
        await scheduleCronJobs(opts.db, new Date(now));
      }
      if (now - lastRecover >= 60_000) {
        lastRecover = now;
        const n = await recoverStaleJobs(opts.db);
        if (n) opts.log.warn({ count: n }, 'takılı işler geri alındı');
      }
      const processed = await processDueJobs({
        db: opts.db,
        config: opts.config,
        log: opts.log,
        workerId,
        limit: opts.batchSize ?? 20,
        queues: opts.queues,
      });
      if (processed === 0) await sleep(pollMs, opts.signal);
    } catch (err) {
      opts.log.error({ err }, 'worker döngü hatası');
      await sleep(1_000, opts.signal);
    }
  }
  opts.log.info({ workerId }, 'worker durdu');
}
