/** @vitest-environment jsdom */

// Checkout ekranının erişilebilirlik denetimi (denetim 2026-10-04 madde 4.6 · EK A madde 26).
//
// NEDEN BU EKRAN: denetim 4.6 "en az bir kritik ekran" diyor. Checkout, sözleşmenin kurulduğu ve ödeme
// yükümlülüğünün doğduğu tek ekrandır (03 §4.4): burada etiketsiz bir form alanı ya da erişilebilir adı olmayan
// bir onay kutusu, ekran okuyucu kullanan müşterinin siparişi tamamlayamaması demektir — yani ciro kaybı ve
// 6563/TKHK tarafında "ön bilgilendirmeyi okudum" onayının geçerliliği sorunu.
//
// NE DENETLENİR: axe-core'un WCAG 2.2 AA kural kümesinden jsdom'da anlamlı olanlar — form etiketleri,
// erişilebilir adlar, ARIA geçerliliği, başlık düzeni, çift `id`, buton/bağlantı ayrımı.
// NE DENETLENMEZ: renk kontrastı ve dokunma hedefi (jsdom düzen hesaplamaz; ayrı testleri var —
// `components/panel/panel-contrast.test.ts` ve Tailwind `min-h-hit`). Gerekçe: `apps/web/test/a11y.tsx`.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import type { CartLine } from '@/lib/cart';
import { auditA11y, formatViolations, renderForAudit } from '@/test/a11y';

// Next'in yönlendiricisi ve <Link>'i app router bağlamı ister; testte yok. Yerine aynı DOM'u üreten en küçük
// karşılıklar konur — erişilebilirlik açısından <Link> zaten <a href> basar.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/s/test-isletme/odeme',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string | { pathname?: string }; children?: unknown }) => {
    const target = typeof href === 'string' ? href : (href?.pathname ?? '#');
    return <a href={target} {...(rest as any)}>{children as any}</a>;
  },
}));

import { CheckoutPage } from './checkout-page';

const SLUG = 'test-isletme';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRODUCT = ID(1);
const ZONE = ID(2);
const CATEGORY = ID(3);

function storeFixture(): StorefrontView {
  return {
    tenant: { name: 'Bozok Pide', slug: SLUG, brandColor: null, logoUrl: null, coverUrl: null, phone: '+905551112233' },
    branch: {
      id: ID(9),
      name: 'Merkez',
      address: 'Çarşı Mah. 1. Sk. No:1',
      orderingState: 'open',
      nextOpenAt: null,
      phone: '+905551112233',
      acceptsDelivery: true,
      acceptsPickup: true,
      // Üç ödeme yöntemi: nakit (para üstü yuvarlama çipleri), kart (POS notu), yemek kartı (marka seçici).
      // Böylece koşullu alanların hepsi DOM'a girer ve denetim gerçek ekranı görür.
      paymentMethods: ['cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery'],
      mealCardBrands: ['multinet', 'sodexo'],
      prepMinutes: 20,
      busyExtraMinutes: 0,
    },
    orderingEnabled: true,
    live: true,
    zones: [
      { id: ZONE, name: 'Merkez', kind: 'neighborhoods', neighborhoods: ['Çarşı'], feeKurus: 2500, minOrderKurus: 15000, etaMinutes: 15 },
    ],
    categories: [
      {
        id: CATEGORY,
        name: 'Pideler',
        products: [{ id: PRODUCT, name: 'Kıymalı pide', description: null, priceKurus: 20000, imageUrl: null, soldOut: false, optionGroups: [] }],
      },
    ],
    legal: { legalName: 'Bozok Gıda Ltd. Şti.', taxNo: '1234567890', taxOffice: 'Yozgat', address: 'Çarşı Mah.', phone: '+903541112233', email: 'info@example.com' },
  };
}

function seedCart(): void {
  const line: CartLine = {
    key: `${PRODUCT}||`,
    productId: PRODUCT,
    quantity: 2,
    optionIds: [],
    name: 'Kıymalı pide',
    unitPriceKurus: 20000,
    optionLabels: [],
  };
  window.localStorage.setItem(`siparisinonunde:cart:${SLUG}`, JSON.stringify({ lines: [line], updatedAt: Date.now() }));
}

/** Sunucu yanıtları: oturum (Akış B, bağlantı yok) + tutar. Gerçek ağ yoktur. */
function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const json = url.includes('/session')
        ? { customer: null, lastOrder: null, linkStatus: 'none', lastOrderSource: null }
        : {
            lines: [
              {
                productId: PRODUCT,
                name: 'Kıymalı pide',
                quantity: 2,
                unitPriceKurus: 20000,
                optionsUnitKurus: 0,
                lineTotalKurus: 40000,
                options: [],
                note: null,
              },
            ],
            subtotalKurus: 40000,
            deliveryFeeKurus: 2500,
            totalKurus: 42500,
            minOrderKurus: 15000,
            meetsMinimum: true,
            zone: { id: ZONE, name: 'Merkez', feeKurus: 2500, minOrderKurus: 15000, etaMinutes: 15 },
            problems: [],
          };
      return Promise.resolve(new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }),
  );
}

/** Kancaları (useEffect) ve 400 ms'lik tutar gecikmesini boşaltır. */
async function settle(ms = 500): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  });
}

describe('checkout erişilebilirliği', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('WCAG 2.2 AA kurallarını (jsdom kapsamında) ihlal etmez', async () => {
    seedCart();
    const screen = renderForAudit(<CheckoutPage slug={SLUG} store={storeFixture()} />);
    await settle();

    // Formun gerçekten çizildiğini doğrula: aksi hâlde "sepetiniz boş" ekranını denetleyip boşuna yeşil yanardık.
    expect(screen.container.querySelector('h1')?.textContent).toContain('Siparişi tamamla');
    expect(screen.container.querySelectorAll('input, select, textarea').length).toBeGreaterThan(5);

    const violations = await auditA11y(screen.container);
    expect(violations, formatViolations(violations)).toEqual([]);
    screen.unmount();
  });

  // DENETİMİN KENDİSİ SÖKÜLMEMİŞ Mİ: yukarıdaki iki test "ihlal yok" diyor. Eğer axe yapılandırması bir gün
  // sessizce bozulursa (kural kümesi boşalır, jsdom ortamı düşer, auditA11y hep [] döner) o testler YİNE yeşil
  // yanar ve kimse farkına varmaz. Bu test bilinen bir ihlali (etiketsiz girdi) kurar ve YAKALANDIĞINI doğrular.
  it('yardımcı gerçekten ihlal yakalıyor (etiketsiz girdi)', async () => {
    const broken = document.createElement('div');
    broken.innerHTML = '<input type="text" />';
    document.body.appendChild(broken);

    const violations = await auditA11y(broken);
    expect(violations.map((v) => v.rule)).toContain('label');

    broken.remove();
  });

  it('boş sepet ekranı da erişilebilir (menüye dönüş bağlantısı adlandırılmış)', async () => {
    const screen = renderForAudit(<CheckoutPage slug={SLUG} store={storeFixture()} />);
    await settle(50);

    const violations = await auditA11y(screen.container);
    expect(violations, formatViolations(violations)).toEqual([]);
    screen.unmount();
  });
});
