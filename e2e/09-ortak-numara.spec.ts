// Senaryo 9 — Ortak numara (00 §12a madde 8; 14 §8.1): tüm dükkanlar platformun tek WhatsApp numarasını kullanır.
// (a) Müşteri Bozok'un QR'ını okutur (#BOZOK) → Bozok adına karşılama → menüden sipariş → sipariş Bozok panelinde,
//     Çamlık Döner panelinde yok. Aynı müşteri Döner'in QR'ını okutur (#DONER) → Döner adına karşılama.
//     "Ertesi gün" kodsuz yazar → dükkan seçici son dükkanları sorar → Bozok seçilir → mesajlar Bozok'a gider.
// (b) İşletme sahibi (360 px): WhatsApp sayfasında ortak numara, dükkan kodu, müşteri bağlantısı, QR indirme.

import { expect, test } from './support/test';
import { apiLogin, newApiContext, sharedThread, toE164, uniqueName, uniquePhone } from './support/api';
import { ageSharedRoute } from './support/db';
import { DEMO, DONER } from './support/env';
import { expectNoHorizontalOverflow, goToCheckout, labelRe, loginPanel, openSimulator, orderCard, scanShopQr, simulatorSend, skipShiftStart } from './support/ui';

interface ActiveOrders {
  items: { number: number; customerName: string | null }[];
}

test('Ortak numara: QR ile dükkan seçimi, dükkana özel sipariş, kodsuz dönüşte dükkan seçici', async ({ page, openContext, request }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Zeynep') };
  await openSimulator(page, customer);

  // 1) Bozok'un QR'ı: ortak numaraya "… #BOZOK" → Bozok adına karşılama (kalın dükkan adı) + "Menüyü aç"
  await scanShopQr(page, DEMO.waCode);
  await expect(page.getByText(`${DEMO.tenantName} WhatsApp sipariş hattına hoş geldiniz`, { exact: false })).toBeVisible();
  await expect(page.getByText(`Etkin dükkan: ${DEMO.tenantName}`)).toBeVisible();
  const bozokMenu = await page.getByRole('link', { name: 'Menüyü aç' }).last().getAttribute('href');
  expect(bozokMenu).toMatch(new RegExp(`/s/${DEMO.slug}\\?l=`));

  // 2) Menüden gel-al siparişi → Bozok'a düşer
  const shop = await page.context().newPage();
  await shop.goto(bozokMenu!);
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
  expect(await page.getByRole('link', { name: 'Menüyü aç' }).last().getAttribute('href')).toMatch(new RegExp(`/s/${DONER.slug}\\?l=`));
  const afterDoner = await sharedThread(request, customer.phone);
  expect(afterDoner.route?.currentTenantName).toBe(DONER.tenantName);
  // Döner'in karşılaması Döner'in konuşmasında, Bozok'unki Bozok'ta (mesajlar dükkanlara ayrı yazılır)
  const welcomes = afterDoner.messages.filter((m) => m.direction === 'out' && m.code === 'M01').map((m) => m.tenantName);
  expect(welcomes).toEqual([DEMO.tenantName, DONER.tenantName]);

  // 4) "Sonra bir gün" kodsuz yazar → etkin dükkan süresi geçmiş: dükkan seçici son dükkanları sorar (en yeni önce)
  await ageSharedRoute(toE164(customer.phone), 25);
  await simulatorSend(page, 'merhaba');
  const picker = page.getByRole('listitem').filter({ hasText: 'Hangi dükkandan sipariş vermek istersin?' });
  await expect(picker).toBeVisible();
  await expect(page.getByText(`Son dükkan: ${DONER.tenantName} (24 saat geçti)`)).toBeVisible();
  const choices = picker.getByRole('button');
  await expect(choices.nth(0)).toHaveText(DONER.tenantName);
  await expect(choices.nth(1)).toHaveText(DEMO.tenantName);

  // 5) Bozok seçilir → Bozok'a bağlanır; açık siparişi olduğu için durum kartı Bozok adına gelir
  await picker.getByRole('button', { name: DEMO.tenantName, exact: true }).click();
  await expect(page.getByText(`Etkin dükkan: ${DEMO.tenantName}`)).toBeVisible();
  await expect
    .poll(async () => {
      const t = await sharedThread(request, customer.phone);
      const lastOut = t.messages.filter((m) => m.direction === 'out').at(-1);
      return [t.route?.currentTenantName, lastOut?.tenantName, lastOut?.platform, lastOut?.brand];
    })
    .toEqual([DEMO.tenantName, DEMO.tenantName, false, DEMO.tenantName]);
  const final = await sharedThread(request, customer.phone);
  // Seçici mesajları platform düzeyinde (hiçbir dükkanın sohbetine girmez), seçimin kendisi Bozok'a yazılır
  expect(final.messages.filter((m) => m.platform && m.direction === 'out').map((m) => m.code)).toEqual(['P01']);
  const reply = final.messages.filter((m) => m.direction === 'in').at(-1)!;
  expect([reply.kind, reply.tenantName]).toEqual(['button_reply', DEMO.tenantName]);

  await doner.dispose();
});

test.describe('İşletme sahibi 360 px', () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('WhatsApp sayfası: ortak numara, dükkan kodu, müşteri bağlantısı, QR indirme ve masa kartı', async ({ page }) => {
    await loginPanel(page, DEMO.owner);
    await page.goto('/panel/ayarlar/whatsapp');
    await expect(page.getByText('Siparişleriniz ortak Siparişin Önünde numarasından gelir.')).toBeVisible();
    await expect(page.getByText(`#${DEMO.waCode}`, { exact: true }).first()).toBeVisible();
    const link = await page.getByRole('textbox', { name: 'Müşteri bağlantısı' }).inputValue();
    expect(link).toMatch(new RegExp(`^https://wa\\.me/${DEMO.waDisplayPhone.replace('+', '')}\\?text=`));
    expect(new URL(link).searchParams.get('text')).toBe(`Merhaba, ${DEMO.tenantName} için sipariş vermek istiyorum. #${DEMO.waCode}`);
    await expect(page.getByRole('button', { name: 'Bağlantıyı kopyala' })).toBeVisible();

    // QR indirme (oturum çereziyle, aynı köken)
    const png = page.getByRole('link', { name: 'PNG indir' });
    await expect(png).toHaveAttribute('href', '/api/v1/panel/whatsapp/qr?format=png');
    const res = await page.request.get('/api/v1/panel/whatsapp/qr?format=png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['content-disposition']).toContain(`whatsapp-qr-${DEMO.waCode.toLowerCase()}.png`);

    // Masa kartı: dükkan adı, "Sipariş vermek için okut", kod
    const card = page.locator('#print-table-card');
    await expect(card).toContainText(DEMO.tenantName);
    await expect(card).toContainText('Sipariş vermek için okut');
    await expect(card).toContainText(`Dükkan kodu: #${DEMO.waCode}`);
    await expect(page.getByRole('button', { name: /^Masa kartını yazdır/ })).toBeVisible();
    // Kendi numara ikincil bölüm olarak durur
    await expect(page.getByRole('heading', { name: 'Kendi numaranızı bağlayın' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'panel WhatsApp (ortak numara)');
  });
});
