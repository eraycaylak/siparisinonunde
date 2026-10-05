// Sentetik canary (06 §7.10; denetim H4 / iş 3.6) — services/canary + jobs/cron kayıtları.
// Kapsam: sipariş GERÇEK yoldan oluşuyor (fiyat → DB → branch_events) ve sözleşmeye uyuyor (number = 0, alarm
// zinciri yok, dış bildirim yok), ack geldiğinde süre ölçülüp kayıt siliniyor, ack gelmeyince SSE'ye `resync` +
// 2. ARDIŞIK turda uyarı gidiyor, kayıt rapora karışmıyor, 10 dk sonra süpürülüyor, `CANARY_ENABLED` kapalıyken
// hiç sipariş üretilmiyor ve emniyet ağı `order_new_watch` canary'yi taramıyor.

import { branchEvents, branchPanelPresence, jobs, orders, tenants } from '@siparis/db';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerAllJobs } from '../src/jobs/index';
import { watchNewOrders } from '../src/jobs/cron/index';
import { resetAlertCooldown } from '../src/lib/alert';
import { processDueJobs, registeredCrons, scheduleCronJobs } from '../src/lib/jobs';
import {
  CANARY_ACK_TIMEOUT_MS,
  CANARY_CUSTOMER_NAME,
  CANARY_DUE_WINDOW_MS,
  CANARY_INTERVAL_MS,
  CANARY_MAX_AGE_MS,
  CANARY_RUN_JOB,
  CANARY_VERIFY_JOB,
  canaryJitterMs,
  canaryRunKey,
  canarySlot,
  createCanaryOrder,
  dueCanaryBranches,
  isCanaryDue,
  previousCanaryStale,
  purgeExpiredCanaryOrders,
  runCanaryTick,
  verifyCanaryOrder,
} from '../src/services/canary/index';
import { dailyReport, todayIstanbul } from '../src/services/reports/index';
import { createTestContext, type TestContext } from './helpers';
import { setupStore, type StoreFixture } from './orders-helpers';

let ctx: TestContext;
let s: StoreFixture;
const log = pino({ level: 'silent' });

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

/** Şubenin canary siparişleri (varsa). */
async function canaryOrders(branchId: string) {
  return ctx.db
    .select()
    .from(orders)
    .where(and(eq(orders.branchId, branchId), eq(orders.testKind, 'canary')));
}

/** Siparişin alarm zinciri işleri (durumla birlikte). */
async function alarmJobs(orderId: string) {
  return (await ctx.db.execute<{ status: string }>(sql`
    select status from jobs where type = 'order.alarm_step' and payload->>'orderId' = ${orderId}`)) as unknown as { status: string }[];
}

async function resyncEvents(branchId: string) {
  return ctx.db
    .select()
    .from(branchEvents)
    .where(and(eq(branchEvents.branchId, branchId), eq(branchEvents.type, 'resync')));
}

beforeAll(async () => {
  ctx = await createTestContext();
  registerAllJobs();
  s = await setupStore(ctx, { slug: 'canary-test' });
});
afterAll(async () => {
  await ctx.close();
});

let savedEnabled: string | undefined;
let savedStaleAlert: string | undefined;
beforeEach(() => {
  savedEnabled = process.env.CANARY_ENABLED;
  savedStaleAlert = process.env.CANARY_STALE_ALERT;
});
afterEach(async () => {
  if (savedEnabled === undefined) delete process.env.CANARY_ENABLED;
  else process.env.CANARY_ENABLED = savedEnabled;
  if (savedStaleAlert === undefined) delete process.env.CANARY_STALE_ALERT;
  else process.env.CANARY_STALE_ALERT = savedStaleAlert;
  resetAlertCooldown();
  // Testler arası sızıntı olmasın: sentetik sipariş, varlık satırı ve canary işleri temizlenir
  await ctx.db.delete(orders).where(eq(orders.testKind, 'canary'));
  await ctx.db.delete(branchPanelPresence).where(eq(branchPanelPresence.branchId, s.branchId));
  await ctx.db.delete(branchEvents).where(and(eq(branchEvents.branchId, s.branchId), eq(branchEvents.type, 'resync')));
  await ctx.db.execute(sql`delete from jobs where type in (${CANARY_RUN_JOB}, ${CANARY_VERIFY_JOB})`);
});

describe('cron kaydı', () => {
  it('cron.canary dakikada bir kayıtlı', () => {
    const c = registeredCrons().find((x) => x.type === 'cron.canary');
    expect(c?.schedule).toEqual({ everyMinutes: 1 });
  });
});

describe('dilim ve sapma', () => {
  it('sapma şubeye göre sabit ve aralığın içinde', () => {
    const a = canaryJitterMs(s.branchId);
    expect(a).toBe(canaryJitterMs(s.branchId));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(CANARY_INTERVAL_MS);
  });

  it('dilim penceresinin içinde vadesi gelir, dışında gelmez', () => {
    const start = new Date(canarySlot(s.branchId, new Date()).startedAtMs);
    expect(isCanaryDue(s.branchId, start)).toBe(true);
    expect(isCanaryDue(s.branchId, new Date(start.getTime() + CANARY_DUE_WINDOW_MS - 1))).toBe(true);
    // Pencere kapandıktan sonra ama bir sonraki dilim başlamadan önce: vade yok
    expect(isCanaryDue(s.branchId, new Date(start.getTime() + CANARY_DUE_WINDOW_MS + 1_000))).toBe(false);
    // Bir sonraki dilimin başı: yeniden vade
    expect(isCanaryDue(s.branchId, new Date(start.getTime() + CANARY_INTERVAL_MS))).toBe(true);
  });
});

describe('canary siparişi oluşuyor', () => {
  it('gerçek yoldan geçer; number 0, alarm zinciri ve dış bildirim yok', async () => {
    const [before] = await ctx.db.select({ seq: tenants.orderSeq }).from(tenants).where(eq(tenants.id, s.tenantId));
    const now = new Date();
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId }, now);
    expect(res.created).toBe(true);
    if (!res.created) return;

    const [o] = await canaryOrders(s.branchId);
    expect(o).toMatchObject({
      testKind: 'canary',
      status: 'new',
      // İşletmenin sipariş numarası sayacını tüketmez (06 §7.10)
      number: 0,
      // Dış bildirim yolları kapalı: müşteri kaydı ve durum mesajı kanalı yok
      statusNotifyChannel: 'none',
      customerId: null,
      customerPhone: null,
      customerName: CANARY_CUSTOMER_NAME,
    });
    // Fiyat SUNUCUDA hesaplandı: kalem ve toplamlar menüden geldi (0 ₺ sipariş yazılmadı)
    expect(o!.totalKurus).toBeGreaterThan(0);
    expect(o!.subtotalKurus + o!.deliveryFeeKurus).toBe(o!.totalKurus);
    // Zorunlu seçeneği olan ürün (Kıymalı Pide) seçilmez: fiyatlanamaz ve canary her turda susardı
    const items = (await ctx.db.execute<{ product_id: string }>(sql`
      select product_id from order_items where order_id = ${o!.id}`)) as unknown as { product_id: string }[];
    expect(items.map((i) => i.product_id)).not.toContain(s.pideId);

    // Sayaç dokunulmadı
    const [after] = await ctx.db.select({ seq: tenants.orderSeq }).from(tenants).where(eq(tenants.id, s.tenantId));
    expect(after!.seq).toBe(before!.seq);

    // branch_events 'order.created' yazıldı (SSE kaynağı)
    const created = (await ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from branch_events
       where branch_id = ${s.branchId} and type = 'order.created' and payload->'order'->>'id' = ${o!.id}`)) as unknown as { n: number }[];
    expect(created[0]!.n).toBe(1);

    // Alarm zinciri planlandı ama aynı transaction'da iptal edildi: bekleyen adım YOK
    const chain = await alarmJobs(o!.id);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.filter((r) => r.status === 'pending')).toHaveLength(0);

    // Web Push işi hiç kurulmadı (services/push/send canary kapısı)
    expect(await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `push:new_order:${o!.id}`))).toHaveLength(0);

    // Ack kontrolü 60 sn sonraya kuruldu
    const [verify] = await ctx.db.select().from(jobs).where(eq(jobs.type, CANARY_VERIFY_JOB));
    expect(verify).toBeDefined();
    expect(verify!.runAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + CANARY_ACK_TIMEOUT_MS - 2_000);
  });

  it('emniyet ağı order_new_watch canary siparişini taramaz (zincir geri kurulmaz)', async () => {
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    expect(res.created).toBe(true);
    if (!res.created) return;
    const out = await watchNewOrders(ctx.db);
    expect(out.orderIds).not.toContain(res.orderId);
    expect((await alarmJobs(res.orderId)).filter((r) => r.status === 'pending')).toHaveLength(0);
  });

  it('rapora, ciroya ve sipariş sayısına karışmaz', async () => {
    const before = await dailyReport(ctx.db, { tenantId: s.tenantId, branchId: s.branchId }, todayIstanbul());
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    expect(res.created).toBe(true);
    const after = await dailyReport(ctx.db, { tenantId: s.tenantId, branchId: s.branchId }, todayIstanbul());
    expect(after.receivedCount).toBe(before.receivedCount);
    expect(after.revenueKurus).toBe(before.revenueKurus);
    expect(after.byStatus).toEqual(before.byStatus);
  });

  it('kapalı şubede ve menüsüz işletmede sipariş üretilmez', async () => {
    const closed = await ctx.createTenantWithOwner({ name: 'Canary Kapalı' });
    // Çalışma saatleri silinince şube kapalı sayılır
    await ctx.db.execute(sql`delete from opening_hours where branch_id = ${closed.branchId}`);
    expect(await createCanaryOrder(ctx.db, { tenantId: closed.tenantId, branchId: closed.branchId })).toMatchObject({
      created: false,
      reason: 'closed',
    });

    const empty = await ctx.createTenantWithOwner({ name: 'Canary Menüsüz' });
    expect(await createCanaryOrder(ctx.db, { tenantId: empty.tenantId, branchId: empty.branchId })).toMatchObject({
      created: false,
      reason: 'menu_empty',
    });
  });
});

describe('ack kontrolü', () => {
  it('ack geldiyse süre ölçülür ve kayıt silinir', async () => {
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!res.created) throw new Error('canary siparişi oluşmadı');
    const ackedAt = new Date(res.placedAt.getTime() + 1_500);
    await ctx.db.update(orders).set({ firstAckedAt: ackedAt }).where(eq(orders.id, res.orderId));

    const { log: capture, lines } = captureLog();
    const out = await verifyCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId, orderId: res.orderId }, { log: capture });
    expect(out.outcome).toBe('acked');
    expect(out.ackMs).toBe(1_500);
    expect(await canaryOrders(s.branchId)).toHaveLength(0);
    expect(lines.some((l) => (l.obj as { canary?: string }).canary === 'ack')).toBe(true);
  });

  it('ack gelmediyse SSE resync gider, kayıt silinir; İLK turda uyarı yok', async () => {
    process.env.CANARY_STALE_ALERT = '1';
    // Panel "çevrimiçi": uyarının önkoşulu sağlanmış olsun ki eşiğin tek başına yetmediği görülsün
    await ctx.db.insert(branchPanelPresence).values({ branchId: s.branchId, tenantId: s.tenantId, lastSeenAt: new Date() });
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!res.created) throw new Error('canary siparişi oluşmadı');

    const { log: capture, lines } = captureLog();
    const out = await verifyCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId, orderId: res.orderId }, { log: capture });
    expect(out).toMatchObject({ outcome: 'stale', streak: 1, resyncSent: true, alerted: false });
    expect(await resyncEvents(s.branchId)).toHaveLength(1);
    expect(await canaryOrders(s.branchId)).toHaveLength(0);
    expect(lines.filter((l) => (l.obj as { alert?: string }).alert === 'canary_stale_panel')).toHaveLength(0);
  });

  it('CANARY_STALE_ALERT kapalıyken bayat panel sinyali hiç üretilmez (resync + hata logu yok)', async () => {
    // Panel sessiz ack atmadığı sürece sonuç her turda kesin "bayat" çıkar: 15 dk'da bir kesin-yanlış sinyal
    // gerçek hataları gömer ve panelleri boşuna tazeletir. Sipariş üretme + temizlik yolu yine çalışmalı.
    delete process.env.CANARY_STALE_ALERT;
    await ctx.db.insert(branchPanelPresence).values({ branchId: s.branchId, tenantId: s.tenantId, lastSeenAt: new Date() });
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!res.created) throw new Error('canary siparişi oluşmadı');

    const { log: capture, lines } = captureLog();
    const out = await verifyCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId, orderId: res.orderId }, { log: capture });
    expect(out).toMatchObject({ outcome: 'stale', resyncSent: false, alerted: false });
    expect(await resyncEvents(s.branchId)).toHaveLength(0);
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(0);
    // Kayıt yine silinir (sentetik sipariş ekranlarda/raporda birikmez)
    expect(await canaryOrders(s.branchId)).toHaveLength(0);
  });

  it('2 ARDIŞIK başarısızlıkta uyarı gider (önceki tur başarılıysa gitmez)', async () => {
    process.env.CANARY_STALE_ALERT = '1';
    await ctx.db.insert(branchPanelPresence).values({ branchId: s.branchId, tenantId: s.tenantId, lastSeenAt: new Date() });

    // 1. tur: başarısız (sonucu işin yüküne yazılır)
    const first = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!first.created) throw new Error('canary siparişi oluşmadı');
    const [firstJob] = await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `canary_verify:${first.orderId}`));
    const r1 = await verifyCanaryOrder(
      ctx.db,
      { tenantId: s.tenantId, branchId: s.branchId, orderId: first.orderId, jobId: firstJob!.id },
      { log },
    );
    expect(r1).toMatchObject({ outcome: 'stale', streak: 1, alerted: false });
    expect(await previousCanaryStale(ctx.db, s.branchId)).toBe(true);

    // 2. tur: ardışık başarısızlık → kritik uyarı
    const second = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!second.created) throw new Error('ikinci canary siparişi oluşmadı');
    const [secondJob] = await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `canary_verify:${second.orderId}`));
    const { log: capture, lines } = captureLog();
    const r2 = await verifyCanaryOrder(
      ctx.db,
      { tenantId: s.tenantId, branchId: s.branchId, orderId: second.orderId, jobId: secondJob!.id },
      { log: capture },
    );
    expect(r2).toMatchObject({ outcome: 'stale', streak: 2, alerted: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(lines.filter((l) => (l.obj as { alert?: string }).alert === 'canary_stale_panel')).toHaveLength(1);
    expect(await resyncEvents(s.branchId)).toHaveLength(2);
  });

  it('cihaz çevrimdışıyken uyarı gitmez (panel çevrimdışı dedektörü zaten uyarıyor)', async () => {
    process.env.CANARY_STALE_ALERT = '1';
    // Varlık satırı yok = hiç görülmemiş panel
    const first = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!first.created) throw new Error('canary siparişi oluşmadı');
    const [j1] = await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `canary_verify:${first.orderId}`));
    await verifyCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId, orderId: first.orderId, jobId: j1!.id }, { log });
    const second = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!second.created) throw new Error('ikinci canary siparişi oluşmadı');
    const [j2] = await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, `canary_verify:${second.orderId}`));
    const out = await verifyCanaryOrder(
      ctx.db,
      { tenantId: s.tenantId, branchId: s.branchId, orderId: second.orderId, jobId: j2!.id },
      { log },
    );
    expect(out).toMatchObject({ outcome: 'stale', streak: 2, alerted: false });
  });

  it('başka tenant adına çağrı kaydı görmez (tenant yalıtımı)', async () => {
    const other = await ctx.createTenantWithOwner({ name: 'Canary Yabancı' });
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!res.created) throw new Error('canary siparişi oluşmadı');
    const out = await verifyCanaryOrder(ctx.db, { tenantId: other.tenantId, branchId: s.branchId, orderId: res.orderId }, { log });
    expect(out.outcome).toBe('missing');
    // Yabancı tenant'ın çağrısı kaydı SİLMEDİ
    expect(await canaryOrders(s.branchId)).toHaveLength(1);
  });
});

describe('temizlik ve açma/kapama', () => {
  it('10 dakikadan eski canary kaydı süpürülür, yenisi korunur', async () => {
    const fresh = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!fresh.created) throw new Error('canary siparişi oluşmadı');
    await ctx.db
      .update(orders)
      .set({ placedAt: new Date(Date.now() - CANARY_MAX_AGE_MS - 60_000) })
      .where(eq(orders.id, fresh.orderId));
    const old = fresh.orderId;
    const second = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!second.created) throw new Error('ikinci canary siparişi oluşmadı');

    expect(await purgeExpiredCanaryOrders(ctx.db)).toBe(1);
    const left = await canaryOrders(s.branchId);
    expect(left.map((o) => o.id)).toEqual([second.orderId]);
    expect(left.map((o) => o.id)).not.toContain(old);
  });

  it('CANARY_ENABLED kapalıyken sipariş üretilmez ama temizlik çalışır', async () => {
    delete process.env.CANARY_ENABLED;
    const res = await createCanaryOrder(ctx.db, { tenantId: s.tenantId, branchId: s.branchId });
    if (!res.created) throw new Error('canary siparişi oluşmadı');
    // Tur, dilim başıyla çağrılıyor; dilim başı gerçek saatin 15 dk gerisinde olabileceği için yaşı da ONA göre kur
    const tickNow = new Date(canarySlot(s.branchId, new Date()).startedAtMs);
    await ctx.db
      .update(orders)
      .set({ placedAt: new Date(tickNow.getTime() - CANARY_MAX_AGE_MS - 60_000) })
      .where(eq(orders.id, res.orderId));

    const out = await runCanaryTick(ctx.db, { log }, tickNow);
    expect(out).toMatchObject({ skipped: 'env', queued: 0, purged: 1 });
    await ctx.db.execute(sql`delete from jobs where type = ${CANARY_RUN_JOB}`);
  });

  it('CANARY_ENABLED açıkken dilimi gelen şube kuyruğa girer; aynı dilim ikinci kez eklenmez', async () => {
    process.env.CANARY_ENABLED = '1';
    const now = new Date(canarySlot(s.branchId, new Date()).startedAtMs);
    const due = await dueCanaryBranches(ctx.db, now);
    expect(due.map((d) => d.branchId)).toContain(s.branchId);

    const first = await runCanaryTick(ctx.db, { log }, now);
    expect(first.branchIds).toContain(s.branchId);
    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.dedupeKey, canaryRunKey(s.branchId, canarySlot(s.branchId, now).slot)));
    expect(job?.type).toBe(CANARY_RUN_JOB);

    // Dilim tekilliği: cron dakikada bir koşsa da aynı dilim ikinci işi eklemez
    const second = await runCanaryTick(ctx.db, { log, config: undefined }, new Date(now.getTime() + 60_000));
    expect(second.branchIds).not.toContain(s.branchId);
  });

  it('worker yolundan uçtan uca: cron → canary.run → sipariş', async () => {
    process.env.CANARY_ENABLED = '1';
    await scheduleCronJobs(ctx.db);
    await processDueJobs({ db: ctx.db, config: ctx.config, log, queues: ['cron'] });
    // cron.canary turu `canary.run` işlerini ekler; ikinci tur onları çalıştırır
    await processDueJobs({ db: ctx.db, config: ctx.config, log, queues: ['cron'] });
    const made = await canaryOrders(s.branchId);
    // Şubenin dilimi bu dakikaya denk gelmiyorsa sipariş çıkmaz; denk geldiyse sözleşmeye uygun olmalı
    for (const o of made) expect(o).toMatchObject({ testKind: 'canary', number: 0, statusNotifyChannel: 'none' });
  });
});
