// Senaryo 7 — Kayıt → kurulum sihirbazı → test siparişi → canlı ekranda görünür (04 §3, 00 §7 test siparişi).
// Menüye ürün eklemek sihirbazın dışında (menü sayfası) olduğundan ürün API ile eklenir.

import { expect, test } from './support/test';
import { uniquePhone } from './support/api';
import { labelRe, orderCard, skipShiftStart } from './support/ui';

test('Kayıt, kurulum sihirbazı, test siparişi ve canlı ekranda onay', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const businessName = `E2E Kebap ${stamp}`;

  // 1) Kayıt formu
  await page.goto('/panel/kayit');
  await page.getByLabel(labelRe('İşletme adı')).fill(businessName);
  await page.getByLabel(labelRe('Adınız soyadınız')).fill('Deneme Kurucu');
  await page.getByLabel(labelRe('Cep telefonu')).fill(uniquePhone());
  await expect(page.getByLabel(labelRe('İl'))).toHaveValue('Yozgat');
  await page.getByLabel(labelRe('E-posta')).fill(`kayit-${stamp}@e2e.local`);
  await page.getByLabel(labelRe('Parola')).fill('e2e-parola-123');
  await page.getByRole('checkbox', { name: /Kullanım koşullarını/ }).check();
  await page.getByRole('checkbox', { name: /KVKK aydınlatma metnini/ }).check();
  await page.getByRole('checkbox', { name: /satmayacağımı beyan ederim/ }).check();
  await page.getByRole('button', { name: 'Hesabımı aç' }).click();

  // 2) Kurulum sihirbazı
  await expect(page).toHaveURL(/\/panel\/kurulum$/);
  await expect(page.getByRole('heading', { name: 'İşletmenizi hazırlayalım', level: 1 })).toBeVisible();
  const progress = page.getByRole('progressbar', { name: 'Kurulum ilerlemesi' });
  await expect(progress).toBeVisible();
  const before = Number(await progress.getAttribute('aria-valuenow'));

  // Menü: bir kategori + bir ürün (panel menü API'si, aynı oturum)
  const cat = await page.request.post('/api/v1/panel/categories', { data: { name: 'Kebaplar' } });
  expect(cat.ok(), await cat.text()).toBeTruthy();
  const { id: categoryId } = (await cat.json()) as { id: string };
  const prod = await page.request.post('/api/v1/panel/products', { data: { categoryId, name: 'Adana Dürüm', priceKurus: 18000 } });
  expect(prod.ok(), await prod.text()).toBeTruthy();

  const steps = page.getByRole('navigation', { name: 'Kurulum adımları' });
  await steps.getByRole('button', { name: /Menü/ }).click();
  await page.getByRole('button', { name: 'Kontrol et' }).click();
  await expect(steps.getByRole('button', { name: /Menü.*\(tamamlandı\)/ })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', String(before + 1));

  // 3) Test siparişi adımı
  await steps.getByRole('button', { name: /Test siparişi/ }).click();
  await expect(page.getByRole('heading', { name: /Test siparişi/, level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Test siparişi oluştur' }).click();
  const testOrder = page.getByText(/^Test siparişi #\d+$/);
  await expect(testOrder).toBeVisible();
  const number = Number((await testOrder.textContent())!.match(/#(\d+)/)![1]);

  // 4) Canlı ekranda TEST etiketiyle görünür ve onaylanır
  await page.getByRole('link', { name: /Canlı ekranda görün ve onaylayın/ }).click();
  await expect(page).toHaveURL(/\/panel$/);
  await skipShiftStart(page);
  const card = orderCard(page, number);
  await expect(card).toBeVisible();
  await expect(card).toContainText('TEST');
  await expect(card).toContainText('Adana Dürüm');
  await card.getByRole('button', { name: /^Onayla · \d+ dk$/ }).click();
  await expect(card).toContainText('Onaylandı');

  // Sihirbaz test siparişini tamamlanmış sayar
  await page.goto('/panel/kurulum');
  await expect(page.getByRole('navigation', { name: 'Kurulum adımları' }).getByRole('button', { name: /Test siparişi.*\(tamamlandı\)/ })).toBeVisible();
});
