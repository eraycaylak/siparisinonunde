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
  | 'uyanik_tutma_hatasi'
  /** Son başarılı veritabanı yedeği eşikten eski: yedek zinciri kopmuş olabilir (aşağıdaki "Yedek gözcüsü") */
  | 'yedek_eskidi';

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

// --- Yedek gözcüsü (denetim 2026-10-05 bulgu B) --------------------------------------------------------
//
// Yedek yaşını YALNIZ `/api/v1/health/worker` görür; Worker'ın 5 dakikalık uyanık tutma turu ise sade `/health`'e
// gidiyordu, yani "günlerce yazılamayan yedek" riskinin HİÇ haber yolu yoktu (uç 503 dönse bile dış izleme
// kurulmamışsa kimse bakmıyordu). Tur artık ikinci bir yoklama yapar, gövdeyi buradaki saf işlevlerle okur ve eşik
// aşımında `yedek_eskidi` uyarısı gönderir (deploy/cloudflare/src/index.ts `scheduled`).
//
// Saf tutuldu ki `scripts/webhook-spool.test.mjs` içinde Worker çalışma zamanı olmadan denenebilsin.

/**
 * `yedek_eskidi` uyarısı en çok bu sıklıkla gider: cron 5 dk'da bir koşar, dizgin olmasa düzelmeyen bir arıza her
 * 5 dakikada bir aynı uyarıyı yollardı. Soğuma Durable Object deposundadır (isolate yeniden yaratılınca kaybolmaz;
 * index.ts `yedekUyarisiSirasiMi`). API ucunun kendi uyarısı 30 dk'da bir geldiği için (apps/api/src/routes/health.ts
 * `HEALTH_ALERT_COOLDOWN_MS`) bu ikinci göz bilerek daha seyrektir.
 */
export const YEDEK_UYARI_SOGUMA_MS = 60 * 60_000;

/** `/api/v1/health/worker` gövdesinden yedek yaşı okuması. Bilinmeyen alan `null`'dır ve uyarı üretmez. */
export interface YedekOkumasi {
  /** Son başarılı yedeğin yaşı (sn); uç bilmiyorsa (durum dosyası yok/bozuk) null. */
  yasSn: number | null;
  /** Ucun bildirdiği eşik (sn); `0` = eşik kapalı, bilinmiyorsa null. */
  esikSn: number | null;
  /** Eşik aşıldı mı. */
  eskidi: boolean;
}

function sayiOku(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

/**
 * Sağlık ucunun gövdesini okur. Kararın TEK KAYNAĞI ucun kendi `warnings` dizisidir (eşiği o değerlendirir,
 * `0 = kapalı` dahil); dizi hiç yoksa (eski bir API sürümü yanıt veriyorsa) yaş/eşik karşılaştırmasına düşülür.
 * Gövde JSON değil, boş ya da beklenmedik şekilde ise "bilinmiyor" döner — uyarı üretilmez (yanlış alarm, kanalı
 * güvenilmez yapar).
 */
export function yedekDurumunuOku(govde: unknown): YedekOkumasi {
  if (govde === null || typeof govde !== 'object') return { yasSn: null, esikSn: null, eskidi: false };
  const o = govde as Record<string, unknown>;
  const yasSn = sayiOku(o.lastBackupAgeSec);
  const esikSn = sayiOku(o.maxBackupAgeSec);
  const uyarilar = Array.isArray(o.warnings) ? o.warnings.filter((x): x is string => typeof x === 'string') : null;
  const eskidi = uyarilar
    ? uyarilar.includes('backup_stale')
    : yasSn !== null && esikSn !== null && esikSn > 0 && yasSn > esikSn;
  return { yasSn, esikSn, eskidi };
}

/**
 * Uyarı gönderilmeli mi: eşik aşılmış VE soğuma dolmuş olmalı. `sonUyariMs` null ise (hiç gönderilmemiş) hemen
 * gönderilir. İleri tarihli damga (saat sapması ya da bozuk kayıt) dizgini süresiz kilitlemesin diye gönderime
 * izin verir.
 */
export function yedekUyarisiGerekir(
  okuma: YedekOkumasi,
  sonUyariMs: number | null,
  simdiMs: number,
  sogumaMs: number = YEDEK_UYARI_SOGUMA_MS,
): boolean {
  if (!okuma.eskidi) return false;
  if (sogumaMs <= 0 || sonUyariMs === null) return true;
  const gecen = simdiMs - sonUyariMs;
  if (gecen < 0) return true;
  return gecen >= sogumaMs;
}

/**
 * `yedek_eskidi` uyarısının gövdesi: nöbetçinin ilk bakacağı iki sayı (yaş ve eşik) + kaynak etiketi. Bilinmeyen
 * alan YAZILMAZ (uydurma sayı raporlanmaz). Kişisel veri yoktur.
 */
export function yedekUyariAyrinti(okuma: YedekOkumasi): UyariAyrinti {
  const ayrinti: UyariAyrinti = { kaynak: 'yedek_gozcusu' };
  if (okuma.yasSn !== null) ayrinti.yasSn = okuma.yasSn;
  if (okuma.esikSn !== null) ayrinti.esikSn = okuma.esikSn;
  return ayrinti;
}
