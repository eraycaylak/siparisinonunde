// Dev araçları (DEV_TOOLS=1): hesaplar, simülatör gelen mesajı (?sync=1), thread, echo, SMS kutusu, platform uyarıları.

import { buildApp } from '../src/app';
import { notifications, smsMessages } from '@siparis/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, testConfig, type TestContext } from './helpers';
import { setupWaTenant, type WaSetup } from './wa-helpers';

let ctx: TestContext;
let t: WaSetup;
const PHONE = '+905381234567';

beforeAll(async () => {
  ctx = await createTestContext();
  t = await setupWaTenant(ctx, { name: 'Simülatör Pide' });
});
afterAll(async () => {
  await ctx.close();
});

type ThreadRes = {
  conversation: { id: string; mode: string } | null;
  messages: Array<{ direction: string; kind: string; body: string; code: string | null; status: string; cta?: { label: string; url: string }; buttons?: { id: string }[]; sentBy: string }>;
};

describe('dev WhatsApp simülatörü', () => {
  it('GET /dev/wa/accounts', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/dev/wa/accounts' });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Array<{ id: string; tenantName: string; slug: string }> }).items;
    expect(items.find((i) => i.id === t.account.id)).toMatchObject({ tenantName: 'Simülatör Pide', slug: t.slug });
  });

  it('POST /dev/wa/inbound?sync=1 "merhaba" → karşılama + Menüyü aç (mock gönderildi); thread', async () => {
    const res = await ctx.request({
      method: 'POST',
      url: '/api/v1/dev/wa/inbound?sync=1',
      body: { waAccountId: t.account.id, from: { phone: '0538 123 45 67', name: 'Selin' }, message: { type: 'text', text: 'merhaba' } },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, summary: { messages: 1 } });
    const thread = await ctx.request({ method: 'GET', url: `/api/v1/dev/wa/thread?waAccountId=${t.account.id}&phone=${encodeURIComponent(PHONE)}` });
    const body = thread.json() as ThreadRes;
    expect(body.messages.map((m) => [m.direction, m.code ?? m.kind])).toEqual([
      ['in', 'text'],
      ['out', 'M01'],
    ]);
    const welcome = body.messages[1]!;
    expect(welcome.status).toBe('sent');
    expect(welcome.cta?.label).toBe('Menüyü aç');
    expect(welcome.cta?.url).toMatch(new RegExp(`/s/${t.slug}\\?l=`));
  });

  it('"yetkili" → insan modu; buton yanıtı; echo → business_phone', async () => {
    await ctx.request({ method: 'POST', url: '/api/v1/dev/wa/inbound?sync=1', body: { waAccountId: t.account.id, from: { phone: PHONE }, message: { type: 'text', text: 'yetkili' } } });
    const echoRes = await ctx.request({ method: 'POST', url: '/api/v1/dev/wa/echo?sync=1', body: { waAccountId: t.account.id, to: { phone: PHONE }, text: 'Buyurun, nasıl yardımcı olabilirim?' } });
    expect(echoRes.statusCode, echoRes.body).toBe(200);
    const body = (await ctx.request({ method: 'GET', url: `/api/v1/dev/wa/thread?waAccountId=${t.account.id}&phone=${encodeURIComponent(PHONE)}` })).json() as ThreadRes;
    expect(body.conversation!.mode).toBe('human');
    expect(body.messages.slice(-1)[0]).toMatchObject({ direction: 'out', kind: 'echo', sentBy: 'business_phone' });
    expect(body.messages.some((m) => m.code === 'M20')).toBe(true);
  });

  it('doğrulama: telefon ya da BSUID gerekli; bilinmeyen hesap 404', async () => {
    const bad = await ctx.request({ method: 'POST', url: '/api/v1/dev/wa/inbound', body: { waAccountId: t.account.id, from: { name: 'x' }, message: { type: 'text', text: 'x' } } });
    expect(bad.statusCode).toBe(400);
    const missing = await ctx.request({ method: 'POST', url: '/api/v1/dev/wa/inbound', body: { waAccountId: '00000000-0000-4000-8000-000000000000', from: { phone: PHONE }, message: { type: 'text', text: 'x' } } });
    expect(missing.statusCode).toBe(404);
  });

  it('GET /dev/sms ve /dev/platform-alerts', async () => {
    await ctx.db.insert(smsMessages).values({ tenantId: t.tenantId, toPhone: PHONE, body: 'Test SMS', purpose: 'otp', provider: 'mock', status: 'sent' });
    await ctx.db.insert(notifications).values({ tenantId: t.tenantId, kind: 'new_order_alarm', channel: 'platform_wa', status: 'sent', payload: { text: 'Yeni sipariş onay bekliyor', template: 'isletme_yeni_siparis_v1', params: ['a'] } });
    const sms = (await ctx.request({ method: 'GET', url: `/api/v1/dev/sms?to=${encodeURIComponent(PHONE)}` })).json() as { items: Array<{ body: string; tenantName: string }> };
    expect(sms.items[0]).toMatchObject({ body: 'Test SMS', tenantName: 'Simülatör Pide' });
    const alerts = (await ctx.request({ method: 'GET', url: '/api/v1/dev/platform-alerts' })).json() as { items: Array<{ text: string; template: string }> };
    expect(alerts.items[0]).toMatchObject({ text: 'Yeni sipariş onay bekliyor', template: 'isletme_yeni_siparis_v1' });
  });

  it('DEV_TOOLS kapalıyken /dev yok (404)', async () => {
    const app = await buildApp({ config: testConfig({ DEV_TOOLS: '0' }), db: ctx.handle, logger: false });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/dev/wa/accounts' });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
