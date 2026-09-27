// Yönetim çağrıları (admin "WhatsApp kurulumu", 15 §6.2a): Graph API uyumlu iki hedef.
//   - Meta Graph (cloud): https://graph.facebook.com/v23.0/<yol>, Authorization: Bearer <token> (providers/cloud.ts ile aynı
//     sürüm ve taban adres).
//   - 360dialog (d360): https://waba-v2.360dialog.io/<yol>, D360-API-KEY: <anahtar> (providers/d360.ts ile aynı taban adres).
//     360dialog v2, Graph'ın numara düzeyindeki uçlarını (message_templates, health_status) aynı gövde ve yanıt biçimiyle
//     sunar; numara ve WABA anahtara bağlı olduğundan yolda kimlik yoktur.
// Aynı değiştirilebilir fetch (http.ts; testlerde sahte sunucu). Anahtar yalnız başlıkta gider; URL'ye ve hata metnine yazılmaz.

import { fetchWithTimeout } from './http';
import { GRAPH_API_VERSION, GRAPH_BASE_URL } from './providers/cloud';
import { D360_BASE_URL } from './providers/d360';

/** Sağlayıcı hatası: Meta kodu (ör. "190", "100"), HTTP durumu ("http_401") ya da ağ hatasında "network" / "timeout". */
export class GraphApiError extends Error {
  readonly code: string;
  readonly subcode: string | null;
  readonly httpStatus: number | null;
  /** Meta'nın kullanıcıya dönük açıklaması (error_user_msg), varsa */
  readonly userMessage: string | null;

  constructor(code: string, message: string, opts: { subcode?: string | null; httpStatus?: number | null; userMessage?: string | null } = {}) {
    super(message);
    this.name = 'GraphApiError';
    this.code = code;
    this.subcode = opts.subcode ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.userMessage = opts.userMessage ?? null;
  }
}

export function isGraphApiError(err: unknown): err is GraphApiError {
  return err instanceof GraphApiError;
}

/** Çağrı hedefi: taban adres, kimlik başlığı ve hata metinlerindeki sağlayıcı adı. */
export interface AdminApiTarget {
  provider: 'cloud' | 'd360';
  /** Sonunda / olmadan */
  baseUrl: string;
  headers: Record<string, string>;
  /** "Meta" / "360dialog" */
  label: string;
  /** Yönelme ve ayrılma hâli: "Meta'ya" / "360dialog'a", "Meta'dan" / "360dialog'dan" */
  labelTo: string;
  labelFrom: string;
}

export function graphTarget(token: string): AdminApiTarget {
  return {
    provider: 'cloud',
    baseUrl: `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}`,
    headers: { Authorization: `Bearer ${token}` },
    label: 'Meta',
    labelTo: "Meta'ya",
    labelFrom: "Meta'dan",
  };
}

export function d360Target(apiKey: string): AdminApiTarget {
  return {
    provider: 'd360',
    baseUrl: D360_BASE_URL,
    headers: { 'D360-API-KEY': apiKey },
    label: '360dialog',
    labelTo: "360dialog'a",
    labelFrom: "360dialog'dan",
  };
}

type Obj = Record<string, unknown>;

const str = (v: unknown) => (v == null || v === '' ? null : String(v));

/**
 * Hata gövdesi → GraphApiError. Biçimler: Graph { error: { code, error_subcode, message, error_user_msg, error_data } }
 * (360dialog Meta hatasını aynen iletir), 360dialog'un kendi { error: "metin" }, eski { errors: [{ code, title, details }] }
 * ve { meta: { developer_message } }.
 */
function parseError(json: unknown, status: number, t: AdminApiTarget): GraphApiError {
  const j = json && typeof json === 'object' ? (json as Obj) : null;
  const clip = (v: string) => v.slice(0, 500);
  const e = j?.error && typeof j.error === 'object' ? (j.error as Obj) : null;
  if (e) {
    const details = e.error_data && typeof e.error_data === 'object' ? str((e.error_data as Obj).details) : null;
    return new GraphApiError(str(e.code) ?? `http_${status}`, clip(String(details ?? e.message ?? `Bilinmeyen ${t.label} hatası`)), {
      subcode: str(e.error_subcode),
      httpStatus: status,
      userMessage: str(e.error_user_msg) ? clip(String(e.error_user_msg)) : null,
    });
  }
  if (typeof j?.error === 'string' && j.error.trim()) return new GraphApiError(`http_${status}`, clip(j.error.trim()), { httpStatus: status });
  const first = Array.isArray(j?.errors) ? ((j!.errors as unknown[])[0] as Obj | undefined) : undefined;
  if (first && typeof first === 'object') {
    const msg = str(first.details) ?? str(first.title) ?? str(first.message) ?? `${t.label} yanıtı HTTP ${status}`;
    return new GraphApiError(str(first.code) ?? `http_${status}`, clip(msg), { httpStatus: status });
  }
  const meta = j?.meta && typeof j.meta === 'object' ? (j.meta as Obj) : null;
  const metaMsg = meta ? (str(meta.developer_message) ?? str(meta.message)) : null;
  if (metaMsg) return new GraphApiError(str(meta!.code) ?? `http_${status}`, clip(metaMsg), { httpStatus: status });
  return new GraphApiError(`http_${status}`, `${t.label} yanıtı HTTP ${status}`, { httpStatus: status });
}

export interface GraphCallOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/** Hedef adresi: <taban>/<yol>?<query>. Yol parçaları çağıran tarafından kodlanır. */
export function apiUrl(t: Pick<AdminApiTarget, 'baseUrl'>, path: string, query?: GraphCallOptions['query']): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') sp.set(k, String(v));
  const qs = sp.toString();
  return `${t.baseUrl}/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

/** Graph adresi: https://graph.facebook.com/v23.0/<path>?<query>. */
export function graphUrl(path: string, query?: GraphCallOptions['query']): string {
  return apiUrl({ baseUrl: `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}` }, path, query);
}

/** Yönetim çağrısı; başarısızlıkta GraphApiError. */
export async function adminApiCall<T = Obj>(t: AdminApiTarget, method: 'GET' | 'POST', path: string, opts: GraphCallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...t.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(apiUrl(t, path, opts.query), { method, headers, body }, opts.timeoutMs ?? 20_000);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new GraphApiError(aborted ? 'timeout' : 'network', aborted ? `${t.labelFrom} yanıt gelmedi (zaman aşımı)` : `${t.labelTo} ulaşılamadı`);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || (json && typeof json === 'object' && (json as Obj).error)) throw parseError(json, res.status, t);
  return (json ?? {}) as T;
}

/** Meta Graph çağrısı (cloud); başarısızlıkta GraphApiError. */
export async function graphCall<T = Obj>(token: string, method: 'GET' | 'POST', path: string, opts: GraphCallOptions = {}): Promise<T> {
  return adminApiCall<T>(graphTarget(token), method, path, opts);
}
