// Telefon siparişinde müşteri arama (04 §4.13, uç `GET /panel/orders/manual/customers`): ilk karakterden
// itibaren sonuç, telefon VE ad (Türkçe harf katlamalı), "0" tek başına → en son sipariş verenler,
// yük bölme (`detail=0` liste / `detail=1` ve `/:id` ayrıntı), tenant yalıtımı, KVKK silme süzgeci ve
// İNDEKS ÇİTİ (ifade/opclass sapması `schema-drift.test.ts` tarafından GÖRÜLEMEZ; buradaki EXPLAIN görür).

import { FOLD_FROM, FOLD_TO } from '@siparis/core';
import { customerErasures, customers } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, expectError, expectIsolated, type TestContext } from './helpers';
import { createCustomer } from './settings-helpers';
import { setupStore, stubExternalJobs, type StoreFixture } from './orders-helpers';

let ctx: TestContext;
let s: StoreFixture;
let other: StoreFixture;
let cashier: string;
let kitchen: string;
/** Telefon siparişiyle oluşan müşteri: adres + son sipariş + seçenek kimliği taşır. */
let phoneCustomerId: string;
let cigdemId: string;
let ahmetId: string;
let ahmetCanId: string;
let erasedId: string;
let freshId: string;
let canId: string;
let foreignId: string;

const get = (url: string, cookie: string) => ctx.request({ method: 'GET', url: `/api/v1/panel${url}`, cookie });
const lookup = async (query: string, cookie = cashier) => {
  const res = await get(`/orders/manual/customers?${query}`, cookie);
  expect(res.statusCode, res.body).toBe(200);
  const body: { items: { id: string; name: string | null }[]; mode: string } = res.json();
  return body;
};
const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

beforeAll(async () => {
  ctx = await createTestContext();
  stubExternalJobs();
  s = await setupStore(ctx, { wa: 'connected' });
  other = await setupStore(ctx, { wa: 'connected' });
  cashier = (await ctx.createStaff(s.tenantId, 'cashier')).cookie;
  kitchen = (await ctx.createStaff(s.tenantId, 'kitchen')).cookie;

  // Gerçek telefon siparişi: ayrıntı yolunun (adres + son sipariş + optionIds) tek güvenilir kurulumu.
  const created = await ctx.request({
    method: 'POST',
    url: '/api/v1/panel/orders/manual',
    cookie: cashier,
    body: {
      items: [{ productId: s.pideId, quantity: 1, optionIds: [s.acisizId] }],
      fulfillmentType: 'delivery',
      neighborhood: 'Tekke',
      customerName: 'Telefon Müşteri',
      customerPhone: '0533 222 33 44',
      addressLine: 'Kale Sk. 4',
      paymentMethod: 'card_on_delivery',
    },
  });
  expect(created.statusCode, created.body).toBe(200);
  const [pc] = await ctx.db.select().from(customers).where(eq(customers.phoneE164, '+905332223344'));
  phoneCustomerId = pc!.id;

  cigdemId = (await createCustomer(ctx.db, s.tenantId, { name: 'ÇİĞDEM Şule ÖZÜ', phone: '+905431112233', withAddress: true })).id;
  ahmetId = (await createCustomer(ctx.db, s.tenantId, { name: 'AHMET Yıldız', phone: '+905441112233' })).id;
  ahmetCanId = (await createCustomer(ctx.db, s.tenantId, { name: 'ahmet can', phone: '+905451112233', notes: 'Kapıda zil çalmaz' })).id;
  await createCustomer(ctx.db, s.tenantId, { name: 'Şükrü Çağla', phone: '+905461112233' });
  freshId = (await createCustomer(ctx.db, s.tenantId, { name: 'Taze Kayıt', phone: '+905471112233' })).id;
  erasedId = (await createCustomer(ctx.db, s.tenantId, { name: 'Silinmiş Ahmet', phone: '+905481112233' })).id;
  await ctx.db.insert(customerErasures).values({ customerId: erasedId, tenantId: s.tenantId });
  canId = (await createCustomer(ctx.db, s.tenantId, { name: 'Can Demir', phone: '+905521112244' })).id;
  foreignId = (await createCustomer(ctx.db, other.tenantId, { name: 'Ahmet Başka', phone: '+905491112233' })).id;

  // Yığın satırlar: planlayıcının indeks seçimi birkaç satırda belirsizdir (maliyetler neredeyse eşit).
  // Adları "bulk …" ile başlar ve numaraları "1112233"/"2223344" içermez ki yukarıdaki beklentileri bozmasın;
  // `last_order_at` null olduğu için sıralamada her zaman en sona düşerler.
  await ctx.db.insert(customers).values(
    Array.from({ length: 300 }, (_, i) => ({
      tenantId: s.tenantId,
      name: `Bulk Kayit ${i}`,
      phoneE164: `+905500${String(i).padStart(6, '0')}`,
    })),
  );
  await ctx.sql.unsafe('analyze customers').simple();

  // `latest` dalı yalnız `last_order_at` dolu olanları döner; sıra en yeniden eskiye.
  const now = Date.now();
  // Gerçek siparişle oluşan müşterinin `last_order_at`'i akış tarafından ŞİMDİ'ye kuruldu; beklentileri
  // bozmaması için sıranın sonuna alınır (bu dal yalnız sıralamayı sınıyor, o müşteriyi varlıkla sınıyor).
  await ctx.db.update(customers).set({ lastOrderAt: new Date(now - 240_000) }).where(eq(customers.id, phoneCustomerId));
  await ctx.db.update(customers).set({ lastOrderAt: new Date(now - 60_000), orderCount: 3 }).where(eq(customers.id, cigdemId));
  await ctx.db.update(customers).set({ lastOrderAt: new Date(now - 120_000), orderCount: 1 }).where(eq(customers.id, ahmetId));
  await ctx.db.update(customers).set({ lastOrderAt: new Date(now - 180_000), orderCount: 1 }).where(eq(customers.id, ahmetCanId));
  await ctx.db.update(customers).set({ lastOrderAt: new Date(now - 10_000) }).where(eq(customers.id, erasedId));
  await ctx.db.update(customers).set({ lastOrderAt: new Date(now - 5_000) }).where(eq(customers.id, foreignId));
});

afterAll(async () => {
  await ctx.close();
});

describe('ilk karakterden itibaren arama', () => {
  it('"0" tek başına: süzgeç uygulanmaz, en son sipariş verenler döner (siparişsiz kayıt yok)', async () => {
    const body = await lookup('q=0&detail=0');
    expect(body.mode).toBe('latest');
    expect(ids(body)[0]).toBe(cigdemId); // en yeni `last_order_at`
    expect(ids(body)).toContain(phoneCustomerId);
    expect(ids(body)).not.toContain(freshId); // `last_order_at` null
    expect(ids(body)).not.toContain(erasedId);
    expect(ids(body)).not.toContain(foreignId);
  });

  it('"+90" ve "90" da süzgeçsiz dala düşer; boş sorgu da', async () => {
    for (const q of ['q=%2B90', 'q=90', 'q=', '']) {
      expect((await lookup(`${q}&detail=0`)).mode).toBe('latest');
    }
  });

  it('tek rakam "5": önek dalı, tüm 05xx numaraları', async () => {
    const body = await lookup('q=5&detail=0');
    expect(body.mode).toBe('phone');
    expect(ids(body)).toContain(cigdemId);
    expect(ids(body)).not.toContain(erasedId);
  });

  it('tek harf "a": ad dalı, ilk tuşta sonuç', async () => {
    const body = await lookup('q=a&detail=0');
    expect(body.mode).toBe('name');
    expect(ids(body)).toEqual(expect.arrayContaining([ahmetId, ahmetCanId]));
    expect(ids(body)).not.toContain(erasedId);
  });

  it('"a" → "ah" → "ahm": her adımda sonuç var ve daralıyor', async () => {
    for (const q of ['a', 'ah', 'ahm', 'ahmet']) {
      const body = await lookup(`q=${q}&detail=0`);
      expect(ids(body), q).toEqual(expect.arrayContaining([ahmetId, ahmetCanId]));
    }
  });
});

describe('Türkçe harf katlama (canlı collation C.UTF-8)', () => {
  it('"cig" → "ÇİĞDEM"; "AHMET" küçük harfle, "ahmet" büyük harfle bulunur', async () => {
    expect(ids(await lookup('q=cig&detail=0'))).toContain(cigdemId);
    expect(ids(await lookup(`q=${encodeURIComponent('çiğ')}&detail=0`))).toContain(cigdemId);
    expect(ids(await lookup('q=AHMET&detail=0'))).toEqual(expect.arrayContaining([ahmetId, ahmetCanId]));
  });

  it('"Şükrü" ve "Çağla" aksanlı ve aksansız yazımla bulunur', async () => {
    for (const q of ['Şükrü', 'sukru', 'SUKRU', 'Çağla', 'cagla']) {
      const body = await lookup(`q=${encodeURIComponent(q)}&detail=0`);
      expect(body.items.map((i) => i.name), q).toContain('Şükrü Çağla');
    }
  });

  it('içerik yedeği: ada göre "ozu" (ad ortasında) ve telefonun son 7 hanesi', async () => {
    expect(ids(await lookup('q=ozu&detail=0'))).toContain(cigdemId);
    const byTail = await lookup('q=2223344&detail=0');
    expect(byTail.mode).toBe('phone');
    expect(ids(byTail)).toContain(phoneCustomerId);
  });

  it('önek eşleşmesi içerik eşleşmesinden ÖNCE sıralanır', async () => {
    // "can": "Can Demir" ÖNEK (rnk 0, `last_order_at` null), "ahmet can" İÇERİK (rnk 1, `last_order_at` dolu).
    // Önek, daha yeni siparişli içerik eşleşmesini bile geçer — sıralama `rnk` ile başlar.
    const body = await lookup('q=can&detail=0');
    expect(ids(body)[0]).toBe(canId);
    expect(ids(body)).toContain(ahmetCanId);
  });
});

describe('yük bölme: liste / ayrıntı', () => {
  it('detail=0: ham telefon ve not gövdede YOK, maskeli telefon + adres sayısı var', async () => {
    const res = await get('/orders/manual/customers?q=ahmet&detail=0', cashier);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('5441112233');
    expect(res.body).not.toContain('Kapıda zil çalmaz');
    const item = res.json().items.find((i: { id: string }) => i.id === ahmetCanId);
    expect(item).toMatchObject({ phoneMasked: '0*** *** 22 33', hasNotes: true, addressCount: 0 });
    expect(item.phoneE164).toBeUndefined();
    expect(item.notes).toBeUndefined();
    expect(item.addresses).toBeUndefined();
    expect(item.lastOrders).toBeUndefined();
  });

  // ÇİT: `lookupCustomers` adres sayısını `top` ara sorgusundan SONRA, yalnız `limit` satır için hesaplar
  // (lateral sayım aday penceresinin tamamı için koşmasın diye). Kesme noktasının sayımı bozmadığını sınar:
  // aday sayısı limitten BÜYÜK olduğu hâlde dönen satırın `addressCount`'u doğru olmalı.
  it('liste gövdesinde adres sayısı doğru — aday sayısı limitten büyükken de (sayım limitten sonra koşar)', async () => {
    const dar = await lookup('q=0&detail=0&limit=1'); // 300+ aday, tek satır döner
    expect(dar.items).toHaveLength(1);
    expect(dar.items[0]).toMatchObject({ id: cigdemId, addressCount: 1 });
    const genis = await lookup('q=0&detail=0&limit=20');
    expect(genis.items.find((i) => i.id === cigdemId)).toMatchObject({ addressCount: 1 });
    // Sıra kesmeden etkilenmez: iki istekte de en yeni `last_order_at` başta.
    expect(ids(genis)[0]).toBe(cigdemId);
  });

  it('detail varsayılanı "1": eski gövde (ham telefon, adresler, son siparişler, optionIds) aynen döner', async () => {
    const body = await lookup('phone=2223344');
    const item = body.items.find((i) => i.id === phoneCustomerId) as unknown as {
      phoneE164: string;
      addresses: { neighborhood: string; addressLine: string }[];
      lastOrders: { items: { optionIds: string[] }[] }[];
    };
    expect(item.phoneE164).toBe('+905332223344');
    expect(item.addresses[0]).toMatchObject({ neighborhood: 'Tekke', addressLine: 'Kale Sk. 4' });
    expect(item.lastOrders[0]!.items[0]!.optionIds).toEqual([s.acisizId]);
  });

  it('/:id ayrıntı yolu aynı ağır gövdeyi verir; adres sayısı listeyle tutarlı', async () => {
    const res = await get(`/orders/manual/customers/${phoneCustomerId}`, cashier);
    expect(res.statusCode, res.body).toBe(200);
    const item = res.json().item;
    expect(item).toMatchObject({ id: phoneCustomerId, name: 'Telefon Müşteri', phoneE164: '+905332223344', addressCount: 1 });
    expect(item.addresses).toHaveLength(1);
    expect(item.lastOrders[0].items[0].optionIds).toEqual([s.acisizId]);
  });
});

describe('yetki, tenant yalıtımı ve KVKK', () => {
  it('mutfak 403, oturumsuz 401', async () => {
    expectError(await get('/orders/manual/customers?q=a', kitchen), 403, 'forbidden');
    expectError(await ctx.request({ method: 'GET', url: '/api/v1/panel/orders/manual/customers?q=a' }), 401, 'unauthorized');
  });

  it('başka tenant\'ın müşterisi aramada DÖNMEZ (ad, telefon ve süzgeçsiz dalda)', async () => {
    for (const q of ['q=Ahmet', 'q=5', 'q=0', 'q=1112233'] as const) {
      expect(ids(await lookup(`${q}&detail=0`)), q).not.toContain(foreignId);
    }
    // Karşı yön: diğer tenant kendi müşterisini görür, bizimkini görmez.
    const otherCashier = (await ctx.createStaff(other.tenantId, 'cashier')).cookie;
    const mine = await lookup('q=Ahmet&detail=0', otherCashier);
    expect(ids(mine)).toEqual([foreignId]);
  });

  it('/:id başka tenant\'ın kimliğinde 404; KVKK ile silinmiş müşteride de 404', async () => {
    expectIsolated(await get(`/orders/manual/customers/${foreignId}`, cashier));
    expectIsolated(await get(`/orders/manual/customers/${erasedId}`, cashier));
  });

  it('silinmiş müşteri hiçbir dalda listelenmez', async () => {
    for (const q of ['q=0', 'q=5', 'q=Silinmiş', 'q=1112233'] as const) {
      expect(ids(await lookup(`${q}&detail=0`)), q).not.toContain(erasedId);
    }
  });

  it('limit tavanı: 20 üstü reddedilir, 0 reddedilir', async () => {
    expect((await get('/orders/manual/customers?q=a&limit=21', cashier)).statusCode).toBe(400);
    expect((await get('/orders/manual/customers?q=a&limit=0', cashier)).statusCode).toBe(400);
  });
});

describe('indeks çiti (ifade ve opclass sapmasını sapma testi GÖRMEZ)', () => {
  // `schema-drift.test.ts` indeks anahtarlarını `pg_get_indexdef(oid, k, true)` ile okur ve o çağrı opclass'ı
  // YAZMAZ — yani `text_pattern_ops` düşse sapma testi sessizce yeşil kalır, arama ise `C` dışı collation'da
  // (canlı `C.UTF-8`, compose `en_US.utf8`) indekssiz kalır. İfade metni de sorgu tarafından ayrışabilir.
  // Bu yüzden iki ayrı kapı: (1) TAM indeks tanımı katalogdan okunur, (2) plan gerçekten indeksi kullanıyor mu.

  const indexDef = async (name: string): Promise<string> => {
    const rows = (await ctx.sql`
      select pg_get_indexdef(ix.indexrelid) as def
        from pg_index ix join pg_class i on i.oid = ix.indexrelid
       where i.relname = ${name}`) as unknown as { def: string }[];
    expect(rows[0]?.def, `${name} indeksi veritabanında yok (migration 0006 uygulanmadı mı?)`).toBeTruthy();
    return rows[0]!.def;
  };

  it('telefon öneki indeksi text_pattern_ops taşır', async () => {
    expect(await indexDef('customers_tenant_phone_prefix_idx')).toContain('phone_e164 text_pattern_ops');
  });

  it('ad katlama indeksinin ifadesi @siparis/core sabitleriyle birebir aynı ve text_pattern_ops taşır', async () => {
    // Sapma hâlinde arama yanlış DEĞİL ama indekssiz (yavaş) kalır; bu yüzden kapı burada, makinede.
    expect(await indexDef('customers_tenant_name_fold_idx')).toContain(
      `translate(name, '${FOLD_FROM}'::text, '${FOLD_TO}'::text) text_pattern_ops`,
    );
  });

  it('ad öneki sorgusu planda GERÇEKTEN ifade indeksini kullanır', async () => {
    const fold = `translate(c.name, '${FOLD_FROM}', '${FOLD_TO}')`;
    const plan = await ctx.sql.begin(async (tx) => {
      await tx.unsafe('set local enable_seqscan = off').simple();
      return tx.unsafe(
        `explain (format json) select c.id from customers c
          where c.tenant_id = '${s.tenantId}'::uuid and c.name is not null and ${fold} like 'ahm%' limit 200`,
      );
    });
    const text = JSON.stringify(plan);
    expect(text, `plan ifade indeksini kullanmıyor — NAME_FOLD_SQL ile indeks ifadesi ayrışmış olabilir: ${text.slice(0, 800)}`).toContain(
      'customers_tenant_name_fold_idx',
    );
  });
});
