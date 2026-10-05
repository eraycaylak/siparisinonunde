// Toplu dışa aktarma bloğunun mantık testleri (04 §11.6 · denetim açık soru 10).
//
// Regresyon bağlamı: uç nokta yazılmıştı ama panelde çağıran arayüz YOKTU. Arayüz eklenirken iki sınıf hata
// riski var: (1) sunucunun sözleşmesini tahmin etmek (yol, sorgu adı, hata kodu), (2) sunucunun anlaşılır
// olmayan hatasını kullanıcıya olduğu gibi göstermek. Testler ikisini de çiviler.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  EXPORT_DEFAULT_DAYS,
  EXPORT_MAX_DAYS,
  EXPORT_RANGE_MIRROR,
  addDays,
  exportErrorMessage,
  exportFallbackFilename,
  exportQuery,
  exportRequestPath,
  exportUrl,
  fetchExportFile,
  filenameFromDisposition,
  personalDataGate,
  rangeDays,
  resolveExportRange,
  retryAfterSeconds,
  retryAfterText,
  validateExportRange,
} from './data-export';

const TODAY = '2026-10-05';

describe('addDays / rangeDays', () => {
  it('ay ve yıl sınırını geçer', () => {
    expect(addDays('2026-10-05', -29)).toBe('2026-09-06');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    // Artık gün: 2028 artık yıl
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('iki uç dahil gün sayar', () => {
    expect(rangeDays({ from: '2026-10-05', to: '2026-10-05' })).toBe(1);
    expect(rangeDays({ from: '2026-09-06', to: '2026-10-05' })).toBe(30);
  });
});

describe('resolveExportRange', () => {
  it('boş alanları sunucunun varsayılanıyla doldurur (siparişler: son 30 gün)', () => {
    expect(resolveExportRange('orders', '', '', TODAY)).toEqual({ from: '2026-09-06', to: TODAY });
    expect(rangeDays(resolveExportRange('orders', '', '', TODAY)!)).toBe(EXPORT_DEFAULT_DAYS);
  });

  it('müşterilerde iki alan da boşsa aralık yoktur (tüm kayıtlar)', () => {
    expect(resolveExportRange('customers', '', '', TODAY)).toBeNull();
  });

  it('müşterilerde tek alan doluysa diğerini sunucu gibi tamamlar', () => {
    expect(resolveExportRange('customers', '2026-10-01', '', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(resolveExportRange('customers', '', '2026-10-02', TODAY)).toEqual({ from: '2026-09-03', to: '2026-10-02' });
  });

  it('geçersiz tarihte tahmin üretmez', () => {
    expect(resolveExportRange('orders', '2026-02-30', '', TODAY)).toBeNull();
    expect(resolveExportRange('orders', '', '05.10.2026', TODAY)).toBeNull();
  });
});

describe('validateExportRange', () => {
  it('normal aralık geçerlidir', () => {
    expect(validateExportRange('orders', '2026-09-06', TODAY, TODAY)).toBeNull();
    expect(validateExportRange('customers', '', '', TODAY)).toBeNull();
  });

  it('ters aralığı bitiş alanında bildirir', () => {
    expect(validateExportRange('orders', '2026-10-05', '2026-10-01', TODAY)).toEqual({
      field: 'to',
      message: 'Bitiş tarihi başlangıçtan önce olamaz.',
    });
  });

  it('en çok 366 gün: 366 geçerli, 367 değil', () => {
    const to = '2026-10-05';
    expect(validateExportRange('orders', addDays(to, -(EXPORT_MAX_DAYS - 1)), to, TODAY)).toBeNull();
    expect(validateExportRange('orders', addDays(to, -EXPORT_MAX_DAYS), to, TODAY)).toEqual({
      field: 'to',
      message: 'En fazla 366 günlük dönem dışa aktarılabilir.',
    });
  });

  it('geçersiz tarih metni ilgili alanda bildirilir', () => {
    expect(validateExportRange('orders', '2026-13-01', TODAY, TODAY)?.field).toBe('from');
    expect(validateExportRange('orders', '2026-09-06', '2026-02-30', TODAY)?.field).toBe('to');
  });
});

describe('uç nokta sözleşmesi', () => {
  it('yol dört dosyayı da doğru kurar', () => {
    expect(exportRequestPath('orders', 'csv')).toBe('/panel/exports/orders.csv');
    expect(exportRequestPath('orders', 'json')).toBe('/panel/exports/orders.json');
    expect(exportRequestPath('customers', 'csv')).toBe('/panel/exports/customers.csv');
    expect(exportRequestPath('customers', 'json')).toBe('/panel/exports/customers.json');
  });

  it('sorgu yalnız dolu alanları taşır; şube gönderilmez', () => {
    expect(exportQuery({ kind: 'orders', format: 'csv', from: '2026-09-06', to: TODAY })).toEqual({
      from: '2026-09-06',
      to: TODAY,
      includePersonal: undefined,
    });
    expect(exportQuery({ kind: 'customers', format: 'json', from: '', to: '' })).toEqual({
      from: undefined,
      to: undefined,
      includePersonal: undefined,
    });
  });

  it('kişisel veri bayrağı sunucunun beklediği "1" değeridir', () => {
    expect(exportQuery({ kind: 'orders', format: 'csv', from: '', to: '', includePersonal: true }).includePersonal).toBe('1');
  });

  it('tam adres /api/v1 ön ekiyle kurulur', () => {
    expect(exportUrl({ kind: 'orders', format: 'csv', from: '2026-09-06', to: TODAY })).toBe(
      '/api/v1/panel/exports/orders.csv?from=2026-09-06&to=2026-10-05',
    );
    expect(exportUrl({ kind: 'customers', format: 'json', from: '', to: '', includePersonal: true })).toBe(
      '/api/v1/panel/exports/customers.json?includePersonal=1',
    );
  });
});

describe('dosya adı', () => {
  it('yedek ad aralığı ve dosya türünü söyler', () => {
    expect(exportFallbackFilename({ kind: 'orders', format: 'csv', from: '2026-09-06', to: TODAY }, TODAY)).toBe(
      'siparisler-2026-09-06_2026-10-05.csv',
    );
    // Müşteri dosyasında aralık yoksa (tüm kayıtlar) tarih yerine indirme günü yazılır
    expect(exportFallbackFilename({ kind: 'customers', format: 'json', from: '', to: '' }, TODAY)).toBe(
      'musteriler-2026-10-05.json',
    );
  });

  it('content-disposition başlığını çözer', () => {
    expect(filenameFromDisposition('attachment; filename="siparisler-bozok-2026-09-06_2026-10-05.csv"')).toBe(
      'siparisler-bozok-2026-09-06_2026-10-05.csv',
    );
    expect(filenameFromDisposition('attachment; filename=musteriler.json')).toBe('musteriler.json');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''m%C3%BC%C5%9Fteriler.csv")).toBe('müşteriler.csv');
  });

  it('başlık yoksa ya da ad kullanılamazsa null döner', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment')).toBeNull();
    expect(filenameFromDisposition('attachment; filename=".."')).toBeNull();
    expect(filenameFromDisposition('attachment; filename=""')).toBeNull();
  });

  it('yol ayırıcısı ve kontrol karakteri adda kalmaz', () => {
    const name = filenameFromDisposition('attachment; filename="../../etc/passwd"');
    expect(name).not.toBeNull();
    expect(name).not.toMatch(/[\\/]/);
    expect(filenameFromDisposition('attachment; filename="a\u0000b.csv"')).toBe('ab.csv');
  });
});

describe('exportErrorMessage', () => {
  it('429: bekleme süresini ve sınırı söyler', () => {
    const err = new ApiError(429, 'rate_limited', 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', { retryAfterSec: 45 });
    expect(exportErrorMessage(err)).toContain('45 saniye');
    expect(exportErrorMessage(err)).toContain('10 dakikada 5 dosya');
  });

  it('429: dakikaya yuvarlar, süre gelmezse sunucu varsayılanını kullanır', () => {
    expect(exportErrorMessage(new ApiError(429, 'rate_limited', 'x', { retryAfterSec: 120 }))).toContain('2 dakika');
    expect(exportErrorMessage(new ApiError(429, 'rate_limited', 'x'))).toContain('30 saniye');
  });

  it('403 destek oturumu: ne yapılacağını söyler', () => {
    const msg = exportErrorMessage(
      new ApiError(403, 'impersonation_export_blocked', 'Destek görünümünde kişisel veri içeren toplu dosya indirilemez.'),
    );
    expect(msg).toContain('Destek görünümünde');
    expect(msg).toContain('kapatıp indirin');
  });

  it('403 yetki ve işletme seçimi ayrı ayrı anlatılır', () => {
    expect(exportErrorMessage(new ApiError(403, 'forbidden', 'Bu işlem için yetkiniz yok.'))).toContain('işletme sahibi');
    expect(exportErrorMessage(new ApiError(403, 'tenant_required', 'Önce bir işletme seçin.'))).toContain('işletme seçin');
  });

  it('doğrulama hatası sunucunun Türkçe metniyle geçer', () => {
    expect(exportErrorMessage(new ApiError(400, 'validation_error', 'Bitiş tarihi başlangıçtan önce olamaz.'))).toBe(
      'Bitiş tarihi başlangıçtan önce olamaz.',
    );
  });

  it('bilinmeyen hatada anlaşılır yedek metin', () => {
    expect(exportErrorMessage(new Error('boom'))).toBe('Dosya indirilemedi. Biraz sonra tekrar deneyin.');
    expect(exportErrorMessage(new ApiError(404, 'not_found', 'Şube bulunamadı.'))).toContain('Sayfayı yenileyip');
  });

  it('bekleme süresi yardımcıları', () => {
    expect(retryAfterSeconds(new ApiError(429, 'rate_limited', 'x', { retryAfterSec: 7 }))).toBe(7);
    expect(retryAfterSeconds(new ApiError(429, 'rate_limited', 'x', { retryAfterSec: -1 }))).toBe(30);
    expect(retryAfterSeconds('bu bir hata değil')).toBe(30);
    expect(retryAfterText(59)).toBe('59 saniye');
    expect(retryAfterText(61)).toBe('2 dakika');
  });
});

describe('personalDataGate', () => {
  it('normal oturumda kutu görünür', () => {
    expect(personalDataGate({ supportSession: false })).toEqual({ visible: true, reason: null });
  });

  it('destek görünümünde kutu gizlenir ve gerekçe yazılır', () => {
    const gate = personalDataGate({ supportSession: true });
    expect(gate.visible).toBe(false);
    expect(gate.reason).toContain('maskeli');
    // 04 §11.6: maskeli dosya "kişisel verisiz" DEĞİLDİR (ad / mahalle / serbest not kalır).
    // Destek personeline "maskeli" demek yetmez; gerekçe neyin kaldığını da söylemek zorundadır.
    expect(gate.reason).toContain('not dosyada kalır');
  });
});

describe('fetchExportFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('başarılı yanıtta dosyayı ve sunucunun verdiği adı döndürür', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response('siparis_no;durum\r\nYG-1;delivered\r\n', {
          status: 200,
          headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="siparisler-x.csv"' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = await fetchExportFile('/api/v1/panel/exports/orders.csv?from=2026-09-06');
    expect(file.filename).toBe('siparisler-x.csv');
    expect(await file.blob.text()).toContain('siparis_no;durum');

    // Çerez oturumu gider, yanıt önbelleğe alınmaz (dosya her seferinde taze)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
    expect(init.method).toBe('GET');
  });

  it('başlık yoksa ad null kalır (çağıran yedek adı kullanır)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => Promise.resolve(new Response('x', { status: 200 }))));
    expect((await fetchExportFile('/api/v1/panel/exports/orders.csv')).filename).toBeNull();
  });

  it('hata gövdesindeki kod, mesaj ve retryAfterSec ApiError olarak çıkar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string) =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Çok fazla istek.', details: { retryAfterSec: 30 } } }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    await expect(fetchExportFile('/api/v1/panel/exports/orders.csv')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      details: { retryAfterSec: 30 },
    });
  });

  it('gövdesi okunamayan hatada da durum kodu korunur', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => Promise.resolve(new Response('<html>502</html>', { status: 502 }))));
    await expect(fetchExportFile('/api/v1/panel/exports/orders.csv')).rejects.toMatchObject({ status: 502, code: 'http_502' });
  });

  it('ağ hatası "sunucuya ulaşılamadı" olur, iptal olduğu gibi yukarı gider', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchExportFile('/api/v1/panel/exports/orders.csv')).rejects.toMatchObject({ status: 0, code: 'network_error' });

    const abort = new Error('iptal');
    abort.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn((_url: string) => Promise.reject(abort)));
    await expect(fetchExportFile('/api/v1/panel/exports/orders.csv')).rejects.toThrow('iptal');
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// AYNA TESTİ: bu modüldeki sabitler sunucudan KOPYADIR (apps/web, apps/api'ye bağımlı değil). Sunucuda sınır
// değişir de burası unutulursa kullanıcı "en fazla 366 gün" yazısını görür, sunucu başka bir sayıyla reddeder.
// Test sunucu dosyasını okuyup sayıları karşılaştırır — veritabanı gerekmez, sadece dosya okur.
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('sunucu aynası', () => {
  it('gün sınırları apps/api ile aynı', () => {
    const path = fileURLToPath(new URL(`../../../${EXPORT_RANGE_MIRROR.replace(/^apps\//, '')}`, import.meta.url));
    const src = readFileSync(path, 'utf8');
    expect(Number(/export const EXPORT_MAX_DAYS = ([\d_]+);/.exec(src)?.[1]?.replace(/_/g, ''))).toBe(EXPORT_MAX_DAYS);
    expect(Number(/export const EXPORT_DEFAULT_DAYS = ([\d_]+);/.exec(src)?.[1]?.replace(/_/g, ''))).toBe(EXPORT_DEFAULT_DAYS);
  });

  it('uç nokta yolları apps/api rotalarıyla aynı', () => {
    const path = fileURLToPath(new URL('../../../api/src/routes/panel/exports.ts', import.meta.url));
    const src = readFileSync(path, 'utf8');
    // Rota şablonla kuruluyor; aranan şey kaynak METNİDİR, bu yüzden `${format}` dizgede olduğu gibi durur
    /* eslint-disable no-template-curly-in-string -- sunucu kaynağındaki şablon metni birebir aranıyor */
    expect(src).toContain('/exports/orders.${format}');
    expect(src).toContain('/exports/customers.${format}');
    /* eslint-enable no-template-curly-in-string */
    expect(src).toContain("'impersonation_export_blocked'");
    expect(src).toContain('includePersonal');
  });
});
