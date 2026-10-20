// Twilio ortak numara uçtan uca (docs/16): Twilio'nun GERÇEK gelen mesaj yükü (form-encoded, SmsStatus=received dahil)
// imzalı olarak ortak webhook'a gelir → ham olay + iş → worker yönlendirici dükkanı seçer → Twilio Messages.json'a
// cevap gider. Canlıda "#DENEME yazdım, cevap gelmedi" hatasının yeniden üretimi: ayrıştırıcı SmsStatus=received
// alanını durum bildirimi sanıp mesajı atıyordu. Dizin yok (00 §12a madde 11, O2): kodsuz yazan yeni müşteriye Twilio'dan
// listesiz tek nötr metin gider; dükkan adı, listesi ya da sayısı gitmez.

import { waWebhookEvents } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setHttpFetch, signTwilioRequest } from '../src/wa/index';
import { createTestContext, testConfig, type TestContext } from './helpers';
import { flushOutbound, runJobs, setupSharedTenant } from './wa-helpers';

const HEX16 = '0123456789abcdef';
const ACCOUNT_SID = `AC${HEX16}${HEX16}`;
const AUTH_TOKEN = 'twilio-auth-token-e2e';
const TOKEN = 'twilio-shared-hook-token-0123456789';
const BASE = 'https://yemekgelsin.net';
const HOOK_PATH = `/api/v1/webhooks/wa/shared/${TOKEN}`;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({
    config: testConfig({
      APP_BASE_URL: BASE,
      PLATFORM_WA_PROVIDER: 'twilio',
      PLATFORM_WA_API_KEY: AUTH_TOKEN,
      PLATFORM_WA_PHONE_NUMBER_ID: ACCOUNT_SID,
      PLATFORM_WA_DISPLAY_PHONE: '+18509099295',
      PLATFORM_WA_WEBHOOK_TOKEN: TOKEN,
    }),
  });
  await setupSharedTenant(ctx, { name: 'Deneme Pide Salonu', code: 'DENEME' });
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => setHttpFetch(null));

/** Twilio'nun WhatsApp gelen mesaj webhook'unun alanları (canlıda görülen biçim). */
function inboundForm(sid: string, body: string, waId = '905321112233'): Record<string, string> {
  return {
    SmsMessageSid: sid,
    NumMedia: '0',
    ProfileName: 'Eray',
    MessageType: 'text',
    SmsSid: sid,
    WaId: waId,
    SmsStatus: 'received',
    Body: body,
    To: 'whatsapp:+18509099295',
    NumSegments: '1',
    ReferralNumMedia: '0',
    MessageSid: sid,
    AccountSid: ACCOUNT_SID,
    From: `whatsapp:+${waId}`,
    ApiVersion: '2010-04-01',
  };
}

function postSigned(params: Record<string, string>) {
  const signature = signTwilioRequest(`${BASE}${HOOK_PATH}`, params, AUTH_TOKEN);
  return ctx.app.inject({
    method: 'POST',
    url: HOOK_PATH,
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-twilio-signature': signature },
    payload: new URLSearchParams(params).toString(),
  });
}

interface Call {
  url: string;
  method: string;
  body: string;
}

function fakeTwilio(): Call[] {
  const calls: Call[] = [];
  let n = 0;
  setHttpFetch(async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('content.twilio.com') && (init?.method ?? 'GET') === 'GET') return json({ contents: [], meta: {} });
    if (url.includes('content.twilio.com')) return json({ sid: `HX${++n}` });
    return json({ sid: `SMout${++n}`, status: 'queued' });
  });
  return calls;
}

describe('Twilio ortak numara: gelen mesaj → cevap (uçtan uca)', () => {
  it('imzalı gerçek yük 200 alır; #DENEME yazan müşteriye dükkanın adıyla cevap Twilio üzerinden gider', async () => {
    const calls = fakeTwilio();
    const res = await postSigned(inboundForm('SMin0001', 'Merhaba, Deneme Pide Salonu için sipariş vermek istiyorum. #DENEME'));
    expect(res.statusCode, res.body).toBe(200);

    await runJobs(ctx, ['wa.process_inbound']);
    const [ev] = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.provider, 'shared'));
    expect(ev?.processedAt).not.toBeNull();
    expect(ev?.error ?? null).toBeNull();

    await flushOutbound(ctx);
    const sends = calls.filter((c) => c.url.endsWith(`/Accounts/${ACCOUNT_SID}/Messages.json`));
    expect(sends.length, JSON.stringify(calls.map((c) => c.url))).toBeGreaterThan(0);
    const forms = sends.map((c) => Object.fromEntries(new URLSearchParams(c.body)));
    for (const f of forms) {
      expect(f.From).toBe('whatsapp:+18509099295');
      expect(f.To).toBe('whatsapp:+905321112233');
    }
    // Ortak numarada mesajlar dükkanın adını taşır (00 §12a madde 8)
    expect(forms.some((f) => (f.Body ?? f.ContentVariables ?? '').includes('Deneme Pide Salonu'))).toBe(true);
  });

  it('kodsuz "Selam" yazan yeni müşteriye Twilio üzerinden listesiz nötr metin gider (dükkan adı yok)', async () => {
    const calls = fakeTwilio();
    const res = await postSigned(inboundForm('SMin0003', 'Selam', '905329998877'));
    expect(res.statusCode, res.body).toBe(200);
    await runJobs(ctx, ['wa.process_inbound']);
    await runJobs(ctx, ['wa.send_shared']);
    const sends = calls.filter((c) => c.url.endsWith(`/Accounts/${ACCOUNT_SID}/Messages.json`));
    expect(sends).toHaveLength(1);
    const form = Object.fromEntries(new URLSearchParams(sends[0]!.body));
    expect(form.To).toBe('whatsapp:+905329998877');
    expect(form.Body).toBe('Sipariş vermek için işletmenin QR kodunu okutun ya da işletmenin paylaştığı bağlantıyı açın.');
    expect(form.ContentSid ?? null).toBeNull();
    expect(JSON.stringify(form)).not.toContain('Deneme Pide Salonu');
  });

  it('yanlış imza 401: olay kaydedilmez', async () => {
    const before = (await ctx.db.select().from(waWebhookEvents)).length;
    const res = await ctx.app.inject({
      method: 'POST',
      url: HOOK_PATH,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'yanlis' },
      payload: new URLSearchParams(inboundForm('SMin0002', 'Selam')).toString(),
    });
    expect(res.statusCode).toBe(401);
    expect((await ctx.db.select().from(waWebhookEvents)).length).toBe(before);
  });
});
