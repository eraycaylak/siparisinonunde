// Senaryo 6 — Admin ve destek erişimi (05 A-09, 00 §4, 14 §5): platform girişi → işletme detayı →
// "Paneli salt-okunur aç" (gerekçe zorunlu) → panel kırmızı bantla açılır → yazma denemeleri engellenir
// (arayüzde hata, API'de 403 read_only_session) → oturum bitirilince yönetim paneline dönülür.

import { expect, test } from './support/test';
import { branchIdOf, storefront } from './support/api';
import { DEMO } from './support/env';
import { labelRe, skipShiftStart } from './support/ui';

test('Admin: işletme detayı, salt-okunur panel ve engellenen yazma denemesi', async ({ page, request }) => {
  // 1) Platform girişi
  await page.goto('/admin/giris');
  await page.getByLabel('E-posta ya da telefon').fill(DEMO.admin.email);
  await page.getByLabel(labelRe('Parola')).fill(DEMO.admin.password);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/admin(\/|$)/);
  await expect(page).not.toHaveURL(/\/admin\/giris/);

  // 2) İşletmeler → Bozok Pide Salonu detayı
  await page.goto('/admin/isletmeler');
  await page.getByRole('link', { name: DEMO.tenantName }).first().click();
  await expect(page).toHaveURL(/\/admin\/isletmeler\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: DEMO.tenantName, level: 1 })).toBeVisible();

  // 3) Destek erişimi: gerekçe kısa olursa reddedilir, yeterliyse panel aynı sekmede salt-okunur açılır
  await page.getByRole('button', { name: 'Paneli salt-okunur aç' }).click();
  const dialog = page.getByRole('dialog', { name: 'Paneli salt-okunur aç' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(labelRe('Gerekçe')).fill('Kısa');
  await dialog.getByRole('button', { name: 'Destek erişimini başlat' }).click();
  await expect(dialog.getByText(/Gerekçe en az \d+ karakter/)).toBeVisible();
  await dialog.getByLabel(labelRe('Gerekçe')).fill('E2E: sipariş düşmüyor şikayeti, bildirim ayarları kontrolü');
  await dialog.getByRole('button', { name: 'Destek erişimini başlat' }).click();

  await expect(page).toHaveURL(/\/panel(\/|$)/);
  await skipShiftStart(page);
  await expect(page.getByText('Destek oturumu: salt-okunur, değişiklik yapılamaz.')).toBeVisible();

  // 4) Arayüzden yazma denemesi: sipariş almayı 15 dk durdur → hata
  await page.getByRole('button', { name: /^Sipariş alma durumu:/ }).click();
  const orderingSheet = page.getByRole('dialog', { name: 'Sipariş alma durumu' });
  await expect(orderingSheet).toBeVisible();
  await orderingSheet.getByRole('button', { name: '15 dk', exact: true }).click();
  await expect(page.getByText('Salt-okunur oturumda değişiklik yapılamaz.')).toBeVisible();

  // 5) API'den yazma denemesi (aynı tarayıcı oturumu): 403 read_only_session
  const branchId = await branchIdOf(page.request);
  const res = await page.request.post(`/api/v1/panel/branches/${branchId}/pause`, { data: { minutes: 15 } });
  expect(res.status()).toBe(403);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('read_only_session');

  // Hiçbir şey değişmedi: vitrin hâlâ sipariş alıyor
  expect((await storefront(request)).branch.orderingState).toBe('open');

  // 6) Oturumu bitir → yönetim paneline dönüş
  await page.getByRole('button', { name: 'Oturumu bitir' }).click();
  await expect(page).toHaveURL(/\/admin(\/|$)/);
});
