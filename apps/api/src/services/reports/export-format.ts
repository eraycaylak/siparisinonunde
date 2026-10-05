// Dışa aktarma biçimleri (CSV / JSON) — akışlı. Üretici tükenene kadar parça parça metin verir; hiçbir aşamada
// satırların tamamı bellekte tutulmaz (açık soru 5 kapasite kaygısı).

import { EXPORT_FORMAT, EXPORT_MAX_ROWS, type ExportRows } from './export';

/** Excel'de formüle dönüşebilecek başlangıçlar. Dışa aktarma dosyası tabloya açılır; metin metin kalmalı. */
const FORMULA_START = /^[=+@\t\r]/;

/**
 * CSV hücresi: menü CSV'siyle aynı dil (noktalı virgül ayraç, `""` kaçışı, Türkçe ondalık virgül).
 * Ek olarak formül enjeksiyonu kırılır: `=HYPERLINK(...)` biçiminde yazılmış bir müşteri notu ya da müşteri adı,
 * dosyayı açan kişinin makinesinde çalışan bir hücre olmasın (dosya işletmenin muhasebecisine de gidiyor).
 * Negatif sayı bozulmasın diye `-` yalnız ardından rakam gelmiyorsa kaçırılır.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) || /^-(?![0-9])/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) || /^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_TRUNCATED_MARKER = `# KIRPILDI: tek dosyada en fazla ${EXPORT_MAX_ROWS} satır dışa aktarılır. Daha kısa bir tarih aralığı seçin.`;

/**
 * Satırları ~64 KB'lik parçalarda birleştirir. Satır başına bir soket yazması 200.000 satırlık dosyada 200.000
 * sistem çağrısı demektir; 1/4 vCPU kutuda bu tek başına panelin önüne geçer. Bellek yine sabit (bir parça).
 */
const CHUNK_BYTES = 64 * 1024;

async function* buffered(parts: AsyncGenerator<string>): AsyncGenerator<string> {
  let buf = '';
  for await (const part of parts) {
    buf += part;
    if (buf.length >= CHUNK_BYTES) {
      yield buf;
      buf = '';
    }
  }
  if (buf) yield buf;
}

/** UTF-8 BOM + CRLF: Excel'in Türkçe yerel ayarı dosyayı doğrudan açar (menü CSV'siyle aynı biçim). */
export function csvChunks<T>(header: readonly string[], rows: ExportRows<T>, cells: (row: T) => string[]): AsyncGenerator<string> {
  return buffered(csvLines(header, rows, cells));
}

async function* csvLines<T>(header: readonly string[], rows: ExportRows<T>, cells: (row: T) => string[]): AsyncGenerator<string> {
  yield `﻿${header.join(';')}\r\n`;
  for (;;) {
    const next = await rows.next();
    if (next.done) {
      // Kırpılma dosyanın İÇİNDE görünür: sessizce eksik veri en kötü sonuçtur
      if (next.value.truncated) yield `${csvCell(CSV_TRUNCATED_MARKER)}\r\n`;
      return;
    }
    yield `${cells(next.value).map(csvCell).join(';')}\r\n`;
  }
}

export interface JsonExportMeta {
  kind: 'orders' | 'customers';
  scope: { tenantId: string; branchId: string | null };
  range: { from: string; to: string } | null;
  includesPersonalData: boolean;
}

/**
 * Tek geçerli JSON belgesi akıtılır: üstbilgi → `rows` dizisi → `rowCount`/`truncated`. Satır sayısı ancak sonda
 * bilinebildiği için en sona yazılır. Ayrıştırıcı dosyayı bütün olarak okur; sunucuda bellek sabit kalır.
 */
export function jsonChunks<T>(meta: JsonExportMeta, rows: ExportRows<T>): AsyncGenerator<string> {
  return buffered(jsonParts(meta, rows));
}

async function* jsonParts<T>(meta: JsonExportMeta, rows: ExportRows<T>): AsyncGenerator<string> {
  const head = JSON.stringify({
    format: EXPORT_FORMAT,
    kind: meta.kind,
    exportedAt: new Date().toISOString(),
    scope: meta.scope,
    range: meta.range,
    includesPersonalData: meta.includesPersonalData,
  });
  // `{...}` → `{...,"rows":[` : üstbilginin kapanış süslü parantezi atılır, satırlar aynı nesnenin içine akar
  yield `${head.slice(0, -1)},"rows":[`;
  let count = 0;
  for (;;) {
    const next = await rows.next();
    if (next.done) {
      yield `],"rowCount":${count},"truncated":${next.value.truncated}}\n`;
      return;
    }
    yield `${count === 0 ? '' : ','}\n${JSON.stringify(next.value)}`;
    count++;
  }
}
