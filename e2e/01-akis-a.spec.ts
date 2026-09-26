// Senaryo 1 — Akış A (00 §7, 14 §10): müşteri dükkanın QR'ını okutur (ortak numaraya #BOZOK; 00 §12a madde 8) →
// Bozok adına karşılama + "Menüyü aç" linki → vitrinde seçenekli ürün → checkout → sipariş doğrudan `new` → panel
// canlı ekranında görünür → "Onayla" → müşteriye "onaylandı" mesajı.
// 60 sn "alındı" debounce'u beklenmez: onay birleşik M06c'yi hemen kuyruğa atar, /api/v1/dev/jobs/flush işler.

import { expect, test } from './support/test';
import { apiLogin, demoWaAccount, flushJobs, newApiContext, uniqueName, uniquePhone, waThread } from './support/api';
import { DEMO } from './support/env';
import { goToCheckout, labelRe, loginPanel, openSimulator, orderCard, scanShopQr, skipShiftStart } from './support/ui';

test('Akış A: sohbetten menü linki, seçenekli ürün, panelde onay ve WhatsApp "onaylandı" mesajı', async ({ page, openContext, request }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Ayşe') };

  // 1) Müşteri dükkanın QR'ını okutur → ortak numaraya "… #BOZOK" gider → Bozok adına karşılama + "Menüyü aç" CTA
  await openSimulator(page, customer);
  await scanShopQr(page, DEMO.waCode);
  const menuLink = page.getByRole('link', { name: 'Menüyü aç' });
  await expect(menuLink).toBeVisible();
  await expect(page.getByText(`${DEMO.tenantName} WhatsApp sipariş hattına hoş geldiniz`, { exact: false })).toBeVisible();
  // Ortak numarada her mesaj dükkan adıyla (kalın ilk satır) başlar
  await expect(page.locator('strong', { hasText: DEMO.tenantName })).toBeVisible();
  const menuUrl = await menuLink.getAttribute('href');
  expect(menuUrl).toMatch(new RegExp(`/s/${DEMO.slug}\\?l=`));

  // 2) Linki müşteri telefonunda açar: token çereze çevrilir ve adres çubuğundan silinir
  const shop = await page.context().newPage();
  await shop.goto(menuUrl!);
  await expect(shop).toHaveURL(new RegExp(`/s/${DEMO.slug}$`));
  await expect(shop.getByRole('button', { name: 'Ben değilim' })).toBeVisible();

  // 3) Seçenekli ürün: Adana Kebap (Porsiyon zorunlu, Acı zorunlu)
  await shop.getByRole('button', { name: 'Adana Kebap: seçenekleri gör' }).click();
  const sheet = shop.getByRole('dialog', { name: 'Adana Kebap' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('radio', { name: /^1,5 porsiyon/ }).check();
  await sheet.getByRole('radio', { name: /^Acısız/ }).check();
  await sheet.getByRole('button', { name: /^Sepete ekle/ }).click();
  await expect(sheet).toBeHidden();

  // 4) Checkout (paket servis, Medrese mahallesi, kapıda nakit)
  await goToCheckout(shop);
  // Ön dolum (03 §4.4): ad WhatsApp profilinden gelir
  await expect(shop.getByLabel(labelRe('Adınız'))).toHaveValue(customer.name);
  await shop.getByLabel(labelRe('Mahalle')).selectOption('Medrese');
  await expect(shop.getByText(/Teslimat bölgesindesiniz/)).toBeVisible();
  await shop.getByLabel(labelRe('Adres')).fill('Lise Caddesi No: 5 Daire 3');
  await shop.getByLabel(labelRe('Adınız')).fill(customer.name);
  await shop.getByLabel(labelRe('Teslimat telefonu')).fill(customer.phone);
  await shop.getByRole('radio', { name: /^Kapıda nakit/ }).check();
  await shop.getByRole('checkbox', { name: /Ön bilgilendirme formunu/ }).check();
  await expect(shop.getByText('1,5 porsiyon, Acısız')).toBeVisible();
  await shop.getByRole('button', { name: /^Siparişi onayla/ }).click();

  // Akış A'da doğrulama yok: doğrudan takip sayfası, durum "alındı"
  await expect(shop).toHaveURL(/\/t\/[^/]+$/);
  await expect(shop.getByRole('heading', { level: 1 })).toContainText('Siparişiniz alındı');
  const header = await shop.getByText(/Sipariş #\d+/).first().textContent();
  const number = Number(header?.match(/#(\d+)/)?.[1]);
  expect(number).toBeGreaterThan(1000);

  // 5) İşletme paneli: canlı ekranda yeni sipariş kartı → "Onayla · 20 dk"
  const panelContext = await openContext();
  const panel = await panelContext.newPage();
  await loginPanel(panel, DEMO.owner);
  await skipShiftStart(panel);
  const card = orderCard(panel, number);
  await expect(card).toBeVisible();
  await expect(card).toContainText(customer.name);
  await expect(card).toContainText('Adana Kebap');
  const accept = card.getByRole('button', { name: 'Onayla · 20 dk', exact: true });
  const acceptAny = card.getByRole('button', { name: /^Onayla · \d+ dk$/ });
  await ((await accept.count()) ? accept : acceptAny).click();
  await expect(card.getByRole('button', { name: /^Onayla/ })).toHaveCount(0);
  await expect(card).toContainText('Onaylandı');

  // 6) Müşteri WhatsApp'ında "alındı ve onaylandı" (M06c) — debounce beklemeden işleri çalıştır
  await expect(async () => {
    await flushJobs(request);
    await page.getByRole('button', { name: 'Yenile' }).click();
    await expect(page.getByText(/Siparişiniz (alındı ve )?onaylandı!/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  // Mesaj koruma (00 §7): 60 sn içinde onay → "alındı" (M05) ayrı gitmez, tek birleşik M06c gider
  const acc = await demoWaAccount(request);
  const outCodes = (await waThread(request, acc.id, customer.phone)).filter((m) => m.direction === 'out').map((m) => m.code);
  expect(outCodes).toEqual(['M01', 'M06c']);

  // Takip sayfası da onayı gösterir
  await shop.reload();
  await expect(shop.getByRole('heading', { level: 1 })).toContainText('Onaylandı');

  await panelContext.close();
});

test('Akış A gel-al: telefon boş bırakılır, WhatsApp bağlantısındaki numara kullanılır', async ({ page }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Fatma') };
  await openSimulator(page, customer);
  await scanShopQr(page, DEMO.waCode);
  const menuUrl = await page.getByRole('link', { name: 'Menüyü aç' }).getAttribute('href');

  const shop = await page.context().newPage();
  await shop.goto(menuUrl!);
  await expect(shop.getByRole('button', { name: 'Ben değilim' })).toBeVisible();
  await shop.getByRole('button', { name: 'Mercimek Çorbası sepete ekle' }).click();
  await goToCheckout(shop);
  await shop.getByText('Gel-al', { exact: true }).click();
  // Telefon zorunlu değil; ipucu maskeli WhatsApp numarasını gösterir (03 §4.4)
  const phone = shop.getByLabel(labelRe('Teslimat telefonu'));
  await expect(phone).toHaveValue('');
  await expect(shop.getByText(/Boş bırakırsanız WhatsApp numaranız .* kullanılır\./)).toBeVisible();
  await expect(shop.getByLabel(labelRe('Adınız'))).toHaveValue(customer.name);
  await shop.getByRole('radio', { name: /^Kasada öde/ }).check();
  await shop.getByRole('checkbox', { name: /Ön bilgilendirme formunu/ }).check();
  await shop.getByRole('button', { name: /^Siparişi onayla/ }).click();

  await expect(shop).toHaveURL(/\/t\/[^/]+$/);
  await expect(shop.getByRole('heading', { level: 1 })).toContainText('Siparişiniz alındı');

  // Panelde sipariş müşterinin WhatsApp numarasıyla (son 4 hane) görünür
  const owner = await newApiContext();
  await apiLogin(owner, DEMO.owner.email, DEMO.owner.password);
  const active = (await (await owner.get('/api/v1/panel/orders/active')).json()) as {
    items: { customerName: string | null; customerPhoneMasked: string | null; fulfillmentType: string }[];
  };
  const mine = active.items.find((o) => o.customerName === customer.name);
  expect(mine?.fulfillmentType).toBe('pickup');
  expect(mine?.customerPhoneMasked?.replace(/\D/g, '').slice(-4)).toBe(customer.phone.replace(/\D/g, '').slice(-4));
  await owner.dispose();
});
