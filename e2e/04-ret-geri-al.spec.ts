// Senaryo 4 — Ret + geri al (00 §7 "Ret geri alma", 04 §4.7): panelde ret → 30 sn "bekleyen ret" →
// "Geri al" (sipariş yeniden onaylanabilir) → yeniden ret → 30 sn sonra kesinleşir (`rejected`) →
// müşteriye WhatsApp'tan ret mesajı (M11) gider ve takip sayfası "Sipariş alınamadı" gösterir.

import { expect, test } from './support/test';
import { createWebOrder, demoWaAccount, flushJobs, trackingPath, trackOrder, uniqueName, uniquePhone, verifyByWhatsappCode, waThread } from './support/api';
import { DEMO } from './support/env';
import { loginPanel, orderCard, skipShiftStart } from './support/ui';

test('Ret, geri al, yeniden ret ve müşteriye ret mesajı', async ({ page, request, openContext }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Hakan') };

  // Kurulum: WhatsApp koduyla doğrulanmış (Akış B) yeni sipariş
  const order = await createWebOrder(request, { customerName: customer.name, customerPhone: customer.phone, products: ['Kaşarlı Pide'], fulfillment: 'pickup' });
  await verifyByWhatsappCode(request, order, customer);

  await loginPanel(page, DEMO.owner);
  await skipShiftStart(page);
  const card = orderCard(page, order.number);
  await expect(card).toBeVisible();

  const reject = async () => {
    await card.getByRole('button', { name: 'Reddet', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: `#${order.number} siparişi reddet` });
    await expect(sheet).toBeVisible();
    await sheet.getByText('Çok yoğunuz', { exact: true }).click();
    await expect(sheet.getByText(/yoğunluk nedeniyle/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Reddet', exact: true }).click();
    await expect(sheet).toBeHidden();
  };

  // 1) Ret → bekleyen ret: kartta "Geri al · N sn", onay butonu yok
  await reject();
  const undo = card.getByRole('button', { name: /^Geri al · \d+ sn$/ });
  await expect(undo).toBeVisible();
  await expect(card.getByRole('button', { name: /^Onayla/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Geri alınabilir işlemler' })).toContainText(`#${order.number} reddediliyor`);

  // 2) Geri al → sipariş yeniden "Yeni", onaylanabilir
  await undo.click();
  await expect(card.getByRole('button', { name: /^Onayla · \d+ dk$/ })).toBeVisible();
  await expect(undo).toHaveCount(0);
  expect((await trackOrder(request, order)).order.status).toBe('new');

  // 3) Yeniden ret → 30 sn sonra kesinleşir; kart canlı ekrandan kalkar
  await reject();
  await expect(card.getByRole('button', { name: /^Geri al/ })).toBeVisible();
  await expect
    .poll(
      async () => {
        await flushJobs(request);
        return (await trackOrder(request, order)).order.status;
      },
      { message: 'ret 30 sn sonra kesinleşmeli', timeout: 75_000, intervals: [2_000] },
    )
    .toBe('rejected');
  await expect(card).toBeHidden({ timeout: 30_000 });

  // 4) Müşteriye ret mesajı (M11) WhatsApp'tan gider
  const acc = await demoWaAccount(request);
  await expect
    .poll(
      async () => {
        await flushJobs(request);
        const messages = await waThread(request, acc.id, customer.phone);
        return messages.some((m) => m.direction === 'out' && /numaralı siparişinizi şu an alamıyoruz/.test(m.body ?? ''));
      },
      { message: 'ret mesajı bekleniyor', timeout: 30_000 },
    )
    .toBe(true);

  // Takip sayfası: "Sipariş alınamadı"
  const customerPage = await (await openContext()).newPage();
  await customerPage.goto(trackingPath(order));
  await expect(customerPage.getByRole('heading', { level: 1 })).toContainText('Sipariş alınamadı');
  await customerPage.close();
});
