// Senaryo 2 — Akış B (00 §7, 03 §4.5): vitrinden doğrudan (çerezsiz) sipariş → `awaiting_customer` →
// doğrulama ekranındaki kodla müşteri WhatsApp'tan "Sipariş kodu: XXXXXX" gönderir → sipariş `new` →
// "alındı" (M05) anında gider, ekran kendiliğinden takip sayfasına geçer.

import { expect, test } from './support/test';
import { uniqueName, uniquePhone } from './support/api';
import { DEMO } from './support/env';
import { goToCheckout, labelRe, openSimulator, simulatorSend } from './support/ui';

test('Akış B: vitrinden sipariş, WhatsApp koduyla doğrulama ve takip sayfası', async ({ page }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Mehmet') };

  // 1) QR/Instagram'dan gelen müşteri: vitrin, basit ürün + seçenekli ürün, gel-al
  await page.goto(`/s/${DEMO.slug}`);
  await expect(page.getByRole('heading', { name: DEMO.tenantName, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Mercimek Çorbası sepete ekle' }).click();
  await page.getByRole('button', { name: 'Lahmacun: seçenekleri gör' }).click();
  const sheet = page.getByRole('dialog', { name: 'Lahmacun' });
  await sheet.getByRole('radio', { name: /^Acılı/ }).check();
  await sheet.getByRole('button', { name: /^Sepete ekle/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /^Sepeti gör/ })).toContainText('2 ürün');

  await goToCheckout(page);
  await page.getByText('Gel-al', { exact: true }).click();
  await page.getByLabel(labelRe('Adınız')).fill(customer.name);
  await page.getByLabel(labelRe('Teslimat telefonu')).fill(customer.phone);
  await page.getByRole('radio', { name: /^Kasada öde/ }).check();
  await page.getByRole('checkbox', { name: /Ön bilgilendirme formunu/ }).check();
  await page.getByRole('button', { name: /^Siparişi onayla/ }).click();

  // 2) Doğrulama ekranı: kod + "WhatsApp ile onayla" (wa.me/<işletme numarası>?text=Sipariş kodu: …)
  await expect(page.getByRole('heading', { name: /WhatsApp.+onaylayın/ })).toBeVisible();
  const codeEl = page.getByLabel(/^Sipariş kodu /);
  const code = (await codeEl.textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  const waLink = page.getByRole('link', { name: 'WhatsApp ile onayla' });
  await expect(waLink).toHaveAttribute('href', new RegExp(`^https://wa\\.me/${DEMO.waDisplayPhone.replace('+', '')}\\?text=`));
  expect(decodeURIComponent((await waLink.getAttribute('href'))!.split('text=')[1]!)).toBe(`Sipariş kodu: ${code}`);

  // 3) Müşteri WhatsApp'tan hazır mesajı gönderir (simülatör, ayrı sekme)
  const wa = await page.context().newPage();
  await openSimulator(wa, customer);
  await simulatorSend(wa, `Sipariş kodu: ${code}`);
  await expect(wa.getByText(/Siparişiniz alındı! Sipariş no:/)).toBeVisible();

  // 4) Doğrulama ekranı kendiliğinden takip sayfasına geçer; sipariş `new`
  await expect(page).toHaveURL(/\/t\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Siparişiniz alındı');
  await expect(page.getByRole('list', { name: 'Sipariş adımları' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sipariş özeti' })).toContainText('Mercimek Çorbası');
});
