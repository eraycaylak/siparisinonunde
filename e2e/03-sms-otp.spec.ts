// Senaryo 3 — WhatsApp'sız mod / SMS OTP yedeği (00 §4, §7; 14 §7.3):
// (a) WhatsApp'ı henüz bağlanmamış yeni işletme ("WhatsApp'sız başla" + Kapı 1 web canlıya geçiş, API ile kurulur) → vitrinden sipariş →
//     doğrulama ekranı SMS'e düşer → kod mock SMS kutusundan (/api/v1/dev/sms) alınır → sipariş `new` →
//     onay müşteriye SMS ile bildirilir (kritik durum).
// (b) Demo işletmenin WhatsApp kanalı arızalı (hesap devre dışı) → Akış B otomatik olarak SMS OTP'ye döner.
//     Not: panelde WhatsApp bağlantısını kesen bir uç nokta olmadığı için hesap durumu test yardımcısıyla (SQL) değişir.

import { expect, test } from './support/test';
import {
  acceptOrder,
  branchIdOf,
  createWebOrder,
  fakeClientIp,
  flushJobs,
  latestOtp,
  newApiContext,
  smsInbox,
  trackOrder,
  uniqueName,
  uniquePhone,
} from './support/api';
import { setWaAccountStatus } from './support/db';
import { DEMO } from './support/env';
import { goToCheckout, labelRe } from './support/ui';

test('WhatsApp bağlı olmayan işletme: SMS koduyla doğrulama ve onayın SMS ile bildirilmesi', async ({ page, request }) => {
  const owner = await newApiContext();
  const stamp = Date.now().toString(36);
  const customer = { phone: uniquePhone(), name: uniqueName('Zeynep') };

  // --- Kurulum (API): kayıt, 7/24 saat, menü, "WhatsApp'sız başla"
  const signup = await owner.post('/api/v1/auth/signup', {
    headers: { 'x-forwarded-for': fakeClientIp() },
    data: {
      businessName: `E2E Çorbacı ${stamp}`,
      ownerName: 'Deneme Sahip',
      phone: uniquePhone(),
      email: `sms-${stamp}@e2e.local`,
      password: 'e2e-parola-123',
      city: 'Yozgat',
      acceptTerms: true,
    },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const { tenant } = (await signup.json()) as { tenant: { slug: string } };
  const branchId = await branchIdOf(owner);

  const hours = await owner.put(`/api/v1/panel/branches/${branchId}/hours`, {
    data: { days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ opensAt: '00:00', closesAt: '23:59' }] })) },
  });
  expect(hours.ok(), await hours.text()).toBeTruthy();
  const cat = await owner.post('/api/v1/panel/categories', { data: { name: 'Çorbalar' } });
  expect(cat.ok(), await cat.text()).toBeTruthy();
  const { id: categoryId } = (await cat.json()) as { id: string };
  const product = await owner.post('/api/v1/panel/products', { data: { categoryId, name: 'Ezogelin Çorbası', priceKurus: 9500 } });
  expect(product.ok(), await product.text()).toBeTruthy();
  const whatsappless = await owner.post('/api/v1/panel/onboarding/whatsappless', { data: { enabled: true } });
  expect(whatsappless.ok(), await whatsappless.text()).toBeTruthy();

  // Canlıya geçmeden vitrin "Yakında" der, sepete ekleme yok ve arama motorlarına kapalıdır (04 §3.4.4)
  await page.goto(`/s/${tenant.slug}`);
  await expect(page.getByText('Bu işletme online siparişe yakında başlayacak.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ezogelin Çorbası sepete ekle' })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  // --- Kapı 1 (web_live_at): künye, şube adresi ve bölge tamamlanmadan vitrin sipariş almaz (ordering_closed)
  const imprint = await owner.patch('/api/v1/panel/tenant', { data: { legalName: 'Deneme Sahip', taxNo: '12345678901', address: 'Yozgat Merkez' } });
  expect(imprint.ok(), await imprint.text()).toBeTruthy();
  const address = await owner.patch(`/api/v1/panel/branches/${branchId}`, { data: { addressLine: 'Lise Cad. 5', lat: 39.82, lng: 34.81 } });
  expect(address.ok(), await address.text()).toBeTruthy();
  const zone = await owner.post('/api/v1/panel/zones', {
    data: { name: 'Yakın', kind: 'radius', radiusM: 3000, feeKurus: 0, minOrderKurus: 0, etaMinutes: 30 },
  });
  expect(zone.ok(), await zone.text()).toBeTruthy();
  const goLive = await owner.post('/api/v1/panel/onboarding/go-live');
  expect(goLive.ok(), await goLive.text()).toBeTruthy();
  // WhatsApp'sız mod: yalnız web siparişi açılır (Kapı 2 WhatsApp bağlantısı ister)
  expect(await goLive.json()).toMatchObject({ webLive: true, live: false });

  // --- Müşteri: vitrin → gel-al siparişi
  await page.goto(`/s/${tenant.slug}`);
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ezogelin Çorbası sepete ekle' }).click();
  await goToCheckout(page);
  await page.getByText('Gel-al', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Gel-al' })).toBeChecked();
  await expect(page.getByText(/onay, ret ve iptal SMS ile bildirilir/)).toBeVisible();
  await page.getByLabel(labelRe('Adınız')).fill(customer.name);
  await page.getByLabel(labelRe('Teslimat telefonu')).fill(customer.phone);
  await page.getByRole('radio', { name: /^Kasada öde/ }).check();
  await page.getByRole('checkbox', { name: /Ön bilgilendirme formunu/ }).check();
  await page.getByRole('button', { name: /^Siparişi onayla/ }).click();

  // --- SMS doğrulama ekranı (WhatsApp kodu yok)
  await expect(page.getByRole('heading', { name: 'SMS ile doğrulayın' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'WhatsApp ile onayla' })).toHaveCount(0);
  await expect(page.getByLabel('Cep telefonu')).toHaveValue(customer.phone);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await expect(page.getByText(/numarasına 6 haneli kod gönderdik/)).toBeVisible();

  const code = await latestOtp(request, customer.phone);
  await page.getByLabel('Doğrulama kodu').fill(code);

  // Kod doğrulanınca takip sayfası: sipariş `new`
  await expect(page).toHaveURL(/\/t\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Siparişiniz alındı');

  // --- İşletme onaylar → müşteriye "onaylandı" SMS'i (WhatsApp'sız modda kritik durumlar SMS ile)
  const orders = await owner.get('/api/v1/panel/orders/active');
  expect(orders.ok()).toBeTruthy();
  const active = (await orders.json()) as { items: { id: string; status: string; customerName: string | null }[] };
  const mine = active.items.find((o) => o.customerName === customer.name);
  expect(mine?.status).toBe('new');
  await acceptOrder(owner, mine!.id, 20);

  await expect
    .poll(
      async () => {
        await flushJobs(request);
        return (await smsInbox(request, customer.phone)).some((s) => /onaylandı/.test(s.body));
      },
      { message: '"onaylandı" SMS bekleniyor', timeout: 30_000 },
    )
    .toBe(true);

  await owner.dispose();
});

test('WhatsApp kanalı devre dışıyken Akış B SMS OTP ile doğrulanır', async ({ request }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Can') };
  await setWaAccountStatus(DEMO.slug, 'error');
  try {
    const order = await createWebOrder(request, { customerName: customer.name, customerPhone: customer.phone, products: ['Kıymalı Pide'], fulfillment: 'pickup' });
    expect(order.status).toBe('awaiting_customer');
    expect(order.verification.method).toBe('sms_otp');
    expect(order.verification.waLink).toBeUndefined();

    const send = await request.post(`/api/v1/store/orders/${order.orderId}/sms-otp`, {
      headers: { 'x-forwarded-for': fakeClientIp() },
      data: { phone: customer.phone },
    });
    expect(send.ok(), await send.text()).toBeTruthy();
    const code = await latestOtp(request, customer.phone);
    const verify = await request.post(`/api/v1/store/orders/${order.orderId}/sms-verify`, { data: { code } });
    expect(verify.ok(), await verify.text()).toBeTruthy();
    expect((await trackOrder(request, order)).order.status).toBe('new');
  } finally {
    await setWaAccountStatus(DEMO.slug, 'connected');
  }
});
