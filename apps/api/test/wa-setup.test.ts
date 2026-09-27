// Ortak numara "WhatsApp kurulumu" (admin, 15 §6.2a): yetki (yalnız platform_owner), denetim kaydı (sır/PIN yok), Graph
// ve 360dialog istek biçimleri (sahte fetch: setHttpFetch), Türkçe hata eşlemesi, idempotent şablon gönderimi ve webhook
// kaydı, şablon kataloğunun gönderen kodla / 02 §5 metinleriyle tutarlılığı.

import { CUSTOMER_TEMPLATES } from '@siparis/core';
import { auditLog } from '@siparis/db';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { registerD360Webhook, setupStatus, syncTemplates, templateCreatePayload } from '../src/services/admin/wa-setup';
import { WA_TEMPLATE_CATALOG, renderTemplateBody, templateVariableCount } from '../src/services/messaging/template-bodies';
import { setHttpFetch } from '../src/wa/index';
import { createPlatformUsers, type PlatformUsers } from './admin-helpers';
import { createTestContext, expectError, testConfig, TEST_DATABASE_URL, type TestContext } from './helpers';

const TOKEN = 'EAAG-gizli-sistem-kullanici-token-WXYZ';
const PHONE_ID = '109876543210';
const WABA_ID = '209876543210';
const APP_SECRET = 'meta-app-secret-9f8e';
const HOOK = 'shared-hook-token-0123456789abcdef';
const VERIFY = 'verify-me-0123456789';
const BASE = 'https://yemekgelsin.net';
const GRAPH = 'https://graph.facebook.com/v23.0';
const D360 = 'https://waba-v2.360dialog.io';
const D360_KEY = 'd360-gizli-api-anahtari-QRST';

const cloudEnv = {
  APP_BASE_URL: BASE,
  PLATFORM_WA_PROVIDER: 'cloud',
  PLATFORM_WA_API_KEY: TOKEN,
  PLATFORM_WA_PHONE_NUMBER_ID: PHONE_ID,
  PLATFORM_WA_WABA_ID: WABA_ID,
  WA_APP_SECRET: APP_SECRET,
  PLATFORM_WA_DISPLAY_PHONE: '+905321234567',
  PLATFORM_WA_WEBHOOK_TOKEN: HOOK,
  WA_VERIFY_TOKEN: VERIFY,
};

let ctx: TestContext;
let p: PlatformUsers;
let ownerCookie: string;

interface Call {
  method: string;
  url: string;
  auth: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}
let calls: Call[] = [];
type Reply = { status?: number; json: unknown } | 'network';

/** Sahte Graph: her isteği kaydeder, yanıtı işleyiciden alır. */
function mockGraph(handler: (c: Call) => Reply) {
  calls = [];
  setHttpFetch(async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = { method: init?.method ?? 'GET', url, auth: headers.Authorization, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = handler(c);
    if (r === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
}
const graphError = (status: number, code: number, extra: Record<string, unknown> = {}): Reply => ({
  status,
  json: { error: { message: 'Graph error', type: 'OAuthException', code, fbtrace_id: 'Axyz', ...extra } },
});

const post = (url: string, cookie: string, body?: unknown) => ctx.request({ method: 'POST', url: `/api/v1/admin/whatsapp/setup${url}`, cookie, body });
const get = (url: string, cookie: string) => ctx.request({ method: 'GET', url: `/api/v1/admin/whatsapp/setup${url}`, cookie });
const owner = () => p.platform_owner.cookie;

async function auditRows() {
  return ctx.db.select().from(auditLog).where(like(auditLog.action, 'admin.wa_setup_%'));
}
async function lastAudit(action: string) {
  const rows = (await auditRows()).filter((r) => r.action === action);
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1);
}

beforeAll(async () => {
  ctx = await createTestContext({ config: testConfig(cloudEnv) });
  p = await createPlatformUsers(ctx);
  ownerCookie = (await ctx.createTenantWithOwner({ name: 'Kurulum Deneme Lokantası' })).ownerCookie;
});
afterEach(() => setHttpFetch(null));
afterAll(async () => {
  await ctx.close();
});

// ---------------------------------------------------------------------------
describe('yetki: yalnız platform_owner', () => {
  const endpoints: [string, string, unknown?][] = [
    ['GET', ''],
    ['POST', '/reveal'],
    ['POST', '/test'],
    ['POST', '/register', { pin: '123456' }],
    ['GET', '/subscription'],
    ['POST', '/subscription'],
    ['GET', '/webhook'],
    ['POST', '/webhook'],
    ['GET', '/templates'],
    ['POST', '/templates'],
  ];

  it('diğer platform rolleri 403, işletme sahibi 403, oturumsuz 401; Graph hiç çağrılmaz', async () => {
    mockGraph(() => ({ json: {} }));
    for (const [method, url, body] of endpoints) {
      for (const role of ['platform_admin', 'support_agent', 'finance', 'sales_rep'] as const) {
        const res = await ctx.request({ method: method as 'GET', url: `/api/v1/admin/whatsapp/setup${url}`, cookie: p[role].cookie, body });
        expectError(res, 403, 'forbidden');
      }
      const tenantRes = await ctx.request({ method: method as 'GET', url: `/api/v1/admin/whatsapp/setup${url}`, cookie: ownerCookie, body });
      expect(tenantRes.statusCode, `${method} ${url}`).toBe(403);
      const anon = await ctx.request({ method: method as 'GET', url: `/api/v1/admin/whatsapp/setup${url}`, body });
      expect(anon.statusCode, `${method} ${url}`).toBe(401);
    }
    expect(calls).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('durum ve Meta\'ya girilecek bilgiler', () => {
  it('durum: tanımlı alanlar ve son 4 karakter; hiçbir gizli değer tam dönmez', async () => {
    const res = await get('', owner());
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({
      provider: 'cloud',
      providerLabel: 'Meta Cloud API',
      displayName: 'Yemek Gelsin',
      displayPhone: '+905321234567',
      graphApiVersion: 'v23.0',
      apiBase: 'graph.facebook.com/v23.0',
      fields: {
        phoneNumberId: { set: true, tail: '••••3210' },
        wabaId: { set: true, tail: '••••3210' },
        apiKey: { set: true, tail: '••••WXYZ' },
        appSecret: { set: true, tail: '••••9f8e' },
        webhookToken: { set: true, tail: '••••cdef' },
        verifyToken: { set: true, isDefault: false },
      },
      webhookUrlMasked: `${BASE}/api/v1/webhooks/wa/shared/••••cdef`,
      actions: { test: true, register: true, subscribe: true, templates: true, webhook: false },
      problems: [],
    });
    for (const secret of [TOKEN, APP_SECRET, HOOK, VERIFY]) expect(res.body).not.toContain(secret);
  });

  it('mock ve eksik alanlar: Türkçe sorun satırları, adımlar kapalı', () => {
    const mock = setupStatus(testConfig());
    expect(mock.provider).toBe('mock');
    expect(mock.actions).toEqual({ test: false, register: false, subscribe: false, templates: false, webhook: false });
    expect(mock.problems.join(' ')).toMatch(/simülatör/);
    // Varsayılan yol 360dialog: eklenecek secret adları söylenir
    expect(mock.problems.join(' ')).toMatch(/D360_API_KEY ve WA_PHONE/);
    const partial = setupStatus(testConfig({ PLATFORM_WA_PROVIDER: 'cloud', PLATFORM_WA_API_KEY: TOKEN, PLATFORM_WA_PHONE_NUMBER_ID: 'PHONE-XYZ' }));
    const text = partial.problems.join('\n');
    expect(text).toMatch(/WABA ID\) tanımlı değil: PLATFORM_WA_WABA_ID \(canlı ortam: GitHub secret META_WA_WABA_ID\)/);
    expect(text).toMatch(/App secret\) tanımlı değil/);
    expect(text).toMatch(/yalnız rakamlardan/);
    expect(text).toMatch(/APP_BASE_URL https/);
    expect(partial.actions).toEqual({ test: true, register: true, subscribe: false, templates: false, webhook: false });
  });

  it('Göster: tam webhook adresi + doğrulama belirteci; denetim kaydında belirteç yok', async () => {
    const res = await post('/reveal', owner());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ webhookUrl: `${BASE}/api/v1/webhooks/wa/shared/${HOOK}`, verifyToken: VERIFY, webhookField: 'messages' });
    expect(res.headers['cache-control']).toBe('no-store');
    const a = await lastAudit('admin.wa_setup_reveal');
    expect(a).toMatchObject({ actorUserId: p.platform_owner.user.id, entityType: 'platform_wa', tenantId: null });
    expect(a!.data).toMatchObject({ ok: true, webhookConfigured: true, actorRole: 'platform_owner' });
    expect(JSON.stringify(a!.data)).not.toContain(HOOK);
    expect(JSON.stringify(a!.data)).not.toContain(VERIFY);
  });

  it('gösterilen adres ve belirteç Meta doğrulamasından geçer (ortak webhook GET)', async () => {
    const { webhookUrl, verifyToken } = (await post('/reveal', owner())).json() as { webhookUrl: string; verifyToken: string };
    const path = new URL(webhookUrl).pathname;
    const res = await ctx.request({ method: 'GET', url: `${path}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=4242` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('4242');
  });
});

// ---------------------------------------------------------------------------
describe('Bağlantıyı test et: GET /{phone_number_id}', () => {
  it('istek biçimi ve Türkçe sonuç; hazır numara', async () => {
    mockGraph(() => ({
      json: {
        id: PHONE_ID,
        display_phone_number: '+90 532 123 45 67',
        verified_name: 'Yemek Gelsin',
        name_status: 'APPROVED',
        quality_rating: 'GREEN',
        code_verification_status: 'VERIFIED',
        platform_type: 'CLOUD_API',
        throughput: { level: 'STANDARD' },
      },
    }));
    const res = await post('/test', owner());
    expect(res.statusCode, res.body).toBe(200);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe('GET');
    const u = new URL(c.url);
    expect(`${u.origin}${u.pathname}`).toBe(`${GRAPH}/${PHONE_ID}`);
    expect(u.searchParams.get('fields')).toBe('display_phone_number,verified_name,name_status,quality_rating,code_verification_status,platform_type,throughput');
    expect(c.url).not.toContain(TOKEN);
    expect(c.auth).toBe(`Bearer ${TOKEN}`);
    const body = res.json();
    expect(body.ready).toBe(true);
    expect(body.phone).toMatchObject({ platformType: 'CLOUD_API', nameStatus: 'APPROVED', throughputLevel: 'STANDARD' });
    const rows = Object.fromEntries((body.rows as { label: string; value: string; tone: string }[]).map((r) => [r.label, r]));
    expect(rows['Sistemdeki numara']).toMatchObject({ tone: 'ok' });
    expect(rows['Görünen ad onayı']).toMatchObject({ value: 'Onaylandı', tone: 'ok' });
    expect(rows['Cloud API kaydı']).toMatchObject({ value: "Cloud API'ye kayıtlı", tone: 'ok' });
    expect(rows['Kalite']).toMatchObject({ value: 'Yüksek (yeşil)' });
    expect(body.hints).toEqual([]);
    const a = await lastAudit('admin.wa_setup_test');
    expect(a!.data).toMatchObject({ ok: true, ready: true, platformType: 'CLOUD_API' });
  });

  it('kayıtsız, doğrulanmamış, farklı numara: yapılacaklar Türkçe', async () => {
    mockGraph(() => ({
      json: { id: PHONE_ID, display_phone_number: '+90 533 000 00 00', verified_name: 'Yemek Gelsin', name_status: 'PENDING_REVIEW', code_verification_status: 'NOT_VERIFIED', platform_type: 'NOT_APPLICABLE', throughput: { level: 'NOT_APPLICABLE' } },
    }));
    const body = (await post('/test', owner())).json();
    expect(body.ready).toBe(false);
    const hints = (body.hints as string[]).join('\n');
    expect(hints).toMatch(/Numarayı etkinleştir/);
    expect(hints).toMatch(/SMS ya da sesli arama/);
    expect(hints).toMatch(/incelemesinde/);
    expect(hints).toMatch(/WA_PHONE/);
  });

  it('hata eşlemesi: 190 token, 100/33 yanlış kimlik, WABA kimliği girilmiş, 10 izin, ağ; denetim kaydı ok:false', async () => {
    mockGraph(() => graphError(401, 190, { error_subcode: 463 }));
    const t = await post('/test', owner());
    expectError(t, 502, 'graph_token_invalid');
    expect(t.json().error.message).toMatch(/META_WA_TOKEN/);
    expect(t.body).not.toContain(TOKEN);
    expect((await lastAudit('admin.wa_setup_test'))!.data).toMatchObject({ ok: false, error: 'graph_token_invalid', graphCode: '190' });

    mockGraph(() => graphError(400, 100, { error_subcode: 33, message: "Unsupported get request. Object with ID '1' does not exist" }));
    const nf = await post('/test', owner());
    expectError(nf, 502, 'graph_not_found');
    expect(nf.json().error.message).toMatch(/Phone number ID/);

    mockGraph(() => graphError(400, 100, { message: '(#100) Tried accessing nonexisting field (display_phone_number) on node type (WhatsAppBusinessAccount)' }));
    const wrong = await post('/test', owner());
    expectError(wrong, 502, 'graph_wrong_id');
    expect(wrong.json().error.message).toMatch(/WABA kimliği girilmiş/);

    mockGraph(() => graphError(403, 10, { message: 'Application does not have permission for this action' }));
    const perm = await post('/test', owner());
    expectError(perm, 502, 'graph_permission');
    expect(perm.json().error.message).toMatch(/whatsapp_business_management/);

    mockGraph(() => 'network');
    expectError(await post('/test', owner()), 502, 'graph_unreachable');
  });

  it('mock iken 409 (hiçbir sağlayıcı çağrılmaz) ve denetim kaydı; 360dialog webhook adımı cloud\'da 409', async () => {
    const mockApp: FastifyInstance = await buildApp({ config: testConfig(), db: ctx.handle, logger: false });
    try {
      mockGraph(() => ({ json: {} }));
      const expected: Record<string, string> = { '/test': 'wa_setup_mock', '/subscription': 'wa_setup_not_cloud', '/templates': 'wa_setup_mock', '/webhook': 'wa_setup_mock' };
      for (const [url, code] of Object.entries(expected)) {
        const res = await mockApp.inject({ method: 'POST', url: `/api/v1/admin/whatsapp/setup${url}`, headers: { cookie: owner() } });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json().error.code, url).toBe(code);
      }
      expect(calls).toHaveLength(0);
      expect((await lastAudit('admin.wa_setup_templates_sync'))!.data).toMatchObject({ ok: false, error: 'wa_setup_mock', provider: 'mock' });
    } finally {
      await mockApp.close();
    }
    const hook = await post('/webhook', owner());
    expectError(hook, 409, 'wa_setup_not_d360');
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('Numarayı etkinleştir: POST /{phone_number_id}/register', () => {
  it('istek gövdesi; PIN denetim kaydına ve yanıta yazılmaz', async () => {
    mockGraph(() => ({ json: { success: true } }));
    const res = await post('/register', owner(), { pin: '481516' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${GRAPH}/${PHONE_ID}/register`, auth: `Bearer ${TOKEN}`, body: { messaging_product: 'whatsapp', pin: '481516' } });
    const a = await lastAudit('admin.wa_setup_register');
    expect(a!.data).toMatchObject({ ok: true });
    expect(JSON.stringify(await auditRows())).not.toContain('481516');
    expect(res.body).not.toContain('481516');
  });

  it('geçersiz PIN 400 (Meta çağrılmaz); 133005 PIN uyuşmazlığı ve 133006 doğrulanmamış numara Türkçe; sonra hız sınırı 429', async () => {
    mockGraph(() => ({ json: { success: true } }));
    for (const pin of ['12345', '1234567', '12a456', '']) {
      expect((await post('/register', owner(), { pin })).statusCode, pin).toBe(400);
    }
    expect(calls).toHaveLength(0);

    mockGraph(() => graphError(400, 133005, { message: 'Two step verification PIN Mismatch' }));
    const mismatch = await post('/register', owner(), { pin: '000000' });
    expectError(mismatch, 502, 'wa_pin_mismatch');
    expect(mismatch.json().error.message).toMatch(/İki adımlı doğrulama/);
    expect((await lastAudit('admin.wa_setup_register'))!.data).toMatchObject({ ok: false, error: 'wa_pin_mismatch', graphCode: '133005' });

    mockGraph(() => graphError(400, 133006, { message: 'Phone number needs to be verified before registering' }));
    expectError(await post('/register', owner(), { pin: '000000' }), 502, 'wa_phone_not_verified');

    // İlk başarılı test + 2 hata = 3 deneme; sınır 10 dk'da 5
    mockGraph(() => ({ json: { success: true } }));
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await post('/register', owner(), { pin: '000000' })).statusCode);
    expect(codes).toEqual([200, 200, 429, 429]);
    expect((await lastAudit('admin.wa_setup_register'))!.data).toMatchObject({ ok: false, error: 'rate_limited' });
  });
});

// ---------------------------------------------------------------------------
describe('Webhook aboneliği: /{waba_id}/subscribed_apps', () => {
  it('POST abone eder ve güncel listeyi döner; GET yalnız okur', async () => {
    mockGraph((c) =>
      c.method === 'POST' ? { json: { success: true } } : { json: { data: [{ whatsapp_business_api_data: { id: '555', name: 'yemekgelsin', link: 'https://x' } }] } },
    );
    const res = await post('/subscription', owner());
    expect(res.statusCode, res.body).toBe(200);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${GRAPH}/${WABA_ID}/subscribed_apps`, `GET ${GRAPH}/${WABA_ID}/subscribed_apps`]);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(res.json()).toMatchObject({ subscribed: true, apps: [{ id: '555', name: 'yemekgelsin' }] });
    expect((await lastAudit('admin.wa_setup_subscribe'))!.data).toMatchObject({ ok: true, subscribed: true, apps: 1 });

    mockGraph(() => ({ json: { data: [] } }));
    const read = await get('/subscription', owner());
    expect(read.json()).toMatchObject({ subscribed: false, apps: [] });
    expect(read.json().message).toMatch(/Webhook aboneliğini aç/);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect((await lastAudit('admin.wa_setup_subscription_view'))!.data).toMatchObject({ ok: true, subscribed: false });
  });

  it('yanlış WABA kimliği: 100/33 → WABA mesajı', async () => {
    mockGraph(() => graphError(400, 100, { error_subcode: 33 }));
    const res = await post('/subscription', owner());
    expectError(res, 502, 'graph_not_found');
    expect(res.json().error.message).toMatch(/META_WA_WABA_ID/);
  });
});

// ---------------------------------------------------------------------------
describe('Mesaj şablonları', () => {
  /** Sahte WABA şablon deposu: GET sayfalı liste, POST oluşturur. */
  function templateStore(initial: { name: string; status: string; category?: string; language?: string; rejected_reason?: string }[], opts: { failFor?: Record<string, Reply> } = {}) {
    const store = initial.map((t) => ({ category: 'UTILITY', language: 'tr', ...t }));
    mockGraph((c) => {
      const u = new URL(c.url);
      if (c.method === 'GET') {
        const after = u.searchParams.get('after');
        const start = after ? Number(after) : 0;
        const page = store.slice(start, start + 5);
        const next = start + 5 < store.length;
        return { json: { data: page, paging: { cursors: { before: String(start), after: String(start + 5) }, ...(next ? { next: `${GRAPH}/x?after=${start + 5}` } : {}) } } };
      }
      const body = c.body as { name: string; category: string; language: string };
      const fail = opts.failFor?.[body.name];
      if (fail) return fail;
      store.push({ name: body.name, status: 'PENDING', category: body.category, language: body.language });
      return { json: { id: `tpl-${store.length}`, status: 'PENDING', category: body.category } };
    });
    return store;
  }

  it('GET: sayfalı liste (after imleci), durum/ret sebebi/kategori değişimi Türkçe; eksikler "Meta\'da yok"', async () => {
    templateStore([
      { name: 'siparis_alindi_v1', status: 'APPROVED' },
      { name: 'siparis_onaylandi_v1', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' },
      { name: 'siparis_hazir_v1', status: 'APPROVED', category: 'MARKETING' },
      { name: 'siparis_yolda_v1', status: 'PENDING' },
      { name: 'baska_sablon', status: 'APPROVED' },
      { name: 'siparis_teslim_v1', status: 'APPROVED', language: 'en_US' },
      { name: 'isletme_yeni_siparis_v1', status: 'PAUSED' },
    ]);
    const res = await get('/templates', owner());
    expect(res.statusCode, res.body).toBe(200);
    expect(calls).toHaveLength(2);
    const first = new URL(calls[0]!.url);
    expect(`${first.origin}${first.pathname}`).toBe(`${GRAPH}/${WABA_ID}/message_templates`);
    expect(first.searchParams.get('fields')).toBe('name,status,category,language,rejected_reason');
    expect(new URL(calls[1]!.url).searchParams.get('after')).toBe('5');
    const body = res.json();
    const by = Object.fromEntries((body.templates as { name: string }[]).map((t) => [t.name, t])) as Record<string, Record<string, unknown>>;
    expect(body.templates).toHaveLength(WA_TEMPLATE_CATALOG.length);
    expect(by.siparis_alindi_v1).toMatchObject({ status: 'APPROVED', statusLabel: 'Onaylandı', tone: 'ok', categoryChanged: false });
    expect(by.siparis_onaylandi_v1).toMatchObject({ status: 'REJECTED', statusLabel: 'Reddedildi', tone: 'bad', rejectedReason: 'INVALID_FORMAT', rejectedReasonLabel: expect.stringMatching(/Geçersiz biçim/) });
    expect(by.siparis_hazir_v1).toMatchObject({ categoryChanged: true, category: 'MARKETING' });
    expect(by.siparis_yolda_v1).toMatchObject({ statusLabel: 'İncelemede', tone: 'warn' });
    // Yalnız başka dilde olan şablon Türkçe için yok sayılır
    expect(by.siparis_teslim_v1).toMatchObject({ status: null, statusLabel: "Meta'da yok" });
    expect(by.isletme_yeni_siparis_v1).toMatchObject({ status: 'PAUSED', tone: 'bad' });
    expect(body.summary).toEqual({ total: WA_TEMPLATE_CATALOG.length, approved: 2, pending: 1, rejected: 2, missing: WA_TEMPLATE_CATALOG.length - 5 });
    expect(body.sync).toBeUndefined();
    expect((await lastAudit('admin.wa_setup_templates_view'))!.data).toMatchObject({ ok: true });
  });

  it('POST: yalnız eksikler oluşturulur (gövde kodla birebir, konumsal değişken + örnek, butonlar); ikinci çalıştırma hiçbir şey oluşturmaz', async () => {
    const store = templateStore([
      { name: 'siparis_alindi_v1', status: 'APPROVED' },
      { name: 'siparis_onaylandi_v1', status: 'REJECTED', rejected_reason: 'PROMOTIONAL' },
    ]);
    const res = await post('/templates', owner());
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    const expectedCreated = WA_TEMPLATE_CATALOG.map((d) => d.name).filter((n) => n !== 'siparis_alindi_v1' && n !== 'siparis_onaylandi_v1');
    expect(body.sync).toEqual({ created: expectedCreated, skipped: ['siparis_alindi_v1', 'siparis_onaylandi_v1'], failed: [] });
    const creates = calls.filter((c) => c.method === 'POST');
    expect(creates).toHaveLength(expectedCreated.length);
    for (const c of creates) {
      expect(c.url).toBe(`${GRAPH}/${WABA_ID}/message_templates`);
      expect(c.auth).toBe(`Bearer ${TOKEN}`);
      const b = c.body as { name: string; language: string; category: string; components: Record<string, unknown>[] };
      const def = WA_TEMPLATE_CATALOG.find((d) => d.name === b.name)!;
      expect(b).toMatchObject({ language: 'tr', category: 'UTILITY' });
      const bodyComp = b.components.find((x) => x.type === 'BODY') as { text: string; example: { body_text: string[][] } };
      expect(bodyComp.text).toBe(def.body);
      expect(bodyComp.example.body_text[0]).toHaveLength(templateVariableCount(def.body));
    }
    const byName = (n: string) => creates.find((c) => (c.body as { name: string }).name === n)!.body as { components: { type: string; buttons?: unknown[] }[] };
    expect(byName('siparis_hazir_v1').components[1]).toEqual({
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: 'Siparişi takip et', url: `${BASE}/t/{{1}}`, example: [expect.stringMatching(new RegExp(`^${BASE}/t/.+`))] }],
    });
    expect(byName('siparis_teslim_v1').components[1]!.buttons).toEqual([expect.objectContaining({ type: 'URL', text: 'Değerlendir', url: `${BASE}/t/{{1}}` })]);
    expect(byName('yanit_bekliyor_v1').components[1]!.buttons).toEqual([{ type: 'QUICK_REPLY', text: 'Devam et' }]);
    expect(byName('siparis_reddedildi_v1').components).toHaveLength(1);
    expect(byName('isletme_yeni_siparis_v1').components[1]!.buttons).toEqual([{ type: 'URL', text: 'Siparişleri aç', url: `${BASE}/panel/siparisler` }]);
    // Sonuç: son liste Meta'dan yeniden okunur
    expect(body.summary).toMatchObject({ approved: 1, rejected: 1, pending: expectedCreated.length, missing: 0 });
    const sync = await lastAudit('admin.wa_setup_templates_sync');
    expect(sync!.data).toMatchObject({ ok: true, created: expectedCreated, skipped: 2, failed: [] });

    // İdempotent: ikinci çalıştırmada oluşturma yok, hiçbir şey silinmez
    const before = store.length;
    calls = [];
    const again = await post('/templates', owner());
    expect(again.json().sync).toMatchObject({ created: [], failed: [] });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(store).toHaveLength(before);
  });

  it('"zaten var" hatası atlanır, tek şablon hatası listelenir, diğerleri oluşturulur', async () => {
    templateStore([], {
      failFor: {
        siparis_alindi_v1: graphError(400, 100, { error_subcode: 2388024, message: 'Content in this language already exists' }),
        siparis_hazir_v1: graphError(400, 100, { error_subcode: 2388043, message: 'Invalid parameter', error_user_msg: 'Değişkenler için örnek gerekli.' }),
      },
    });
    const body = (await post('/templates', owner())).json();
    expect(body.sync.skipped).toEqual(['siparis_alindi_v1']);
    expect(body.sync.failed).toEqual([{ name: 'siparis_hazir_v1', message: expect.stringMatching(/Değişkenler için örnek gerekli/) }]);
    expect(body.sync.created).toHaveLength(WA_TEMPLATE_CATALOG.length - 2);
  });

  it('token hatası tüm gönderimi durdurur (502); https olmayan APP_BASE_URL 409', async () => {
    templateStore([], { failFor: Object.fromEntries(WA_TEMPLATE_CATALOG.map((d) => [d.name, graphError(401, 190)])) });
    expectError(await post('/templates', owner()), 502, 'graph_token_invalid');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect((await lastAudit('admin.wa_setup_templates_sync'))!.data).toMatchObject({ ok: false, error: 'graph_token_invalid' });

    templateStore([]);
    await expect(syncTemplates(testConfig({ ...cloudEnv, APP_BASE_URL: 'http://localhost:3000' }))).rejects.toMatchObject({ statusCode: 409, code: 'wa_setup_base_url' });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 360dialog (d360, varsayılan yol; 15 §6.2): anahtar yalnız D360-API-KEY başlığında, yolda kimlik yok.

const d360Env = {
  APP_BASE_URL: BASE,
  PLATFORM_WA_PROVIDER: 'd360',
  PLATFORM_WA_API_KEY: D360_KEY,
  PLATFORM_WA_DISPLAY_PHONE: '+905321234567',
  PLATFORM_WA_WEBHOOK_TOKEN: HOOK,
};
const EXPECTED_HOOK = `${BASE}/api/v1/webhooks/wa/shared/${HOOK}`;

describe('360dialog (d360)', () => {
  let d360App: FastifyInstance;
  const d = (method: 'GET' | 'POST', url: string, body?: unknown) =>
    d360App.inject({ method, url: `/api/v1/admin/whatsapp/setup${url}`, headers: { cookie: owner() }, ...(body ? { payload: body as object } : {}) });

  /** Her çağrıda anahtar yalnız başlıkta; Authorization yok, URL'de anahtar yok. */
  function expectD360Headers() {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url.startsWith(`${D360}/`), c.url).toBe(true);
      expect(c.headers['D360-API-KEY']).toBe(D360_KEY);
      expect(c.auth).toBeUndefined();
      expect(c.url).not.toContain(D360_KEY);
    }
  }

  /** Sahte 360dialog: health_status, webhook yapılandırması (bellekte) ve şablon deposu. */
  function mockD360(opts: {
    health?: Reply;
    webhook?: string | null;
    webhookGet?: Reply;
    webhookPost?: Reply;
    templates?: { name: string; status: string; category?: string; language?: string; rejected_reason?: string }[];
    failFor?: Record<string, Reply>;
  } = {}) {
    const state = { webhook: opts.webhook ?? null, templates: (opts.templates ?? []).map((t) => ({ category: 'UTILITY', language: 'tr', ...t })) };
    mockGraph((c) => {
      const u = new URL(c.url);
      if (u.pathname === '/health_status') {
        return (
          opts.health ?? {
            json: {
              id: '1234567890',
              display_phone_number: '+90 532 123 45 67',
              verified_name: 'Yemek Gelsin',
              name_status: 'APPROVED',
              quality_rating: 'GREEN',
              messaging_limit_tier: 'TIER_1K',
              health_status: { can_send_message: 'AVAILABLE', entities: [{ entity_type: 'PHONE_NUMBER', id: '1', can_send_message: 'AVAILABLE' }] },
            },
          }
        );
      }
      if (u.pathname === '/v1/configs/webhook') {
        if (c.method === 'GET') {
          if (opts.webhookGet) return opts.webhookGet;
          return state.webhook ? { json: { url: state.webhook } } : { status: 404, json: { error: 'Webhook not found' } };
        }
        if (opts.webhookPost) return opts.webhookPost;
        state.webhook = (c.body as { url: string }).url;
        return { json: { url: state.webhook } };
      }
      if (u.pathname === '/message_templates') {
        if (c.method === 'GET') return { json: { data: state.templates, paging: { cursors: { before: 'a', after: 'b' } } } };
        const body = c.body as { name: string; category: string; language: string };
        const fail = opts.failFor?.[body.name];
        if (fail) return fail;
        state.templates.push({ name: body.name, status: 'PENDING', category: body.category, language: body.language });
        return { json: { id: `tpl-${state.templates.length}`, status: 'PENDING', category: body.category } };
      }
      return { status: 404, json: { error: `not found: ${u.pathname}` } };
    });
    return state;
  }

  beforeAll(async () => {
    d360App = await buildApp({ config: testConfig(d360Env), db: ctx.handle, logger: false });
  });
  afterAll(async () => {
    await d360App.close();
  });

  it('durum: 360dialog, numara, anahtar son 4 karakter; Meta adımları kapalı, webhook adımı açık; gizli değer dönmez', async () => {
    mockGraph(() => ({ json: {} }));
    const res = await d('GET', '');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      provider: 'd360',
      providerLabel: '360dialog',
      displayPhone: '+905321234567',
      apiBase: 'waba-v2.360dialog.io',
      fields: { apiKey: { set: true, tail: '••••QRST' }, webhookToken: { set: true, tail: '••••cdef' } },
      webhookUrlMasked: `${BASE}/api/v1/webhooks/wa/shared/••••cdef`,
      actions: { test: true, register: false, subscribe: false, templates: true, webhook: true },
      problems: [],
    });
    for (const secret of [D360_KEY, HOOK]) expect(res.body).not.toContain(secret);
    expect(calls).toHaveLength(0);

    // Anahtar yok, alan adında alt çizgi: Türkçe sorunlar, adımlar kapalı
    const bad = setupStatus(testConfig({ ...d360Env, PLATFORM_WA_API_KEY: '', APP_BASE_URL: 'https://yemek_gelsin.example' }));
    const text = bad.problems.join('\n');
    expect(text).toMatch(/360dialog API anahtarı tanımlı değil: PLATFORM_WA_API_KEY \(canlı ortam: GitHub secret D360_API_KEY\)/);
    expect(text).toMatch(/alt çizgi/);
    expect(bad.actions).toEqual({ test: false, register: false, subscribe: false, templates: false, webhook: false });
  });

  it('Bağlantıyı test et: GET /health_status?fields=… + GET /v1/configs/webhook; hazır numara; denetim kaydı', async () => {
    mockD360({ webhook: EXPECTED_HOOK });
    const res = await d('POST', '/test');
    expect(res.statusCode, res.body).toBe(200);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /health_status', 'GET /v1/configs/webhook']);
    expect(new URL(calls[0]!.url).searchParams.get('fields')).toBe(
      'health_status,display_phone_number,verified_name,name_status,quality_rating,code_verification_status,platform_type,messaging_limit_tier',
    );
    expectD360Headers();
    const body = res.json();
    expect(body.ready).toBe(true);
    const rows = Object.fromEntries((body.rows as { label: string; value: string; tone: string }[]).map((r) => [r.label, r]));
    expect(rows['API anahtarı']).toMatchObject({ tone: 'ok' });
    expect(rows['Sistemdeki numara']).toMatchObject({ tone: 'ok' });
    expect(rows['Görünen ad onayı']).toMatchObject({ value: 'Onaylandı', tone: 'ok' });
    expect(rows['Mesaj gönderimi (Meta)']).toMatchObject({ value: 'Açık', tone: 'ok' });
    expect(rows['Günlük iletişim sınırı']).toMatchObject({ value: 'Günde 1.000 kişi' });
    expect(rows['Webhook (360dialog)']).toMatchObject({ value: `${BASE}/api/v1/webhooks/wa/shared/••••cdef (doğru)`, tone: 'ok' });
    expect(body.hints).toEqual([]);
    expect(res.body).not.toContain(HOOK);
    expect((await lastAudit('admin.wa_setup_test'))!.data).toMatchObject({ ok: true, ready: true, provider: 'd360' });
  });

  it('test: webhook yok, gönderim engelli, Meta açıklamaları ipucu olarak; webhook okunamazsa test düşmez', async () => {
    mockD360({
      health: {
        json: {
          display_phone_number: '+90 532 123 45 67',
          verified_name: 'Yemek Gelsin',
          name_status: 'PENDING_REVIEW',
          health_status: {
            can_send_message: 'BLOCKED',
            entities: [{ entity_type: 'WABA', id: '9', can_send_message: 'BLOCKED', errors: [{ error_code: 141010, error_description: 'The Business has not passed business verification.', possible_solution: 'Verify the business.' }] }],
          },
        },
      },
    });
    const body = (await d('POST', '/test')).json();
    expect(body.ready).toBe(false);
    const hints = (body.hints as string[]).join('\n');
    expect(hints).toMatch(/Webhook 360dialog'a kayıtlı değil/);
    expect(hints).toMatch(/engelliyor/);
    expect(hints).toMatch(/Meta \(WABA, kod 141010\): The Business has not passed business verification\. Öneri: Verify the business\./);
    expect(hints).toMatch(/incelemesinde/);

    mockD360({ webhookGet: { status: 500, json: { error: 'internal' } } });
    const partial = await d('POST', '/test');
    expect(partial.statusCode, partial.body).toBe(200);
    const rows = Object.fromEntries((partial.json().rows as { label: string; value: string }[]).map((r) => [r.label, r]));
    expect(rows['Webhook (360dialog)']).toMatchObject({ value: 'Okunamadı' });
  });

  it('hata eşlemesi: 401 anahtar, 403, 404, 429, 5xx, ağ; anahtar yanıtta yok; denetim kaydında HTTP durumu', async () => {
    mockGraph(() => ({ status: 401, json: { error: 'Invalid API key' } }));
    const t = await d('POST', '/test');
    expectError(t, 502, 'd360_key_invalid');
    expect(t.json().error.message).toMatch(/D360_API_KEY/);
    expect(t.json().error.message).toMatch(/webhook adresini siler/);
    expect(t.body).not.toContain(D360_KEY);
    expect((await lastAudit('admin.wa_setup_test'))!.data).toMatchObject({ ok: false, error: 'd360_key_invalid', httpStatus: 401, provider: 'd360' });

    mockGraph(() => ({ status: 403, json: { error: 'Forbidden' } }));
    expectError(await d('POST', '/test'), 502, 'd360_forbidden');
    mockGraph(() => ({ status: 404, json: { error: 'Not found' } }));
    const nf = await d('POST', '/test');
    expectError(nf, 502, 'd360_not_found');
    expect(nf.json().error.message).toMatch(/§6\.3/);
    mockGraph(() => ({ status: 429, json: { error: 'Too many requests' } }));
    expectError(await d('POST', '/test'), 502, 'd360_rate_limited');
    mockGraph(() => ({ status: 503, json: { error: 'unavailable' } }));
    expectError(await d('POST', '/test'), 502, 'd360_unavailable');
    // 360dialog'un ilettiği Meta hatası (Graph biçimi)
    mockGraph(() => graphError(400, 131042, { message: 'Business eligibility payment issue' }));
    expectError(await d('POST', '/test'), 502, 'wa_payment_missing');
    mockGraph(() => 'network');
    expectError(await d('POST', '/test'), 502, 'd360_unreachable');
  });

  it("webhook: GET okur (yoksa \"kayıtlı değil\"); POST ortak adresi yazar {url}; ikinci POST yazmaz (idempotent); belirteç kayıtlarda yok", async () => {
    const state = mockD360();
    const view = await d('GET', '/webhook');
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json()).toMatchObject({ configured: false, matches: false, changed: false, urlMasked: null, expectedUrlMasked: `${BASE}/api/v1/webhooks/wa/shared/••••cdef` });
    expect(view.json().message).toMatch(/kayıtlı webhook yok/);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expectD360Headers();
    expect((await lastAudit('admin.wa_setup_webhook_view'))!.data).toMatchObject({ ok: true, configured: false, matches: false });

    calls = [];
    const reg = await d('POST', '/webhook');
    expect(reg.statusCode, reg.body).toBe(200);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /v1/configs/webhook', 'POST /v1/configs/webhook', 'GET /v1/configs/webhook']);
    const postCall = calls.find((c) => c.method === 'POST')!;
    expect(postCall.body).toEqual({ url: EXPECTED_HOOK });
    expect(postCall.headers['Content-Type']).toBe('application/json');
    expectD360Headers();
    expect(state.webhook).toBe(EXPECTED_HOOK);
    expect(reg.json()).toMatchObject({ configured: true, matches: true, changed: true, urlMasked: `${BASE}/api/v1/webhooks/wa/shared/••••cdef` });
    expect(reg.json().message).toMatch(/kaydedildi/);
    expect(reg.body).not.toContain(HOOK);
    const audit = await lastAudit('admin.wa_setup_webhook_register');
    expect(audit!.data).toMatchObject({ ok: true, configured: true, matches: true, changed: true, provider: 'd360' });
    expect(JSON.stringify(await auditRows())).not.toContain(HOOK);

    // İdempotent: adres zaten doğru → yalnız okur
    calls = [];
    const again = await d('POST', '/webhook');
    expect(again.json()).toMatchObject({ matches: true, changed: false });
    expect(again.json().message).toMatch(/zaten/);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('webhook: başka adres kayıtlıysa üzerine yazılır (eski adres maskeli gösterilir); GET 500 olsa da yazmayı dener', async () => {
    mockD360({ webhook: 'https://eski-entegrasyon.example/hooks/0123456789abcdefXYZW?k=gizli' });
    const view = (await d('GET', '/webhook')).json();
    expect(view).toMatchObject({ configured: true, matches: false, urlMasked: 'https://eski-entegrasyon.example/hooks/••••XYZW?…' });
    expect(view.message).toMatch(/başka bir adrese/);
    const reg = await d('POST', '/webhook');
    expect(reg.json()).toMatchObject({ matches: true, changed: true });

    const state = mockD360({ webhookGet: { status: 500, json: { error: 'internal' } } });
    const tolerant = await d('POST', '/webhook');
    expect(tolerant.statusCode, tolerant.body).toBe(200);
    expect(state.webhook).toBe(EXPECTED_HOOK);
    expect(tolerant.json()).toMatchObject({ changed: true, matches: true });

    // Anahtar geçersiz: yazmaya geçmez
    mockD360({ webhookGet: { status: 401, json: { error: 'Invalid API key' } } });
    expectError(await d('POST', '/webhook'), 502, 'd360_key_invalid');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    // POST reddedilirse Türkçe hata ve denetim kaydı
    mockD360({ webhookPost: { status: 400, json: { error: 'URL must be https' } } });
    const rej = await d('POST', '/webhook');
    expectError(rej, 502, 'd360_error');
    expect(rej.json().error.message).toMatch(/URL must be https/);
    expect((await lastAudit('admin.wa_setup_webhook_register'))!.data).toMatchObject({ ok: false, error: 'd360_error', httpStatus: 400 });
  });

  it('webhook ön koşulları: belirteç yok ya da https değil / alan adında alt çizgi → 409, 360dialog çağrılmaz', async () => {
    mockD360();
    await expect(registerD360Webhook(testConfig({ ...d360Env, PLATFORM_WA_WEBHOOK_TOKEN: '' }))).rejects.toMatchObject({ statusCode: 409, code: 'wa_setup_missing' });
    await expect(registerD360Webhook(testConfig({ ...d360Env, APP_BASE_URL: 'http://localhost:3000' }))).rejects.toMatchObject({ statusCode: 409, code: 'wa_setup_base_url' });
    await expect(registerD360Webhook(testConfig({ ...d360Env, APP_BASE_URL: 'https://yemek_gelsin.example' }))).rejects.toMatchObject({ statusCode: 409, code: 'wa_setup_base_url' });
    await expect(registerD360Webhook(testConfig({ ...d360Env, APP_BASE_URL: 'https://yemekgelsin.net:8443' }))).rejects.toMatchObject({ statusCode: 409, code: 'wa_setup_base_url' });
    expect(calls).toHaveLength(0);
  });

  it('ortak webhook: 360dialog imza göndermez → d360\'ta imzasız olay kabul edilir (WA_APP_SECRET olsa da; URL belirteci korur); cloud\'da 401', async () => {
    const payload = { object: 'whatsapp_business_account', entry: [] };
    const withSecret = await buildApp({ config: testConfig({ ...d360Env, WA_APP_SECRET: APP_SECRET }), db: ctx.handle, logger: false });
    try {
      const ok = await withSecret.inject({ method: 'POST', url: `/api/v1/webhooks/wa/shared/${HOOK}`, payload });
      expect(ok.statusCode, ok.body).toBe(200);
      const wrong = await withSecret.inject({ method: 'POST', url: '/api/v1/webhooks/wa/shared/yanlis-belirtec-00000000', payload });
      expect(wrong.statusCode).toBe(404);
    } finally {
      await withSecret.close();
    }
    const cloudRes = await ctx.request({ method: 'POST', url: `/api/v1/webhooks/wa/shared/${HOOK}`, body: payload });
    expect(cloudRes.statusCode).toBe(401);
  });

  it('Meta\'ya özel adımlar (numara kaydı, abonelik) 360dialog\'da 409 ve açıklama; hiçbir çağrı yapılmaz', async () => {
    mockD360();
    for (const [method, url, body] of [['POST', '/register', { pin: '123456' }], ['GET', '/subscription'], ['POST', '/subscription']] as const) {
      const res = await d(method, url, body);
      expectError(res, 409, 'wa_setup_not_cloud');
      expect(res.json().error.message).toMatch(/360dialog yapar/);
    }
    expect(calls).toHaveLength(0);
  });

  it('şablonlar: GET/POST /message_templates (Graph ile aynı gövde), küçük harf durumlar, yalnız eksikler, ikinci çalıştırma boş', async () => {
    const state = mockD360({
      templates: [
        { name: 'siparis_alindi_v1', status: 'approved', category: 'utility' },
        { name: 'siparis_onaylandi_v1', status: 'submitted' },
        { name: 'siparis_hazir_v1', status: 'rejected', rejected_reason: 'invalid_format' },
      ],
    });
    const list = await d('GET', '/templates');
    expect(list.statusCode, list.body).toBe(200);
    const first = new URL(calls[0]!.url);
    expect(`${first.origin}${first.pathname}`).toBe(`${D360}/message_templates`);
    expect(first.searchParams.get('fields')).toBe('name,status,category,language,rejected_reason');
    expectD360Headers();
    const by = Object.fromEntries((list.json().templates as { name: string }[]).map((t) => [t.name, t])) as Record<string, Record<string, unknown>>;
    expect(by.siparis_alindi_v1).toMatchObject({ status: 'APPROVED', tone: 'ok', categoryChanged: false });
    expect(by.siparis_onaylandi_v1).toMatchObject({ status: 'SUBMITTED', statusLabel: 'İncelemede', tone: 'warn' });
    expect(by.siparis_hazir_v1).toMatchObject({ status: 'REJECTED', rejectedReason: 'INVALID_FORMAT', rejectedReasonLabel: expect.stringMatching(/Geçersiz biçim/) });
    expect(list.json().summary).toMatchObject({ approved: 1, pending: 1, rejected: 1, missing: WA_TEMPLATE_CATALOG.length - 3 });

    calls = [];
    const sync = await d('POST', '/templates');
    expect(sync.statusCode, sync.body).toBe(200);
    const creates = calls.filter((c) => c.method === 'POST');
    expect(creates).toHaveLength(WA_TEMPLATE_CATALOG.length - 3);
    for (const c of creates) {
      expect(c.url).toBe(`${D360}/message_templates`);
      const b = c.body as { name: string };
      const def = WA_TEMPLATE_CATALOG.find((x) => x.name === b.name)!;
      expect(c.body).toEqual(templateCreatePayload(def, BASE));
    }
    expectD360Headers();
    expect(sync.json().sync).toMatchObject({ skipped: ['siparis_alindi_v1', 'siparis_onaylandi_v1', 'siparis_hazir_v1'], failed: [] });
    expect((await lastAudit('admin.wa_setup_templates_sync'))!.data).toMatchObject({ ok: true, provider: 'd360', skipped: 3 });

    const before = state.templates.length;
    calls = [];
    const again = await d('POST', '/templates');
    expect(again.json().sync).toMatchObject({ created: [], failed: [] });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(state.templates).toHaveLength(before);
  });

  it('şablonlar: "zaten var" atlanır, tek şablon hatası listelenir; 401 tüm gönderimi durdurur', async () => {
    mockD360({
      failFor: {
        siparis_alindi_v1: { status: 400, json: { error: 'Template with this name and language already exists' } },
        siparis_hazir_v1: graphError(400, 100, { error_subcode: 2388043, message: 'Invalid parameter', error_user_msg: 'Değişkenler için örnek gerekli.' }),
      },
    });
    const body = (await d('POST', '/templates')).json();
    expect(body.sync.skipped).toEqual(['siparis_alindi_v1']);
    expect(body.sync.failed).toEqual([{ name: 'siparis_hazir_v1', message: expect.stringMatching(/360dialog isteği reddetti.*Değişkenler için örnek gerekli/) }]);
    expect(body.sync.created).toHaveLength(WA_TEMPLATE_CATALOG.length - 2);

    mockD360({ failFor: Object.fromEntries(WA_TEMPLATE_CATALOG.map((x) => [x.name, { status: 401, json: { error: 'Invalid API key' } } as Reply])) });
    expectError(await d('POST', '/templates'), 502, 'd360_key_invalid');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('şablon kataloğu: tek kaynak ve gönderen kodla uyum', () => {
  it('her şablonda değişken sayısı = parametre sayısı = örnek sayısı; {{n}} sıralı', () => {
    expect(WA_TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(15);
    for (const def of WA_TEMPLATE_CATALOG) {
      const n = templateVariableCount(def.body);
      expect(n, def.name).toBe(def.params.length);
      expect(def.examples, def.name).toHaveLength(n);
      for (let i = 1; i <= n; i++) expect(def.body, def.name).toContain(`{{${i}}}`);
      expect(def.examples.every((e) => e && !/\n/.test(e)), def.name).toBe(true);
      // Meta gövdenin değişkenle başlamasını/bitmesini reddeder
      expect(def.body.trim().startsWith('{{'), def.name).toBe(false);
      expect(def.body.trim().endsWith('}}'), def.name).toBe(false);
      // Gösterim metni aynı gövdeden üretilir
      expect(renderTemplateBody(def.name, def.examples)).not.toMatch(/\{\{\d+\}\}/);
    }
  });

  it('butonlar gönderen kodla uyumlu: takip/değerlendirme tek dinamik URL (index 0); platform uyarıları dinamik buton istemez', () => {
    for (const def of WA_TEMPLATE_CATALOG.filter((d) => d.audience === 'customer')) {
      const kind = CUSTOMER_TEMPLATES[def.name as keyof typeof CUSTOMER_TEMPLATES].button;
      const dynamic = def.buttons.filter((b) => b.type === 'url' && b.dynamic);
      if (kind === 'track' || kind === 'review') {
        expect(def.buttons, def.name).toHaveLength(1);
        expect(dynamic, def.name).toHaveLength(1);
      } else {
        expect(dynamic, def.name).toHaveLength(0);
      }
    }
    // platform-alert.ts buton parametresi göndermez
    for (const name of ['isletme_yeni_siparis_v1', 'isletme_panel_cevrimdisi_v1', 'isletme_baglanti_sorunu_v1', 'isletme_meta_odeme_v1', 'isletme_kalite_uyari_v1']) {
      const def = WA_TEMPLATE_CATALOG.find((d) => d.name === name)!;
      expect(def.buttons.some((b) => b.type === 'url' && b.dynamic), name).toBe(false);
    }
    const payload = templateCreatePayload(WA_TEMPLATE_CATALOG.find((d) => d.name === 'kurye_giris_v1')!, `${BASE}/`);
    expect(JSON.stringify(payload)).toContain(`${BASE}/kurye/giris?t={{1}}`);
  });

  it('gövdeler 02 §5.2/§5.3 "Metinler" listesiyle birebir aynı', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const doc = readFileSync(join(here, '../../../docs/02-whatsapp-entegrasyonu.md'), 'utf8');
    for (const def of WA_TEMPLATE_CATALOG) {
      const re = new RegExp(`^- \\*\\*\`${def.name}\`\\*\\*(?: \\[[^\\]]+\\])? — "(.*)"$`, 'm');
      const m = doc.match(re);
      expect(m, def.name).not.toBeNull();
      expect(m![1]!.replace(/\\"/g, '"'), def.name).toBe(def.body);
    }
  });

  it('PLATFORM_WA_WABA_ID: isteğe bağlı, kırpılır', () => {
    const base = { DATABASE_URL: TEST_DATABASE_URL, SESSION_SECRET: 'x'.repeat(20), TRACKING_SECRET: 'y'.repeat(10), ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
    expect(loadConfig({ ...base, PLATFORM_WA_WABA_ID: ' 2098 ' }).PLATFORM_WA_WABA_ID).toBe('2098');
    expect(loadConfig(base).PLATFORM_WA_WABA_ID).toBeUndefined();
  });
});
