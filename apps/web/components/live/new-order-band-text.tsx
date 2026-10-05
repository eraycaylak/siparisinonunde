// Kırmızı "YENİ SİPARİŞ" bandının yazısı, iki parça hâlinde (04 §4.5, 12 §11.1 ölçüt 4.1.3).
//
// Bant `role="alert"` olduğu için bandın TÜM metni ekran okuyucuya okunur. Bu yüzden:
//  - `NewOrderAnnouncement`: yalnız ekran okuyucunun duyacağı tam cümle (bağlantının dışında durur ki bağlantının
//    erişilebilir adı kısa kalsın).
//  - `NewOrderBandLabel`: gözle okunan kısa yazı; `aria-hidden` olduğu için aynı bilgi iki kez okunmaz.
// İkisi de saf: birim testinde `renderToStaticMarkup` ile sınanır (Next bağımlılığı yoktur).

import { formatMoney } from '@/lib/format';
import { newOrderAnnouncement, type AnnounceCard } from './new-order-announce';

/** Bandın ekran okuyucuya okunan cümlesi. Sipariş yoksa hiçbir şey basmaz. */
export function NewOrderAnnouncement({ orders }: { orders: readonly AnnounceCard[] }) {
  const text = newOrderAnnouncement(orders);
  if (!text) return null;
  return <span className="sr-only">{text}</span>;
}

/** Bandın gözle okunan yazısı; ekran okuyucu bunu atlar (cümle yukarıda okundu). */
export function NewOrderBandLabel({ order, extra }: { order: Pick<AnnounceCard, 'number' | 'totalKurus'>; extra: number }) {
  return (
    <span aria-hidden>
      YENİ SİPARİŞ #{order.number}
      {order.totalKurus != null ? ` · ${formatMoney(order.totalKurus)}` : ''}
      {extra > 0 ? ` · +${extra} sipariş daha` : ''}
    </span>
  );
}
