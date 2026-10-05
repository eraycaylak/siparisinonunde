// Twilio HTTP çekirdeği (16 §2.1, §2.4): mesaj gönderimi (form-encoded, api.twilio.com) ve Content API (JSON,
// content.twilio.com). Kimlik doğrulama Basic (Account SID : Auth Token) — anahtar yalnız Authorization başlığında gider,
// URL'ye ve hata metnine yazılmaz.
//
// Hata gövdesi: { code, message, more_info, status }. Twilio kodları Meta karşılıklarına çevrilir (16 §2.6) ki
// wa/errors.ts sınıflandırması (pencere kapalı → şablona düş, token → hesabı duraklat, hız sınırı → yeniden dene)
// değişmeden çalışsın.

import { GraphApiError } from './graph-admin';
import { fetchWithTimeout } from './http';

export const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
export const TWILIO_CONTENT_BASE = 'https://content.twilio.com/v1';

export interface TwilioTarget {
  /** AC ile başlayan 34 karakter */
  accountSid: string;
  authToken: string;
}

export function twilioAuthHeader(t: TwilioTarget): string {
  return `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64')}`;
}

type Obj = Record<string, unknown>;

/**
 * Twilio hata kodu → Meta karşılığı (16 §2.6). Karşılığı olmayan kodlar olduğu gibi döner; `wa/errors.ts`
 * onları HTTP durumuna göre sınıflandırır.
 */
export function twilioCodeToMeta(code: string | null, httpStatus: number | null): string | null {
  switch (code) {
    // 24 saatlik oturum kapalı: serbest mesaj gönderilemez → şablona düş
    case '63016':
    case '63032':
      return '131047';
    // Alıcı WhatsApp'ta yok / numara geçersiz → teslim edilemez
    case '63003':
    case '63024':
    case '21211':
    case '21614':
      return '131026';
    // Kimlik doğrulama / hesap askıda → hesabı duraklat, platform uyarısı
    case '20003':
    case '20005':
      return '190';
    // Hız sınırı → yeniden dene
    case '20429':
    case '63018':
    case '31210':
      return '130429';
    // İçerik / şablon hatası
    case '63005':
    case '63021':
    case '63036':
      return '132000';
    // Twilio'nun GÜNLÜK mesaj sınırı: işletim anlamı Meta'nın 131048'iyle aynıdır (numaradan daha fazla mesaj
    // çıkmıyor, hata kalıcı, ortak numarada tüm dükkanları birden durdurur). Aynı koda çevrilir ki kota gözcüsü
    // (services/messaging/waba-quota.ts) tek kodu dinlesin; sınıflandırma değişmez ('fail').
    case '63038':
      return '131048';
    default:
      if (code == null && httpStatus != null && httpStatus >= 500) return null;
      return code;
  }
}

/** Twilio hata gövdesi → GraphApiError (kod Meta karşılığına çevrilmiş). */
export function twilioError(json: unknown, status: number): GraphApiError {
  const j = json && typeof json === 'object' ? (json as Obj) : null;
  const rawCode = j?.code != null ? String(j.code) : null;
  const message = typeof j?.message === 'string' && j.message.trim() ? j.message.trim() : `Twilio yanıtı HTTP ${status}`;
  const code = twilioCodeToMeta(rawCode, status) ?? `http_${status}`;
  return new GraphApiError(code, message.slice(0, 500), {
    httpStatus: status,
    // Twilio'nun kendi kodu kaybolmasın: teşhiste ve denetim kaydında görünür
    subcode: rawCode && rawCode !== code ? rawCode : null,
    userMessage: typeof j?.more_info === 'string' ? j.more_info : null,
  });
}

interface TwilioCallOptions {
  /** application/x-www-form-urlencoded gövde (mesaj gönderimi) */
  form?: Record<string, string | undefined>;
  /** application/json gövde (Content API) */
  json?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

function withQuery(url: string, query?: TwilioCallOptions['query']): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') sp.set(k, String(v));
  const qs = sp.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Twilio çağrısı; başarısızlıkta GraphApiError (ağ/zaman aşımı: 'network' / 'timeout'). */
export async function twilioCall<T = Obj>(
  t: TwilioTarget,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  opts: TwilioCallOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: twilioAuthHeader(t) };
  let body: string | undefined;
  if (opts.form) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) if (v !== undefined) sp.append(k, v);
    body = sp.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(withQuery(url, opts.query), { method, headers, body }, opts.timeoutMs ?? 20_000);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new GraphApiError(aborted ? 'timeout' : 'network', aborted ? "Twilio'dan yanıt gelmedi (zaman aşımı)" : "Twilio'ya ulaşılamadı");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) throw twilioError(json, res.status);
  return (json ?? {}) as T;
}
