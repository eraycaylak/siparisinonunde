// Toplu dışa aktarma bloğunun saf mantığı (04 §11.6 · 14 §6.3 "Dışa aktarma").
//
// NEDEN BU DOSYA VAR: uç nokta (`apps/api/src/routes/panel/exports.ts`) yazılmıştı ama panelde HİÇBİR arayüz
// yoktu — kullanım koşullarındaki "verilerinizi dışa aktarabilirsiniz" taahhüdü yalnız adres çubuğuna elle URL
// yazmayı bilen kişi için geçerliydi. Bu modül ekranın karar veren kısmını (aralık doğrulama, sorgu, dosya adı,
// hata metni, indirme çağrısı) React'tan ayırır: `apps/web` birim testleri saf `.ts` modüllerini kapsar,
// `.tsx` bileşenleri e2e/erişilebilirlik testlerinin alanıdır (apps/web/vitest.config.ts kapsam notu).
//
// ⚠️ SUNUCU OTORİTEDİR. Aşağıdaki sabitler ve doğrulama kuralları `services/reports/export.ts`
// (`EXPORT_MAX_DAYS`, `EXPORT_DEFAULT_DAYS`, `parseExportRange`, `parseOptionalRange`) AYNASIDIR; amaç kullanıcıya
// sunucuya gitmeden anlaşılır bir uyarı göstermektir. İstemci doğrulaması gevşese bile sunucu 400 ile reddeder
// (CLAUDE.md: doğrulama sistem sınırında). `apps/web` `apps/api`'ye bağımlı DEĞİL, bu yüzden sabitler
// içe aktarılamıyor; kopyalardır ve bu testlerde `EXPORT_RANGE_MIRROR` ile birlikte belgelenmiştir.

import { isValidDateString } from '@siparis/core/settings/validation';
import { ApiError, apiPath, errorMessage, isApiError, withQuery, type QueryParams } from '@/lib/api';

/** İndirilebilen dosyalar. Uç noktalar: `/panel/exports/{kind}.{format}`. */
export type ExportKind = 'orders' | 'customers';
export type ExportFormat = 'csv' | 'json';

/** Tek dosyada kapsanabilen en uzun dönem (gün) — sunucudaki `EXPORT_MAX_DAYS` aynası. */
export const EXPORT_MAX_DAYS = 366;
/** Tarih verilmezse siparişlerde kullanılan dönem (gün) — sunucudaki `EXPORT_DEFAULT_DAYS` aynası. */
export const EXPORT_DEFAULT_DAYS = 30;

/** Aynanın kaynağı: testte ve incelemede hangi sunucu dosyasına bakılacağı yazılı kalsın. */
export const EXPORT_RANGE_MIRROR = 'apps/api/src/services/reports/export.ts' as const;

/** "YYYY-AA-GG" + gün → "YYYY-AA-GG" (UTC aritmetiği; yerel saat kaydırması yok). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface ResolvedRange {
  from: string;
  to: string;
}

export interface RangeProblem {
  /** Odaklanacak alan. */
  field: 'from' | 'to';
  message: string;
}

/**
 * Boş alanları sunucunun doldurduğu gibi doldurur: bitiş yoksa bugün, başlangıç yoksa bitişten
 * `EXPORT_DEFAULT_DAYS - 1` gün öncesi. Müşteri dosyasında İKİSİ DE boşsa aralık YOKTUR (tüm kayıtlar) —
 * `parseOptionalRange` davranışı. Geçersiz tarih metni geldiğinde `null` döner, doğrulama onu `validateExportRange`
 * yakalar (burada tahmin üretmek yanlış dosya adı demek olur).
 */
export function resolveExportRange(kind: ExportKind, from: string, to: string, today: string): ResolvedRange | null {
  if (kind === 'customers' && !from && !to) return null;
  const toDate = to || today;
  if (!isValidDateString(toDate)) return null;
  const fromDate = from || addDays(toDate, -(EXPORT_DEFAULT_DAYS - 1));
  if (!isValidDateString(fromDate)) return null;
  return { from: fromDate, to: toDate };
}

/** Kapsanan gün sayısı (iki uç dahil). */
export function rangeDays(range: ResolvedRange): number {
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
}

/**
 * Sunucuya gitmeden görülebilen hatalar. `null` = geçerli. Metinler `parseExportRange`'in attığı
 * doğrulama mesajlarıyla birebir aynıdır: kullanıcı aynı cümleyi iki ayrı yerde iki ayrı biçimde görmesin.
 */
export function validateExportRange(kind: ExportKind, from: string, to: string, today: string): RangeProblem | null {
  if (to && !isValidDateString(to)) return { field: 'to', message: 'Geçerli bir bitiş tarihi seçin (YYYY-AA-GG).' };
  if (from && !isValidDateString(from)) return { field: 'from', message: 'Geçerli bir başlangıç tarihi seçin (YYYY-AA-GG).' };
  const range = resolveExportRange(kind, from, to, today);
  if (!range) return null;
  if (range.to < range.from) return { field: 'to', message: 'Bitiş tarihi başlangıçtan önce olamaz.' };
  if (rangeDays(range) > EXPORT_MAX_DAYS) {
    return { field: 'to', message: `En fazla ${EXPORT_MAX_DAYS} günlük dönem dışa aktarılabilir.` };
  }
  return null;
}

export interface ExportRequestInput {
  kind: ExportKind;
  format: ExportFormat;
  from: string;
  to: string;
  /** Açık telefon + adres + koordinat. Destek görünümünde sunucu 403 verir. */
  includePersonal?: boolean;
}

/** Uç nokta yolu (API istemcisinin `/api/v1` ön eki `exportUrl` içinde eklenir). */
export function exportRequestPath(kind: ExportKind, format: ExportFormat): string {
  return `/panel/exports/${kind}.${format}`;
}

/**
 * Sorgu parametreleri. `branchId` BİLEREK gönderilmez: sunucu şube kısıtlı üyelikte `auth.branchId`'yi kendisi
 * uygular, çok şubeli işletmede ise panelin o anda seçili şubesini göndermek sahibin "tüm işletme" beklediği
 * dosyayı sessizce tek şubeye daraltırdı. Şube seçimli dışa aktarma ayrı bir iştir (raporda yazılı).
 * Boş tarih gönderilmez: `withQuery` boş değeri atar, sunucu da varsayılanını uygular.
 */
export function exportQuery(input: ExportRequestInput): QueryParams {
  return {
    from: input.from || undefined,
    to: input.to || undefined,
    includePersonal: input.includePersonal ? '1' : undefined,
  };
}

/** İndirilecek tam adres (aynı köken; çerez oturumu `credentials: 'include'` ile gider). */
export function exportUrl(input: ExportRequestInput): string {
  return withQuery(apiPath(exportRequestPath(input.kind, input.format)), exportQuery(input));
}

const KIND_FILE_PREFIX: Record<ExportKind, string> = { orders: 'siparisler', customers: 'musteriler' };

/**
 * Sunucu `content-disposition` vermezse (vekil sunucu başlığı düşürürse) kullanılan ad. Sunucunun adıyla aynı
 * dilde ama işletme kısaltması yoktur: adı uydurmak yerine aralığı yazmak doğruyu söyler.
 */
export function exportFallbackFilename(input: ExportRequestInput, today: string): string {
  const range = resolveExportRange(input.kind, input.from, input.to, today);
  const span = range ? `${range.from}_${range.to}` : today;
  return `${KIND_FILE_PREFIX[input.kind]}-${span}.${input.format}`;
}

/**
 * Dosya adında kullanılmayacak karakterler: yol ayırıcısı ve kontrol karakterleri. Kontrol karakterleri
 * BİLEREK desende: `a\u0000b.csv` gibi bir ad `a.download`'a yazıldığında kaydedilen dosya adını bozar.
 */
// eslint-disable-next-line no-control-regex -- kontrol karakterlerini temizlemek bu fonksiyonun işi
const UNSAFE_FILENAME = /[\\/\u0000-\u001f\u007f]/g;

/**
 * `content-disposition: attachment; filename="..."` → dosya adı. Ad kendi sunucumuzdan gelir ama `a.download`'a
 * yazıldığı için yine temizlenir: yol ayırıcısı ya da kontrol karakteri taşıyan bir başlık indirme klasörünün
 * dışına yazmayı denemesin. Çözülemezse `null` döner, çağıran yedek adı kullanır.
 */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  let raw = '';
  if (utf8?.[1]) {
    try {
      raw = decodeURIComponent(utf8[1].trim());
    } catch {
      raw = '';
    }
  }
  if (!raw) raw = (plain?.[1] ?? plain?.[2] ?? '').trim();
  const safe = raw.replace(UNSAFE_FILENAME, '').trim();
  return safe === '' || safe === '.' || safe === '..' ? null : safe;
}

/** 429 gövdesindeki bekleme süresi; yoksa sunucunun eşzamanlılık kapısındaki varsayılan (30 sn). */
export function retryAfterSeconds(error: unknown, fallback = 30): number {
  if (!isApiError(error)) return fallback;
  const sec = (error.details as { retryAfterSec?: unknown } | undefined)?.retryAfterSec;
  return typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : fallback;
}

/** "45 saniye" / "2 dakika" — bekleme süresini okunur yazar. */
export function retryAfterText(seconds: number): string {
  if (seconds < 60) return `${seconds} saniye`;
  return `${Math.ceil(seconds / 60)} dakika`;
}

/**
 * Hata → kullanıcıya gösterilecek Türkçe cümle. Ham `ApiError.message` yetmez, çünkü iki durum kullanıcıya NE
 * YAPACAĞINI söylemiyor:
 *   - 429 `rate_limited`: sunucu "Çok fazla istek" der ama bu ya 10 dakikada 5 dosya sınırıdır ya da süreç
 *     genelindeki 2 eşzamanlı akış kapısıdır (ikisinin de kodu aynı). Bekleme süresi gövdedeki `retryAfterSec`.
 *   - 403 `impersonation_export_blocked`: "destek görünümü" ifadesi tek başına çözüm göstermiyor; kullanıcıya
 *     kişisel veri kutusunu kapatmasını söylemek gerekir.
 * Doğrulama hataları (400/422) sunucudan zaten Türkçe geliyor, oldukları gibi geçer.
 */
export function exportErrorMessage(error: unknown): string {
  const fallback = 'Dosya indirilemedi. Biraz sonra tekrar deneyin.';
  if (!isApiError(error)) return errorMessage(error, fallback);
  if (error.status === 429) {
    const wait = retryAfterText(retryAfterSeconds(error));
    return `Şu anda indirilebilecek dosya sınırına ulaşıldı. ${wait} sonra tekrar deneyin (işletme başına 10 dakikada 5 dosya).`;
  }
  if (error.status === 403) {
    if (error.code === 'impersonation_export_blocked') {
      return 'Destek görünümünde telefon ve adres içeren dosya indirilemez. "Telefon ve adresleri açık yaz" seçeneğini kapatıp indirin ya da kendi hesabınızla giriş yapın.';
    }
    if (error.code === 'tenant_required') return 'Önce bir işletme seçin, sonra tekrar deneyin.';
    return 'Toplu dışa aktarma yalnız işletme sahibi ve yöneticide açıktır.';
  }
  if (error.status === 404) return 'Şube bulunamadı. Sayfayı yenileyip tekrar deneyin.';
  return errorMessage(error, fallback);
}

export interface PersonalDataGate {
  /** Kişisel veri kutusu gösterilsin mi. */
  visible: boolean;
  /** Kutu gizliyse kullanıcıya gösterilecek gerekçe. */
  reason: string | null;
}

/**
 * "Telefon ve adresleri açık yaz" kutusunun görünürlüğü. Destek görünümünde (impersonation) sunucu bu isteği
 * 403 ile reddeder (05 A-09); kullanıcıya önce tıklatıp sonra reddetmek yerine kutu hiç gösterilmez ve gerekçe
 * yazılır. Rol kapısı ayrıca gerekmiyor: blok yalnız owner/manager'a çizilir, sunucu da aynı rolleri ister.
 */
export function personalDataGate(options: { supportSession: boolean }): PersonalDataGate {
  if (options.supportSession) {
    return {
      visible: false,
      reason:
        'Destek görünümünde olduğunuz için telefon maskeli iner ve açık adres dosyaya hiç yazılmaz; müşteri adı, mahalle ve not dosyada kalır. Açık veri için işletme hesabıyla giriş yapılması gerekir.',
    };
  }
  return { visible: true, reason: null };
}

export interface ExportFile {
  blob: Blob;
  /** Sunucunun `content-disposition` ile verdiği ad; yoksa `null`. */
  filename: string | null;
}

/**
 * Dosyayı indirir. `apiFetch` BİLEREK kullanılmadı: o yardımcı JSON'u ayrıştırıp nesne, CSV'yi metin döndürür —
 * JSON dosyasını yeniden `JSON.stringify` etmek sunucunun ürettiği dosyadan FARKLI bir dosya kaydetmek olurdu
 * (üstbilgi sırası, girinti, `rowCount`/`truncated` alanlarının yazımı). Ayrıca `content-disposition` başlığına
 * ihtiyacımız var.
 *
 * Neden ön yoklama (HEAD / küçük istek) yok: hız sınırı istek başına token yakar (10 dakikada 5); yetkiyi
 * önceden sormak kullanıcının indirme hakkının beşte birini harcar. Tek istek atılır, hata gövdesinden okunur.
 *
 * Bedelin bilinçli kabulü: yanıt akış olmasına rağmen istemci tarafında `blob()` ile TAMAMEN belleğe alınır
 * (tarayıcı sekmesinde). Alternatifi düz `<a download>` bağlantısıydı; o yolda 403/429 yanıtı kullanıcıya
 * "indirme başarısız" ya da içinde JSON hatası olan bir dosya olarak görünürdü — anlaşılır Türkçe hata
 * gösterilemezdi. Dosya tavanı 200.000 satırdır (sunucu kırpar), tipik işletmede birkaç MB.
 */
export async function fetchExportFile(url: string, signal?: AbortSignal): Promise<ExportFile> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/csv, application/json' },
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | undefined;
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? 'Dosya indirilemedi.', err?.details);
  }
  return { blob: await res.blob(), filename: filenameFromDisposition(res.headers.get('content-disposition')) };
}
