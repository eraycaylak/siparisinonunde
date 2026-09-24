// Menü CSV biçimi (04 §6.6 Faz 1 temel): "kategori;ürün;açıklama;fiyat", UTF-8 (BOM'lu), noktalı virgül ayraç,
// Türkçe ondalık virgül ("125,50"). Excel'in Türkçe yerel ayarı bu biçimi doğrudan açar.

import { formatKurus, parseTRY } from '@siparis/core';
import { MENU_CSV_HEADER } from '@siparis/core/menu/contracts';

export interface CsvRecord {
  /** Dosyadaki satır numarası (1'den). */
  line: number;
  cells: string[];
}

/** RFC 4180 benzeri ayrıştırıcı: tırnaklı alanlar, "" kaçışı, satır içi yeni satır. */
export function parseCsv(text: string, delimiter?: string): CsvRecord[] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiter ?? (firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',');
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      inQuotes = true;
      cell = '';
    } else if (ch === delim) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      cells.push(cell);
      if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
      cells = [];
      cell = '';
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
  return records;
}

function quote(value: string): string {
  return /[;"\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Kuruş → "1234,50" (binlik ayraçsız; içe aktarmada parseTRY iki biçimi de okur). */
export function csvPrice(kurus: number): string {
  return formatKurus(kurus).replace(/\./g, '');
}

export function formatMenuCsv(rows: { category: string; name: string; description: string | null; priceKurus: number }[]): string {
  const lines = [MENU_CSV_HEADER.join(';')];
  for (const r of rows) {
    lines.push([r.category, r.name, r.description ?? '', csvPrice(r.priceKurus)].map(quote).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export interface MenuCsvRow {
  line: number;
  category: string;
  name: string;
  description: string | null;
  priceKurus: number | null;
  error?: string;
}

function isHeader(cells: string[]): boolean {
  const first = (cells[0] ?? '').trim().toLocaleLowerCase('tr-TR');
  return first === 'kategori' || first === 'category';
}

/** CSV metnini menü satırlarına çevirir; satır düzeyi hatalar `error` alanında (Türkçe). */
export function parseMenuCsv(text: string, limits: { categoryName: number; productName: number; description: number; maxPriceKurus: number }): MenuCsvRow[] {
  const records = parseCsv(text);
  const out: MenuCsvRow[] = [];
  records.forEach((rec, idx) => {
    if (idx === 0 && isHeader(rec.cells)) return;
    const [rawCategory = '', rawName = '', rawDescription = '', rawPrice = ''] = rec.cells;
    const category = rawCategory.trim().replace(/\s+/g, ' ');
    const name = rawName.trim().replace(/\s+/g, ' ');
    const description = rawDescription.trim() || null;
    const priceKurus = parseTRY(rawPrice.trim());
    const row: MenuCsvRow = { line: rec.line, category, name, description, priceKurus };
    if (rec.cells.length < 4) row.error = 'Satırda 4 sütun olmalı: kategori; ürün; açıklama; fiyat.';
    else if (!category) row.error = 'Kategori boş.';
    else if (category.length > limits.categoryName) row.error = `Kategori adı en çok ${limits.categoryName} karakter olabilir.`;
    else if (!name) row.error = 'Ürün adı boş.';
    else if (name.length > limits.productName) row.error = `Ürün adı en çok ${limits.productName} karakter olabilir.`;
    else if (description && description.length > limits.description) row.error = `Açıklama en çok ${limits.description} karakter olabilir.`;
    else if (!rawPrice.trim()) row.error = 'Fiyat boş.';
    else if (priceKurus === null) row.error = `Fiyat okunamadı: "${rawPrice.trim()}". Örnek: 125,50`;
    else if (priceKurus < 0) row.error = 'Fiyat negatif olamaz.';
    else if (priceKurus > limits.maxPriceKurus) row.error = 'Fiyat çok yüksek.';
    out.push(row);
  });
  return out;
}

/** Karşılaştırma anahtarı: Türkçe küçük harf, tek boşluk. */
export function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
}
