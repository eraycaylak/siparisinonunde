// Saklama (cron.retention, 08 §2.8): sipariş notu final durumdan 30 gün sonra boşaltılır (satır 1); WhatsApp mesaj
// içeriği 6 ay sonra silinir, wamid/yön/zaman/durum kalır (satır 4). Aydınlatma metni (storefront /yasal/aydinlatma)
// bu süreleri müşteriye taahhüt eder.

import { conversations, messages, orderItems, orders } from '@siparis/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob, processDueJobs } from '../src/lib/jobs';
import { RETENTION_REDACTED_BODY } from '../src/jobs/system/index';
import { createTestContext, type TestContext } from './helpers';
import { createHookedOrder, createLinkToken, setupStore, type StoreFixture } from './orders-helpers';

const DAY = 86_400_000;

let ctx: TestContext;
let s: StoreFixture;

async function runRetention(): Promise<void> {
  await enqueueJob(ctx.db, { queue: 'cron', type: 'cron.retention' });
  await processDueJobs({ db: ctx.db, config: ctx.config, log: ctx.app.log, now: new Date(Date.now() + 1_000), where: sql`type = 'cron.retention'` });
}

/** Siparişe not yazar ve durumunu/zamanlarını ayarlar. */
async function orderWithNote(patch: Partial<typeof orders.$inferInsert>): Promise<string> {
  const o = await createHookedOrder(ctx, s);
  await ctx.db.update(orders).set({ note: 'Fıstık alerjim var, zile basmayın', ...patch }).where(eq(orders.id, o.id));
  await ctx.db.update(orderItems).set({ note: 'soğansız' }).where(eq(orderItems.orderId, o.id));
  return o.id;
}

const noteOf = async (id: string) => (await ctx.db.select({ note: orders.note }).from(orders).where(eq(orders.id, id)))[0]!.note;
const itemNotesOf = async (id: string) => (await ctx.db.select({ note: orderItems.note }).from(orderItems).where(eq(orderItems.orderId, id))).map((r) => r.note);

beforeAll(async () => {
  ctx = await createTestContext();
  s = await setupStore(ctx, { wa: 'connected' });
});
afterAll(async () => {
  await ctx.close();
});

describe('saklama: sipariş notu 30 gün (08 §2.8 satır 1)', () => {
  it('final durumdan 30 gün geçen siparişin ve kalemlerinin notu boşaltılır; yeni ve açık siparişe dokunulmaz', async () => {
    const old = new Date(Date.now() - 31 * DAY);
    const recent = new Date(Date.now() - 10 * DAY);
    const delivered = await orderWithNote({ status: 'delivered', deliveredAt: old });
    const rejected = await orderWithNote({ status: 'rejected', rejectedAt: old, rejectionReason: 'too_busy' });
    const cancelled = await orderWithNote({ status: 'cancelled', cancelledAt: old, cancelledBy: 'customer', cancelReason: 'customer_request' });
    const fresh = await orderWithNote({ status: 'delivered', deliveredAt: recent });
    // Açık sipariş (eski de olsa) not taşır: mutfak fişinde ve kartta gerekir
    const open = await orderWithNote({ status: 'accepted', createdAt: old });

    await runRetention();

    for (const id of [delivered, rejected, cancelled]) {
      expect(await noteOf(id)).toBeNull();
      expect(await itemNotesOf(id)).toEqual([null]);
    }
    for (const id of [fresh, open]) {
      expect(await noteOf(id)).toBe('Fıstık alerjim var, zile basmayın');
      expect(await itemNotesOf(id)).toEqual(['soğansız']);
    }
    // Sipariş kaydının kendisi kalır (tutar, kalemler)
    const [row] = await ctx.db.select({ total: orders.totalKurus, status: orders.status }).from(orders).where(eq(orders.id, delivered));
    expect(row).toMatchObject({ status: 'delivered' });
    expect(row!.total).toBeGreaterThan(0);
  });
});

describe('saklama: WhatsApp mesaj içeriği 6 ay (08 §2.8 satır 4)', () => {
  it('6 aydan eski mesajın metni ve metin taşıyan yük alanları silinir; wamid, yön, durum kalır; yeni mesaja dokunulmaz', async () => {
    const { conversationId } = await createLinkToken(ctx, s);
    const old = new Date(Date.now() - 200 * DAY);
    const recent = new Date(Date.now() - 30 * DAY);
    const oldInWamid = `wamid.${randomUUID()}`;
    const [oldIn, oldOut, oldReply, fresh] = await ctx.db
      .insert(messages)
      .values([
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'in',
          wamid: oldInWamid,
          kind: 'text',
          body: 'Yeni Mah. 5. Sok. No 3, zil bozuk',
          payload: { type: 'text', profileName: 'Ayşe Yılmaz', raw: { text: { body: 'Yeni Mah. 5. Sok. No 3' } } },
          createdAt: old,
        },
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'out',
          wamid: `wamid.${randomUUID()}`,
          kind: 'text',
          body: 'Siparişiniz alındı! Sipariş no: #1051',
          payload: {
            code: 'M05',
            spec: { type: 'text', text: 'Siparişiniz alındı! Sipariş no: #1051' },
            templateFallback: null,
            smsFallback: { to: '+905321234567', body: 'Siparişiniz alındı' },
            statusMessage: true,
            orderEvent: null,
          },
          status: 'read',
          sentBy: 'bot',
          createdAt: old,
        },
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'in',
          wamid: `wamid.${randomUUID()}`,
          kind: 'button_reply',
          body: 'Menüyü aç',
          payload: { type: 'button_reply', id: 'menu', title: 'Menüyü aç' },
          createdAt: old,
        },
        {
          tenantId: s.tenantId,
          conversationId,
          direction: 'in',
          wamid: `wamid.${randomUUID()}`,
          kind: 'text',
          body: 'merhaba',
          payload: { type: 'text', profileName: 'Ayşe Yılmaz' },
          createdAt: recent,
        },
      ])
      .returning();
    await ctx.db.update(conversations).set({ lastMessageAt: old, lastMessagePreview: 'Yeni Mah. 5. Sok.' }).where(eq(conversations.id, conversationId));

    await runRetention();

    const rows = await ctx.db.select().from(messages).where(inArray(messages.id, [oldIn!.id, oldOut!.id, oldReply!.id, fresh!.id]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const a = byId.get(oldIn!.id)!;
    expect(a).toMatchObject({ body: RETENTION_REDACTED_BODY, wamid: oldInWamid, direction: 'in', kind: 'text' });
    expect(a.payload).toEqual({ type: 'text' });
    const b = byId.get(oldOut!.id)!;
    expect(b).toMatchObject({ body: RETENTION_REDACTED_BODY, direction: 'out', status: 'read' });
    expect(b.payload).toEqual({ code: 'M05', statusMessage: true, orderEvent: null });
    const c = byId.get(oldReply!.id)!;
    expect(c.body).toBe(RETENTION_REDACTED_BODY);
    expect(c.payload).toEqual({ type: 'button_reply', id: 'menu' });
    for (const r of [a, b, c]) expect(JSON.stringify(r)).not.toMatch(/Yeni Mah|Ayşe|5321234567|alındı/);
    expect(byId.get(fresh!.id)).toMatchObject({ body: 'merhaba', payload: { type: 'text', profileName: 'Ayşe Yılmaz' } });

    const [conv] = await ctx.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conv!.lastMessagePreview).toBeNull();

    // İdempotent: ikinci koşu değiştirecek satır bulmaz
    const before = (await ctx.db.select({ id: messages.id, updatedAt: messages.updatedAt }).from(messages).where(eq(messages.id, oldIn!.id)))[0]!;
    await runRetention();
    const after = (await ctx.db.select({ id: messages.id, updatedAt: messages.updatedAt }).from(messages).where(eq(messages.id, oldIn!.id)))[0]!;
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
