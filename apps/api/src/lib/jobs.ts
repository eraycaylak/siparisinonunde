// Arka plan işleri (14 §7.2): `jobs` tablosu + FOR UPDATE SKIP LOCKED; üstel geri çekilme; cron zamanlayıcı.
// İşleyiciler idempotent yazılır. Kayıt fonksiyonları hem API hem worker sürecinde çağrılır (jobs/index.ts).

import { DEFAULT_TIMEZONE, localDateString, zonedTimeToUtc, type Queue } from '@siparis/core';
import { jobs, type Database } from '@siparis/db';
import { sql, type SQL } from 'drizzle-orm';
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
  /** Şerit süzgeci (WORKER_LANES); `queues` ile birlikte uygulanır. */
  where?: SQL;
  /** İptal edilince sıradaki işlere başlanmaz; alınmış ama başlanmamış işler hemen `pending`e döner. */
  signal?: AbortSignal;
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
  const laneFilter = opts.where ? sql`and ${opts.where}` : sql``;

  const claimed = (await db.execute<ClaimedRow>(sql`
    update jobs
       set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
     where id in (
       select id from jobs
        where status = 'pending' and run_at <= ${nowExpr} ${queueFilter} ${laneFilter}
        order by run_at, created_at
        for update skip locked
        limit ${limit}
     )
     returning id, queue, type, payload, run_at, attempts, max_attempts, tenant_id, dedupe_key`)) as unknown as ClaimedRow[];

  const rows = [...claimed].sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime());
  let processed = 0;
  for (const [i, r] of rows.entries()) {
    if (opts.signal?.aborted) {
      // Kapanış: başlanmamış işler 5 dk'lık takılı iş kurtarmasını beklemeden sıraya döner (deneme sayılmaz)
      const rest = rows.slice(i).map((x) => x.id);
      await db.execute(sql`
        update jobs set status = 'pending', locked_at = null, locked_by = null, attempts = greatest(attempts - 1, 0)
         where status = 'running' and locked_by = ${workerId}
           and id in (${sql.join(rest.map((id) => sql`${id}::uuid`), sql`, `)})`);
      log.info({ released: rest.length }, 'worker kapanıyor: başlanmamış işler sıraya geri verildi');
      break;
    }
    processed++;
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
  return processed;
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

/** Worker şeridi: kendi döngüsünde, kendi partisiyle çalışan iş alt kümesi. */
export interface WorkerLane {
  name: string;
  /** Şeridin işleri (SQL süzgeci, `jobs` tablosu kolonları üzerinde). */
  where: SQL;
  batchSize: number;
  /** Cron zamanlama ve takılı iş kurtarma bu şeritte çalışır (tek şeritte). */
  housekeeping?: boolean;
}

const WHATSAPP_JOBS = sql`(queue in ('wa-outbound', 'wa-media') or type = 'platform.alert')`;
const SMS_JOBS = sql`(type = 'sms.send')`;

/**
 * Varsayılan şeritler: dış sağlayıcıya giden işler (WhatsApp, SMS) ayrı döngülerde ve küçük partilerle çalışır.
 * Sağlayıcı yavaşlayınca (istek başına 15 sn zaman aşımı) alarm zinciri, sipariş zaman aşımları, bildirim kararları
 * ve cron işleri onların arkasında beklemez; WhatsApp kesintisi SMS yedeğini de bekletmez.
 */
export const DEFAULT_WORKER_LANES: readonly WorkerLane[] = [
  { name: 'main', where: sql`not ${WHATSAPP_JOBS} and not ${SMS_JOBS}`, batchSize: 10, housekeeping: true },
  { name: 'whatsapp', where: WHATSAPP_JOBS, batchSize: 5 },
  { name: 'sms', where: SMS_JOBS, batchSize: 5 },
];

export interface RunWorkerOptions {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
  signal: AbortSignal;
  workerId?: string;
  pollMs?: number;
  /** Tek şerit (`queues`) parti boyu; şeritlerde her şeridin kendi `batchSize`'ı geçerlidir. */
  batchSize?: number;
  /** Verilirse tek şerit yalnız bu kuyruklarla çalışır (testler); verilmezse `lanes` ya da DEFAULT_WORKER_LANES. */
  queues?: readonly Queue[];
  lanes?: readonly WorkerLane[];
  /** Her döngü turunda çağrılır (worker.ts gözetçisi: döngü takılırsa süreç yeniden başlatılır). */
  onHeartbeat?: (lane: string) => void;
  enableCron?: boolean;
  /** Geçici DB hatasında ilk bekleme (katlanarak artar; varsayılan 1 sn). */
  transientBackoffMs?: number;
  /** Geçici DB hatasında en uzun bekleme (varsayılan 5 sn: şema geri gelince işler gecikmeden sürsün). */
  transientBackoffMaxMs?: number;
}

/** Geçici hata günlüğü en çok bu aralıkla yazılır. */
export const TRANSIENT_LOG_INTERVAL_MS = 60_000;

// Postgres SQLSTATE: şema/tablo yok (dev/e2e sıfırlaması sırasında), veritabanı yok, sunucu kapanıyor/açılıyor,
// bağlantı sınırı ve bağlantı hataları (08xxx); ayrıca Node.js ve postgres-js bağlantı hata kodları.
const TRANSIENT_PG_CODES = new Set(['42P01', '3F000', '3D000', '57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006']);
const TRANSIENT_NET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
]);

/** Geçici sayılan hata kodu (yoksa null). Drizzle sarmalayıcısının `cause` zinciri ve AggregateError taranır. */
function transientCode(err: unknown, depth = 0): string | null {
  if (!err || typeof err !== 'object' || depth > 5) return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && (TRANSIENT_PG_CODES.has(code) || TRANSIENT_NET_CODES.has(code))) return code;
  const errors = (err as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    for (const e of errors) {
      const c = transientCode(e, depth + 1);
      if (c) return c;
    }
  }
  return transientCode((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * Worker döngüsünü durdurmaması, yalnız bekletmesi gereken hata mı: `relation "jobs" does not exist` (42P01; şema
 * sıfırlanırken), bağlantı reddedildi/koptu vb.
 */
export function isTransientDbError(err: unknown): boolean {
  return transientCode(err) != null;
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

/** Geçici DB hatası dönemi (şeritler arasında ortak: dakikada en çok bir uyarı, düzelince bir bilgi). */
interface OutageState {
  since: number | null;
  errors: number;
  warned: boolean;
  lastLog: number;
}

/**
 * Şeritleri (DEFAULT_WORKER_LANES) eşzamanlı çalıştırır; her şerit 250 ms'de bir vadesi gelen işlerini işler.
 * `signal` iptal edilince sürmekte olan iş biter, alınmış ama başlanmamış işler sıraya geri verilir.
 * Geçici DB hatasında (isTransientDbError) çökmez: katlanan beklemeyle yeniden dener, dakikada en çok bir uyarı yazar,
 * bağlantı dönünce bir kez bilgi verir.
 */
export async function runWorker(opts: RunWorkerOptions): Promise<void> {
  const workerId = opts.workerId ?? `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const lanes: readonly WorkerLane[] = opts.queues?.length
    ? [{ name: 'main', where: sql`true`, batchSize: opts.batchSize ?? 20, housekeeping: true }]
    : (opts.lanes ?? DEFAULT_WORKER_LANES);
  const outage: OutageState = { since: null, errors: 0, warned: false, lastLog: 0 };
  opts.log.info(
    { workerId, lanes: lanes.map((l) => l.name), handlers: registeredJobTypes(), crons: registeredCrons().map((c) => c.name) },
    'worker başladı',
  );
  await Promise.all(lanes.map((lane) => runLane(opts, lane, lanes.length > 1 ? `${workerId}:${lane.name}` : workerId, outage)));
  opts.log.info({ workerId }, 'worker durdu');
}

async function runLane(opts: RunWorkerOptions, lane: WorkerLane, workerId: string, outage: OutageState): Promise<void> {
  const pollMs = opts.pollMs ?? 250;
  const backoffBase = opts.transientBackoffMs ?? 1_000;
  const backoffMax = opts.transientBackoffMaxMs ?? 5_000;
  let lastCron = 0;
  let lastRecover = 0;
  while (!opts.signal.aborted) {
    opts.onHeartbeat?.(lane.name);
    try {
      const now = Date.now();
      if (lane.housekeeping && opts.enableCron !== false && now - lastCron >= 15_000) {
        lastCron = now;
        await scheduleCronJobs(opts.db, new Date(now));
      }
      if (lane.housekeeping && now - lastRecover >= 60_000) {
        lastRecover = now;
        const n = await recoverStaleJobs(opts.db);
        if (n) opts.log.warn({ count: n }, 'takılı işler geri alındı');
      }
      const processed = await processDueJobs({
        db: opts.db,
        config: opts.config,
        log: opts.log,
        workerId,
        limit: lane.batchSize,
        queues: opts.queues,
        where: lane.where,
        signal: opts.signal,
      });
      if (outage.since != null) {
        if (outage.warned) opts.log.info({ workerId, downMs: Date.now() - outage.since, errors: outage.errors }, 'worker: veritabanı yeniden erişilebilir');
        outage.since = null;
        outage.errors = 0;
        outage.warned = false;
      }
      if (processed === 0) await sleep(pollMs, opts.signal);
    } catch (err) {
      if (!isTransientDbError(err)) {
        opts.log.error({ err, lane: lane.name }, 'worker döngü hatası');
        await sleep(1_000, opts.signal);
        continue;
      }
      const now = Date.now();
      outage.since ??= now;
      outage.errors++;
      if (now - outage.lastLog >= TRANSIENT_LOG_INTERVAL_MS) {
        outage.lastLog = now;
        outage.warned = true;
        opts.log.warn(
          { workerId, code: transientCode(err), message: err instanceof Error ? err.message : String(err), errors: outage.errors },
          'worker: veritabanı geçici olarak erişilemiyor (şema sıfırlanıyor ya da bağlantı yok); bekleniyor',
        );
      }
      await sleep(Math.min(backoffBase * 2 ** Math.min(outage.errors - 1, 16), backoffMax), opts.signal);
    }
  }
}
