// Worker uyarıları (denetim 2026-10-04 madde 1.6/1.7): bir şey sessizce bozulmasın.
// Saf fonksiyon + tek yan etkili gönderim: scripts/webhook-spool.test.mjs ile denenir (node --test; yalnız
// silinebilir TypeScript sözdizimi).
//
// `ALERT_WEBHOOK_URL` tanımlıysa kısa bir JSON gönderilir (Slack/Telegram köprüsü, Better Stack, kendi ucu — ne
// bağlanırsa). Tanımlı değilse yalnız `console` satırı kalır: uyarı kanalı yokken de akış bozulmaz.
// AYNI ortam değişkeni adı apps/api tarafında da kullanılır (apps/api/src/lib/alert.ts); değeri koda yazılmaz,
// Worker secret'ı olarak verilir (docs/15 §13).
//
// KİŞİSEL VERİ YAZILMAZ: `ayrinti` yalnız maskeli yol, R2 anahtarı, özet, sayı ve durum kodu taşır. Müşteri telefonu,
// mesaj metni ya da webhook belirteci buraya girmez (CLAUDE.md: PII maskeleme).

export type UyariOlayi =
  /** Container alamadı, gelen webhook R2 tamponuna yazıldı (sipariş/mesaj kaybolmadı) */
  | 'webhook_tamponlandi'
  /** Tampona YAZILAMADI: sağlayıcıya 200 dönülmedi, kayıp riski var — acil */
  | 'webhook_tampon_yazilamadi'
  /** Tamponu boşaltırken geçici hata (container hâlâ hasta); kayıtlar R2'de duruyor */
  | 'webhook_drain_hatasi'
  /** Container kaydı kalıcı reddetti (4xx) ya da kayıt okunamadı: elle bakılmalı */
  | 'webhook_drain_reddedildi'
  /** Container başlatılamadı */
  | 'container_baslatilamadi'
  /** Uyanık tutma turu hata verdi */
  | 'uyanik_tutma_hatasi';

export type UyariAyrinti = Record<string, string | number | boolean>;

export interface Uyari {
  kaynak: 'worker';
  olay: UyariOlayi;
  zaman: string;
  ayrinti: UyariAyrinti;
}

/** Uyarı gövdesi (saf; gönderimden ayrı denenebilir). */
export function uyariGovdesi(olay: UyariOlayi, ayrinti: UyariAyrinti = {}, now: number = Date.now()): Uyari {
  return { kaynak: 'worker', olay, zaman: new Date(now).toISOString(), ayrinti };
}

/**
 * Uyarıyı gönderir. ASLA hata atmaz (uyarı kanalının hatası asıl işi bozmamalı) ve en çok 5 sn bekler.
 * Dönüş: gönderildi mi (adres yoksa false).
 */
export async function uyariGonder(
  url: string | undefined,
  olay: UyariOlayi,
  ayrinti: UyariAyrinti = {},
  deps: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<boolean> {
  const govde = uyariGovdesi(olay, ayrinti, deps.now ?? Date.now());
  console.error(`uyarı: ${olay} ${JSON.stringify(ayrinti)}`);
  const adres = (url ?? '').trim();
  if (!adres) return false;
  const send = deps.fetchImpl ?? fetch;
  try {
    const res = await send(adres, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(govde),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error(`uyarı gönderilemedi: ALERT_WEBHOOK_URL ${res.status}`);
    return res.ok;
  } catch (err) {
    // Adresin kendisi loglanmaz (belirteç taşıyabilir)
    console.error('uyarı gönderilemedi (ALERT_WEBHOOK_URL)', err);
    return false;
  }
}
