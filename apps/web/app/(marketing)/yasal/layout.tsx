import type { ReactNode } from 'react';
import { connection } from 'next/server';

// Yasal metinler künyeyi (6563 m.3: unvan, adres, e-posta…) metnin içinde gösterir ve değeri `@/lib/site`'ın
// `LEGAL_ENTITY`'sinden alır. Bu yerleşim her yasal sayfayı istek anında çizdirir (`connection()`): sayfa `next build`'de
// statik HTML'e dönüşmez, künye isteği karşılayan sürecin ortamından (container ortamı) okunur — değer değişince
// yeniden derleme gerekmez (15 §4). Altbilgi de künyeyi istek anında okur; bu kapı ondan bağımsız olarak yasal
// sayfaları korur (altbilgiden künye kalkarsa sayfalar sessizce statiğe dönmesin).
//
// Sayfa dosyaları (`yasal/*/page.tsx`) bilerek değiştirilmedi: yasal metin içerik özetine girerler
// (scripts/check-legal.ts PINNED_TEXT_DIGEST · apps/api/src/services/orders/legal-gate.ts LEGAL_TEXT_DIGESTS).
export default async function LegalLayout({ children }: { children: ReactNode }) {
  await connection();
  return children;
}
