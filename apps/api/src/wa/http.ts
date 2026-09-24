// Dış HTTP çağrıları için değiştirilebilir fetch (testlerde sahte sunucu). WhatsApp ve SMS sağlayıcıları kullanır.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let currentFetch: FetchLike | null = null;

/** Test/deneme için fetch'i değiştir; null → global fetch. */
export function setHttpFetch(fn: FetchLike | null): void {
  currentFetch = fn;
}

export function httpFetch(): FetchLike {
  return currentFetch ?? ((input, init) => fetch(input, init));
}

/** Zaman aşımlı istek (varsayılan 15 sn). */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await httpFetch()(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
