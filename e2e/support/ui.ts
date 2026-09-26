// Arayüz yardımcıları: panel girişi, vardiya kartı, WhatsApp simülatörü, sepet, yatay taşma denetimi.
// Seçiciler rol + erişilebilir ad üzerinden (metinler 14 §9 / 03 §9 ile aynı).

import { expect, type Locator, type Page } from '@playwright/test';
import { DEMO, SHARED_NUMBER_LABEL } from './env';

/** Tam etiket eşleşmesi; zorunlu alanlardaki "*" işaretini (aria-hidden) yok sayar. */
export function labelRe(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`);
}

/** /panel/giris üzerinden giriş; hedef sayfaya (varsayılan /panel) inilmesini bekler. */
export async function loginPanel(page: Page, user: { email: string; password: string } = DEMO.owner): Promise<void> {
  await page.goto('/panel/giris');
  await page.getByLabel('E-posta ya da telefon').fill(user.email);
  await page.getByLabel(labelRe('Parola')).fill(user.password);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).not.toHaveURL(/\/panel\/giris/);
}

/** Canlı ekrandaki "Vardiyayı başlat" kartını ses açmadan geçer (başsız tarayıcıda ses kilidi yok). */
export async function skipShiftStart(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: 'Sesi açmadan devam et' });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.getByRole('heading', { name: 'Canlı siparişler', level: 1 })).toBeVisible();
}

/** Canlı ekrandaki sipariş kartı: <article aria-label="Sipariş 1007">. */
export function orderCard(page: Page, number: number | string): Locator {
  return page.getByRole('article', { name: `Sipariş ${number}`, exact: true });
}

/**
 * /dev/whatsapp simülatöründe müşteri kimliğini ayarlar. Numara: ortak numara (00 §12a madde 8; demo işletmeler
 * platformun tek numarasını kullanır). Dükkan QR'ı `scanShopQr` ile okutulur.
 */
export async function openSimulator(page: Page, customer: { phone: string; name: string }): Promise<void> {
  await page.goto('/dev/whatsapp');
  await expect(page.getByRole('heading', { name: 'WhatsApp simülatörü' })).toBeVisible();
  const number = page.getByLabel('WhatsApp numarası');
  await expect(number.locator('option', { hasText: SHARED_NUMBER_LABEL })).toHaveCount(1);
  await number.selectOption({ label: SHARED_NUMBER_LABEL });
  await page.getByLabel('Müşteri telefonu').fill(customer.phone);
  await page.getByLabel('Profil adı').fill(customer.name);
}

/** Simülatörde dükkanın QR'ını okutur: QR'daki ön-dolu mesaj ("… için sipariş vermek istiyorum. #KOD") ortak numaraya gider. */
export async function scanShopQr(page: Page, code: string): Promise<void> {
  const sent = page.getByText(new RegExp(`için sipariş vermek istiyorum\\. #${code}$`));
  const before = await sent.count();
  await page.getByRole('button', { name: `#${code}`, exact: true }).click();
  await expect.poll(() => sent.count(), { message: `#${code} mesajı sohbete düşmeli` }).toBeGreaterThan(before);
}

/** Simülatörde müşteri olarak yazar. */
export async function simulatorSend(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Müşteri mesajı' });
  await box.fill(text);
  await page.getByRole('button', { name: 'Gönder', exact: true }).click();
  await expect(box).toHaveValue('');
}

/** Vitrinden sepete gidip "Siparişi tamamla" ile checkout'a geçer. */
export async function goToCheckout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Sepeti gör/ }).click();
  const cart = page.getByRole('dialog', { name: 'Sepetiniz' });
  await expect(cart).toBeVisible();
  await cart.getByRole('link', { name: 'Siparişi tamamla' }).click();
  await expect(page).toHaveURL(/\/siparis$/);
  await expect(page.getByRole('heading', { name: 'Siparişi tamamla', level: 1 })).toBeVisible();
}

/** Sayfada yatay kaydırma yok (360 px kuralı, 12 §8). Taşan öğeleri hata mesajında listeler. */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const offenders: string[] = [];
    if (doc.scrollWidth > width) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > width + 1) {
          const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : '';
          offenders.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} (sağ ${Math.round(r.right)} px)`);
          if (offenders.length >= 5) break;
        }
      }
    }
    return { scrollWidth: doc.scrollWidth, width, offenders };
  });
  expect(result.scrollWidth, `${label}: yatay taşma (${result.width} px) — ${result.offenders.join(', ')}`).toBeLessThanOrEqual(result.width);
}
