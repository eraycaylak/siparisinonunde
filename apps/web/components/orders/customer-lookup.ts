'use client';

// Telefon siparişinde müşteri arama — İSTEMCİ tarafı (04 §4.13; uç `GET /panel/orders/manual/customers`).
//
// İSTEK (Eray, birebir): "telefon numarasına 0 yazdığım andan itibaren listeleme başlasın, ahmette de mesela
// a ya bastım direk listelemeye başlasın ve çok hızlı olsun bekleyip durmasın a-h-m yazarken bile patır patır
// getirsin." Üç şey: (1) İLK karakterden itibaren, (2) telefonun yanı sıra ADLA da, (3) tuş başına sonuç.
//
// GECİKTİRME (debounce) YOK — BİLİNÇLİ. "Bekleyip durmasın" isteği birebir uygulanır; gecikme eklemek istenen
// davranışı keserdi. Liste yolu sunucuda TEK sorgudur ve bu uca hız sınırı takılmamıştır, yani tuş başına
// istek 429 yemez (`apps/api/src/routes/panel/orders.ts` başındaki gerekçe). ⚠️ SQL maliyeti düz değildir:
// önek dallarında 0,2–4 ms, içerik bacağı devreye girdiğinde (ad ≥ 3 harf / telefon ≥ 4 rakam) kiracı
// büyüklüğüne göre 10 ms ile 230 ms arası — ölçümler ve sınır `apps/api/src/services/customers/lookup.ts`
// başında. Kiracı on binlerce müşteriye çıkarsa debounce'suz tuş başına istek ORADAN sınırlanır, buradan
// değil. Debounce yerine DÖRT mekanizma:
//
//   1. NORMALİZE EDİLMİŞ SORGU ANAHTARI (`lookupTerm`): biçim karakterleri ve büyük/küçük harf yeni anahtar
//      üretmez — "0 (532)" ile "0532" aynı, "AHM" ile "ahm" aynı. İstek sayısı kendiliğinden düşer ve
//      istemcinin ürettiği desen, sunucunun ifade indeksiyle birebir aynı katlamayı kullanır (`foldSearch`).
//   2. `placeholderData`: yeni sorgu uçarken ÖNCEKİ sonuç ekranda kalır — liste boşalmaz, titremez, düzen
//      zıplamaz. "Sonuç yok" metni bu yüzden `isSettled`e bağlıdır, `items.length`e değil. Önceki sonuç
//      YALNIZ aynı alanın sorgusuysa tutulur (telefondan ada geçince ilgisiz liste gösterilmez).
//   3. YARIŞ KOŞULU KORUMASI: her terim AYRI önbellek anahtarıdır (`lookupKey`). Geciken "a" yanıtı kendi
//      anahtarına yazılır; ekranda gözlenen anahtar "ahm" olduğu için YENİYİ EZEMEZ. Tek anahtarlı (ör. sabit
//      `['lookup']`) bir kurgu ya da elle `setState` bu garantiyi vermez.
//   4. İPTAL: `useApiQuery` sorgu iptal sinyalini `apiFetch`e geçirir (`apps/web/lib/api.ts`), yani anahtar
//      değişince uçuşta olan istek iptal edilir.
//
// ÖNBELLEK: `staleTime` > 0 olduğu için geri silinip aynı şey yazıldığında (a-h-m → a-h) istek ATILMAZ,
// sonuç önbellekten anında gelir.

import { useEffect, useRef, useState } from 'react';
import { foldSearch } from '@siparis/core';
import type {
  CustomerLookupDetailResponse,
  CustomerLookupItem,
  CustomerLookupResponse,
} from '@siparis/core/orders/contracts';
import { useApiQuery } from '@/lib/api';

/** Hangi alan yazılıyor. Ekranda iki alan var ama aynı anda yalnız biri aranır (sözleşme: tek `q`). */
export type LookupField = 'phone' | 'name';

/** Sunucu varsayılanı da 8; açıkça gönderiyoruz ki ekranda görünen satır sayısı sözleşmeden okunabilsin. */
export const LOOKUP_LIMIT = 8;
/** Aynı terim bu süre içinde yeniden yazılırsa istek atılmaz (önbellekten gelir). */
export const LOOKUP_STALE_MS = 10_000;
/** Ekran okuyucu duyurusu bu kadar sessizlikten sonra güncellenir (tuş başına duyuru = gürültü). */
export const ANNOUNCE_DELAY_MS = 600;

/**
 * Sunucuya gidecek normalize anahtar. Telefonda yalnız rakamlar; adda Türkçe harf katlaması (`foldSearch`),
 * yani SQL ifade indeksinin ikizi. `toLowerCase()` KULLANILMAZ — gerekçe `packages/core/src/text.ts`.
 * Boş dizge "arama yok" demektir (istek atılmaz).
 */
export function lookupTerm(field: LookupField, raw: string): string {
  if (field === 'phone') return raw.replace(/\D/g, '');
  return foldSearch(raw.trim());
}

/** Önbellek anahtarı. Terim normalize olduğu için biçim değişiklikleri yeni anahtar üretmez. */
export function lookupKey(field: LookupField, term: string): readonly [string, string, string, LookupField, string] {
  return ['panel', 'orders', 'lookup', field, term] as const;
}

/** Ayrıntı gövdesi ARAMADAN ayrı anahtarda durur: kimliğe göre okuma arama değildir. */
export function lookupDetailKey(id: string): readonly [string, string, string, string] {
  return ['panel', 'orders', 'lookup-detail', id] as const;
}

/**
 * Klavye ile dolaşmada sıradaki satır. Uçlarda döner (son satırda ↓ → ilk satır), hiçbir satır etkin
 * değilken (-1) ↓ ilk satıra, ↑ son satıra gider. Boş listede -1 kalır.
 */
export function nextActive(active: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (active < 0) return delta > 0 ? 0 : count - 1;
  return (active + delta + count) % count;
}

export interface CustomerLookupState {
  /** Sunucuya giden normalize terim; boşsa arama yapılmaz. */
  term: string;
  items: CustomerLookupItem[];
  /** Hangi dal çalıştı: `latest` (süzgeçsiz, en son sipariş verenler), `phone`, `name`. */
  mode: CustomerLookupResponse['mode'];
  /** Sorgu uçuyor. Liste BOŞALTILMAZ; en çok hafif soluklaştırma + `aria-busy` için. */
  isFetching: boolean;
  /** Ekrandaki liste GÜNCEL terime ait ve sorgu bitti — "sonuç yok" yalnız bunda yazılabilir. */
  isSettled: boolean;
  error: unknown;
}

/**
 * Arama sorgusu. `open` kapalıyken istek ATILMAZ: müşteri seçildiğinde form telefon/ad alanlarını
 * programla doldurur ve bunun yeni bir arama başlatmaması gerekir.
 */
export function useCustomerLookup(field: LookupField, raw: string, open: boolean): CustomerLookupState {
  const term = lookupTerm(field, raw);
  const enabled = open && term.length > 0;
  const query = useApiQuery<CustomerLookupResponse>(
    lookupKey(field, term),
    enabled ? '/panel/orders/manual/customers' : null,
    {
      // `detail=0`: liste gövdesi (tek sorgu, maskeli telefon). Adres/son sipariş yükü ayrıntı ucundadır.
      query: { q: term, detail: '0', limit: LOOKUP_LIMIT },
      staleTime: LOOKUP_STALE_MS,
      // Önceki sonucu ekranda tutmak yalnız AYNI alanda daralırken doğrudur (a → ah → ahm). Alan değişince
      // (telefondan ada geçmek) `keepPreviousData` ilgisiz bir listeyi "Eşleşen müşteriler" diye gösterirdi;
      // bu yüzden önceki sorgunun alanı anahtardan okunup karşılaştırılır. Eşleşmezse boş başlanır: ilk
      // tuşta yanlış satır göstermek, bir tur boş kalmaktan kötüdür.
      placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === field ? previous : undefined),
    },
  );
  return {
    term,
    items: query.data?.items ?? [],
    mode: query.data?.mode ?? 'latest',
    isFetching: query.isFetching,
    isSettled: enabled && !query.isFetching && !query.isPlaceholderData && query.isSuccess,
    error: query.error,
  };
}

/** Seçilen müşterinin ağır gövdesi (adresler + son 3 sipariş). `id` yokken istek atılmaz. */
export function useCustomerDetail(id: string | null) {
  return useApiQuery<CustomerLookupDetailResponse>(
    lookupDetailKey(id ?? '-'),
    id ? `/panel/orders/manual/customers/${encodeURIComponent(id)}` : null,
    { staleTime: LOOKUP_STALE_MS },
  );
}

/**
 * Canlı bölge metnini KISAR: değer ancak `delay` kadar sessizlikten sonra yansır. Liste anında güncellenir,
 * yalnız ekran okuyucu duyurusu bekler — a-h-m yazarken üç kez "3 müşteri bulundu" denmesin.
 */
export function useQuietMessage(message: string, delay = ANNOUNCE_DELAY_MS): string {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (message === '') {
      setShown('');
      return;
    }
    const timer = setTimeout(() => setShown(message), delay);
    return () => clearTimeout(timer);
  }, [message, delay]);
  return shown;
}

/**
 * Seçilen müşterinin ayrıntısı geldiğinde formu BİR KEZ doldurur. Tekrar doldurmaz: kasiyer adresi elle
 * düzelttikten sonra sorgu tazelenirse yazdığı şey geri alınmamalıdır.
 */
export function useFillOnce(selectedId: string | null, item: CustomerLookupItem | undefined, fill: (item: CustomerLookupItem) => void): void {
  const filled = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      filled.current = null;
      return;
    }
    // `item` bir önceki seçimin verisi olabilir (yeni sorgu henüz dönmedi) — kimlik eşleşmesi şart.
    if (!item || item.id !== selectedId || filled.current === selectedId) return;
    filled.current = selectedId;
    fill(item);
  }, [selectedId, item, fill]);
}
