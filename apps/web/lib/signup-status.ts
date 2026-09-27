/**
 * Yeni işletme kaydı açık mı (GET /api/v1/public/signup-status → signup_open kill-switch'i; 00 §12a madde 10).
 * Kayıt sayfası (app/panel/kayit) sunucu tarafında sorar: 'closed' → form yerine "Kayıtlar çok yakında açılıyor" bilgisi
 * (Cloudflare ortamında kayıt kapalıdır; canlı ortamda platform yöneticisi acil durumda kapatabilir). API'ye ulaşılamazsa
 * 'unknown' → form gösterilir; kayıt kapalıysa API yine 403 signup_closed döner ve form aynı bilgiyi yazar.
 */
export type SignupStatus = 'open' | 'closed' | 'unknown';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function probeSignupStatus(
  fetchImpl: FetchFn = (input, init) => fetch(input, init),
  apiOrigin: string = process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
): Promise<SignupStatus> {
  try {
    const res = await fetchImpl(`${apiOrigin.replace(/\/+$/, '')}/api/v1/public/signup-status`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return 'unknown';
    const body = (await res.json()) as { open?: unknown };
    if (body.open === true) return 'open';
    if (body.open === false) return 'closed';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Kayıt kapalıyken gösterilen pazarlama dilindeki bilgi (kayıt sayfası ve formun signup_closed hatası). "Bize ulaşın"
 * /demo'ya gider: canlı ortamda iletişim formu; Türkiye dışındaki Cloudflare ortamında form kapalıdır (kişisel veri
 * orada saklanmaz; lib/site.ts isLeadFormEnabled) ve sayfa varsa destek hattının WhatsApp bağlantısını gösterir.
 */
export const SIGNUP_SOON = {
  title: 'Kayıtlar çok yakında açılıyor',
  body: 'Yemek Gelsin’e yeni işletme kaydını çok yakında açıyoruz. Şimdiden yer ayırtmak ya da kendi rakamlarınla konuşmak için bize ulaş.',
  cta: 'Bize ulaşın',
  href: '/demo',
} as const;
