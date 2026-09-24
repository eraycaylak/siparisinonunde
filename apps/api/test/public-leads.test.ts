// POST /api/v1/public/leads (14 §6.5; 05 C.5.1): demo formu + hesaplayıcı lead'i, bal küpü, hız sınırı,
// telefon normalizasyonu, tekrar kontrolü; lead admin listesinde görünür.

import { leads } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlatformUsers, type PlatformUsers } from './admin-helpers';
import { createTestContext, expectError, type TestContext } from './helpers';

let ctx: TestContext;
let p: PlatformUsers;
let ipSeq = 1;
const freshIp = () => `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

const URL = '/api/v1/public/leads';

/** apps/web/components/marketing/demo-form.tsx'in gönderdiği yük. */
const demoForm = (over: Record<string, unknown> = {}) => ({
  name: 'Ayşe Demir',
  businessName: 'Demir Pide',
  phone: '0 (532) 765 43 21',
  city: 'Yozgat',
  source: 'demo_form',
  notes: 'İlçe: Merkez · İşletme türü: Pide / lahmacun · Günlük paket: 20–40 · Arama zamanı: Fark etmez · WhatsApp\'tan yazılabilir: evet',
  ...over,
});

const send = (body: unknown, ip = freshIp()) => ctx.request({ method: 'POST', url: URL, body, headers: { 'x-forwarded-for': ip } });

beforeAll(async () => {
  ctx = await createTestContext();
  p = await createPlatformUsers(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('POST /public/leads', () => {
  it('demo formu: 201, telefon E.164, durum new, kaynak demo_form', async () => {
    const res = await send(demoForm());
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ ok: true });
    const [row] = await ctx.db.select().from(leads).where(eq(leads.phone, '+905327654321'));
    expect(row).toMatchObject({ name: 'Ayşe Demir', businessName: 'Demir Pide', city: 'Yozgat', source: 'demo_form', status: 'new' });
    expect(row!.notes).toContain('Günlük paket: 20–40');
  });

  it('hesaplayıcı: calculatorInput saklanır', async () => {
    const calc = { dailyOrders: 30, avgBasketTl: 350, commissionRate: 0.25, courierModel: 'own', vatDeductible: true };
    const res = await send(demoForm({ phone: '05321110000', source: 'calculator', calculatorInput: calc }));
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await ctx.db.select().from(leads).where(eq(leads.phone, '+905321110000'));
    expect(row!.source).toBe('calculator');
    expect(row!.calculatorInput).toEqual(calc);
  });

  it('bal küpü doluysa 204 ve kayıt yok (geçersiz alanlarla bile)', async () => {
    const before = (await ctx.db.select().from(leads)).length;
    const res = await send({ ...demoForm({ phone: '05329990000' }), website: 'http://spam.example' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const bot = await send({ website: 'x', name: '' });
    expect(bot.statusCode).toBe(204);
    expect((await ctx.db.select().from(leads)).length).toBe(before);
  });

  it('doğrulama: geçersiz telefon, eksik alan, bilinmeyen kaynak → 400 (Türkçe, alan yolu)', async () => {
    const bad = await send(demoForm({ phone: '0212 555 44 33' }));
    expectError(bad, 400, 'validation_error');
    expect(bad.json().error.details.issues[0].path).toBe('/phone');
    expect(bad.json().error.message).toMatch(/cep telefonu/);
    const missing = await send({ ...demoForm(), name: '' });
    expectError(missing, 400, 'validation_error');
    expect(missing.json().error.details.issues[0]).toMatchObject({ path: '/name', message: 'Adını ve soyadını yaz.' });
    expectError(await send(demoForm({ source: 'reseller' })), 400, 'validation_error');
    expectError(await send(demoForm({ calculatorInput: { big: 'x'.repeat(5000) } })), 400, 'validation_error');
  });

  it('aynı telefonla açık lead varsa yenisi açılmaz, nota eklenir', async () => {
    const res = await send(demoForm({ businessName: 'Demir Pide 2. Şube', notes: 'İkinci talep' }));
    expect(res.statusCode, res.body).toBe(201);
    const rows = await ctx.db.select().from(leads).where(eq(leads.phone, '+905327654321'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.notes).toContain('tekrar talep');
    expect(rows[0]!.notes).toContain('Demir Pide 2. Şube');
  });

  it('hız sınırı: IP başına saatte 5 → 6. istek 429', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const r = await send(demoForm({ phone: `0535000000${i}` }), ip);
      expect(r.statusCode, r.body).toBe(201);
    }
    const sixth = await send(demoForm({ phone: '05350000009' }), ip);
    expectError(sixth, 429, 'rate_limited');
    expect(sixth.headers['retry-after']).toBeTruthy();
    // Başka IP etkilenmez
    expect((await send(demoForm({ phone: '05350000010' }))).statusCode).toBe(201);
  });

  it('lead admin listesinde new olarak görünür', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/admin/leads?q=Demir', cookie: p.sales_rep.cookie });
    expect(res.statusCode, res.body).toBe(200);
    const item = res.json().items.find((l: { phone: string }) => l.phone === '+905327654321');
    expect(item).toMatchObject({ status: 'new', source: 'demo_form', businessName: 'Demir Pide' });
  });
});
