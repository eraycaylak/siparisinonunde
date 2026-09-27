// Meta Graph yönetim çağrıları (admin "WhatsApp kurulumu", 15 §6.2a): numara bilgisi, numara kaydı, WABA aboneliği,
// mesaj şablonları. Gönderim sağlayıcısıyla aynı sürüm ve taban adres (providers/cloud.ts) ve aynı değiştirilebilir fetch
// (http.ts; testlerde sahte sunucu). Token yalnız Authorization başlığında gider; URL'ye ve hata metnine yazılmaz.

import { fetchWithTimeout } from './http';
import { GRAPH_API_VERSION, GRAPH_BASE_URL } from './providers/cloud';

/** Graph hatası: Meta kodu (ör. "190", "100") ya da ağ hatasında "network" / "timeout". */
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

type Obj = Record<string, unknown>;

function parseError(json: unknown, status: number): GraphApiError {
  const e = json && typeof json === 'object' && (json as Obj).error && typeof (json as Obj).error === 'object' ? ((json as Obj).error as Obj) : null;
  if (!e) return new GraphApiError(`http_${status}`, `Meta yanıtı HTTP ${status}`, { httpStatus: status });
  const str = (v: unknown) => (v == null || v === '' ? null : String(v));
  const details = e.error_data && typeof e.error_data === 'object' ? str((e.error_data as Obj).details) : null;
  return new GraphApiError(str(e.code) ?? `http_${status}`, String(details ?? e.message ?? 'Bilinmeyen Meta hatası').slice(0, 500), {
    subcode: str(e.error_subcode),
    httpStatus: status,
    userMessage: str(e.error_user_msg)?.slice(0, 500) ?? null,
  });
}

export interface GraphCallOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/** Graph adresi: https://graph.facebook.com/v23.0/<path>?<query>. Yol parçaları çağıran tarafından kodlanır. */
export function graphUrl(path: string, query?: GraphCallOptions['query']): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') sp.set(k, String(v));
  const qs = sp.toString();
  return `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

/** Graph çağrısı; başarısızlıkta GraphApiError. */
export async function graphCall<T = Obj>(token: string, method: 'GET' | 'POST', path: string, opts: GraphCallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(graphUrl(path, opts.query), { method, headers, body }, opts.timeoutMs ?? 20_000);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new GraphApiError(aborted ? 'timeout' : 'network', aborted ? "Meta'dan yanıt gelmedi (zaman aşımı)" : "Meta'ya ulaşılamadı");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || (json && typeof json === 'object' && (json as Obj).error)) throw parseError(json, res.status);
  return (json ?? {}) as T;
}
