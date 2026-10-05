// Sepet değişikliği (K10/K12, 03 §3.4 ve §4.4): sunucunun 409 `cart_changed` ayrıntısını — ya da 422
// `cart_invalid` sorun listesini, ya da takip yanıtındaki bekleyen değişikliği — tek bir görünüm modeline çevirir.
// 409 ayrıntısının alan adları sunucuda `apps/api/src/services/orders/expected-total.ts` tarafından yazılır
// (`expectedTotalKurus` = ekranda görülen eski toplam, `totalKurus` = yeni toplam, + ara toplam/teslimat ücreti).
// Metnin kaynağı sunucudur; sunucu cümle göndermezse koddan Türkçe cümle türetilir, ASLA uydurulmaz (kod
// tanınmıyorsa satır atlanır). Tutar yalnız sunucudan gelir (CLAUDE.md değişmez kural 3) ve integer kuruştur;
// istemci fark hesaplamaz, yalnız sunucunun verdiği iki toplamı yazar.

import { errorMessage, isApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

/** Sunucunun sepet uyuşmazlığında döndüğü hata kodu (409). */
export const CART_CHANGED_CODE = 'cart_changed';

/** Listede gösterilecek en çok satır: bozuk/şişirilmiş yanıt ekranı doldurmasın. */
const MAX_LINES = 8;
/** Sunucu cümlesinin en çok uzunluğu. */
const MAX_MESSAGE_LENGTH = 160;

export interface CartChangeEntry {
  /** `item_sold_out` | `item_removed` | `option_removed` | `price_changed` | `quantity_reduced` | `delivery_fee_changed` */
  code?: string;
  /** Sunucunun hazır Türkçe cümlesi (tek doğruluk kaynağı). */
  message?: string;
  /** Ürün adı. */
  name?: string;
  quantity?: number;
  oldUnitPriceKurus?: number | null;
  newUnitPriceKurus?: number | null;
}

export interface CartChangeDetails {
  /** Kalem bazlı fark listesi (tükenen ürün, kalkan seçenek, değişen fiyat). */
  changes?: CartChangeEntry[];
  /**
   * `/quote` sorun listesi: sunucu 422 `cart_invalid` ayrıntısını bu adla gönderir (K10 — ürün sepetteyken
   * tükendi). Aynı görünüm modeli iki kaynağı da okur, böylece ekranda tek bir "Sepetiniz güncellendi" akışı olur.
   */
  problems?: { code?: string; message?: string }[];
  /** Müşterinin onayladığı (eski) toplam — 409 `cart_changed` ayrıntısında `expectedTotalKurus` adıyla gelir. */
  previousTotalKurus?: number | null;
  expectedTotalKurus?: number | null;
  /** Sunucunun hesapladığı yeni toplam — KDV ve teslimat ücreti dahil. */
  totalKurus?: number | null;
  subtotalKurus?: number | null;
  deliveryFeeKurus?: number | null;
}

export interface CartChangeView {
  /** Ekranda madde madde gösterilecek fark listesi. */
  lines: string[];
  previousTotalKurus: number | null;
  totalKurus: number | null;
  /** Yeni toplamın dökümü: fark yalnız teslimat ücretinden geliyorsa müşteri bunu görür. */
  subtotalKurus: number | null;
  deliveryFeeKurus: number | null;
  /** "Yeni toplam 315,00 TL (önce 285,00 TL)." — toplam bilinmiyorsa null. */
  totalText: string | null;
  /** Ekran okuyucuya tek seferde okunan özet. */
  summary: string;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const kurus = (v: unknown): number | null => (isInt(v) && v >= 0 ? v : null);

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > MAX_MESSAGE_LENGTH ? `${t.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : t;
}

/** Tek değişiklik satırının metni: önce sunucunun cümlesi, yoksa koddan türet. Tanınmayan kod → null (atlanır). */
export function cartChangeLine(entry: CartChangeEntry): string | null {
  const given = text(entry.message);
  if (given) return given;
  const name = text(entry.name);
  const oldPrice = kurus(entry.oldUnitPriceKurus);
  const newPrice = kurus(entry.newUnitPriceKurus);
  switch (entry.code) {
    case 'item_sold_out':
      return name ? `${name} bugün tükendi, sepetten çıkarıldı.` : 'Bir ürün bugün tükendi, sepetten çıkarıldı.';
    case 'item_removed':
      return name ? `${name} artık menüde yok, sepetten çıkarıldı.` : 'Bir ürün artık menüde yok, sepetten çıkarıldı.';
    case 'option_removed':
      return name ? `${name}: bazı seçenekler artık yok, çıkarıldı.` : 'Bazı seçenekler artık yok, çıkarıldı.';
    case 'price_changed':
      if (oldPrice == null || newPrice == null) return name ? `${name} fiyatı güncellendi.` : 'Fiyatlar güncellendi.';
      return `${name ? `${name} fiyatı` : 'Fiyat'} güncellendi: ${formatMoney(oldPrice)} → ${formatMoney(newPrice)}.`;
    case 'quantity_reduced':
      return isInt(entry.quantity) && entry.quantity > 0 && name
        ? `${name} için stok yetmedi, adet ${entry.quantity} olarak güncellendi.`
        : 'Bir ürünün adedi stok nedeniyle azaltıldı.';
    case 'delivery_fee_changed':
      if (oldPrice == null || newPrice == null) return 'Teslimat ücreti güncellendi.';
      return `Teslimat ücreti güncellendi: ${formatMoney(oldPrice)} → ${formatMoney(newPrice)}.`;
    default:
      return null;
  }
}

function totalSentence(previous: number | null, total: number | null): string | null {
  if (total == null) return null;
  if (previous != null && previous !== total) return `Yeni toplam ${formatMoney(total)} (önce ${formatMoney(previous)}).`;
  return `Yeni toplam ${formatMoney(total)}.`;
}

/**
 * 409 `cart_changed` ayrıntısını (ya da takip yanıtındaki `order.cartChange` alanını) görünüm modeline çevirir.
 * Gösterilecek hiçbir şey yoksa (ne satır ne toplam) null döner; çağıran genel hata metnine düşer.
 */
export function parseCartChange(details: unknown): CartChangeView | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as CartChangeDetails;
  const lines: string[] = [];
  const collect = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (lines.length >= MAX_LINES) return;
      if (!entry || typeof entry !== 'object') continue;
      const line = cartChangeLine(entry as CartChangeEntry);
      if (line && !lines.includes(line)) lines.push(line);
    }
  };
  collect(d.changes);
  collect(d.problems);
  const previousTotalKurus = kurus(d.previousTotalKurus) ?? kurus(d.expectedTotalKurus);
  const totalKurus = kurus(d.totalKurus);
  if (!lines.length && totalKurus == null) return null;
  const totalText = totalSentence(previousTotalKurus, totalKurus);
  const summary = ['Sepetiniz güncellendi.', ...lines, totalText].filter(Boolean).join(' ');
  return {
    lines,
    previousTotalKurus,
    totalKurus,
    subtotalKurus: kurus(d.subtotalKurus),
    deliveryFeeKurus: kurus(d.deliveryFeeKurus),
    totalText,
    summary,
  };
}

/** 409 + `cart_changed` mı? */
export function isCartChangedError(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.code === CART_CHANGED_CODE;
}

/** Hatadan görünüm modeli: sepet değişikliği hatası değilse ya da ayrıntı boşsa null. */
export function cartChangeFromError(error: unknown): CartChangeView | null {
  if (!isCartChangedError(error)) return null;
  return parseCartChange((error as { details?: unknown }).details);
}

/**
 * "Güncel sepetle devam" çağrısının hata metni. Uç nokta henüz yayında değilse (404/405/501) müşteri çıkmaz
 * sokakta kalmaz: işletmeyi aramaya yönlendirilir.
 */
export function cartChangeActionError(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 404 || error.status === 405 || error.status === 501) {
      return 'Bu işlem şu an yapılamıyor. Lütfen işletmeyi arayın.';
    }
    if (error.status === 410) return 'Bu bağlantının süresi dolmuş. Lütfen işletmeyi arayın.';
  }
  return errorMessage(error, 'Onayınız iletilemedi. Tekrar deneyin.');
}

/** Takip/sipariş yanıtındaki bekleyen sepet değişikliği (sözleşmeye eklenene kadar savunmalı okuma). */
export function pendingCartChange(order: unknown): CartChangeView | null {
  if (!order || typeof order !== 'object') return null;
  return parseCartChange((order as { cartChange?: unknown }).cartChange);
}
