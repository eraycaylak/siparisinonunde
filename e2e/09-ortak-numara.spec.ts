// Senaryo 9 — Ortak numara (00 §12a madde 8, geçiş: madde 11; 14 §8.1): dükkanlar geçiş boyunca platformun tek WhatsApp
// numarasını kullanır; DİZİN YOK (O2).
// (a) Müşteri Bozok'un kodunu yazar (#BOZOK) → Bozok adına karşılama → menüden sipariş → sipariş Bozok panelinde,
//     Çamlık Döner panelinde yok. Aynı müşteri #DONER yazar → Döner adına karşılama. "Ertesi gün" kodsuz yazar →
//     dükkan listesi / son dükkanlar düğmesi GELMEZ, tek nötr yanıt gelir → müşteri #BOZOK'u yeniden yazar → Bozok.
// (b) QR kısa bağlantısı (O4): /q/<kod> → 302 vitrin (?src=qr); vitrin altbilgisinde işletmeci beyanı (O3); bilinmeyen
//     kod listesiz nötr sayfa.
// (c) İşletme sahibi (360 px): WhatsApp sayfasında ortak numara, dükkan kodu, müşteri bağlantısı (/q/<kod>), QR indirme.

import { expect, test } from './support/test';
import { apiLogin, newApiContext, sharedThread, toE164, uniqueName, uniquePhone } from './support/api';
import { ageSharedRoute } from './support/db';
import { DEMO, DONER } from './support/env';
import { expectNoHorizontalOverflow, goToCheckout, labelRe, loginPanel, openSimulator, orderCard, scanShopQr, simulatorSend, skipShiftStart } from './support/ui';

interface ActiveOrders {
  items: { number: number; customerName: string | null }[];
}

test('Ortak numara: #KOD ile dükkan seçimi, dükkana özel sipariş, kodsuz dönüşte listesiz nötr yanıt', async ({ page, openContext, request }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Zeynep') };
  await openSimulator(page, customer);

  // 1) Bozok'un QR'ı: ortak numaraya "… #BOZOK" → Bozok adına karşılama (kalın dükkan adı) + "Menüyü aç"
  await scanShopQr(page, DEMO.waCode);
  await expect(page.getByText(`${DEMO.tenantName} WhatsApp sipariş hattına hoş geldiniz`, { exact: false })).toBeVisible();
  await expect(page.getByText(`Etkin dükkan: ${DEMO.tenantName}`)).toBeVisible();
  const bozokMenu = await page.getByRole('link', { name: 'Menüyü aç' }).last().getAttribute('href');
  expect(bozokMenu).toMatch(/\/m\/[A-Za-z0-9_-]{12}$/);

  // 2) Menüden gel-al siparişi → Bozok'a düşer
  const shop = await page.context().newPage();
  await shop.goto(bozokMenu!);
  await expect(shop).toHaveURL(new RegExp(`/s/${DEMO.slug}`));
  await expect(shop.getByRole('button', { name: 'Ben değilim' })).toBeVisible();
  await shop.getByRole('button', { name: 'Mercimek Çorbası sepete ekle' }).click();
  await goToCheckout(shop);
  await shop.getByText('Gel-al', { exact: true }).click();
  await expect(shop.getByLabel(labelRe('Adınız'))).toHaveValue(customer.name);
  await shop.getByRole('radio', { name: /^Kasada öde/ }).check();
  await shop.getByRole('checkbox', { name: /Ön bilgilendirme formunu/ }).check();
  await shop.getByRole('button', { name: /^Siparişi onayla/ }).click();
  await expect(shop).toHaveURL(/\/t\/[^/]+$/);
  await expect(shop.getByRole('heading', { level: 1 })).toContainText('Siparişiniz alındı');
  const number = Number((await shop.getByText(/Sipariş #\d+/).first().textContent())?.match(/#(\d+)/)?.[1]);
  expect(number).toBeGreaterThan(1000);
  await shop.close();

  // Sipariş Bozok'un canlı ekranında görünür ...
  const panelContext = await openContext();
  const panel = await panelContext.newPage();
  await loginPanel(panel, DEMO.owner);
  await skipShiftStart(panel);
  await expect(orderCard(panel, number)).toContainText(customer.name);
  await panelContext.close();
  // ... Çamlık Döner'in panelinde yoktur (her dükkanın verisi ayrı)
  const doner = await newApiContext();
  await apiLogin(doner, DONER.owner.email, DONER.owner.password);
  const donerActive = (await (await doner.get('/api/v1/panel/orders/active')).json()) as ActiveOrders;
  expect(donerActive.items.some((o) => o.customerName === customer.name)).toBe(false);

  // 3) Aynı müşteri Çamlık Döner'in QR'ını okutur → Döner adına karşılama, menü bağlantısı Döner'in vitrini
  await scanShopQr(page, DONER.waCode);
  await expect(page.getByText(`${DONER.tenantName} WhatsApp sipariş hattına hoş geldiniz`, { exact: false })).toBeVisible();
  await expect(page.getByText(`Etkin dükkan: ${DONER.tenantName}`)).toBeVisible();
  await expect(page.locator('strong', { hasText: DONER.tenantName })).toBeVisible();
  const donerMenu = await page.getByRole('link', { name: 'Menüyü aç' }).last().getAttribute('href');
  expect(donerMenu).toMatch(/\/m\/[A-Za-z0-9_-]{12}$/);
  expect(donerMenu).not.toBe(bozokMenu);
  const afterDoner = await sharedThread(request, customer.phone);
  expect(afterDoner.route?.currentTenantName).toBe(DONER.tenantName);
  // Döner'in karşılaması Döner'in konuşmasında, Bozok'unki Bozok'ta (mesajlar dükkanlara ayrı yazılır)
  const welcomes = afterDoner.messages.filter((m) => m.direction === 'out' && m.code === 'M01').map((m) => m.tenantName);
  expect(welcomes).toEqual([DEMO.tenantName, DONER.tenantName]);

  // 4) "Sonra bir gün" kodsuz yazar → etkin dükkan süresi geçmiş: dükkan listesi ya da son dükkanlar düğmesi YOK (O2);
  // tek nötr yanıt gelir, başka dükkanın adı geçmez
  await ageSharedRoute(toE164(customer.phone), 25);
  await simulatorSend(page, 'merhaba');
  const neutral = page.getByRole('listitem').filter({ hasText: 'Sipariş vermek için işletmenin QR kodunu okutun ya da işletmenin paylaştığı bağlantıyı açın.' });
  await expect(neutral).toBeVisible();
  await expect(neutral.getByRole('button')).toHaveCount(0);
  await expect(page.getByText('Hangi dükkandan sipariş vermek istersin?')).toHaveCount(0);
  await expect(page.getByText(`Son dükkan: ${DONER.tenantName} (24 saat geçti)`)).toBeVisible();

  // 5) Müşteri Bozok'un kodunu yeniden yazar → Bozok'a bağlanır; açık siparişi olduğu için durum kartı Bozok adına gelir
  await scanShopQr(page, DEMO.waCode);
  await expect(page.getByText(`Etkin dükkan: ${DEMO.tenantName}`)).toBeVisible();
  await expect
    .poll(async () => {
      const t = await sharedThread(request, customer.phone);
      const lastOut = t.messages.filter((m) => m.direction === 'out').at(-1);
      return [t.route?.currentTenantName, lastOut?.tenantName, lastOut?.platform, lastOut?.brand];
    })
    .toEqual([DEMO.tenantName, DEMO.tenantName, false, DEMO.tenantName]);
  const final = await sharedThread(request, customer.phone);
  // Platform yanıtı (nötr, P09) platform düzeyinde; hiçbir dükkanın sohbetine girmez, dükkan adı taşımaz
  const platformOut = final.messages.filter((m) => m.platform && m.direction === 'out');
  expect(platformOut.map((m) => m.code)).toEqual(['P09']);
  expect(JSON.stringify(platformOut)).not.toContain(DEMO.tenantName);
  expect(JSON.stringify(platformOut)).not.toContain(DONER.tenantName);
  const reply = final.messages.filter((m) => m.direction === 'in').at(-1)!;
  expect([reply.kind, reply.tenantName]).toEqual(['text', DEMO.tenantName]);

  await doner.dispose();
});

test('QR kısa bağlantısı: /q/<kod> vitrine yönlenir (işletmeci beyanıyla); bilinmeyen kod listesiz nötr sayfa', async ({ page, request }) => {
  // API düzeyinde 302 (küçük harf kod da çözülür)
  const res = await request.get(`/q/${DEMO.waCode.toLowerCase()}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toMatch(new RegExp(`/s/${DEMO.slug}\\?src=qr$`));

  await page.goto(`/q/${DEMO.waCode}`);
  await expect(page).toHaveURL(new RegExp(`/s/${DEMO.slug}\\?src=qr$`));
  await expect(page.getByTestId('operator-statement')).toHaveText(
    `Bu sayfa ${DEMO.tenantName} tarafından işletilir; Yemek Gelsin yalnız yazılım altyapısı sağlar.`,
  );
  await expect(page.getByText('Altyapı: Yemek Gelsin')).toHaveCount(0);

  await page.goto('/q/YOKBOYLE');
  await expect(page.getByRole('heading', { name: 'QR kodu bulunamadı' })).toBeVisible();
  await expect(page).toHaveTitle('QR kodu bulunamadı');
  await expect(page.getByRole('main').getByRole('link')).toHaveCount(0);
  await expect(page.getByText(DEMO.tenantName)).toHaveCount(0);

  // Bilinmeyen vitrin: platform/panel bağlantısı yok
  await page.goto('/s/boyle-bir-dukkan-yok');
  await expect(page.getByRole('heading', { name: 'Sayfa bulunamadı' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'İşletme paneli' })).toHaveCount(0);

  // Geçerli vitrin altında eşleşmeyen yol da vitrinin nötr 404'üdür (kök 404'ün platform/panel bağlantıları yok)
  const miss = await page.goto(`/s/${DEMO.slug}/olmayan-sayfa`);
  expect(miss?.status()).toBe(404);
  await expect(page.getByText('Bu adreste bir sipariş sayfası yok.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'İşletme paneli' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ana sayfaya dön' })).toHaveCount(0);
  await expect(page).toHaveTitle('Sayfa bulunamadı');
});

test.describe('İşletme sahibi 360 px', () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('WhatsApp sayfası: ortak numara, dükkan kodu, müşteri bağlantısı (/q/), QR indirme ve masa kartı', async ({ page }) => {
    await loginPanel(page, DEMO.owner);
    await page.goto('/panel/ayarlar/whatsapp');
    await expect(page.getByText('WhatsApp mesajlarınız ortak Yemek Gelsin numarasından gider.')).toBeVisible();
    await expect(page.getByText(`#${DEMO.waCode}`, { exact: true }).first()).toBeVisible();
    // Müşteri bağlantısı QR kısa bağlantısıdır (O4): menüye açılır; ortak numaranın wa.me bağlantısı paylaşılmaz
    const link = await page.getByRole('textbox', { name: 'Müşteri bağlantısı' }).inputValue();
    expect(link).toMatch(new RegExp(`/q/${DEMO.waCode}$`));
    expect(link).not.toContain('wa.me');
    await expect(page.getByRole('button', { name: 'Bağlantıyı kopyala' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Menüyü aç' })).toHaveAttribute('href', link);

    // QR indirme (oturum çereziyle, aynı köken)
    const png = page.getByRole('link', { name: 'PNG indir' });
    await expect(png).toHaveAttribute('href', '/api/v1/panel/whatsapp/qr?format=png');
    const res = await page.request.get('/api/v1/panel/whatsapp/qr?format=png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['content-disposition']).toContain(`menu-qr-${DEMO.waCode.toLowerCase()}.png`);

    // Masa kartı: dükkan adı, "Sipariş vermek için okut", QR kısa bağlantısı; platform adı ve ortak numara yok
    const card = page.locator('#print-table-card');
    await expect(card).toContainText(DEMO.tenantName);
    await expect(card).toContainText('Sipariş vermek için okut');
    await expect(card).toContainText(`/q/${DEMO.waCode}`);
    await expect(card).not.toContainText('Yemek Gelsin');
    await expect(card).not.toContainText('Dükkan kodu');
    await expect(page.getByRole('button', { name: /^Masa kartını yazdır/ })).toBeVisible();
    // Kendi numara ikincil bölüm olarak durur
    await expect(page.getByRole('heading', { name: 'Kendi numaranızı bağlayın' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'panel WhatsApp (ortak numara)');
  });
});
