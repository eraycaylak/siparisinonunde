// Ortak numara "WhatsApp kurulumu" (admin, 15 §6.2a): yetki (yalnız platform_owner), denetim kaydı (sır/PIN yok), Graph
// istek biçimleri (sahte fetch: setHttpFetch), Türkçe hata eşlemesi, idempotent şablon gönderimi ve şablon kataloğunun
// gönderen kodla / 02 §5 metinleriyle tutarlılığı.

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
import { setupStatus, syncTemplates, templateCreatePayload } from '../src/services/admin/wa-setup';
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
  body: unknown;
}
let calls: Call[] = [];
type Reply = { status?: number; json: unknown } | 'network';

/** Sahte Graph: her isteği kaydeder, yanıtı işleyiciden alır. */
function mockGraph(handler: (c: Call) => Reply) {
  calls = [];
  setHttpFetch(async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const c: Call = { method: init?.method ?? 'GET', url, auth: headers.Authorization, body: init?.body ? JSON.parse(String(init.body)) : undefined };
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
      fields: {
        phoneNumberId: { set: true, tail: '••••3210' },
        wabaId: { set: true, tail: '••••3210' },
        apiKey: { set: true, tail: '••••WXYZ' },
        appSecret: { set: true, tail: '••••9f8e' },
        webhookToken: { set: true, tail: '••••cdef' },
        verifyToken: { set: true, isDefault: false },
      },
      webhookUrlMasked: `${BASE}/api/v1/webhooks/wa/shared/••••cdef`,
      actions: { test: true, register: true, subscribe: true, templates: true },
      problems: [],
    });
    for (const secret of [TOKEN, APP_SECRET, HOOK, VERIFY]) expect(res.body).not.toContain(secret);
  });

  it('mock ve eksik alanlar: Türkçe sorun satırları, adımlar kapalı', () => {
    const mock = setupStatus(testConfig());
    expect(mock.provider).toBe('mock');
    expect(mock.actions).toEqual({ test: false, register: false, subscribe: false, templates: false });
    expect(mock.problems.join(' ')).toMatch(/simülatör/);
    const partial = setupStatus(testConfig({ PLATFORM_WA_PROVIDER: 'cloud', PLATFORM_WA_API_KEY: TOKEN, PLATFORM_WA_PHONE_NUMBER_ID: 'PHONE-XYZ' }));
    const text = partial.problems.join('\n');
    expect(text).toMatch(/WABA ID\) tanımlı değil: PLATFORM_WA_WABA_ID \(Cloudflare dev: GitHub secret META_WA_WABA_ID\)/);
    expect(text).toMatch(/App secret\) tanımlı değil/);
    expect(text).toMatch(/yalnız rakamlardan/);
    expect(text).toMatch(/APP_BASE_URL https/);
    expect(partial.actions).toEqual({ test: true, register: true, subscribe: false, templates: false });
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

  it('cloud değilse 409 (Graph çağrılmaz) ve denetim kaydı', async () => {
    const mockApp: FastifyInstance = await buildApp({ config: testConfig(), db: ctx.handle, logger: false });
    try {
      mockGraph(() => ({ json: {} }));
      for (const url of ['/test', '/subscription', '/templates']) {
        const res = await mockApp.inject({ method: 'POST', url: `/api/v1/admin/whatsapp/setup${url}`, headers: { cookie: owner() } });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json().error.code).toBe('wa_setup_not_cloud');
      }
      expect(calls).toHaveLength(0);
      expect((await lastAudit('admin.wa_setup_templates_sync'))!.data).toMatchObject({ ok: false, error: 'wa_setup_not_cloud', provider: 'mock' });
    } finally {
      await mockApp.close();
    }
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
