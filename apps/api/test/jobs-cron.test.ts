// Kuyruk emniyet cron'ları (jobs/cron/index.ts):
//  - cron.order_new_watch (06 §7.6, §8.5; denetim H3): alarm zinciri işi kaybolmuş ya da `failed` olmuş `new`
//    siparişin eksik adımlarını ORİJİNAL zamanıyla yeniden kuyruğa atar.
//  - cron.jobs_dlq_watch (denetim H21/H26): kalıcı başarısız iş birikmesi uyarısı. `failed` iş saklaması bu
//    cron'da DEĞİL, `jobs/system` içindeki `cron.retention` koşusundadır (retention.test.ts).

import { jobs, orders } from '@siparis/db';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DLQ_ALERT_THRESHOLD,
  ORDER_NEW_WATCH_MAX_JOBS_PER_STEP,
  ORDER_NEW_WATCH_WINDOW_MS,
  registerCronJobs,
  watchNewOrders,
} from '../src/jobs/cron/index';
import { resetAlertCooldown } from '../src/lib/alert';
import { enqueueJob, processDueJobs, registeredCrons, scheduleCronJobs } from '../src/lib/jobs';
import { alarmDedupeKey } from '../src/services/orders/alarm-policy';
import { setHttpFetch } from '../src/wa/http';
import { createTestContext, type TestContext, type TestTenant } from './helpers';

let ctx: TestContext;
let t: TestTenant;
const log = pino({ level: 'silent' });
const MIN = 60_000;

/** Türkçe: siparişin alarm adımı işleri (yük içindeki orderId'ye göre). */
async function alarmJobs(orderId: string) {
  const rows = (await ctx.db.execute<{ id: string; step: string; status: string; run_at: Date; dedupe_key: string }>(sql`
    select id, payload->>'step' as step, status, run_at, dedupe_key from jobs
     where type = 'order.alarm_step' and payload->>'orderId' = ${orderId}
     order by (payload->>'step')::int`)) as unknown as { id: string; step: string; status: string; run_at: Date; dedupe_key: string }[];
  return rows;
}

/** Siparişi `new`den çıkarır: sonraki testlerin taramasına karışmasın. */
async function closeOrder(orderId: string) {
  await ctx.db.update(orders).set({ status: 'delivered' }).where(eq(orders.id, orderId));
}

async function newOrder(opts: { placedMinutesAgo?: number; channel?: 'web' | 'manual'; testKind?: 'onboarding_test' | 'canary' } = {}) {
  const placedAt = new Date(Date.now() - (opts.placedMinutesAgo ?? 0) * MIN);
  const order = await ctx.createOrder({
    tenantId: t.tenantId,
    branchId: t.branchId,
    status: 'new',
    extra: { placedAt, ...(opts.channel ? { channel: opts.channel } : {}), ...(opts.testKind ? { testKind: opts.testKind } : {}) },
  });
  return order;
}

function captureLog(): { log: FastifyBaseLogger; lines: { level: string; msg: string; obj: Record<string, unknown> }[] } {
  const lines: { level: string; msg: string; obj: Record<string, unknown> }[] = [];
  const at =
    (level: string) =>
    (obj: unknown, msg?: string) => {
      lines.push({ level, msg: msg ?? (typeof obj === 'string' ? obj : ''), obj: (obj ?? {}) as Record<string, unknown> });
    };
  const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal') } as Record<
    string,
    unknown
  >;
  logger.child = () => logger;
  return { log: logger as unknown as FastifyBaseLogger, lines };
}

beforeAll(async () => {
  ctx = await createTestContext();
  registerCronJobs();
  t = await ctx.createTenantWithOwner({ name: 'Emniyet Cron' });
});
afterAll(async () => {
  await ctx.close();
});
let savedWebhook: string | undefined;
afterEach(() => {
  setHttpFetch(null);
  resetAlertCooldown();
  if (savedWebhook === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = savedWebhook;
});

describe('cron kayıtları', () => {
  it('order_new_watch dakikada bir, jobs_dlq_watch 15 dakikada bir kayıtlı', () => {
    const watch = registeredCrons().find((c) => c.type === 'cron.order_new_watch');
    expect(watch?.schedule).toEqual({ everyMinutes: 1 });
    const dlq = registeredCrons().find((c) => c.type === 'cron.jobs_dlq_watch');
    expect(dlq?.schedule).toEqual({ everyMinutes: 15 });
  });
});

describe('cron.order_new_watch', () => {
  it('zinciri hiç olmayan `new` sipariş: tüm adımlar orijinal zamanıyla kuyruğa girer', async () => {
    const order = await newOrder();
    expect(await alarmJobs(order.id)).toHaveLength(0);

    const now = new Date();
    const res = await watchNewOrders(ctx.db, now);
    expect(res.orderIds).toContain(order.id);

    const rows = await alarmJobs(order.id);
    // Varsayılan politika: 60 sn tekrar, 2 dk platform WA, 5 dk SMS, 10 dk müşteri bilgisi, 15 dk otomatik iptal
    expect(rows.map((r) => Number(r.step))).toEqual([2, 3, 4, 5, 6]);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(rows.map((r) => r.dedupe_key)).toEqual([2, 3, 4, 5, 6].map((s) => alarmDedupeKey(order.id, s)));
    // Zincir baştan BAŞLATILMAZ: adım zamanları siparişin `new` olduğu andan hesaplanır
    const base = order.placedAt.getTime();
    const delays = { 2: 1, 3: 2, 4: 5, 5: 10, 6: 15 };
    for (const r of rows) {
      const expected = base + delays[Number(r.step) as keyof typeof delays] * MIN;
      expect(Math.abs(new Date(r.run_at).getTime() - expected), `adım ${r.step}`).toBeLessThan(2000);
    }

    // İdempotent: ikinci koşuda adımlar `pending` olduğu için hiçbir şey eklenmez
    const again = await watchNewOrders(ctx.db, now);
    expect(again.orderIds).not.toContain(order.id);
    expect(await alarmJobs(order.id)).toHaveLength(5);
    await closeOrder(order.id);
  });

  it('`done` adım yeniden kurulmaz, `failed`/`cancelled` adım yeniden kurulur', async () => {
    const order = await newOrder();
    await watchNewOrders(ctx.db);
    const rows = await alarmJobs(order.id);
    const doneId = rows.find((r) => Number(r.step) === 2)!.id;
    const failedId = rows.find((r) => Number(r.step) === 6)!.id;
    await ctx.db.execute(sql`update jobs set status = 'done', finished_at = now() where id = ${doneId}`);
    await ctx.db.execute(sql`update jobs set status = 'failed', finished_at = now() where id = ${failedId}`);

    const res = await watchNewOrders(ctx.db);
    expect(res.orderIds).toContain(order.id);
    expect(res.requeued).toBeGreaterThanOrEqual(1);
    const after = await alarmJobs(order.id);
    // Adım 2 tek satır kalır (done); adım 6 için yeni bir pending satır açılır
    expect(after.filter((r) => Number(r.step) === 2)).toHaveLength(1);
    const step6 = after.filter((r) => Number(r.step) === 6);
    expect(step6).toHaveLength(2);
    expect(step6.filter((r) => r.status === 'pending')).toHaveLength(1);
    await closeOrder(order.id);
  });

  // H-a1: TAM tekillik altında `failed` adım anahtarını TUTAR. Onarım bu yüzden bir sonraki NESLİ açar
  // (`alarm:<sipariş>:<adım>#g1`, `#g2` …). Nesil olmadan `enqueueJob` null döner, `repaired = 0` olduğu için
  // `order_new_watch` uyarısı bile gitmez ve sipariş sessizce `new` kalır: 15 dk `tenant_no_response` iptali
  // hiç çalışmaz (= kaçan sipariş).
  it('kalıcı başarısız adım bir sonraki nesille yerine konur (anahtar işgali kurtarmayı engellemez)', async () => {
    const order = await newOrder();
    await watchNewOrders(ctx.db);
    const step6 = (await alarmJobs(order.id)).find((r) => Number(r.step) === 6)!;
    expect(step6.dedupe_key, 'ilk onarım çıplak anahtar (nesil 0)').toBe(alarmDedupeKey(order.id, 6));
    await ctx.db.execute(sql`update jobs set status = 'failed', finished_at = now() where id = ${step6.id}`);

    const res = await watchNewOrders(ctx.db);
    expect(res.orderIds).toContain(order.id);
    expect(res.requeued).toBeGreaterThanOrEqual(1);
    const g1 = (await alarmJobs(order.id)).filter((r) => Number(r.step) === 6 && r.status === 'pending');
    expect(g1).toHaveLength(1);
    expect(g1[0]!.dedupe_key).toBe(`${alarmDedupeKey(order.id, 6)}#g1`);

    // Nesil 1 de kalıcı başarısız olursa nesil 2 açılır: kurtarma tıkanmaz (sınır ORDER_NEW_WATCH_MAX_JOBS_PER_STEP)
    await ctx.db.execute(sql`update jobs set status = 'failed', finished_at = now() where id = ${g1[0]!.id}`);
    await watchNewOrders(ctx.db);
    const g2 = (await alarmJobs(order.id)).filter((r) => Number(r.step) === 6 && r.status === 'pending');
    expect(g2).toHaveLength(1);
    expect(g2[0]!.dedupe_key).toBe(`${alarmDedupeKey(order.id, 6)}#g2`);
    await closeOrder(order.id);
  });

  // Bekleyen ret ertelemesinde adımın nesil 0 satırı `done` olur ama adım ÇALIŞMAMIŞTIR. Canlılık en yüksek
  // nesille ölçülmezse (eskiden "herhangi bir `done` satır varsa canlı"), devralan satır kalıcı başarısız olduğunda
  // adım sonsuza kadar onarılamaz sayılırdı — ret geri alınsa bile.
  it('erteleme zincirinin son nesli başarısızsa adım onarılır (`done` nesil 0 satırı yanıltmaz)', async () => {
    const order = await newOrder();
    await watchNewOrders(ctx.db);
    const rows = await alarmJobs(order.id);
    const base = rows.find((r) => Number(r.step) === 3)!;
    // Nesil 0 `done` (ertelemeyi devretti) + nesil 1 kalıcı `failed`
    await ctx.db.execute(sql`update jobs set status = 'done', finished_at = now() where id = ${base.id}`);
    await ctx.db.execute(sql`
      insert into jobs (queue, type, payload, status, dedupe_key, tenant_id, run_at, finished_at)
      values ('notify', 'order.alarm_step',
              ${JSON.stringify({ orderId: order.id, tenantId: t.tenantId, branchId: t.branchId, step: 3, gen: 1 })}::jsonb,
              'failed', ${`${alarmDedupeKey(order.id, 3)}#g1`}, ${t.tenantId}, now(), now())`);

    const res = await watchNewOrders(ctx.db);
    expect(res.orderIds).toContain(order.id);
    const pending3 = (await alarmJobs(order.id)).filter((r) => Number(r.step) === 3 && r.status === 'pending');
    expect(pending3).toHaveLength(1);
    expect(pending3[0]!.dedupe_key).toBe(`${alarmDedupeKey(order.id, 3)}#g2`);
    await closeOrder(order.id);
  });

  it('vakti geçmiş otomatik iptal adımı HEMEN çalışacak şekilde eklenir (15 dk yanıtsız sipariş kapanır)', async () => {
    const order = await newOrder({ placedMinutesAgo: 40 });
    const now = new Date();
    await watchNewOrders(ctx.db, now);
    const rows = await alarmJobs(order.id);
    expect(rows).toHaveLength(5);
    // Hepsinin vadesi geçmiş: run_at şimdiye çekilir, geçmişe yazılmaz
    for (const r of rows) {
      expect(new Date(r.run_at).getTime()).toBeLessThanOrEqual(now.getTime() + 2000);
      expect(new Date(r.run_at).getTime()).toBeGreaterThanOrEqual(now.getTime() - 2000);
    }
    await closeOrder(order.id);
  });

  it('bekleyen retteki sipariş taranmaz (eskalasyon bilerek duruyor)', async () => {
    const order = await newOrder();
    await ctx.db
      .update(orders)
      .set({ rejectionScheduledAt: new Date(), rejectionReason: 'item_unavailable' })
      .where(eq(orders.id, order.id));
    const res = await watchNewOrders(ctx.db);
    expect(res.orderIds).not.toContain(order.id);
    expect(await alarmJobs(order.id)).toHaveLength(0);
    await ctx.db.update(orders).set({ rejectionScheduledAt: null, rejectionReason: null }).where(eq(orders.id, order.id));
    await closeOrder(order.id);
  });

  it('telefon siparişi (manual) ve pencere dışı sipariş taranmaz', async () => {
    const manual = await newOrder({ channel: 'manual' });
    const old = await newOrder({ placedMinutesAgo: ORDER_NEW_WATCH_WINDOW_MS / MIN + 60 });
    const res = await watchNewOrders(ctx.db);
    expect(res.orderIds).not.toContain(manual.id);
    expect(res.orderIds).not.toContain(old.id);
    expect(await alarmJobs(manual.id)).toHaveLength(0);
    expect(await alarmJobs(old.id)).toHaveLength(0);
    await closeOrder(manual.id);
    await closeOrder(old.id);
  });

  it('sürekli başarısız adım: satır sınırında durur ve kritik uyarı verir (sonsuz döngü yok)', async () => {
    const order = await newOrder();
    for (let i = 0; i < ORDER_NEW_WATCH_MAX_JOBS_PER_STEP; i++) {
      await watchNewOrders(ctx.db);
      await ctx.db.execute(sql`
        update jobs set status = 'failed', finished_at = now()
         where type = 'order.alarm_step' and payload->>'orderId' = ${order.id} and status = 'pending'`);
    }
    const before = (await alarmJobs(order.id)).length;
    const { log: capture, lines } = captureLog();
    const res = await watchNewOrders(ctx.db, new Date(), { log: capture });
    expect(res.exhausted).toContain(order.id);
    expect(res.requeued).toBe(0);
    expect(await alarmJobs(order.id)).toHaveLength(before);
    await new Promise((r) => setTimeout(r, 10));
    expect(lines.filter((l) => (l.obj as { alert?: string }).alert === 'order_new_watch_exhausted')).toHaveLength(1);
    await closeOrder(order.id);
  });

  it('cron işleyicisi worker yolundan çalışır', async () => {
    const order = await newOrder();
    await scheduleCronJobs(ctx.db);
    await processDueJobs({ db: ctx.db, config: ctx.config, log, queues: ['cron'] });
    expect((await alarmJobs(order.id)).length).toBeGreaterThan(0);
    await closeOrder(order.id);
  });
});

describe('cron.jobs_dlq_watch', () => {
  /** Verilen yaşta kalıcı başarısız iş satırı (yükünde kişisel veri ile). */
  async function failedJob(opts: { daysAgo: number; type?: string; payload?: Record<string, unknown> }) {
    const [row] = (await ctx.db.execute<{ id: string }>(sql`
      insert into jobs (queue, type, payload, status, attempts, max_attempts, last_error, finished_at, run_at)
      values ('notify', ${opts.type ?? 'sms.send'},
              ${JSON.stringify(opts.payload ?? { to: '+905321234567', body: 'Yemek Gelsin doğrulama kodunuz: 482913', purpose: 'otp', orderId: 'o-1' })}::jsonb,
              'failed', 5, 5, 'sağlayıcı 500',
              now() - make_interval(days => ${opts.daysAgo}), now() - make_interval(days => ${opts.daysAgo}))
      returning id`)) as unknown as { id: string }[];
    return row!.id;
  }

  it('eşik aşılınca kritik uyarı gider, altında gitmez', async () => {
    await ctx.db.delete(jobs);
    savedWebhook = process.env.ALERT_WEBHOOK_URL;
    process.env.ALERT_WEBHOOK_URL = 'https://uyari.example.test/kanca';
    const posts: Record<string, unknown>[] = [];
    setHttpFetch(async (_url, init) => {
      posts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response('', { status: 204 });
    });

    // Cron işini doğrudan kuyruğa atarız: `scheduleCronJobs` aynı 15 dk dilimini ikinci kez eklemez (dilim tekilliği)
    const handler = async () => {
      const { log: capture, lines } = captureLog();
      await enqueueJob(ctx.db, { queue: 'cron', type: 'cron.jobs_dlq_watch' });
      await processDueJobs({ db: ctx.db, config: ctx.config, log: capture, queues: ['cron'] });
      await new Promise((r) => setTimeout(r, 30));
      return lines;
    };

    // Eşiğin altında: uyarı yok
    for (let i = 0; i < DLQ_ALERT_THRESHOLD; i++) await failedJob({ daysAgo: 0, type: 'wa.send', payload: { orderId: `o-${i}` } });
    let lines = await handler();
    expect(lines.filter((l) => (l.obj as { alert?: string }).alert === 'jobs_dlq_threshold')).toHaveLength(0);
    expect(posts).toHaveLength(0);

    // Eşiğin üstünde: kritik uyarı + webhook; gövdede iş türü sayıları, YÜK YOK
    await ctx.db.delete(jobs);
    resetAlertCooldown();
    for (let i = 0; i < DLQ_ALERT_THRESHOLD + 2; i++) await failedJob({ daysAgo: 0, type: 'wa.send', payload: { orderId: `o-${i}` } });
    lines = await handler();
    const alertLine = lines.find((l) => (l.obj as { alert?: string }).alert === 'jobs_dlq_threshold');
    expect(alertLine, 'eşik aşımı uyarısı').toBeTruthy();
    expect(alertLine!.level).toBe('error');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: 'jobs_dlq_threshold', severity: 'critical' });
    const data = (posts[0] as { data: { failed: number; types: string[] } }).data;
    expect(data.failed).toBe(DLQ_ALERT_THRESHOLD + 2);
    expect(data.types).toContain(`wa.send=${DLQ_ALERT_THRESHOLD + 2}`);
    expect(JSON.stringify(posts[0])).not.toContain('905321234567');
    await ctx.db.delete(jobs);
  });
});
