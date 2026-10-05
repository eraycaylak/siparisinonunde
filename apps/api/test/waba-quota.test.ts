// Ortak numaranın 24 saatlik WABA konuşma kotası (denetim 2026-10-04 · açık soru 2).
//
// Kapsanan davranışlar:
//  - Ölçü mevcut kayıtlardan TÜRETİLİR: iş-kaynaklı konuşma = öncesinde 24 saat gelen mesaj olmayan giden mesaj;
//    pencere içi yanıt sayılmaz; kendi numarasındaki işletme sayılmaz; platform uyarıları (notifications) sayılır.
//  - Alıcı kimliği platform genelinde tekilleştirilir: aynı kişi iki dükkanla konuşursa Meta bir konuşma sayar.
//  - Eşik uyarıları (%70 warning, %90 critical, tavan dolu = ACİL) ve kiracı payı.
//  - Kalite derecesi okuması: okunabiliyorsa düşük derecede uyarı, okunamıyorsa UYDURULMAZ.
//  - Sağlayıcı basamağı okunabiliyorsa yapılandırılan tavanın yerine geçer.
//  - Gönderim kapısı: varsayılan KAPALI; açıkken yalnız önemsiz + yeni konuşma açan mesaj düşürülür, kritik gider,
//    düşürülen mesajın durum bütçesi geri verilir.
//  - Kapı yalnız gerçekten yer kazandıran mesajı düşürür: alıcıya son 24 saatte gönderilebilmiş bir mesaj varsa
//    yeni mesaj tavana bir şey eklemez (`recipientAlreadyBilled`) → düşürülmez.
//  - Meta 131048 (ve Twilio 63038) = tavanın GERÇEĞİ: kritik uyarı.

import { conversations, customers, messages, notifications, orders, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import { registerCronJobs } from '../src/jobs/cron/index';
import { resetAlertCooldown } from '../src/lib/alert';
import { getJobHandler, type JobRow } from '../src/lib/jobs';
import type { OutboundPayload } from '../src/services/messaging/outbound';
import { performWaSend, WABA_QUOTA_SHED_CODE } from '../src/services/messaging/send';
import {
  CRITICAL_ORDER_EVENTS,
  criticalReserve,
  detectWabaQuotaPressure,
  evaluateWabaQuality,
  isCriticalOutbound,
  measureWabaQuota,
  parseMessagingLimit,
  quotaLevel,
  recipientAlreadyBilled,
  resetQualityReadClock,
  resetQuotaGauge,
  resolveQuotaConfig,
  setQuotaGauge,
  shouldShedNonCritical,
  WABA_CONVERSATION_CAP_DEFAULT,
  WABA_GAUGE_TTL_MS,
  type WabaQualityReading,
} from '../src/services/messaging/waba-quota';
import { isMessagingLimitCode, MESSAGING_LIMIT_CODE, waErrorSummary, WaSendError } from '../src/wa/errors';
import { setHttpFetch } from '../src/wa/http';
import { clearMockSent, mockFailNext, mockSentMessages } from '../src/wa/providers/mock';
import { twilioCodeToMeta } from '../src/wa/twilio-api';
import { createTestContext, testConfig, type TestContext } from './helpers';
import { MIN, plus, setupSharedTenant, setupWaTenant, silentLog, type WaSetup } from './wa-helpers';

const HOUR = 60 * MIN;
const ALERT_URL = 'https://uyari.example.test/kanca';

let ctx: TestContext;
/** Ortak numara dükkanları */
let A: WaSetup;
let B: WaSetup;
/** Kendi numarasını kullanan işletme (kotaya girmez) */
let OWN: WaSetup;

const now = new Date('2026-10-05T12:00:00Z');

interface Line {
  level: string;
  msg: string;
  obj: Record<string, unknown>;
}

function captureLog(): { log: FastifyBaseLogger; lines: Line[] } {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (obj: unknown, msg?: string) => {
      lines.push({ level, msg: msg ?? (typeof obj === 'string' ? obj : ''), obj: (obj ?? {}) as Record<string, unknown> });
    };
  const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal') } as Record<string, unknown>;
  logger.child = () => logger;
  return { log: logger as unknown as FastifyBaseLogger, lines };
}

const alertsIn = (lines: Line[], kind: string) => lines.filter((l) => l.obj.alert === kind);

let seq = 9000;
const nextPhone = () => `+90538${String(1000000 + seq++).slice(-7)}`;

/** Müşteri + konuşma (belirtilen hesapta). `lastInboundAt` pencere durumunu belirler. */
async function conv(db: Database, t: WaSetup, opts: { phone?: string | null; bsuid?: string | null; lastInboundAt?: Date | null } = {}) {
  // `phone: null` BİLEREK telefonsuz müşteri demektir (?? kullanılmaz: null yeni telefon üretmemeli)
  const phone = opts.phone === undefined ? nextPhone() : opts.phone;
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.tenantId, phoneE164: phone, waBsuid: opts.bsuid ?? null })
    .returning();
  const [cv] = await db
    .insert(conversations)
    .values({
      tenantId: t.tenantId,
      branchId: t.branchId,
      waAccountId: t.account.id,
      customerId: c!.id,
      lastInboundAt: opts.lastInboundAt ?? null,
    })
    .returning();
  return { customer: c!, conversation: cv! };
}

/** Giden mesaj satırı (gönderilmiş sayılır). */
async function outMsg(
  db: Database,
  t: WaSetup,
  conversationId: string,
  opts: { at?: Date; status?: 'sent' | 'delivered' | 'read' | 'failed' | 'queued'; orderId?: string | null; payload?: OutboundPayload } = {},
) {
  const [m] = await db
    .insert(messages)
    .values({
      tenantId: t.tenantId,
      conversationId,
      direction: 'out',
      kind: 'text',
      body: 'durum mesajı',
      status: opts.status ?? 'sent',
      sentBy: 'bot',
      orderId: opts.orderId ?? null,
      createdAt: opts.at ?? now,
      ...(opts.payload ? { payload: opts.payload as unknown as Record<string, unknown> } : {}),
    })
    .returning();
  return m!;
}

/** Gelen mesaj satırı (24 saat penceresini açar). */
async function inMsg(db: Database, t: WaSetup, conversationId: string, at: Date) {
  await db.insert(messages).values({
    tenantId: t.tenantId,
    conversationId,
    direction: 'in',
    kind: 'text',
    body: 'merhaba',
    status: 'read',
    createdAt: at,
  });
}

/** Ölçüme giren tüm kayıtları temizler (ölçü PLATFORM genelidir: başka testin satırı sızmasın). */
async function clearTraffic(db: Database) {
  await db.delete(messages);
  await db.delete(notifications);
  await db.delete(conversations);
  await db.delete(customers);
}

beforeAll(async () => {
  ctx = await createTestContext({ config: testConfig() });
  A = await setupSharedTenant(ctx, { name: 'Bozok Pide', code: 'BOZOK' });
  B = await setupSharedTenant(ctx, { name: 'Çamlık Döner', code: 'DONER' });
  OWN = await setupWaTenant(ctx, { name: 'Kendi Numarası' });
});
afterAll(async () => {
  await ctx.close();
});

let savedEnv: Record<string, string | undefined>;
beforeEach(async () => {
  savedEnv = {
    ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
    ALERT_MIN_SEVERITY: process.env.ALERT_MIN_SEVERITY,
    WABA_CONVERSATION_CAP: process.env.WABA_CONVERSATION_CAP,
    WABA_SHED_NONCRITICAL: process.env.WABA_SHED_NONCRITICAL,
  };
  for (const k of Object.keys(savedEnv)) delete process.env[k];
  resetAlertCooldown();
  resetQuotaGauge();
  resetQualityReadClock();
  clearMockSent();
  await clearTraffic(ctx.db);
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetAlertCooldown();
  resetQuotaGauge();
  resetQualityReadClock();
});

// ---------------------------------------------------------------------------
// Saf işlevler (veritabanı yok)

describe('kota eşikleri ve yapılandırma', () => {
  it('eşik seviyeleri tavana göre hesaplanır', () => {
    expect(quotaLevel(0, 250)).toBe('ok');
    expect(quotaLevel(174, 250)).toBe('ok');
    expect(quotaLevel(175, 250)).toBe('warn'); // %70
    expect(quotaLevel(224, 250)).toBe('warn');
    expect(quotaLevel(225, 250)).toBe('critical'); // %90
    expect(quotaLevel(250, 250)).toBe('exhausted');
    expect(quotaLevel(400, 250)).toBe('exhausted');
    // Tavan bilinmiyorsa (0) uyarı üretilmez: yanlış yapılandırma uyarı seli açmasın
    expect(quotaLevel(10, 0)).toBe('ok');
  });

  it('kritik mesajlara ayrılan dilim tavanın %10\'u, en az 10', () => {
    expect(criticalReserve(250)).toBe(25);
    expect(criticalReserve(2000)).toBe(200);
    expect(criticalReserve(50)).toBe(10); // %10 = 5 → taban 10
  });

  it('tavan ortamdan okunur; geçersiz değer yok sayılır', () => {
    expect(resolveQuotaConfig({}, {}).cap).toBe(WABA_CONVERSATION_CAP_DEFAULT);
    expect(resolveQuotaConfig({}, { WABA_CONVERSATION_CAP: '1000' }).cap).toBe(1000);
    expect(resolveQuotaConfig({}, { WABA_CONVERSATION_CAP: '0' }).cap).toBe(WABA_CONVERSATION_CAP_DEFAULT);
    expect(resolveQuotaConfig({}, { WABA_CONVERSATION_CAP: '-5' }).cap).toBe(WABA_CONVERSATION_CAP_DEFAULT);
    expect(resolveQuotaConfig({}, { WABA_CONVERSATION_CAP: 'çok' }).cap).toBe(WABA_CONVERSATION_CAP_DEFAULT);
    // Yapılandırma ortamı ezer (config.ts'e eklendiğinde davranış değişmesin)
    expect(resolveQuotaConfig({ WABA_CONVERSATION_CAP: '2000' }, { WABA_CONVERSATION_CAP: '250' }).cap).toBe(2000);
  });

  it('düşürme ayarı varsayılan KAPALI', () => {
    expect(resolveQuotaConfig({}, {}).shedEnabled).toBe(false);
    expect(resolveQuotaConfig({}, { WABA_SHED_NONCRITICAL: '1' }).shedEnabled).toBe(true);
    expect(resolveQuotaConfig({}, { WABA_SHED_NONCRITICAL: 'true' }).shedEnabled).toBe(true);
    expect(resolveQuotaConfig({}, { WABA_SHED_NONCRITICAL: '0' }).shedEnabled).toBe(false);
    expect(resolveQuotaConfig({}, { WABA_SHED_NONCRITICAL: 'hayır' }).shedEnabled).toBe(false);
  });

  it('sağlayıcı basamağı çözülür; throughput seviyesi basamak SAYILMAZ', () => {
    expect(parseMessagingLimit('250')).toBe(250);
    expect(parseMessagingLimit('TIER_1K')).toBe(1000);
    expect(parseMessagingLimit('tier_10k')).toBe(10_000);
    expect(parseMessagingLimit('1k')).toBe(1000);
    expect(parseMessagingLimit('100K')).toBe(100_000);
    expect(parseMessagingLimit('1M')).toBe(1_000_000);
    // Cloud'da `throughput.level` gelir: BASAMAK DEĞİLDİR → uydurma değer üretilmez
    expect(parseMessagingLimit('STANDARD')).toBeNull();
    expect(parseMessagingLimit('HIGH')).toBeNull();
    expect(parseMessagingLimit('UNLIMITED')).toBeNull();
    expect(parseMessagingLimit(null)).toBeNull();
    expect(parseMessagingLimit('')).toBeNull();
  });
});

describe('kritiklik ve gönderim kapısı kararı', () => {
  const gaugeAt = (total: number, cap = 250, at: Date = now) => ({ total, cap, level: quotaLevel(total, cap), measuredAt: at });
  const input = (over: Partial<Parameters<typeof shouldShedNonCritical>[0]> = {}) => ({
    gauge: gaugeAt(230),
    now,
    shared: true,
    opensConversation: true,
    critical: false,
    shedEnabled: true,
    ...over,
  });

  it('kritiklik bütçe işaretlerinden okunur', () => {
    // Durum mesajı DEĞİL (karşılama, bot yanıtı, personel mesajı) → asla düşürülmez
    expect(isCriticalOutbound({ statusMessage: false, orderEvent: null })).toBe(true);
    expect(isCriticalOutbound(null)).toBe(true);
    expect(isCriticalOutbound({ statusMessage: true, orderEvent: 'accepted' })).toBe(true);
    expect(isCriticalOutbound({ statusMessage: true, orderEvent: 'rejected' })).toBe(true);
    expect(isCriticalOutbound({ statusMessage: true, orderEvent: 'cancelled' })).toBe(true);
    // Önemsiz durum mesajları
    expect(isCriticalOutbound({ statusMessage: true, orderEvent: 'preparing' })).toBe(false);
    expect(isCriticalOutbound({ statusMessage: true, orderEvent: 'on_the_way' })).toBe(false);
    expect(isCriticalOutbound({ statusMessage: true, orderEvent: 'delivered' })).toBe(false);
    expect(isCriticalOutbound({ statusMessage: true, orderEvent: null })).toBe(false);
  });

  it('kritik küme SMS yedeğiyle aynı kümedir', () => {
    expect([...CRITICAL_ORDER_EVENTS].sort()).toEqual(['accepted', 'cancelled', 'rejected']);
  });

  it('yalnız son dilimde ve yalnız önemsiz mesajda düşürür', () => {
    // 250 tavan, ayrılan dilim 25 → 225'ten itibaren düşürme
    expect(shouldShedNonCritical(input({ gauge: gaugeAt(224) }))).toBe(false);
    expect(shouldShedNonCritical(input({ gauge: gaugeAt(225) }))).toBe(true);
    expect(shouldShedNonCritical(input({ gauge: gaugeAt(400) }))).toBe(true);
  });

  it('şüphede mesaj GİDER (fail-open)', () => {
    expect(shouldShedNonCritical(input({ shedEnabled: false }))).toBe(false); // ayar kapalı (varsayılan)
    expect(shouldShedNonCritical(input({ shared: false }))).toBe(false); // kendi numarası: kota paylaşılmıyor
    expect(shouldShedNonCritical(input({ opensConversation: false }))).toBe(false); // pencere açık: tavana saymaz
    expect(shouldShedNonCritical(input({ critical: true }))).toBe(false); // sipariş onayı
    expect(shouldShedNonCritical(input({ gauge: null }))).toBe(false); // ölçüm yok
    expect(shouldShedNonCritical(input({ gauge: gaugeAt(230, 0) }))).toBe(false); // tavan bilinmiyor
    // Bayat ölçüm: cron durduysa kapı kendiliğinden devre dışı kalır
    expect(shouldShedNonCritical(input({ now: plus(now, WABA_GAUGE_TTL_MS + MIN) }))).toBe(false);
    expect(shouldShedNonCritical(input({ now: plus(now, WABA_GAUGE_TTL_MS - MIN) }))).toBe(true);
  });
});

describe('mesaj sınırı hata kodu', () => {
  it('131048 tanınır ve Türkçe özeti vardır', () => {
    expect(isMessagingLimitCode(MESSAGING_LIMIT_CODE)).toBe(true);
    expect(isMessagingLimitCode('131048')).toBe(true);
    expect(isMessagingLimitCode('131047')).toBe(false);
    expect(isMessagingLimitCode(null)).toBe(false);
    const err = new WaSendError('131048', 'restricted');
    // Sınıflandırma değişmez (docs/02 §10.1: yeniden deneme YOK)
    expect(err.action).toBe('fail');
    expect(err.retryable).toBe(false);
    expect(waErrorSummary(err)).toContain('mesaj sınırı');
  });

  it('Twilio günlük sınırı (63038) aynı koda çevrilir', () => {
    expect(twilioCodeToMeta('63038', 400)).toBe('131048');
    expect(isMessagingLimitCode(twilioCodeToMeta('63038', 400))).toBe(true);
    // Hız sınırı KARIŞMAZ: o yeniden denenir
    expect(twilioCodeToMeta('63018', 429)).toBe('130429');
  });
});

// ---------------------------------------------------------------------------
// Ölçü (veritabanından türetme)

describe('24 saatlik iş-kaynaklı konuşma ölçüsü', () => {
  it('pencere DIŞINDA giden mesaj konuşma açar, pencere İÇİNDE giden saymaz', async () => {
    // (1) Hiç gelen mesaj yok → iş-kaynaklı
    const soguk = await conv(ctx.db, A);
    await outMsg(ctx.db, A, soguk.conversation.id, { at: plus(now, -2 * HOUR) });
    // (2) 1 saat önce müşteri yazmış → pencere açık, sayılmaz
    const sicak = await conv(ctx.db, A, { lastInboundAt: plus(now, -HOUR) });
    await inMsg(ctx.db, A, sicak.conversation.id, plus(now, -HOUR));
    await outMsg(ctx.db, A, sicak.conversation.id, { at: plus(now, -30 * MIN) });
    // (3) 30 saat önce yazmış → pencere kapanmış, giden mesaj yeni konuşma açar
    const bayat = await conv(ctx.db, A, { lastInboundAt: plus(now, -30 * HOUR) });
    await inMsg(ctx.db, A, bayat.conversation.id, plus(now, -30 * HOUR));
    await outMsg(ctx.db, A, bayat.conversation.id, { at: plus(now, -3 * HOUR) });

    const u = await measureWabaQuota(ctx.db, { now, cap: 250 });
    expect(u.total).toBe(2);
    expect(u.cap).toBe(250);
    expect(u.remaining).toBe(248);
    expect(u.level).toBe('ok');
    expect(u.tenants).toEqual([{ tenantId: A.tenantId, name: 'Bozok Pide', conversations: 2 }]);
  });

  it('aynı sohbetteki ikinci mesaj yeni konuşma açmaz (ilk mesaj pencereyi açmaz, GELEN açar)', async () => {
    // İki giden mesaj, arada gelen mesaj YOK: Meta ikisini de aynı 24 saatlik konuşmada sayar.
    // Tekillik ALICI başınadır → sayı 1.
    const c = await conv(ctx.db, A);
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -4 * HOUR) });
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -2 * HOUR) });
    expect((await measureWabaQuota(ctx.db, { now })).total).toBe(1);
  });

  it('gönderilemeyen (failed/queued) mesaj sayılmaz', async () => {
    const c1 = await conv(ctx.db, A);
    await outMsg(ctx.db, A, c1.conversation.id, { status: 'failed' });
    const c2 = await conv(ctx.db, A);
    await outMsg(ctx.db, A, c2.conversation.id, { status: 'queued' });
    const c3 = await conv(ctx.db, A);
    await outMsg(ctx.db, A, c3.conversation.id, { status: 'delivered' });
    expect((await measureWabaQuota(ctx.db, { now })).total).toBe(1);
  });

  it('pencereden eski mesaj sayılmaz (kayan 24 saat)', async () => {
    const c = await conv(ctx.db, A);
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -25 * HOUR) });
    expect((await measureWabaQuota(ctx.db, { now })).total).toBe(0);
    expect((await measureWabaQuota(ctx.db, { now: plus(now, -24 * HOUR) })).total).toBe(1);
  });

  it('kendi numarasını kullanan işletme ortak numaranın kotasına GİRMEZ', async () => {
    const own = await conv(ctx.db, OWN);
    await outMsg(ctx.db, OWN, own.conversation.id);
    const shared = await conv(ctx.db, A);
    await outMsg(ctx.db, A, shared.conversation.id);
    const u = await measureWabaQuota(ctx.db, { now });
    expect(u.total).toBe(1);
    expect(u.tenants.map((t) => t.tenantId)).toEqual([A.tenantId]);
  });

  it('aynı kişi iki dükkanla konuşursa Meta BİR konuşma sayar; paylar iki satır gösterir', async () => {
    const phone = nextPhone();
    const inA = await conv(ctx.db, A, { phone });
    await outMsg(ctx.db, A, inA.conversation.id);
    const inB = await conv(ctx.db, B, { phone });
    await outMsg(ctx.db, B, inB.conversation.id);

    const u = await measureWabaQuota(ctx.db, { now });
    expect(u.total).toBe(1);
    // Payların TOPLAMI toplamdan büyüktür: bu bilinçlidir (tavan karşılaştırması `total` ile yapılır)
    expect(u.tenants).toHaveLength(2);
    expect(u.tenants.reduce((s, t) => s + t.conversations, 0)).toBe(2);
  });

  it('telefonu olmayan müşteri BSUID ile sayılır', async () => {
    const c = await conv(ctx.db, A, { phone: null, bsuid: 'bsuid-abc' });
    await outMsg(ctx.db, A, c.conversation.id);
    expect((await measureWabaQuota(ctx.db, { now })).total).toBe(1);
  });

  it('işletme sahibine giden platform uyarıları da AYNI numaranın kotasını tüketir', async () => {
    await ctx.db.insert(notifications).values({
      tenantId: A.tenantId,
      recipientUserId: A.owner.id,
      kind: 'new_order_alarm',
      channel: 'platform_wa',
      payload: {},
      status: 'sent',
      sentAt: plus(now, -10 * MIN),
    });
    // Aynı sahibe ikinci uyarı: tek konuşma
    await ctx.db.insert(notifications).values({
      tenantId: A.tenantId,
      recipientUserId: A.owner.id,
      kind: 'panel_offline',
      channel: 'platform_wa',
      payload: {},
      status: 'sent',
      sentAt: plus(now, -5 * MIN),
    });
    // Gönderilmemiş (skipped) uyarı sayılmaz
    await ctx.db.insert(notifications).values({
      tenantId: B.tenantId,
      recipientUserId: B.owner.id,
      kind: 'panel_offline',
      channel: 'platform_wa',
      payload: {},
      status: 'skipped',
    });
    const u = await measureWabaQuota(ctx.db, { now });
    expect(u.total).toBe(1);
    expect(u.tenants).toEqual([{ tenantId: A.tenantId, name: 'Bozok Pide', conversations: 1 }]);
  });

  it('alıcı zaten sayıldı mı: yalnız pencere içindeki GÖNDERİLEBİLMİŞ giden mesaj sayılır', async () => {
    const c = await conv(ctx.db, A);
    // Hiç mesaj yok
    expect(await recipientAlreadyBilled(ctx.db, c.conversation.id, now)).toBe(false);
    // Başarısız mesaj tavandan yer tüketmemiştir
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -HOUR), status: 'failed' });
    expect(await recipientAlreadyBilled(ctx.db, c.conversation.id, now)).toBe(false);
    // 25 saat önce gönderilmiş mesaj pencere dışıdır
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -25 * HOUR), status: 'sent' });
    expect(await recipientAlreadyBilled(ctx.db, c.conversation.id, now)).toBe(false);
    // Pencere içinde gönderilmiş mesaj → alıcı sayıldı
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -2 * HOUR), status: 'delivered' });
    expect(await recipientAlreadyBilled(ctx.db, c.conversation.id, now)).toBe(true);
    // Başka sohbet etkilenmez (kapsam sohbettir)
    const other = await conv(ctx.db, A);
    expect(await recipientAlreadyBilled(ctx.db, other.conversation.id, now)).toBe(false);
  });

  it('kiracı payları en çok konuşandan başlar', async () => {
    for (let i = 0; i < 3; i++) {
      const c = await conv(ctx.db, A);
      await outMsg(ctx.db, A, c.conversation.id);
    }
    const c = await conv(ctx.db, B);
    await outMsg(ctx.db, B, c.conversation.id);
    const u = await measureWabaQuota(ctx.db, { now });
    expect(u.total).toBe(4);
    expect(u.tenants.map((t) => [t.name, t.conversations])).toEqual([
      ['Bozok Pide', 3],
      ['Çamlık Döner', 1],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Dedektör ve uyarılar

describe('kota gözcüsü', () => {
  const deps = (provider: Config['PLATFORM_WA_PROVIDER'], log: FastifyBaseLogger, over: Record<string, string> = {}) => ({
    db: ctx.db,
    config: { ...ctx.config, PLATFORM_WA_PROVIDER: provider, ...over },
    log,
  });

  /** Ortak numaradan `n` tekil kişiye iş-kaynaklı konuşma açılmış gibi yapar. */
  async function openConversations(n: number) {
    for (let i = 0; i < n; i++) {
      const c = await conv(ctx.db, A);
      await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -HOUR) });
    }
  }

  it('simülatörde ölçüm yapılmaz', async () => {
    await openConversations(3);
    const { log, lines } = captureLog();
    const r = await detectWabaQuotaPressure(deps('mock', log), { now });
    expect(r).toMatchObject({ reason: 'provider_mock', usage: null, alerted: false });
    expect(alertsIn(lines, 'waba_conversation_quota')).toHaveLength(0);
  });

  it('eşik altında uyarı yok ama gösterge tazelenir', async () => {
    await openConversations(2);
    const { log, lines } = captureLog();
    const r = await detectWabaQuotaPressure(deps('cloud', log, { WABA_CONVERSATION_CAP: '250' }), { now });
    expect(r.reason).toBe('measured');
    expect(r.usage).toMatchObject({ total: 2, cap: 250, level: 'ok' });
    expect(r.alerted).toBe(false);
    expect(alertsIn(lines, 'waba_conversation_quota')).toHaveLength(0);
  });

  it('%70 eşiğinde uyarı (warning), %90\'da kritik', async () => {
    await openConversations(8);
    const warn = captureLog();
    // Tavan 10 → 8 konuşma = %80 (warn)
    const r1 = await detectWabaQuotaPressure(deps('cloud', warn.log, { WABA_CONVERSATION_CAP: '10' }), { now });
    expect(r1.usage).toMatchObject({ total: 8, cap: 10, level: 'warn' });
    expect(r1.alerted).toBe(true);
    const a1 = alertsIn(warn.lines, 'waba_conversation_quota');
    expect(a1).toHaveLength(1);
    expect(a1[0]!.obj).toMatchObject({ severity: 'warning', total: 8, cap: 10, percent: 80, remaining: 2 });

    resetAlertCooldown();
    await openConversations(1);
    const crit = captureLog();
    const r2 = await detectWabaQuotaPressure(deps('cloud', crit.log, { WABA_CONVERSATION_CAP: '10' }), { now });
    expect(r2.usage).toMatchObject({ total: 9, level: 'critical' });
    expect(alertsIn(crit.lines, 'waba_conversation_quota')[0]!.obj).toMatchObject({ severity: 'critical' });
  });

  it('tavan dolunca uyarı ACİL ve kiracı payını gösterir', async () => {
    await openConversations(9);
    const c = await conv(ctx.db, B);
    await outMsg(ctx.db, B, c.conversation.id, { at: plus(now, -HOUR) });
    const { log, lines } = captureLog();
    const r = await detectWabaQuotaPressure(deps('cloud', log, { WABA_CONVERSATION_CAP: '10' }), { now });
    expect(r.usage).toMatchObject({ total: 10, level: 'exhausted', remaining: 0 });
    const a = alertsIn(lines, 'waba_conversation_quota');
    expect(a).toHaveLength(1);
    expect(a[0]!.obj).toMatchObject({ severity: 'critical', level: 'exhausted' });
    expect(a[0]!.msg).toContain('ACİL');
    // Tek işletme kotanın yarısından çoğunu tükettiyse ADIYLA görünür (madde 3)
    expect(a[0]!.msg).toContain('Bozok Pide');
    expect(a[0]!.msg).toContain('9 konuşma');
    expect(a[0]!.obj.tenants).toEqual(['Bozok Pide=9', 'Çamlık Döner=1']);
  });

  it('uyarı kanalı varsa webhook\'a gider', async () => {
    process.env.ALERT_WEBHOOK_URL = ALERT_URL;
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    setHttpFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return new Response(null, { status: 204 });
    });
    try {
      await openConversations(10);
      const { log } = captureLog();
      await detectWabaQuotaPressure(deps('cloud', log, { WABA_CONVERSATION_CAP: '10' }), { now });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.body).toMatchObject({ kind: 'waba_conversation_quota', severity: 'critical' });
    } finally {
      setHttpFetch(null);
    }
  });

  it('kota uyarısında müşteri telefonu YOK (yalnız sayı ve işletme adı)', async () => {
    const phone = nextPhone();
    const c = await conv(ctx.db, A, { phone });
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(now, -HOUR) });
    const { log, lines } = captureLog();
    await detectWabaQuotaPressure(deps('cloud', log, { WABA_CONVERSATION_CAP: '1' }), { now });
    const a = alertsIn(lines, 'waba_conversation_quota');
    expect(JSON.stringify(a)).not.toContain(phone.slice(-7));
  });
});

describe('kalite derecesi okuması', () => {
  const deps = (log: FastifyBaseLogger) => ({ db: ctx.db, config: { ...ctx.config, PLATFORM_WA_PROVIDER: 'cloud' as const }, log });
  const reading = (over: Partial<WabaQualityReading> = {}): WabaQualityReading => ({
    readable: true,
    qualityRating: 'GREEN',
    messagingLimitRaw: null,
    messagingLimitCap: null,
    ready: true,
    ...over,
  });

  it('yeşil derecede uyarı yok; sarıda uyarı, kırmızıda kritik', () => {
    const g = captureLog();
    expect(evaluateWabaQuality({ log: g.log, config: ctx.config }, reading({ qualityRating: 'GREEN' }))).toBe(false);
    expect(alertsIn(g.lines, 'waba_quality_rating')).toHaveLength(0);

    const y = captureLog();
    expect(evaluateWabaQuality({ log: y.log, config: ctx.config }, reading({ qualityRating: 'YELLOW' }))).toBe(true);
    expect(alertsIn(y.lines, 'waba_quality_rating')[0]!.obj).toMatchObject({ severity: 'warning', quality: 'YELLOW' });

    resetAlertCooldown();
    const r = captureLog();
    expect(evaluateWabaQuality({ log: r.log, config: ctx.config }, reading({ qualityRating: 'RED' }))).toBe(true);
    expect(alertsIn(r.lines, 'waba_quality_rating')[0]!.obj).toMatchObject({ severity: 'critical', quality: 'RED' });
  });

  it('okunamıyorsa UYDURULMAZ: uyarı yok, yalnız bilgi satırı', () => {
    const { log, lines } = captureLog();
    expect(evaluateWabaQuality({ log, config: ctx.config }, reading({ readable: false, qualityRating: null, reason: 'provider_error' }))).toBe(false);
    expect(alertsIn(lines, 'waba_quality_rating')).toHaveLength(0);
    expect(lines.some((l) => l.msg.includes('okunamadı'))).toBe(true);
  });

  it('sağlayıcı basamağı okunursa yapılandırılan tavanın yerine geçer', async () => {
    const { log } = captureLog();
    const r = await detectWabaQuotaPressure(deps(log), {
      now,
      qualityIntervalMs: 0,
      readQuality: async () => reading({ messagingLimitRaw: 'TIER_1K', messagingLimitCap: 1000 }),
    });
    expect(r.qualityRead).toBe(true);
    expect(r.usage!.cap).toBe(1000);
  });

  it('okunan basamak sonraki turlarda da geçerlidir (tavan salınmaz)', async () => {
    process.env.WABA_CONVERSATION_CAP = '250';
    const { log } = captureLog();
    const read = async () => reading({ messagingLimitRaw: 'TIER_1K', messagingLimitCap: 1000 });
    // 1. tur: okuma yapılır → 1000
    expect((await detectWabaQuotaPressure(deps(log), { now, readQuality: read })).usage!.cap).toBe(1000);
    // 2. tur: aralık dolmadı, okuma YAPILMAZ → tavan 250'ye düşmemeli
    const r2 = await detectWabaQuotaPressure(deps(log), { now: plus(now, 5 * MIN), readQuality: read });
    expect(r2.qualityRead).toBe(false);
    expect(r2.usage!.cap).toBe(1000);
  });

  it('tek başarısız okuma bilinen basamağı düşürmez', async () => {
    process.env.WABA_CONVERSATION_CAP = '250';
    const { log } = captureLog();
    await detectWabaQuotaPressure(deps(log), {
      now,
      qualityIntervalMs: 0,
      readQuality: async () => reading({ messagingLimitRaw: 'TIER_1K', messagingLimitCap: 1000 }),
    });
    const r = await detectWabaQuotaPressure(deps(log), {
      now: plus(now, 5 * MIN),
      qualityIntervalMs: 0,
      readQuality: async () => {
        throw new Error('Meta ulaşılamadı');
      },
    });
    expect(r.usage!.cap).toBe(1000);
  });

  it('okunamazsa yapılandırılan tavan kullanılır ve ölçüm yine yapılır', async () => {
    process.env.WABA_CONVERSATION_CAP = '250';
    const { log } = captureLog();
    const r = await detectWabaQuotaPressure(deps(log), {
      now,
      qualityIntervalMs: 0,
      readQuality: async () => {
        throw new Error('Meta ulaşılamadı');
      },
    });
    expect(r.quality).toMatchObject({ readable: false, reason: 'provider_error' });
    expect(r.usage!.cap).toBe(250);
    expect(r.reason).toBe('measured');
  });

  it('kalite okuması her turda yapılmaz (aralık dolmadan atlanır)', async () => {
    let reads = 0;
    const { log } = captureLog();
    const read = async () => {
      reads++;
      return reading();
    };
    await detectWabaQuotaPressure(deps(log), { now, readQuality: read });
    expect(reads).toBe(1);
    await detectWabaQuotaPressure(deps(log), { now: plus(now, 5 * MIN), readQuality: read });
    expect(reads).toBe(1);
    await detectWabaQuotaPressure(deps(log), { now: plus(now, 61 * MIN), readQuality: read });
    expect(reads).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Gönderim kapısı (madde 4)

describe('gönderim kapısı: tavana yaklaşınca önemsiz durum mesajı düşer', () => {
  /** Düşürülebilir yük: durum mesajı + kritik OLMAYAN sipariş olayı. */
  const shedablePayload = (): OutboundPayload => ({
    code: 'M09',
    spec: { type: 'text', text: 'Siparişiniz yolda' },
    statusMessage: true,
    orderEvent: 'on_the_way',
    templateFallback: null,
    smsFallback: null,
  });

  /** Kuyrukta bekleyen giden durum mesajı (ortak numara, pencere KAPALI → yeni konuşma açar). */
  async function queuedStatusMessage(opts: { orderEvent: string | null; orderId?: string | null }) {
    const c = await conv(ctx.db, A, { lastInboundAt: null });
    const payload: OutboundPayload = {
      code: 'M09',
      spec: { type: 'text', text: 'Siparişiniz yolda' },
      statusMessage: true,
      orderEvent: opts.orderEvent,
      templateFallback: null,
      smsFallback: null,
    };
    const m = await outMsg(ctx.db, A, c.conversation.id, { status: 'queued', orderId: opts.orderId ?? null, payload });
    return m;
  }

  const sendCtx = (log: FastifyBaseLogger) => ({ db: ctx.db, config: ctx.config, log });

  it('ayar kapalıyken (varsayılan) mesaj gider', async () => {
    setQuotaGauge({ total: 400, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const m = await queuedStatusMessage({ orderEvent: 'on_the_way' });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('sent');
    expect(mockSentMessages()).toHaveLength(1);
  });

  it('ayar açıkken önemsiz durum mesajı düşürülür ve sağlayıcıya GİTMEZ', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 240, cap: 250, level: 'critical', measuredAt: new Date() });
    const m = await queuedStatusMessage({ orderEvent: 'preparing' });
    const { log, lines } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('failed');
    expect(mockSentMessages()).toHaveLength(0);
    const [row] = await ctx.db.select().from(messages).where(eq(messages.id, m.id));
    expect(row).toMatchObject({ status: 'failed', errorCode: WABA_QUOTA_SHED_CODE });
    expect(lines.some((l) => l.msg.includes('düşürüldü'))).toBe(true);
  });

  it('KRİTİK mesaj (sipariş onayı) tavan dolu olsa bile gider', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 400, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const m = await queuedStatusMessage({ orderEvent: 'accepted' });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('sent');
    expect(mockSentMessages()).toHaveLength(1);
  });

  it('pencere açıkken düşürme yoktur (mesaj tavana saymaz)', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 400, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const c = await conv(ctx.db, A, { lastInboundAt: new Date() });
    const payload: OutboundPayload = {
      code: 'M09',
      spec: { type: 'text', text: 'Siparişiniz yolda' },
      statusMessage: true,
      orderEvent: 'on_the_way',
      templateFallback: null,
      smsFallback: null,
    };
    const m = await outMsg(ctx.db, A, c.conversation.id, { status: 'queued', payload });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('sent');
  });

  it('düşürülen mesajın durum bütçesi GERİ VERİLİR', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 250, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const order = await ctx.createOrder({ tenantId: A.tenantId, branchId: A.branchId, status: 'preparing' });
    await ctx.db.update(orders).set({ waStatusMsgCount: 3 }).where(eq(orders.id, order.id));
    const m = await queuedStatusMessage({ orderEvent: 'preparing', orderId: order.id });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('failed');
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row!.waStatusMsgCount).toBe(2);
  });

  // Tavan TEKİL ALICI sayar: zaten sayılmış kişiye giden mesaj kotadan yer KAZANDIRMAZ → düşürülmez.
  // (Bağımsız incelemede düzeltildi: kapı yalnız `lastInboundAt`'e bakıyordu, bu yüzden onaydan sonraki
  // hazırlanıyor/yolda/teslim mesajlarını hiçbir yer kazandırmadan düşürüyordu.)
  it('alıcıya son 24 saatte mesaj gittiyse düşürme YOK (bedava mesaj)', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 400, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const c = await conv(ctx.db, A, { lastInboundAt: null });
    // Sipariş onayı (kritik) bu kişiye 2 saat önce gitti → alıcı tavanda ZATEN sayıldı
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(new Date(), -2 * HOUR), status: 'sent' });
    const m = await outMsg(ctx.db, A, c.conversation.id, { status: 'queued', payload: shedablePayload() });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('sent');
  });

  it('önceki mesaj 24 saatten eskiyse alıcı yeniden sayılır → düşürülür', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 400, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const c = await conv(ctx.db, A, { lastInboundAt: null });
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(new Date(), -25 * HOUR), status: 'sent' });
    const m = await outMsg(ctx.db, A, c.conversation.id, { status: 'queued', payload: shedablePayload() });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('failed');
    const [row] = await ctx.db.select().from(messages).where(eq(messages.id, m.id));
    expect(row).toMatchObject({ errorCode: WABA_QUOTA_SHED_CODE });
  });

  it('gönderilemeyen önceki mesaj alıcıyı saydırmaz (failed sayılmaz)', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 400, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const c = await conv(ctx.db, A, { lastInboundAt: null });
    await outMsg(ctx.db, A, c.conversation.id, { at: plus(new Date(), -HOUR), status: 'failed' });
    const m = await outMsg(ctx.db, A, c.conversation.id, { status: 'queued', payload: shedablePayload() });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('failed');
    const [row] = await ctx.db.select().from(messages).where(eq(messages.id, m.id));
    expect(row).toMatchObject({ errorCode: WABA_QUOTA_SHED_CODE });
  });

  it('kendi numarasını kullanan işletmede kapı hiç çalışmaz', async () => {
    process.env.WABA_SHED_NONCRITICAL = '1';
    setQuotaGauge({ total: 400, cap: 250, level: 'exhausted', measuredAt: new Date() });
    const c = await conv(ctx.db, OWN, { lastInboundAt: null });
    const payload: OutboundPayload = {
      code: 'M09',
      spec: { type: 'text', text: 'Siparişiniz yolda' },
      statusMessage: true,
      orderEvent: 'on_the_way',
      templateFallback: null,
      smsFallback: null,
    };
    const m = await outMsg(ctx.db, OWN, c.conversation.id, { status: 'queued', payload });
    const { log } = captureLog();
    expect(await performWaSend(sendCtx(log), m.id)).toBe('sent');
  });
});

// ---------------------------------------------------------------------------
// Sağlayıcı gerçeği: 131048

describe('131048 geldiğinde kritik uyarı', () => {
  it('ortak numarada mesaj sınırı hatası ACİL uyarı üretir', async () => {
    const c = await conv(ctx.db, A, { lastInboundAt: new Date() });
    const payload: OutboundPayload = {
      code: 'M09',
      spec: { type: 'text', text: 'Siparişiniz yolda' },
      statusMessage: true,
      orderEvent: 'on_the_way',
      templateFallback: null,
      smsFallback: null,
    };
    const m = await outMsg(ctx.db, A, c.conversation.id, { status: 'queued', payload });
    mockFailNext('131048', 'messaging limit reached');
    const { log, lines } = captureLog();
    expect(await performWaSend({ db: ctx.db, config: ctx.config, log }, m.id)).toBe('failed');
    const a = alertsIn(lines, 'waba_messaging_limit');
    expect(a).toHaveLength(1);
    expect(a[0]!.obj).toMatchObject({ severity: 'critical', code: '131048', shared: true });
    expect(a[0]!.msg).toContain('ACİL');
  });

  it('işletmenin kendi numarasında uyarı kritiktir ama "tüm dükkanlar" demez', async () => {
    const c = await conv(ctx.db, OWN, { lastInboundAt: new Date() });
    const payload: OutboundPayload = {
      code: 'M09',
      spec: { type: 'text', text: 'Siparişiniz yolda' },
      statusMessage: true,
      orderEvent: 'on_the_way',
      templateFallback: null,
      smsFallback: null,
    };
    const m = await outMsg(ctx.db, OWN, c.conversation.id, { status: 'queued', payload });
    mockFailNext('131048', 'messaging limit reached');
    const { log, lines } = captureLog();
    await performWaSend({ db: ctx.db, config: ctx.config, log }, m.id);
    const a = alertsIn(lines, 'waba_messaging_limit');
    expect(a).toHaveLength(1);
    expect(a[0]!.obj).toMatchObject({ shared: false });
    expect(a[0]!.msg).not.toContain('Tüm dükkanların');
  });
});

// ---------------------------------------------------------------------------
// Cron kaydı

describe('cron kaydı', () => {
  const job: JobRow = {
    id: '00000000-0000-0000-0000-000000000000',
    queue: 'cron',
    type: 'cron.waba_quota_watch',
    payload: {},
    runAt: now,
    attempts: 1,
    maxAttempts: 1,
    tenantId: null,
    dedupeKey: null,
  };

  it('waba_quota_watch işleyicisi kayıtlıdır', () => {
    registerCronJobs();
    expect(getJobHandler('cron.waba_quota_watch')).toBeTypeOf('function');
  });

  it('simülatörde cron işi sağlayıcıya gitmeden sessizce biter', async () => {
    registerCronJobs();
    const handler = getJobHandler('cron.waba_quota_watch')!;
    // ctx.config PLATFORM_WA_PROVIDER = 'mock' → testConnection HİÇ çağrılmaz (requireRealProvider atardı)
    await expect(handler({}, { db: ctx.db, config: ctx.config, log: silentLog, job })).resolves.toBeUndefined();
  });
});
