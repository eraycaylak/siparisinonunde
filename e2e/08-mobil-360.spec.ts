// Senaryo 8 — Mobil 360 px (12 §8, 14 §9): pazarlama, vitrin, checkout ve takip sayfalarında yatay taşma yok.

import { expect, test } from './support/test';
import { createWebOrder, trackingPath, uniqueName, uniquePhone, verifyByWhatsappCode } from './support/api';
import { DEMO } from './support/env';
import { expectNoHorizontalOverflow, goToCheckout } from './support/ui';

test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test('Pazarlama sayfaları 360 px', async ({ page }) => {
  for (const path of ['/', '/fiyatlar', '/hesaplayici', '/nasil-calisir', '/sss']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, path);
  }
});

test('Vitrin, ürün çekmecesi ve checkout 360 px', async ({ page }) => {
  await page.goto(`/s/${DEMO.slug}`);
  await expect(page.getByRole('heading', { name: DEMO.tenantName, level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'vitrin');

  await page.getByRole('button', { name: 'Adana Kebap: seçenekleri gör' }).click();
  const sheet = page.getByRole('dialog', { name: 'Adana Kebap' });
  await expect(sheet).toBeVisible();
  await expectNoHorizontalOverflow(page, 'ürün çekmecesi');
  await sheet.getByRole('radio', { name: /^Tam porsiyon/ }).check();
  await sheet.getByRole('radio', { name: /^Acılı/ }).check();
  await sheet.getByRole('button', { name: /^Sepete ekle/ }).click();
  await expect(sheet).toBeHidden();

  await goToCheckout(page);
  await expect(page.getByRole('button', { name: /^Siparişi onayla/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'checkout');
});

test('Takip sayfası 360 px', async ({ page, request }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Selin') };
  const order = await createWebOrder(request, {
    customerName: customer.name,
    customerPhone: customer.phone,
    products: ['Karışık Pide', 'Ayran'],
    fulfillment: 'delivery',
    neighborhood: 'Medrese',
  });

  // Doğrulama bekleyen ekran (Akış B)
  await page.goto(trackingPath(order));
  await expect(page.getByRole('heading', { name: /WhatsApp.+onaylayın/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'takip (doğrulama)');

  // Doğrulanmış sipariş: durum çizelgesi + özet
  await verifyByWhatsappCode(request, order, customer);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Sipariş adımları' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sipariş özeti' })).toContainText('Karışık Pide');
  await expectNoHorizontalOverflow(page, 'takip');
});
