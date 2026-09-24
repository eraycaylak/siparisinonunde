// Senaryo 5 — Kurye akışı (04 §9, 00 §4): panelde siparişe kurye ata → kurye giriş linki (tek kullanımlık) →
// /kurye'de "Yola çıktım" ve "Teslim ettim" → müşteri takip sayfasında "Teslim edildi" + değerlendirme.

import { devices } from '@playwright/test';
import { expect, test } from './support/test';
import {
  acceptOrder,
  apiLogin,
  createWebOrder,
  demoWaAccount,
  flushJobs,
  newApiContext,
  trackingPath,
  trackOrder,
  uniqueName,
  uniquePhone,
  verifyByWhatsappCode,
  waThread,
} from './support/api';
import { DEMO } from './support/env';
import { loginPanel, orderCard, skipShiftStart } from './support/ui';

test('Kurye atama, kurye linkiyle giriş, yola çıkış, teslim ve müşteri değerlendirmesi', async ({ page, request, openContext }) => {
  const customer = { phone: uniquePhone(), name: uniqueName('Elif') };

  // Kurulum: doğrulanmış paket servis siparişi, işletme 30 dk ile onaylamış
  const order = await createWebOrder(request, {
    customerName: customer.name,
    customerPhone: customer.phone,
    products: ['Kıymalı Pide'],
    fulfillment: 'delivery',
    neighborhood: 'Medrese',
  });
  await verifyByWhatsappCode(request, order, customer);
  const owner = await newApiContext();
  await apiLogin(owner, DEMO.owner.email, DEMO.owner.password);
  await acceptOrder(owner, order.orderId, 30);
  await owner.dispose();

  // 1) Panel: sipariş ayrıntısı → "Kurye ata" → Burak Kurye → "Yalnız ata"
  await loginPanel(page, DEMO.owner);
  await skipShiftStart(page);
  const card = orderCard(page, order.number);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Diğer işlemler ve ayrıntı' }).click();
  const drawer = page.getByRole('dialog', { name: `#${order.number}`, exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Kurye ata' }).click();
  const courierSheet = page.getByRole('dialog', { name: `#${order.number} · Kurye` });
  await expect(courierSheet).toBeVisible();
  // Seed'de tek kurye var (Burak Kurye)
  await expect(courierSheet).toContainText(DEMO.courier.name);
  await courierSheet.getByRole('button', { name: 'Yalnız ata' }).click();
  await expect(courierSheet).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(card).toContainText(`Kurye: ${DEMO.courier.name}`);

  // 2) Kuryeler sayfası: tek kullanımlık giriş bağlantısı
  await page.goto('/panel/kuryeler');
  const courierItem = page.getByRole('listitem').filter({ hasText: DEMO.courier.name });
  await expect(courierItem).toContainText(`#${order.number}`);
  await courierItem.getByRole('button', { name: 'Giriş bağlantısı oluştur' }).click();
  const linkDialog = page.getByRole('dialog', { name: `${DEMO.courier.name} için giriş bağlantısı` });
  const linkText = linkDialog.getByTestId('courier-link-url');
  await expect(linkText).toHaveText(/\/kurye\/giris\?t=/);
  const courierUrl = (await linkText.textContent())!.trim();

  // 3) Kurye telefonu: link → /kurye → "Yola çıktım" → "Teslim ettim"
  const courierContext = await openContext({ ...devices['Pixel 7'] });
  const courier = await courierContext.newPage();
  await courier.goto(courierUrl);
  await expect(courier).toHaveURL(/\/kurye$/);
  const job = courier.getByRole('article').filter({ hasText: `#${order.number}` });
  await expect(job).toContainText('Medrese');
  await job.getByRole('button', { name: 'Yola çıktım' }).click();
  await expect(job.getByRole('button', { name: 'Teslim ettim' })).toBeVisible();
  await expect.poll(async () => (await trackOrder(request, order)).order.status).toBe('on_the_way');

  await job.getByRole('button', { name: 'Teslim ettim' }).click();
  const deliver = courier.getByRole('dialog', { name: `#${order.number} teslim` });
  await expect(deliver).toBeVisible();
  await expect(deliver.getByRole('radio', { name: /nakit alındı/ })).toBeChecked();
  await deliver.getByRole('button', { name: 'Teslim ettim' }).click();
  await expect(job).toHaveCount(0);
  await courierContext.close();

  // Müşterinin WhatsApp'ı: alındı → onaylandı → yolda → teslim edildi (+ değerlendirme butonları);
  // sipariş başına en fazla 4 durum mesajı (00 §6.5)
  const acc = await demoWaAccount(request);
  await expect
    .poll(
      async () => {
        await flushJobs(request);
        const msgs = await waThread(request, acc.id, customer.phone);
        return msgs.filter((m) => m.direction === 'out' && m.orderId === order.orderId).map((m) => m.code);
      },
      { message: 'durum mesajları bekleniyor', timeout: 45_000 },
    )
    .toEqual(['M05', 'M06a', 'M09', 'M10']);
  const delivered = (await waThread(request, acc.id, customer.phone)).find((m) => m.code === 'M10');
  expect(delivered?.buttons?.map((b) => b.id)).toEqual(expect.arrayContaining([`review:${order.orderId}:good`]));

  // 4) Müşteri takip sayfası: teslim + 3 butonlu değerlendirme
  const customerContext = await openContext({ ...devices['Pixel 7'] });
  const track = await customerContext.newPage();
  await track.goto(trackingPath(order));
  await expect(track.getByRole('heading', { level: 1 })).toContainText('Teslim edildi');
  const review = track.getByRole('region', { name: 'Siparişinizi değerlendirin' });
  await review.getByRole('radio', { name: 'Harika' }).click();
  await review.getByLabel('Kısa yorum (isteğe bağlı)').fill('Sıcacık geldi, teşekkürler.');
  await review.getByRole('button', { name: 'Gönder' }).click();
  await expect(track.getByText('Teşekkür ederiz')).toBeVisible();
  await expect(track.getByText(/Değerlendirmeniz: Harika/)).toBeVisible();
  await customerContext.close();
});
