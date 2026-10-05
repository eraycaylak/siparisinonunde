/** @vitest-environment jsdom */

// Telefon siparişi · müşteri arama kutusunun DAVRANIŞI (04 §4.13).
//
// NE SINANIR (Eray'ın isteğinin birebir karşılığı):
//   1. İLK karakterde istek atılır — telefonda ilk rakam ("0" dahil), adda ilk harf. En az karakter kapısı YOK.
//   2. TUŞ BAŞINA istek: a-h-m yazarken üç sonuç gelir, arada bekleme yok.
//   3. YARIŞ KOŞULU: geciken eski yanıt, yeni sonucu EZMEZ.
//   4. TİTREME YOK: yeni sorgu uçarken önceki liste ekranda kalır, "sonuç yok" yalnız arama bitince yazılır.
//   5. KLAVYE: ↑/↓ etkin satırı değiştirir (odak alanda kalır), Enter seçer, Esc kapatır.
//   5b. ODAK: fareyle seçim odağı alandan çıkarmaz; öteki alana geçmek listeyi kapatır (açık kalsa
//       klavyeyle ulaşılamazdı, çünkü tuş işleyicisi yalnız aranan alandadır).
//   6. Seçimde ayrıntı ucu çağrılır ve form doldurulur (bugünkü otomatik doldurma davranışı).
//
// NASIL: `@testing-library/react` depoda yok; jsdom'a gerçek istemci olarak basan kendi yardımcımız kullanılır
// (`apps/web/test/a11y.tsx` → `renderForAudit`). Yazı alanına yazmak için DOM'un KENDİ `value` kurucusu
// çağrılır: React kontrollü girdinin `value` özelliğini kendi kurucusuyla değiştirir ve doğrudan atama
// React'in değer izleyicisini güncelleyip `change` olayını yutar.

import { act, useState } from 'react';
import { QueryClientProvider, defaultScheduler, notifyManager, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CustomerLookupItem } from '@siparis/core/orders/contracts';
import { createQueryClient } from '@/lib/api';
import { auditA11y, formatViolations, renderForAudit, type RenderedScreen } from '@/test/a11y';
import { CustomerPicker, emptyLookupText, lookupStatusText } from './customer-picker';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function listItem(n: number, name: string, over: Partial<CustomerLookupItem> = {}): CustomerLookupItem {
  return {
    id: ID(n),
    name,
    phoneMasked: '0*** *** 45 67',
    orderCount: 3,
    isBlocked: false,
    hasNotes: false,
    lastOrderAt: new Date('2026-10-01T10:00:00Z').toISOString(),
    addressCount: 1,
    ...over,
  };
}

function detailItem(n: number, name: string): CustomerLookupItem {
  return {
    ...listItem(n, name),
    phoneE164: '+905321234567',
    notes: null,
    addresses: [{ id: ID(90), label: 'Ev', neighborhood: 'Çarşı', addressLine: 'Atatürk Cd. No:5', directions: 'Market üstü' }],
    lastOrders: [
      {
        id: ID(91),
        number: 142,
        placedAt: new Date('2026-10-01T10:00:00Z').toISOString(),
        totalKurus: 24000,
        items: [{ productId: ID(92), name: 'Kıymalı pide', quantity: 2, note: null, optionIds: [] }],
      },
    ],
  };
}

// --- ağ: her istek elle çözülür, böylece yarış ve yükleniyor durumları kurulabilir -------------------------

interface Pending {
  url: string;
  resolve: (body: unknown) => void;
}

let pending: Pending[] = [];
let realFetch: typeof globalThis.fetch;

const jsonOk = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    headers: { get: (key: string) => (key.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const urls = () => (globalThis.fetch as unknown as Mock).mock.calls.map((call) => String(call[0]));
const listUrls = () => urls().filter((u) => u.includes('manual/customers?'));

/**
 * Ağ yanıtını ekrana işler. İKİ tur gerekir ve bu bir incelik değil ZORUNLULUKTUR: React Query'nin
 * bildirim zamanlayıcısı varsayılan olarak `setTimeout(cb, 0)`dır (`defaultScheduler`), yani yanıt
 * mikro-görevlerde çözülse bile React'e haber ayrı bir makro-görevde gider. Tek tur beklemek testi
 * zamanlamaya bağımlı (flaky) yapar. `beforeEach` ayrıca zamanlayıcıyı `queueMicrotask`a çeker
 * (kütüphanenin belgelediği `notifyManager.setScheduler` kancası); iki tur onun da üstüne emniyettir.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 2; turn++) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function settle(match: string, body: unknown): Promise<void> {
  const index = pending.findIndex((p) => p.url.includes(match));
  if (index < 0) throw new Error(`Bekleyen istek yok: ${match} · bekleyenler: ${pending.map((p) => p.url).join(' | ')}`);
  const [entry] = pending.splice(index, 1);
  entry!.resolve(body);
  await flush();
}

// --- yazma ve tuş yardımcıları ----------------------------------------------------------------------------

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function typeInto(input: HTMLInputElement, value: string): void {
  act(() => {
    nativeValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/**
 * Odaklama. React'in `onFocus`u `focusin` olayına bağlıdır; jsdom `focus()` çağrısında bunu üretir ama olayı
 * ayrıca elle göndermek testi jsdom sürümünden bağımsız kılar (işleyici idempotenttir: iki kez çalışması
 * sonucu değiştirmez).
 */
function focusOn(element: HTMLElement): void {
  act(() => {
    element.focus();
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
}

// --- iskele ------------------------------------------------------------------------------------------------

const filled: CustomerLookupItem[] = [];

function Harness() {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <CustomerPicker
      phone={phone}
      name={name}
      onPhoneChange={(v) => {
        setPhone(v);
        setSelectedId(null);
      }}
      onNameChange={(v) => {
        setName(v);
        setSelectedId(null);
      }}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onFill={(item) => {
        filled.push(item);
        if (item.name) setName(item.name);
        if (item.phoneE164) setPhone(`0${item.phoneE164.slice(3)}`);
      }}
      onAddSame={() => undefined}
    />
  );
}

let screen: RenderedScreen;
let client: QueryClient;

function mount(): void {
  client = createQueryClient();
  screen = renderForAudit(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const phoneInput = () => screen.container.querySelector<HTMLInputElement>('input[type="tel"]')!;
const nameInput = () => screen.container.querySelector<HTMLInputElement>('input[type="text"]')!;
const listbox = () => screen.container.querySelector('[role="listbox"]');
const options = () => Array.from(screen.container.querySelectorAll('[role="option"]'));
const optionNames = () => options().map((o) => o.textContent ?? '');
const body = () => screen.container.textContent ?? '';

beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  pending = [];
  filled.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(
    (input: unknown) =>
      new Promise<Response>((resolve) => {
        pending.push({ url: String(input), resolve: (data) => resolve(jsonOk(data)) });
      }),
  );
  mount();
});

afterEach(() => {
  notifyManager.setScheduler(defaultScheduler);
  screen.unmount();
  client.clear();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('ilk karakterden itibaren arama', () => {
  it('telefona tek rakam ("0") yazılması isteği hemen atar — en az karakter kapısı yok', () => {
    typeInto(phoneInput(), '0');
    expect(listUrls()).toHaveLength(1);
    expect(listUrls()[0]).toContain('/api/v1/panel/orders/manual/customers?q=0');
    // Liste gövdesi istenir: adres + son sipariş yükü ayrıntı ucundadır.
    expect(listUrls()[0]).toContain('detail=0');
  });

  it('ada tek harf yazılması isteği atar ve terim Türkçe katlanmış gider', () => {
    typeInto(nameInput(), 'A');
    expect(listUrls()).toHaveLength(1);
    expect(listUrls()[0]).toContain('q=a&');
  });

  it('boş alan istek atmaz', () => {
    typeInto(nameInput(), ' ');
    expect(listUrls()).toHaveLength(0);
  });

  it('tuş başına sonuç: a-h-m yazarken üç istek gider (bekleme yok)', () => {
    typeInto(nameInput(), 'a');
    typeInto(nameInput(), 'ah');
    typeInto(nameInput(), 'ahm');
    expect(listUrls()).toHaveLength(3);
    expect(listUrls().map((u) => new URL(u, 'http://x').searchParams.get('q'))).toEqual(['a', 'ah', 'ahm']);
  });

  it('aynı terim yeniden yazılırsa önbellekten gelir, yeni istek atılmaz', async () => {
    typeInto(nameInput(), 'ah');
    await settle('q=ah&', { items: [listItem(1, 'Ahmet')], mode: 'name' });
    typeInto(nameInput(), 'ahm');
    await settle('q=ahm&', { items: [listItem(2, 'Ahmet Can')], mode: 'name' });
    const before = listUrls().length;

    typeInto(nameInput(), 'ah'); // geri silindi
    expect(listUrls()).toHaveLength(before);
    expect(optionNames().join(' ')).toContain('Ahmet');
  });
});

describe('hız ve kararlılık', () => {
  it('geciken ESKİ yanıt yeni sonucu ezmez', async () => {
    typeInto(nameInput(), 'a');
    typeInto(nameInput(), 'ahm');

    await settle('q=ahm&', { items: [listItem(2, 'Ahmet Can')], mode: 'name' });
    expect(optionNames().join(' ')).toContain('Ahmet Can');

    // "a" yanıtı ancak şimdi dönüyor (ağ gecikmesi) — ekranda görünen liste DEĞİŞMEMELİ.
    await settle('q=a&', { items: [listItem(3, 'Ayşe'), listItem(4, 'Ali')], mode: 'name' });
    expect(optionNames()).toHaveLength(1);
    expect(optionNames().join(' ')).toContain('Ahmet Can');
    expect(body()).not.toContain('Ayşe');
  });

  it('yeni sorgu uçarken önceki liste ekranda kalır (titreme yok)', async () => {
    typeInto(nameInput(), 'ah');
    await settle('q=ah&', { items: [listItem(1, 'Ahmet')], mode: 'name' });
    expect(optionNames()).toHaveLength(1);

    typeInto(nameInput(), 'ahm'); // sorgu uçuyor
    expect(optionNames()).toHaveLength(1);
    expect(optionNames().join(' ')).toContain('Ahmet');
    expect(listbox()!.getAttribute('aria-busy')).toBe('true');
  });

  it('alan değişince önceki alanın listesi gösterilmez', async () => {
    typeInto(phoneInput(), '0532');
    await settle('q=0532&', { items: [listItem(1, 'Ahmet')], mode: 'phone' });
    expect(optionNames()).toHaveLength(1);

    typeInto(nameInput(), 'z'); // ad dalına geçildi, sorgu henüz uçuyor

    // Telefon sonuçları "Eşleşen müşteriler" başlığı altında gösterilmez (ilgisiz liste = yanlış satır seçimi).
    expect(optionNames()).toHaveLength(0);
    expect(body()).not.toContain('Ahmet');
    // Yükleniyorken "sonuç yok" da yazılmaz.
    expect(body()).not.toContain('Eşleşen müşteri yok');
  });

  it('"sonuç yok" yalnız arama gerçekten bitince görünür', async () => {
    typeInto(nameInput(), 'zzz');
    expect(body()).not.toContain('Eşleşen müşteri yok');

    await settle('q=zzz&', { items: [], mode: 'name' });
    expect(body()).toContain('Eşleşen müşteri yok');
  });

  it('süzgeçsiz dalda liste "en son sipariş verenler" olarak etiketlenir', async () => {
    typeInto(phoneInput(), '0');
    await settle('q=0&', { items: [listItem(1, 'Ahmet')], mode: 'latest' });
    expect(listbox()!.getAttribute('aria-label')).toBe('En son sipariş verenler');
  });
});

describe('klavye gezinmesi', () => {
  it('↓/↑ etkin satırı değiştirir, odak alanda kalır', async () => {
    typeInto(nameInput(), 'a');
    await settle('q=a&', { items: [listItem(1, 'Ahmet'), listItem(2, 'Ayşe')], mode: 'name' });
    const input = nameInput();

    press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');

    press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1]!.id);

    press(input, 'ArrowUp');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);

    // Son satırda ↓ başa döner.
    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
  });

  it('Enter seçer: ayrıntı ucu çağrılır, form doldurulur, liste kapanır', async () => {
    typeInto(nameInput(), 'a');
    await settle('q=a&', { items: [listItem(1, 'Ahmet'), listItem(2, 'Ayşe')], mode: 'name' });
    press(nameInput(), 'ArrowDown');
    press(nameInput(), 'Enter');
    await flush();

    expect(urls().some((u) => u.includes(`manual/customers/${ID(1)}`))).toBe(true);
    expect(listbox()).toBeNull();

    await settle(`manual/customers/${ID(1)}`, { item: detailItem(1, 'Ahmet Yılmaz') });
    expect(filled).toHaveLength(1);
    expect(filled[0]!.name).toBe('Ahmet Yılmaz');
    // Otomatik doldurma: telefon ve ad alanları ayrıntıdan yazıldı.
    expect(nameInput().value).toBe('Ahmet Yılmaz');
    expect(phoneInput().value).toBe('05321234567');
    // Ayrıntı kartı adresi ve "Aynısını ekle"yi gösterir.
    expect(body()).toContain('Atatürk Cd. No:5');
    expect(body()).toContain('Aynısını ekle');
  });

  it('alan programla dolduğunda yeni arama başlamaz', async () => {
    typeInto(nameInput(), 'a');
    await settle('q=a&', { items: [listItem(1, 'Ahmet')], mode: 'name' });
    press(nameInput(), 'ArrowDown');
    press(nameInput(), 'Enter');
    await flush();
    const before = listUrls().length;

    await settle(`manual/customers/${ID(1)}`, { item: detailItem(1, 'Ahmet Yılmaz') });
    expect(listUrls()).toHaveLength(before);
  });

  it('Esc listeyi kapatır, yazmaya devam etmek yeniden açar', async () => {
    typeInto(nameInput(), 'a');
    await settle('q=a&', { items: [listItem(1, 'Ahmet')], mode: 'name' });
    expect(listbox()).not.toBeNull();

    press(nameInput(), 'Escape');
    expect(listbox()).toBeNull();

    typeInto(nameInput(), 'ah');
    expect(listbox()).not.toBeNull();
  });

  it('öteki alana odaklanmak listeyi kapatır (oklar ve Esc yalnız aranan alandadır)', async () => {
    typeInto(phoneInput(), '0532');
    await settle('q=0532&', { items: [listItem(1, 'Ahmet')], mode: 'phone' });
    press(phoneInput(), 'ArrowDown');
    expect(phoneInput().getAttribute('aria-activedescendant')).toBe(options()[0]!.id);

    focusOn(nameInput());

    // Açık kalsaydı: odak Ad alanında olduğu için ne ↑/↓ ile gezilebilir ne Esc ile kapatılabilirdi.
    expect(listbox()).toBeNull();
    // Etkin satır da sıfırlanmalı; yoksa `aria-activedescendant` DOM'dan kalkmış bir id'yi gösterirdi.
    expect(phoneInput().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('fareyle seçimde odak yazı alanından çıkmaz', async () => {
    typeInto(nameInput(), 'a');
    await settle('q=a&', { items: [listItem(1, 'Ahmet')], mode: 'name' });

    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      options()[0]!.dispatchEvent(mouseDown);
    });

    // `preventDefault` olmazsa odaklanamayan satıra basmak odağı `body`ye düşürür ve sonraki Tab belgenin
    // başından başlar. jsdom düzen/odak davranışını taklit etmediği için olayın iptali sınanır.
    expect(mouseDown.defaultPrevented).toBe(true);
  });

  it('tıklama da seçer', async () => {
    typeInto(phoneInput(), '0532');
    await settle('q=0532&', { items: [listItem(1, 'Ahmet')], mode: 'phone' });
    act(() => {
      (options()[0] as HTMLElement).click();
    });
    await flush();
    expect(urls().some((u) => u.includes(`manual/customers/${ID(1)}`))).toBe(true);
  });
});

describe('erişilebilirlik', () => {
  it('birleşik kutu yalnız yazılan alanda ve açılır liste ile bağlı', async () => {
    typeInto(nameInput(), 'a');
    await settle('q=a&', { items: [listItem(1, 'Ahmet')], mode: 'name' });

    expect(nameInput().getAttribute('role')).toBe('combobox');
    expect(nameInput().getAttribute('aria-expanded')).toBe('true');
    expect(nameInput().getAttribute('aria-controls')).toBe(listbox()!.id);
    // Telefon alanı o an aranmıyor: ikinci bir birleşik kutu YOK.
    expect(phoneInput().getAttribute('role')).toBeNull();
  });

  it('axe: WCAG 2.2 AA ihlali yok', async () => {
    typeInto(nameInput(), 'a');
    await settle('q=a&', { items: [listItem(1, 'Ahmet', { isBlocked: true, hasNotes: true }), listItem(2, 'Ayşe')], mode: 'name' });
    press(nameInput(), 'ArrowDown');

    const violations = await auditA11y(screen.container);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});

describe('metinler', () => {
  it('boş sonuç metni dalı ayırır', () => {
    expect(emptyLookupText('name')).toContain('Eşleşen müşteri yok');
    expect(emptyLookupText('latest')).toContain('Henüz siparişi olan müşteri yok');
  });

  it('canlı bölge metni yalnız kesinleşmiş sonucu duyurur', () => {
    expect(lookupStatusText('name', 3, false)).toBe('');
    expect(lookupStatusText('name', 3, true)).toContain('3 müşteri bulundu');
    expect(lookupStatusText('latest', 2, true)).toContain('En son sipariş veren 2 müşteri');
    expect(lookupStatusText('name', 0, true)).toContain('Eşleşen müşteri yok');
  });
});
