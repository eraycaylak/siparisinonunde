/** @vitest-environment jsdom */

// Raporlar > "Verilerinizi indirin" bloğunun davranış ve erişilebilirlik testi (04 §11.6).
//
// NEDEN BU EKRAN DENETLENİYOR: blok kullanım koşullarındaki veri taşınabilirliği taahhüdünün tek arayüzü.
// Burada etiketsiz bir tarih alanı ya da yalnız renkle gösterilen bir hata, işletmenin kendi verisini
// indiremediği anlamına gelir. Ayrıca blok KİŞİSEL VERİ kapısı taşıyor (telefon/adres açık mı): kapının
// destek görünümünde kapalı kalması davranış testiyle çivilenir, yoksa sunucunun 403'ü kullanıcıya
// "bir şey ters gitti" olarak görünür.
//
// NE DENETLENMEZ: renk kontrastı ve dokunma hedefi (jsdom düzen hesaplamaz) — gerekçe apps/web/test/a11y.tsx.

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditA11y, formatViolations, renderForAudit } from '@/test/a11y';
import { DataExportSection } from './data-export-section';

// ── jsdom yardımcıları ────────────────────────────────────────────────────────────────────────────────────────

function q<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Öğe bulunamadı: ${selector}`);
  return el;
}

/** Metnine göre buton (ekranda görünen etiketle arama — kullanıcı da böyle buluyor). */
function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));
  if (!found) throw new Error(`Buton bulunamadı: ${text}`);
  return found;
}

/**
 * Denetlenen kontrolün değerini React'in gördüğü biçimde değiştirir. Doğrudan `el.value = x` yazmak yetmez:
 * React 19 kendi değer izleyicisini kullanır ve değişmediğini düşünüp olayı yutabilir. Yerel (native) ayarlayıcı
 * çağrılır, sonra `input` olayı yayılır.
 */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Formu gönderir ve indirme zincirinin (fetch → blob → kaydet) tamamlanmasını bekler. */
async function submitAndSettle(container: HTMLElement): Promise<void> {
  const form = q<HTMLFormElement>(container, 'form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

const DISPOSITION = 'attachment; filename="siparisler-bozok-2026-09-06_2026-10-05.csv"';

function okResponse(): Response {
  return new Response('siparis_no;durum\r\n', {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': DISPOSITION },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Downloaded {
  name: string;
}

interface DownloadChannel {
  /** Kaydedilen dosyalar (tarayıcıya verilen ad). */
  saved: Downloaded[];
  /** Serbest bırakılan blob adresleri. Tıklamayla AYNI anda dolmaz: bırakma zamanlayıcıya alınmıştır. */
  revoked: string[];
}

/**
 * `URL.createObjectURL` ve `<a>.click()` jsdom'da yok / gezinme denemesi üretir. İkisi de kapatılır ve
 * kaydedilen dosya adı yakalanır: "indirme gerçekten tetiklendi mi, hangi adla" testte görülebilsin.
 */
type ObjectUrlApi = { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void };

/** Kurulan geçici `URL` yöntemlerini testten sonra geri almak için. */
function restoreDownloadChannel(): void {
  const objectUrl = URL as unknown as ObjectUrlApi;
  delete objectUrl.createObjectURL;
  delete objectUrl.revokeObjectURL;
}

function stubDownloadChannel(): DownloadChannel {
  const saved: Downloaded[] = [];
  const revoked: string[] = [];
  const objectUrl = URL as unknown as ObjectUrlApi;
  objectUrl.createObjectURL = () => 'blob:test';
  objectUrl.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download });
  });
  return { saved, revoked };
}

function fetchCalls(): string[] {
  const mock = globalThis.fetch as unknown as { mock?: { calls: unknown[][] } };
  return (mock.mock?.calls ?? []).map((call) => String(call[0]));
}

// ── Testler ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('DataExportSection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(okResponse())));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreDownloadChannel();
    document.body.replaceChildren();
  });

  it('WCAG 2.2 AA kurallarını (jsdom kapsamında) ihlal etmez', async () => {
    const screen = renderForAudit(<DataExportSection />);

    // Bloğun gerçekten çizildiğini doğrula: boş ağacı denetleyip boşuna yeşil yanmayalım
    expect(screen.container.textContent).toContain('Verilerinizi indirin');
    expect(screen.container.querySelectorAll('input[type="date"]').length).toBe(2);
    expect(screen.container.querySelectorAll('input[type="radio"]').length).toBe(2);
    expect(screen.container.querySelectorAll('select').length).toBe(1);

    const violations = await auditA11y(screen.container);
    expect(violations, formatViolations(violations)).toEqual([]);
    screen.unmount();
  });

  it('hata gösterilirken de erişilebilir kalır (hata metni alana bağlı, canlı bölge var)', async () => {
    const screen = renderForAudit(<DataExportSection />);
    setValue(screen.container.querySelectorAll<HTMLInputElement>('input[type="date"]')[1]!, '2000-01-01');
    await submitAndSettle(screen.container);

    const violations = await auditA11y(screen.container);
    expect(violations, formatViolations(violations)).toEqual([]);
    screen.unmount();
  });

  it('destek görünümünde kişisel veri kutusu hiç çizilmez, gerekçe yazılır', () => {
    const screen = renderForAudit(<DataExportSection supportSession />);
    expect(screen.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.container.textContent).toContain('Destek görünümünde');
    screen.unmount();
  });

  it('normal oturumda kişisel veri kutusu çizilir ve önceden işaretli DEĞİLDİR', () => {
    const screen = renderForAudit(<DataExportSection />);
    const box = q<HTMLInputElement>(screen.container, 'input[type="checkbox"]');
    expect(box.checked).toBe(false);
    screen.unmount();
  });

  it('ters tarih aralığında sunucuya hiç gitmez; hatayı yazar ve odağı hatalı alana taşır', async () => {
    const screen = renderForAudit(<DataExportSection />);
    const dates = screen.container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    const to = dates[1]!;
    setValue(to, '2000-01-01');
    await submitAndSettle(screen.container);

    expect(fetchCalls()).toEqual([]);
    expect(screen.container.textContent).toContain('Bitiş tarihi başlangıçtan önce olamaz.');
    expect(document.activeElement).toBe(to);
    // Hata metni alana `aria-describedby` ile bağlı olmalı (yalnız renk/konum ile gösterilmesin)
    expect(to.getAttribute('aria-invalid')).toBe('true');
    expect(to.getAttribute('aria-describedby')).toBeTruthy();
    screen.unmount();
  });

  it('başarılı indirmede doğru uç nokta çağrılır ve dosya adı duyurulur', async () => {
    const { saved, revoked } = stubDownloadChannel();
    const screen = renderForAudit(<DataExportSection />);
    await submitAndSettle(screen.container);

    expect(fetchCalls()).toHaveLength(1);
    expect(fetchCalls()[0]).toContain('/api/v1/panel/exports/orders.csv');
    expect(fetchCalls()[0]).toContain('from=');
    expect(fetchCalls()[0]).toContain('to=');
    // Kutu işaretli değil → kişisel veri bayrağı HİÇ gönderilmez
    expect(fetchCalls()[0]).not.toContain('includePersonal');

    expect(saved.map((s) => s.name)).toEqual(['siparisler-bozok-2026-09-06_2026-10-05.csv']);
    // Blob adresi tıklamayla AYNI anda iptal edilmez: tarayıcı dosyayı tıklamadan sonra okur, adresi o anda
    // geçersiz kılmak büyük dosyada indirmeyi yarıda keser (bırakma `REVOKE_DELAY_MS` zamanlayıcısında).
    expect(revoked).toEqual([]);
    const status = q<HTMLElement>(screen.container, '[role="status"]');
    expect(status.textContent).toContain('indirildi');
    screen.unmount();
  });

  it('kişisel veri kutusu işaretlenince includePersonal=1 gider', async () => {
    stubDownloadChannel();
    const screen = renderForAudit(<DataExportSection />);
    await act(async () => {
      q<HTMLInputElement>(screen.container, 'input[type="checkbox"]').click();
    });
    await submitAndSettle(screen.container);

    expect(fetchCalls()[0]).toContain('includePersonal=1');
    screen.unmount();
  });

  it('JSON biçimi seçilince .json ucu çağrılır', async () => {
    stubDownloadChannel();
    const screen = renderForAudit(<DataExportSection />);
    setValue(q<HTMLSelectElement>(screen.container, 'select'), 'json');
    await submitAndSettle(screen.container);

    expect(fetchCalls()[0]).toContain('/api/v1/panel/exports/orders.json');
    screen.unmount();
  });

  it('müşteri dosyasında tarihler temizlenebilir: aralıksız istek tüm kayıtları getirir', async () => {
    stubDownloadChannel();
    const screen = renderForAudit(<DataExportSection />);
    await act(async () => {
      q<HTMLInputElement>(screen.container, 'input[type="radio"][value="customers"]').click();
    });
    await act(async () => {
      buttonByText(screen.container, 'Tarih sınırını kaldır').click();
    });
    await submitAndSettle(screen.container);

    const url = fetchCalls()[0]!;
    expect(url).toBe('/api/v1/panel/exports/customers.csv');
    expect(screen.container.textContent).toContain('Tarih sınırı yok');
    screen.unmount();
  });

  it('429: bekleme süresini içeren Türkçe hata gösterir (role="alert")', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string) => Promise.resolve(errorResponse(429, 'rate_limited', 'Çok fazla istek.', { retryAfterSec: 45 }))),
    );
    const screen = renderForAudit(<DataExportSection />);
    await submitAndSettle(screen.container);

    const alertBox = q<HTMLElement>(screen.container, '[role="alert"]');
    expect(alertBox.textContent).toContain('45 saniye');
    expect(alertBox.textContent).toContain('10 dakikada 5 dosya');
    screen.unmount();
  });

  it('403 destek oturumu reddi, kullanıcıya ne yapacağını söyler', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string) =>
        Promise.resolve(
          errorResponse(403, 'impersonation_export_blocked', 'Destek görünümünde kişisel veri içeren toplu dosya indirilemez.'),
        ),
      ),
    );
    const screen = renderForAudit(<DataExportSection />);
    await submitAndSettle(screen.container);

    const alertBox = q<HTMLElement>(screen.container, '[role="alert"]');
    expect(alertBox.textContent).toContain('kapatıp indirin');
    screen.unmount();
  });

  it('ağ hatası sessiz kalmaz', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => Promise.reject(new TypeError('Failed to fetch'))));
    const screen = renderForAudit(<DataExportSection />);
    await submitAndSettle(screen.container);

    expect(q<HTMLElement>(screen.container, '[role="alert"]').textContent).toContain('Sunucuya ulaşılamadı');
    screen.unmount();
  });
});
