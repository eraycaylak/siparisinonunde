// Webhook: GET doğrulama, POST imza (WA_APP_SECRET), ham olay + iş, idempotency (wamid), durum monotonluğu.

import { jobs, messages, waAccounts, waWebhookEvents } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInboundPayload, buildStatusPayload } from '../src/services/messaging/dev-payload';
import { signMetaPayload } from '../src/wa/signature';
import { createTestContext, expectError, testConfig, type TestContext } from './helpers';
import { conversationFor, flushOutbound, runJobs, setupWaTenant, type WaSetup } from './wa-helpers';

const SECRET = 'test-app-secret';
let ctx: TestContext;
let t: WaSetup;

beforeAll(async () => {
  ctx = await createTestContext({ config: testConfig({ WA_APP_SECRET: SECRET, WA_VERIFY_TOKEN: 'verify-me' }) });
  t = await setupWaTenant(ctx);
});
afterAll(async () => {
  await ctx.close();
});

function post(token: string, body: unknown, opts: { sign?: boolean; signature?: string } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.signature) headers['x-hub-signature-256'] = opts.signature;
  else if (opts.sign !== false) headers['x-hub-signature-256'] = signMetaPayload(raw, SECRET);
  return ctx.app.inject({ method: 'POST', url: `/api/v1/webhooks/wa/${token}`, headers, payload: raw });
}

describe('GET doğrulama (hub.challenge)', () => {
  it('doğru belirteçle challenge düz metin döner', async () => {
    const res = await ctx.request({
      method: 'GET',
      url: `/api/v1/webhooks/wa/${t.account.webhookToken}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toBe('12345');
  });

  it('yanlış belirteç 403, bilinmeyen webhook 404', async () => {
    const bad = await ctx.request({ method: 'GET', url: `/api/v1/webhooks/wa/${t.account.webhookToken}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1` });
    expectError(bad, 403, 'invalid_verify_token');
    const unknown = await ctx.request({ method: 'GET', url: `/api/v1/webhooks/wa/yok-boyle-bir-token?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1` });
    expectError(unknown, 404, 'not_found');
  });
});

describe('POST webhook', () => {
  it('imzasız ya da hatalı imza 401; bilinmeyen belirteç 404; bozuk JSON 400', async () => {
    const { payload } = buildInboundPayload(t.account, { phone: '+905321110001' }, { type: 'text', text: 'x' });
    expectError(await post(t.account.webhookToken, payload, { sign: false }), 401, 'invalid_signature');
    expectError(await post(t.account.webhookToken, payload, { signature: 'sha256=' + '0'.repeat(64) }), 401, 'invalid_signature');
    expectError(await post('bilinmeyen-token-123', payload), 404, 'not_found');
    expectError(await post(t.account.webhookToken, '{bozuk'), 400, 'invalid_json');
    const events = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.waAccountId, t.account.id));
    expect(events).toHaveLength(0);
  });

  it('geçerli imza → 200, ham olay + wa.process_inbound işi, last_webhook_at', async () => {
    const { payload, wamid } = buildInboundPayload(t.account, { phone: '+905321110002', name: 'Ayşe' }, { type: 'text', text: 'merhaba' });
    const res = await post(t.account.webhookToken, payload);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const events = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.waAccountId, t.account.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.processedAt).toBeNull();
    const [job] = await ctx.db.select().from(jobs).where(eq(jobs.type, 'wa.process_inbound'));
    expect(job).toMatchObject({ queue: 'wa-inbound', status: 'pending', payload: { webhookEventId: events[0]!.id } });
    const [acc] = await ctx.db.select().from(waAccounts).where(eq(waAccounts.id, t.account.id));
    expect(acc!.lastWebhookAt).toBeInstanceOf(Date);

    // Worker işler → mesaj kaydı + karşılama
    expect(await runJobs(ctx, ['wa.process_inbound'])).toBe(1);
    const [msg] = await ctx.db.select().from(messages).where(eq(messages.wamid, wamid));
    expect(msg).toMatchObject({ direction: 'in', kind: 'text', body: 'merhaba', sentBy: 'customer' });
    const [processed] = await ctx.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.id, events[0]!.id));
    expect(processed!.processedAt).toBeInstanceOf(Date);
  });

  it('aynı olay 5 kez teslim → tek mesaj, tek yanıt (wamid tekil)', async () => {
    const { payload, wamid } = buildInboundPayload(t.account, { phone: '+905321110003' }, { type: 'text', text: 'selam' });
    for (let i = 0; i < 5; i++) expect((await post(t.account.webhookToken, payload)).statusCode).toBe(200);
    await runJobs(ctx, ['wa.process_inbound']);
    const rows = await ctx.db.select().from(messages).where(eq(messages.wamid, wamid));
    expect(rows).toHaveLength(1);
    const conv = await conversationFor(ctx.db, t.account, '+905321110003');
    const all = await ctx.db.select().from(messages).where(eq(messages.conversationId, conv!.id));
    expect(all.filter((m) => m.direction === 'in')).toHaveLength(1);
    expect(all.filter((m) => m.direction === 'out')).toHaveLength(1); // tek karşılama
  });

  it('durum olayları monoton ilerler (read → delivered geri gitmez; teslimden sonra failed yazılmaz)', async () => {
    const conv = await conversationFor(ctx.db, t.account, '+905321110003');
    await flushOutbound(ctx);
    const sent = (await ctx.db.select().from(messages).where(eq(messages.conversationId, conv!.id))).find((m) => m.direction === 'out')!;
    expect(sent.status).toBe('sent');
    expect(sent.wamid).toMatch(/^mock\./);

    const send = async (status: 'delivered' | 'read' | 'failed') => {
      const res = await post(t.account.webhookToken, buildStatusPayload(t.account, { wamid: sent.wamid!, status, recipientPhone: '+905321110003' }));
      expect(res.statusCode).toBe(200);
      await runJobs(ctx, ['wa.process_inbound']);
      const [m] = await ctx.db.select().from(messages).where(eq(messages.id, sent.id));
      return m!.status;
    };
    expect(await send('read')).toBe('read');
    expect(await send('delivered')).toBe('read');
    expect(await send('failed')).toBe('read');
  });
});
