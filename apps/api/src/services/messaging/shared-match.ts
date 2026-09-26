// Ortak numara: dükkan adı eşleşmesi (00 §12a madde 8). Türkçe karakter ve büyük/küçük harf duyarsız; ekler
// ("Bozok'tan") ve küçük yazım hataları (1 harf) tolere edilir. Saf fonksiyon (birim testli).

import { bareText } from './text';

/** Sorgu sözcüğü olarak anlamsız (selam, istek, genel işletme sözcükleri). */
const QUERY_STOP = new Set([
  'merhaba', 'selam', 'slm', 'mrb', 'iyi', 'gunler', 'aksamlar', 'sabahlar', 'hayirli', 'siparis', 'siparisi', 'vermek',
  'verecegim', 'istiyorum', 'istiyoruz', 'isterim', 'verebilir', 'miyim', 'miyiz', 'var', 'musunuz', 'misiniz', 'menu',
  'menusu', 'menuyu', 'lutfen', 'bir', 'ile', 'icin', 'bana', 'ben', 'biz', 'nasil', 'acik', 'kac', 'dukkan', 'dukkani',
  'dukkandan', 'restoran', 'restaurant', 'lokanta', 'cafe', 'kafe', 'salon', 'salonu', 'sube', 'yemek', 'hesap', 'tesekkur',
  'tesekkurler', 'sagol', 'tamam', 'evet', 'hayir', 'yok', 'gel', 'getir', 'lazim', 'rica', 'ederim',
]);

export interface NameMatchCandidate {
  tenantId: string;
  name: string;
}

export interface NameMatchResult<T extends NameMatchCandidate> {
  /** Adın tamamı mesajda geçiyor ya da sorgunun tüm sözcükleri eşleşiyor */
  strong: T[];
  /** En az bir sorgu sözcüğü eşleşiyor */
  weak: T[];
  /** Anlamlı sorgu sözcüğü sayısı */
  queryTokens: number;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

function tokenMatches(q: string, n: string): boolean {
  if (q === n) return true;
  if (q.length >= 3 && n.startsWith(q)) return true; // kısaltma: "boz" → bozok
  if (n.length >= 4 && q.startsWith(n)) return true; // ek: "bozoktan" → bozok
  return q.length >= 5 && n.length >= 5 && Math.abs(q.length - n.length) <= 1 && levenshtein(q, n) <= 1;
}

/** Mesajın anlamlı sözcükleri (≥ 3 harf, selam/istek sözcükleri hariç). */
export function queryTokens(text: string): string[] {
  return bareText(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !QUERY_STOP.has(t) && !/^\d+$/.test(t));
}

export function matchShopsByName<T extends NameMatchCandidate>(text: string, shops: readonly T[]): NameMatchResult<T> {
  const folded = bareText(text);
  const q = queryTokens(text);
  const strong: T[] = [];
  const weak: T[] = [];
  if (!folded || !q.length) return { strong, weak, queryTokens: q.length };
  for (const shop of shops) {
    const name = bareText(shop.name);
    if (!name) continue;
    const nameTokens = name.split(' ').filter((t) => t.length >= 2);
    const matched = q.filter((qt) => nameTokens.some((nt) => tokenMatches(qt, nt))).length;
    const full = ` ${folded} `.includes(` ${name} `);
    if (full || matched === q.length) strong.push(shop);
    else if (matched > 0) weak.push(shop);
  }
  return { strong, weak, queryTokens: q.length };
}
