// Ortak numara sağlığı ve sağırlık karşıtı önlemler (denetim 2026-10-04 · iş 3.2 · 3.3 · 3.4):
// - Seçici soğuması YALNIZ kendiliğinden gönderilen seçiciyi kısıtlar; "#KOD" bilgisi gibi platform yanıtları
//   sonraki mesajı susturmaz (H15 regresyonu).
// - Webhook'taki phone_number_id hesapla uyuşmuyorsa olay İŞLENMEZ: "eşleşmedi" (orphan) işaretlenir + uyarı (H16).
// - Ortak numara sessizliği (açık saatte webhook olayı gelmiyor) uyarı üretir (H7).
// - Webhook imzası 401'leri sessiz değildir: log + uyarı (H7 / "401'ler loglanmıyor").

import { branches, openingHours, sharedWaMessages, tenants, waWebhookEvents, type Database } from '@siparis/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAlertCooldown } from '../src/lib/alert';
import { buildInboundPayload } from '../src/services/messaging/dev-payload';
import { ingestWebhookPayload, ORPHAN_PHONE_MISMATCH, ORPHAN_PHONE_MISMATCH_PARTIAL, processWebhookEvent } from '../src/services/messaging/ingest';
import { alertSharedAccountError, detectSharedNumberSilence, SHARED_SILENCE_MS } from '../src/services/messaging/shared-health';
import { findSharedRoute } from '../src/services/messaging/shared-router';
import type { Config } from '../src/config';
import { WaSendError } from '../src/wa/errors';
import { setHttpFetch } from '../src/wa/http';
import { signMetaPayload } from '../src/wa/signature';
import { twilioCodeToMeta } from '../src/wa/twilio-api';
import { createTestContext, expectError, testConfig, type TestContext } from './helpers';
import { MIN, conversationFor, plus, setupSharedTenant, setupWaTenant, sharedInbound, type WaSetup } from './wa-helpers';

const APP_SECRET = 'test-app-secret';
const SHARED_TOKEN = 'test-shared-webhook-token';
const ALERT_URL = 'https://uyari.example.test/kanca';

let ctx: TestContext;
let A: WaSetup; // Bozok Pide Salonu #BOZOK (seçilebilir)
let B: WaSetup; // Çamlık Döner #DONER (seçilebilir)
let KAPALI: WaSetup; // canlı değil → ortak numarada seçilemez (#KAPALI "bu dükkan şu an sipariş almıyor")

let seq = 7000;
const nextPhone = () => `+90539${String(1000000 + seq++).slice(-7)}`;
const text = (s: string) => ({ type: 'text' as const, text: s });

interface Line {
  level: string;
  msg: string;
  obj: Record<string, unknown>;
}

/** Log satırlarını toplayan logger (uyarılar `alert:` anahtarıyla görünür). */
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

/** Uyarı webhook'una giden çağrıları toplayan sahte fetch. */
function stubAlertFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  setHttpFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return new Response(null, { status: 204 });
  });
  return calls;
}

/** Kişinin platform düzeyi (dükkan sohbetine girmeyen) mesajları. */
async function platformRows(db: Database, phone: string) {
  const route = await findSharedRoute(db, { phone });
  if (!route) return [];
  return db
    .select()
    .from(sharedWaMessages)
    .where(and(eq(sharedWaMessages.routeId, route.id), eq(sharedWaMessages.direction, 'out')))
    .orderBy(asc(sharedWaMessages.createdAt));
}
const codesOf = (rows: { payload: unknown }[]) => rows.map((r) => String((r.payload as { code?: string } | null)?.code ?? '?'));

beforeAll(async () => {
  ctx = await createTestContext({
    config: testConfig({ WA_APP_SECRET: APP_SECRET, WA_VERIFY_TOKEN: 'verify-me', PLATFORM_WA_WEBHOOK_TOKEN: SHARED_TOKEN }),
  });
  A = await setupSharedTenant(ctx, { name: 'Bozok Pide Salonu', code: 'BOZOK' });
  B = await setupSharedTenant(ctx, { name: 'Çamlık Döner', code: 'DONER' });
  KAPALI = await setupSharedTenant(ctx, { name: 'Kapalı Dükkan', code: 'KAPALI', live: false });
});
afterAll(async () => {
  await ctx.close();
});

let savedEnv: { url?: string | undefined; min?: string | undefined };
beforeEach(() => {
  savedEnv = { url: process.env.ALERT_WEBHOOK_URL, min: process.env.ALERT_MIN_SEVERITY };
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.ALERT_MIN_SEVERITY;
  resetAlertCooldown();
});
afterEach(() => {
  if (savedEnv.url === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = savedEnv.url;
  if (savedEnv.min === undefined) delete process.env.ALERT_MIN_SEVERITY;
  else process.env.ALERT_MIN_SEVERITY = savedEnv.min;
  setHttpFetch(null);
  resetAlertCooldown();
});

// ---------------------------------------------------------------------------
// İş 3.2 — seçici soğuması yalnız kendiliğinden seçiciye

describe('seçici soğuması (auto)', () => {
  it('platform BİLGİ yanıtı soğumayı başlatmaz: hemen ardından gelen kodsuz mesaj seçici alır', async () => {
    const phone = nextPhone();
    const t0 = new Date('2026-10-05T12:00:00Z');
    // 1) "#KAPALI": dükkan var ama ortak numarada seçilemez → P04 bilgi mesajı (kendiliğinden seçici DEĞİL)
    await sharedInbound(ctx, { phone }, text('#KAPALI'), { now: t0 });
    expect(codesOf(await platformRows(ctx.db, phone))).toEqual(['P04']);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ lastPickerAt: null });

    // 2) 5 sn sonra kodsuz mesaj: eskiden 60 sn boyunca SESSİZ kalıyordu (H15) — artık seçici gelir
    await sharedInbound(ctx, { phone }, text('iyi günler kolay gelsin'), { now: plus(t0, 5_000) });
    const after = await platformRows(ctx.db, phone);
    expect(codesOf(after)).toEqual(['P04', 'P02']);
    expect((await findSharedRoute(ctx.db, { phone }))?.lastPickerAt).toEqual(plus(t0, 5_000));
    // Seçici gerçekten seçilebilir dükkanları sunuyor (seçilemeyen #KAPALI listede yok)
    const rows = (after[1]!.payload as { spec: { interactive: { list: { sections: { rows: { id: string }[] }[] } } } }).spec.interactive.list.sections.flatMap(
      (s) => s.rows.map((r) => r.id),
    );
    expect(rows).toContain(`shop:${A.tenantId}`);
    expect(rows).toContain(`shop:${B.tenantId}`);
    expect(rows).not.toContain(`shop:${KAPALI.tenantId}`);
  });

  it('kendiliğinden gönderilen seçici soğumayı başlatır: 60 sn içinde TAM seçici yinelenmez, kısa hatırlatma gider', async () => {
    const phone = nextPhone();
    const t0 = new Date('2026-10-05T13:00:00Z');
    await sharedInbound(ctx, { phone }, text('iyi günler kolay gelsin'), { now: t0 });
    expect(codesOf(await platformRows(ctx.db, phone))).toEqual(['P02']);

    const r = await sharedInbound(ctx, { phone }, text('bir şey sormak istiyorum'), { now: plus(t0, 10_000) });
    expect(r.summary).toMatchObject({ messages: 1 });
    // Tam seçici (liste) yinelenmez ama müşteri SESSİZ KALMAZ: tek satırlık hatırlatma (P06, 06.10.2026)
    expect(codesOf(await platformRows(ctx.db, phone))).toEqual(['P02', 'P06']);
    // Soğuma anı ilerlemedi: hatırlatma kendiliğinden seçici değildir
    expect((await findSharedRoute(ctx.db, { phone }))?.lastPickerAt).toEqual(t0);

    // Hatırlatma da 60 sn'de en çok 1 (üst sınır: kişiye dakikada 2 platform mesajı)
    await sharedInbound(ctx, { phone }, text('bir şey sormak istiyorum'), { now: plus(t0, 20_000) });
    expect(codesOf(await platformRows(ctx.db, phone))).toEqual(['P02', 'P06']);

    // 60 sn geçince yeniden seçici gelir
    await sharedInbound(ctx, { phone }, text('bir şey sormak istiyorum'), { now: plus(t0, 61_000) });
    expect(codesOf(await platformRows(ctx.db, phone))).toEqual(['P02', 'P06', 'P02']);
  });

  it('müşterinin kendi istediği seçici (komut) de soğuma başlatmaz', async () => {
    const phone = nextPhone();
    const t0 = new Date('2026-10-05T14:00:00Z');
    await sharedInbound(ctx, { phone }, text('dükkanlar'), { now: t0 });
    expect(codesOf(await platformRows(ctx.db, phone))).toEqual(['P02']);
    expect(await findSharedRoute(ctx.db, { phone })).toMatchObject({ lastPickerAt: null });
  });
});

// ---------------------------------------------------------------------------
// İş 3.3 — phone_number_id uyuşmazlığı

describe('phone_number_id uyuşmazlığı', () => {
  it('olay işlenmez, "eşleşmedi" işaretlenir ve kritik uyarı gider', async () => {
    const t = await setupWaTenant(ctx, { name: 'Uyuşmaz Lokanta' });
    const phone = nextPhone();
    // Yük BAŞKA bir numaraya ait (sağlayıcıda yanlış webhook adresi / belirteç sızıntısı / enjeksiyon)
    const { payload } = buildInboundPayload(
      { phoneNumberId: 'pn-baska-numara', displayPhone: '+905550000098', wabaId: 'waba-baska' },
      { phone },
      text('merhaba'),
    );
    const { webhookEventId } = await ingestWebhookPayload(ctx.db, t.account, payload);
    const { log, lines } = captureLog();
    const summary = await processWebhookEvent({ db: ctx.db, config: ctx.config, log }, webhookEventId);

    expect(summary).toBeNull();
    const [row] = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.id, webhookEventId));
    expect(row!.error).toBe(ORPHAN_PHONE_MISMATCH);
    expect(row!.processedAt).not.toBeNull();
    // Tenant yalıtımı: bu işletmede ne konuşma ne müşteri açıldı
    expect(await conversationFor(ctx.db, t.account, phone)).toBeUndefined();
    const alerts = alertsIn(lines, 'wa_webhook_phone_mismatch');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.obj).toMatchObject({ severity: 'critical', accountId: t.account.id });
    // Gizli yapılandırma (numara kimliği) uyarıya yazılmaz
    expect(JSON.stringify(alerts[0]!.obj)).not.toContain('pn-baska-numara');
  });

  it('uyuşan phone_number_id normal işlenir', async () => {
    const t = await setupWaTenant(ctx, { name: 'Uyuşan Lokanta' });
    const phone = nextPhone();
    const { payload } = buildInboundPayload(t.account, { phone }, text('merhaba'));
    const { webhookEventId } = await ingestWebhookPayload(ctx.db, t.account, payload);
    const { log, lines } = captureLog();
    const summary = await processWebhookEvent({ db: ctx.db, config: ctx.config, log }, webhookEventId);
    expect(summary).toMatchObject({ messages: 1 });
    expect(alertsIn(lines, 'wa_webhook_phone_mismatch')).toHaveLength(0);
    const [row] = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.id, webhookEventId));
    expect(row!.error).toBeNull();
  });

  it('aynı yükte hem yabancı hem kendi olayı varsa: yalnız yabancı atılır, müşteri mesajı işlenir', async () => {
    const t = await setupWaTenant(ctx, { name: 'Karışık Lokanta' });
    const own = nextPhone();
    const other = nextPhone();
    const ownPayload = buildInboundPayload(t.account, { phone: own }, text('merhaba')).payload as { entry: unknown[] };
    const foreignPayload = buildInboundPayload(
      { phoneNumberId: 'pn-baska-numara-2', displayPhone: '+905550000096', wabaId: 'waba-baska' },
      { phone: other },
      text('yanlış numaraya düşen mesaj'),
    ).payload as { entry: unknown[] };
    // Tek webhook POST'u birden çok entry taşıyabilir: yükün tamamını atmak gerçek müşteri mesajını kaybettirirdi
    const mixed = { ...ownPayload, entry: [...foreignPayload.entry, ...ownPayload.entry] };
    const { webhookEventId } = await ingestWebhookPayload(ctx.db, t.account, mixed);
    const { log, lines } = captureLog();
    const summary = await processWebhookEvent({ db: ctx.db, config: ctx.config, log }, webhookEventId);

    expect(summary).toMatchObject({ messages: 1 });
    expect(await conversationFor(ctx.db, t.account, own)).toBeDefined();
    // Yabancı numaranın müşterisi bu işletmede AÇILMADI (tenant yalıtımı)
    expect(await conversationFor(ctx.db, t.account, other)).toBeUndefined();
    const [row] = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.id, webhookEventId));
    expect(row!.error).toBe(ORPHAN_PHONE_MISMATCH_PARTIAL);
    expect(row!.processedAt).not.toBeNull();
    const alerts = alertsIn(lines, 'wa_webhook_phone_mismatch');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.obj).toMatchObject({ severity: 'critical', foreign: 1, total: 2 });
  });
});

// ---------------------------------------------------------------------------
// İş 3.4 (a) — ortak numara sessizlik dedektörü

describe('ortak numara sessizlik dedektörü', () => {
  const now = new Date('2026-10-05T15:00:00Z');
  const deps = (provider: Config['PLATFORM_WA_PROVIDER'], log: FastifyBaseLogger) => ({
    db: ctx.db,
    config: { ...ctx.config, PLATFORM_WA_PROVIDER: provider },
    log,
  });
  /** Ortak numaradan `ms` önce bir webhook olayı gelmiş gibi yapar (tek kaynak: wa_webhook_events). */
  async function sharedEventAgo(ms: number) {
    await ctx.db.delete(waWebhookEvents).where(eq(waWebhookEvents.provider, 'shared'));
    await ctx.db.insert(waWebhookEvents).values({ provider: 'shared', payload: {}, receivedAt: plus(now, -ms), processedAt: plus(now, -ms) });
  }

  it('simülatörde ölçüm yapılmaz', async () => {
    const { log, lines } = captureLog();
    expect(await detectSharedNumberSilence(deps('mock', log), { now })).toMatchObject({ reason: 'provider_mock', alerted: false });
    expect(alertsIn(lines, 'shared_wa_silence')).toHaveLength(0);
  });

  it('pencere içinde olay varsa sağlıklı', async () => {
    await sharedEventAgo(10 * MIN);
    const { log, lines } = captureLog();
    const r = await detectSharedNumberSilence(deps('cloud', log), { now });
    expect(r).toMatchObject({ reason: 'recent_event', alerted: false, silentMinutes: 10 });
    expect(r.openShops).toBeGreaterThan(0);
    expect(alertsIn(lines, 'shared_wa_silence')).toHaveLength(0);
  });

  it('açık saatte pencere boyunca olay yoksa uyarı gider', async () => {
    await sharedEventAgo(SHARED_SILENCE_MS + 30 * MIN);
    const { log, lines } = captureLog();
    const r = await detectSharedNumberSilence(deps('cloud', log), { now });
    expect(r).toMatchObject({ reason: 'silent', alerted: true, silentMinutes: 150 });
    const alerts = alertsIn(lines, 'shared_wa_silence');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.obj).toMatchObject({ severity: 'warning' });
  });

  it('hiç olay yoksa kanal ölü sayılır (kritik)', async () => {
    await ctx.db.delete(waWebhookEvents).where(eq(waWebhookEvents.provider, 'shared'));
    const { log, lines } = captureLog();
    const r = await detectSharedNumberSilence(deps('cloud', log), { now });
    expect(r).toMatchObject({ reason: 'never', alerted: true, silentMinutes: null });
    expect(alertsIn(lines, 'shared_wa_silence')[0]!.obj).toMatchObject({ severity: 'critical' });
  });

  it('uyarı kanalı varsa webhook\'a gider (ağırlık ve bağlam gövdede)', async () => {
    process.env.ALERT_WEBHOOK_URL = ALERT_URL;
    const calls = stubAlertFetch();
    await sharedEventAgo(SHARED_SILENCE_MS + 5 * MIN);
    const { log } = captureLog();
    await detectSharedNumberSilence(deps('cloud', log), { now });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ALERT_URL);
    expect(calls[0]!.body).toMatchObject({ kind: 'shared_wa_silence', severity: 'warning' });
  });

  it('seçilebilir dükkan yoksa ve kapalı saatte uyarı yok', async () => {
    await ctx.db.delete(waWebhookEvents).where(eq(waWebhookEvents.provider, 'shared'));
    const { log, lines } = captureLog();
    // Çalışma saatleri silinince şube kapalı sayılır: kapalı saatte sessizlik normaldir
    await ctx.db.delete(openingHours);
    expect(await detectSharedNumberSilence(deps('cloud', log), { now })).toMatchObject({ reason: 'no_open_shop', alerted: false });
    // Hiç seçilebilir dükkan kalmazsa ölçüm zaten yapılmaz
    await ctx.db.update(tenants).set({ orderingEnabled: false });
    expect(await detectSharedNumberSilence(deps('cloud', log), { now })).toMatchObject({ reason: 'no_shop', alerted: false });
    expect(alertsIn(lines, 'shared_wa_silence')).toHaveLength(0);
    // Sonraki testler için eski duruma dön
    await ctx.db.update(tenants).set({ orderingEnabled: true });
    for (const b of await ctx.db.select({ id: branches.id, tenantId: branches.tenantId }).from(branches)) {
      await ctx.db
        .insert(openingHours)
        .values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId: b.tenantId, branchId: b.id, weekday, opensAt: '00:00', closesAt: '00:00' })));
    }
  });
});

// ---------------------------------------------------------------------------
// İş 3.4 (c) — ortak numarada kimlik/hesap hatası (Twilio 20003/20005 → 190)

describe('ortak numara kimlik hatası uyarısı', () => {
  it('190 ve 131042 kritik uyarı üretir; geçici hata üretmez', () => {
    const { log, lines } = captureLog();
    // Twilio 20003/20005 → Meta 190 (16 §2.6): sınıflandırma 'account_token'
    expect(twilioCodeToMeta('20003', 401)).toBe('190');
    expect(twilioCodeToMeta('20005', 401)).toBe('190');

    alertSharedAccountError({ log, config: ctx.config }, new WaSendError('190', 'token invalid'), 'twilio');
    alertSharedAccountError({ log, config: ctx.config }, new WaSendError('131042', 'payment'), 'twilio');
    // Geçici hata (hız sınırı) uyarı üretmez: yeniden denenecek
    alertSharedAccountError({ log, config: ctx.config }, new WaSendError('130429', 'rate'), 'twilio');

    const alerts = alertsIn(lines, 'shared_wa_account_error');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.obj).toMatchObject({ severity: 'critical', code: '190', action: 'account_token', provider: 'twilio' });
    expect(alerts[1]!.obj).toMatchObject({ severity: 'critical', code: '131042', action: 'account_payment' });
  });
});

// ---------------------------------------------------------------------------
// İş 3.4 (b) — webhook imzası 401: log + uyarı

describe('webhook imza 401 uyarısı', () => {
  const body = () => JSON.stringify(buildInboundPayload({ phoneNumberId: 'pn-x', displayPhone: '+905550000097', wabaId: 'w' }, { phone: nextPhone() }, text('x')).payload);

  it('ortak numara: hatalı imza 401 + KRİTİK uyarı', async () => {
    process.env.ALERT_WEBHOOK_URL = ALERT_URL;
    const calls = stubAlertFetch();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/wa/shared/${SHARED_TOKEN}`,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
      payload: body(),
    });
    expectError(res, 401, 'invalid_signature');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ kind: 'wa_webhook_signature_invalid', severity: 'critical', data: { scope: 'shared', reason: 'meta_signature' } });
  });

  it('ortak numara (Twilio biçimi): Auth Token tanımsızsa 401 + uyarı', async () => {
    process.env.ALERT_WEBHOOK_URL = ALERT_URL;
    const calls = stubAlertFetch();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/wa/shared/${SHARED_TOKEN}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'MessageSid=SM1&From=whatsapp%3A%2B905321234567&Body=merhaba',
    });
    expectError(res, 401, 'invalid_signature');
    expect(calls[0]!.body).toMatchObject({ severity: 'critical', data: { scope: 'shared', reason: 'twilio_auth_token_missing' } });
  });

  it('işletme hesabı: hatalı imza 401 + uyarı (ağırlık warning, hesap kimliği bağlamda)', async () => {
    process.env.ALERT_WEBHOOK_URL = ALERT_URL;
    const calls = stubAlertFetch();
    const t = await setupWaTenant(ctx, { name: 'İmza Lokantası' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/wa/${t.account.webhookToken}`,
      headers: { 'content-type': 'application/json' },
      payload: body(),
    });
    expectError(res, 401, 'invalid_signature');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ kind: 'wa_webhook_signature_invalid', severity: 'warning', data: { scope: 'account', accountId: t.account.id } });
  });

  it('bilinmeyen belirteç (404) ve doğru imza uyarı üretmez', async () => {
    process.env.ALERT_WEBHOOK_URL = ALERT_URL;
    const calls = stubAlertFetch();
    const t = await setupWaTenant(ctx, { name: 'Sessiz Lokanta' });
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/wa/bilinmeyen-token-9876',
      headers: { 'content-type': 'application/json' },
      payload: body(),
    });
    expectError(unknown, 404, 'not_found');
    const raw = body();
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/wa/${t.account.webhookToken}`,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signMetaPayload(raw, APP_SECRET) },
      payload: raw,
    });
    expect(ok.statusCode).toBe(200);
    expect(calls).toHaveLength(0);
  });
});
