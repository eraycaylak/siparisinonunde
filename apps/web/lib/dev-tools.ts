/** Geliştirici araçları (/dev/whatsapp) açık mı? Üretimde 0 (14 §3). */
export function devToolsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_TOOLS === '1' || process.env.DEV_TOOLS === '1';
}

/**
 * API'nin geliştirici uçları (/api/v1/dev/*) açık mı. Web derlemesi simülatörü açık derlenmiş olsa da (gizli staging:
 * NEXT_PUBLIC_DEV_TOOLS=1) API bu uçları yalnız tüm sağlayıcılar mock iken kaydeder (apps/api/src/config.ts
 * devToolsAllowed), aksi halde 404 döner. Canlı ortamda simülatör hiç derlenmez (NEXT_PUBLIC_DEV_TOOLS=0). 'disabled' → simülatör yerine "Gerçek WhatsApp bağlı" bildirimi; ağ hatası ya da başka
 * durum → 'unknown' (simülatör açılır, kendi hatasını gösterir).
 */
export type DevApiAvailability = 'available' | 'disabled' | 'unknown';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function probeDevApi(
  fetchImpl: FetchFn = (input, init) => fetch(input, init),
  apiOrigin: string = process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
): Promise<DevApiAvailability> {
  try {
    const res = await fetchImpl(`${apiOrigin.replace(/\/+$/, '')}/api/v1/dev/wa/accounts`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 404) return 'disabled';
    return res.ok ? 'available' : 'unknown';
  } catch {
    return 'unknown';
  }
}
