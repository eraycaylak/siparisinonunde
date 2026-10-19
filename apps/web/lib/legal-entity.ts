// Künye (6563 m.3) — ÇALIŞMA ZAMANI okuması. Tek kaynak: web sürecinin ortamı (container ortamı).
//
// NEDEN: künyeyi gösteren sayfalar (altbilgi, /kunye, /yasal/*) eskiden derleme anında okuyordu; `next build`
// onları statik HTML'e çeviriyordu. Canlı ortamda (Cloudflare) künye `wrangler.jsonc` `vars` →
// `deploy/cloudflare/src/mode.ts` `containerEnv` ile container'a ÇALIŞMA zamanında geliyor, imaj ise künyesiz
// derleniyor; yani API kapısı künyeyi görürken sayfalar "Eksik yapılandırma: LEGAL_ENTITY_*" basıyordu (15 §4).
//
// KURAL: künyeyi gösteren her sunucu bileşeni değeri bu fonksiyonla, istek anında okur. `connection()` (Next 16,
// `next/server`) rotayı prerender dışına alır: değer `next build`'deki ortamdan değil, isteği karşılayan sürecin
// ortamından gelir (Next rehberi: "Environment Variables › Runtime Environment Variables"). Değer değişince yeniden
// derleme GEREKMEZ, yeniden başlatma (yeni dağıtım / `docker compose up -d web`) yeter.
//
// Yalnız düz `LEGAL_*` adları okunur (`./legal-entity-env`): `NEXT_PUBLIC_LEGAL_*` derlemede satır içine gömülür
// ve API kapısı onu saymaz, yani kullanılmaz. Değerler gizli değildir; istemci bileşeni gerekirse prop olarak alır.

import { connection } from 'next/server';
import { readLegalEntityEnv } from './legal-entity-env';
import { type LegalEntity, resolveLegalEntity } from './site';

/**
 * İstek anındaki künye. Yalnız sunucu bileşeninde çağrılır (`connection()` istemcide ve "use cache" içinde hata
 * verir). Ortam `connection()`'DAN SONRA okunur. Eksik zorunlu alan uydurulmaz: `missing` doludur ve değer
 * "Eksik yapılandırma: <değişken>" olur.
 */
export async function getLegalEntity(): Promise<LegalEntity> {
  await connection();
  return resolveLegalEntity(readLegalEntityEnv());
}
