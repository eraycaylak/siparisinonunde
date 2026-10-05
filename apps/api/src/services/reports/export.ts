// İşletmenin kendi verisini toplu dışa aktarması — ortak çekirdek (açık soru 10; kullanım koşullarındaki
// "verilerinizi dışa aktarabilirsiniz" taahhüdünün kod karşılığı). Tek müşteri KVKK JSON'u
// (services/customers exportCustomer) yerinde kalır; bu modül işletmenin SİPARİŞ ve MÜŞTERİ listesini
// bütün olarak verir. Satır üreticileri export-orders.ts / export-customers.ts içindedir.
//
// Tasarım kararları:
//   1. Bellekte tam veri tutulmaz. Satırlar keyset (imleç) sayfalamasıyla EXPORT_BATCH_SIZE'lik öbeklerde okunur ve
//      hemen akışa yazılır. Sunucu tarafı cursor / tek uzun transaction BİLEREK kullanılmaz: API havuzu 10
//      bağlantıdır (packages/db createDb varsayılanı), uzun süren tek bir dışa aktarma o bağlantıyı dakikalarca
//      tutarsa panel sorguları aç kalır. Öbekler arasında bağlantı havuza geri döner.
//   2. Tenant kapsamı ZORUNLU: her sorguda `tenant_id = $tenant`. Şube kısıtlı üyelik (auth.branchId) verildiğinde
//      siparişler şubeye, müşteriler de o şubede siparişi olanlara daraltılır (customers tablosunda branch_id yok).
//   3. Test siparişleri (test_kind) hariç — raporlarla aynı kural.
//   4. KVKK ile silinmiş müşteri (customer_erasures) listede GÖRÜNMEZ; siparişlerindeki kişisel alanlar zaten
//      eraseCustomer tarafından anonimleştirilmiştir.
//   5. Kişisel veri kademeli: varsayılan dışa aktarmada telefon maskeli, açık adres/yol tarifi/koordinat hiç yok.
//      Tam veri yalnız `includePersonal` ile gelir ve denetim kaydına bu bayrakla yazılır (CLAUDE.md kural 7).

import { DEFAULT_TIMEZONE, localDateString, zonedTimeToUtc } from '@siparis/core';
import { isValidDateString } from '@siparis/core/settings/validation';
import type { Database } from '@siparis/db';
import { sql, type SQL } from 'drizzle-orm';
import { validationError } from '../settings/common';
import { addDays } from './index';

const TZ = DEFAULT_TIMEZONE;

/** Tek dışa aktarmada kapsanabilen en uzun dönem (gün). Bir yıl + artık gün. */
export const EXPORT_MAX_DAYS = 366;
/** Tarih verilmezse siparişlerde kullanılan dönem (gün). */
export const EXPORT_DEFAULT_DAYS = 30;
/**
 * Bir veritabanı turunda okunan satır sayısı. Bellek sabit kalır (yaklaşık 1 MB), tur sayısı azalır.
 * Neden küçük değil: şube süzgeci olmadan `orders_branch_placed_idx` (tenant_id, branch_id, placed_at)
 * `placed_at` sırasını doğrudan vermez, PostgreSQL sıralama yapar — her tur bu sıralamayı yeniden ödetir.
 * Tur sayısını düşürmek toplam maliyeti düşürür. Kalıcı çözüm `orders(tenant_id, placed_at)` indeksidir
 * (packages/db göçü; raporda DIŞ BAĞIMLILIK).
 */
export const EXPORT_BATCH_SIZE = 1_000;
/** Emniyet tavanı: bundan sonrası kırpılır ve kırpıldığı dosyada görünür. */
export const EXPORT_MAX_ROWS = 200_000;
/** Dosya biçim etiketi (ikinci sürüm ya da içe aktarma gerektiğinde ayırt edici). */
export const EXPORT_FORMAT = 'yemekgelsin.tenant_export.v1';

export interface ExportScope {
  tenantId: string;
  /** Şube kısıtı; null = işletmenin tamamı. */
  branchId?: string | null;
}

export interface ExportRange {
  /** Yerel (Europe/Istanbul) başlangıç günü, dahil. */
  fromDate: string;
  /** Yerel bitiş günü, dahil. */
  toDate: string;
  /** UTC yarı açık aralık [from, to). */
  from: Date;
  to: Date;
}

export interface ExportOptions {
  /** Açık telefon + adres + koordinat. Yalnız owner/manager ve açık istekle. */
  includePersonal?: boolean;
  batchSize?: number;
  maxRows?: number;
}

/** Üreticinin dönüş değeri: satırlar bitti mi, yoksa tavana mı takıldı. */
export interface ExportDone {
  truncated: boolean;
}

export type ExportRows<T> = AsyncGenerator<T, ExportDone, void>;

/**
 * from/to doğrular. İkisi de yoksa son `EXPORT_DEFAULT_DAYS` gün. Dönem `EXPORT_MAX_DAYS`'i aşamaz: sınırsız aralık
 * tek istekle tüm tabloyu taratır (kapasite riski, açık soru 5).
 */
export function parseExportRange(from: string | undefined, to: string | undefined, now = new Date()): ExportRange {
  const toDate = to ?? localDateString(now, TZ);
  if (!isValidDateString(toDate)) throw validationError('Geçerli bir bitiş tarihi seçin (YYYY-AA-GG).', 'to');
  const fromDate = from ?? addDays(toDate, -(EXPORT_DEFAULT_DAYS - 1));
  if (!isValidDateString(fromDate)) throw validationError('Geçerli bir başlangıç tarihi seçin (YYYY-AA-GG).', 'from');
  if (toDate < fromDate) throw validationError('Bitiş tarihi başlangıçtan önce olamaz.', 'to');
  const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000) + 1;
  if (days > EXPORT_MAX_DAYS) throw validationError(`En fazla ${EXPORT_MAX_DAYS} günlük dönem dışa aktarılabilir.`, 'to');
  return {
    fromDate,
    toDate,
    from: zonedTimeToUtc(fromDate, '00:00', TZ),
    to: zonedTimeToUtc(addDays(toDate, 1), '00:00', TZ),
  };
}

/** Müşteri dışa aktarmasında tarih aralığı isteğe bağlıdır (varsayılan: tüm kayıtlar). */
export function parseOptionalRange(from: string | undefined, to: string | undefined, now = new Date()): ExportRange | null {
  if (!from && !to) return null;
  return parseExportRange(from, to, now);
}

/** timestamptz → mikrosaniyeli UTC metin. JS Date milisaniyede keser; imleç kaybı satır atlatır/tekrarlar. */
export const tsText = (expr: string): SQL => sql.raw(`to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

export interface ExportCursor {
  at: string;
  id: string;
}

export const toNumber = (v: unknown): number => Number(v ?? 0);
export const toIso = (v: Date | string | null): string | null => (v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString());

/**
 * Keyset sayfalaması: `(sıralama anı, id)` ikilisinde kesin sıra, her tur ayrı kısa sorgu (havuz bağlantısı turlar
 * arasında serbest kalır). `maxRows` tavanına takılırsa `truncated: true` döner.
 */
export async function* paginateExport<T extends { cursor_at: string; id: string }>(
  db: Database,
  build: (cursor: ExportCursor | null, limit: number) => SQL,
  opts: { batchSize: number; maxRows: number },
): AsyncGenerator<T, ExportDone, void> {
  let cursor: ExportCursor | null = null;
  let emitted = 0;
  for (;;) {
    const remaining = opts.maxRows - emitted;
    if (remaining <= 0) {
      // Tavana tam oturan dosya "kırpıldı" damgası almasın: tek satırlık yoklama gerçekten devamı var mı der
      const more = (await db.execute(build(cursor, 1))) as unknown as T[];
      return { truncated: more.length > 0 };
    }
    const limit = Math.min(opts.batchSize, remaining);
    const rows = (await db.execute(build(cursor, limit))) as unknown as T[];
    for (const row of rows) {
      yield row;
      emitted++;
    }
    if (rows.length < limit) return { truncated: false };
    const last = rows[rows.length - 1]!;
    cursor = { at: last.cursor_at, id: last.id };
  }
}
