// API istemcisi (14 §6). Tarayıcıda aynı kökenden /api/* (Next rewrite → API), sunucuda API_INTERNAL_URL.
// Hata biçimi: { error: { code, message, details? } } → ApiError.

import {
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** 4xx: istemci hatası (yeniden denemeye değmez). */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

const STATUS_MESSAGES: Record<number, string> = {
  0: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.',
  400: 'İstek geçersiz. Bilgileri kontrol edip tekrar deneyin.',
  401: 'Oturumunuz kapanmış. Lütfen yeniden giriş yapın.',
  403: 'Bu işlem için yetkiniz yok.',
  404: 'Aradığınız kayıt bulunamadı.',
  409: 'Kayıt bu arada değişti. Sayfayı yenileyip tekrar deneyin.',
  410: 'Bu bağlantının süresi dolmuş.',
  413: 'Dosya çok büyük.',
  422: 'Bilgileri kontrol edip tekrar deneyin.',
  429: 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.',
  500: 'Beklenmeyen bir hata oluştu. Biraz sonra tekrar deneyin.',
  502: 'Sunucuya şu an ulaşılamıyor. Biraz sonra tekrar deneyin.',
  503: 'Hizmet geçici olarak kullanılamıyor. Biraz sonra tekrar deneyin.',
};

/** Kullanıcıya gösterilecek Türkçe hata metni. */
export function errorMessage(error: unknown, fallback = 'Bir hata oluştu. Tekrar deneyin.'): string {
  if (isApiError(error)) {
    if (error.message && error.message !== error.code) return error.message;
    return STATUS_MESSAGES[error.status] ?? fallback;
  }
  if (error instanceof Error && error.name === 'AbortError') return 'İstek iptal edildi.';
  return fallback;
}

/** API tabanı: tarayıcıda göreli; sunucuda (SSR) API_INTERNAL_URL. */
function apiOrigin(): string {
  if (typeof window !== 'undefined') return '';
  return (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}

/**
 * Yol çözümleme: "/auth/me" → "/api/v1/auth/me"; "/api/..." olduğu gibi kalır.
 */
export function apiPath(path: string): string {
  if (path.startsWith('/api/')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `/api/v1${p}`;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  if (!qs) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Nesne → JSON; FormData/Blob/string olduğu gibi gönderilir. */
  body?: unknown;
  signal?: AbortSignal;
  query?: QueryParams;
  headers?: Record<string, string>;
  /** Sunucu tarafında (SSR) çerez iletmek için. */
  cookie?: string;
  cache?: RequestCache;
}

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    body instanceof ArrayBuffer
  );
}

/**
 * API çağrısı. Başarılı yanıtta JSON gövdesini (204'te undefined) döndürür; aksi halde ApiError fırlatır.
 * Çerezler her zaman gönderilir (credentials: 'include').
 */
export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = options.body !== undefined ? 'POST' : 'GET', body, signal, query, cookie, cache } = options;
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (isRawBody(body)) {
      payload = body;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  if (cookie) headers.Cookie = cookie;

  const url = `${apiOrigin()}${withQuery(apiPath(path), query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      body: payload,
      headers,
      signal,
      credentials: 'include',
      cache: cache ?? 'no-store',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', STATUS_MESSAGES[0] as string);
  }

  if (res.status === 204 || res.status === 205) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  let data: unknown = undefined;
  if (isJson) {
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
  } else if (!res.ok) {
    await res.text().catch(() => '');
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    const code = err?.code ?? `http_${res.status}`;
    const message = err?.message ?? STATUS_MESSAGES[res.status] ?? STATUS_MESSAGES[500] ?? 'Hata';
    throw new ApiError(res.status, code, message, err?.details);
  }
  return data as T;
}

const ENGLISH_VALIDATION = /^(too small|too big|invalid|expected|required|unrecognized|string must|number must)/i;

/**
 * Alan bazlı doğrulama hatalarını { alan: mesaj } biçimine çevirir.
 * Desteklenen ayrıntılar: { issues: [{ path: '/alan' | ['alan'], message }] }, Zod issue dizisi, { fieldErrors }.
 * Sunucu mesajı İngilizce (Zod varsayılanı) ise `fallback` kullanılır.
 */
export function fieldErrorsOf(error: unknown, fallback = 'Bu alanı kontrol edin.'): Record<string, string> {
  if (!isApiError(error) || !error.details) return {};
  const out: Record<string, string> = {};
  const add = (rawPath: unknown, message: unknown) => {
    let key: string | undefined;
    if (Array.isArray(rawPath)) key = rawPath.length ? String(rawPath[0]) : undefined;
    else if (typeof rawPath === 'string') key = rawPath.replace(/^\//, '').split('/')[0];
    if (!key || key in out) return;
    const msg = typeof message === 'string' && message && !ENGLISH_VALIDATION.test(message) ? message : fallback;
    out[key] = msg;
  };
  const d = error.details as Record<string, unknown> | unknown[];
  const issues = Array.isArray(d) ? d : Array.isArray((d as { issues?: unknown }).issues) ? ((d as { issues: unknown[] }).issues) : null;
  if (issues) {
    for (const issue of issues as Array<{ path?: unknown; message?: unknown }>) add(issue.path, issue.message);
  } else if (typeof d === 'object' && d !== null) {
    const fe = (d as { fieldErrors?: Record<string, string[] | string> }).fieldErrors;
    if (fe) for (const [k, v] of Object.entries(fe)) add([k], Array.isArray(v) ? v[0] : v);
    const field = (d as { field?: unknown }).field;
    if (typeof field === 'string') add([field], error.message);
  }
  return out;
}

// ---------------------------------------------------------------------------
// React Query

/** Uygulama geneli QueryClient ayarları. 4xx hataları yeniden denenmez. */
export function createQueryClient(options: { onQueryError?: (error: unknown, queryKey: QueryKey) => void } = {}): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => options.onQueryError?.(error, query.queryKey),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (isApiError(error) && error.isClientError) return false;
          return failureCount < 3;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** GET sorgusu: useApiQuery(['panel','orders'], '/panel/orders', { query: {...} }). */
export function useApiQuery<T>(
  key: QueryKey,
  path: string | null,
  options: Omit<UseQueryOptions<T, ApiError, T, QueryKey>, 'queryKey' | 'queryFn'> & { query?: QueryParams } = {},
) {
  const { query, enabled, ...rest } = options;
  return useQuery<T, ApiError, T, QueryKey>({
    queryKey: key,
    queryFn: ({ signal }) => apiFetch<T>(path as string, { signal, query }),
    enabled: path !== null && (enabled ?? true),
    ...rest,
  });
}

export interface ApiMutationConfig<TBody, TResult>
  extends Omit<UseMutationOptions<TResult, ApiError, TBody>, 'mutationFn'> {
  method?: ApiFetchOptions['method'];
  /** Başarıdan sonra geçersiz kılınacak sorgu anahtarları. */
  invalidate?: QueryKey[];
}

/**
 * Yazma çağrısı. path sabit ya da gövdeden türetilen fonksiyon olabilir:
 * useApiMutation<{id:string}>((b) => `/panel/orders/${b.id}/ack`)
 */
export function useApiMutation<TBody = unknown, TResult = unknown>(
  path: string | ((body: TBody) => string),
  config: ApiMutationConfig<TBody, TResult> = {},
) {
  const qc = useQueryClient();
  const { method = 'POST', invalidate, onSuccess, ...rest } = config;
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: (body: TBody) =>
      apiFetch<TResult>(typeof path === 'function' ? path(body) : path, {
        method,
        body,
      }),
    onSuccess: async (...args) => {
      if (invalidate) await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      await onSuccess?.(...args);
    },
    ...rest,
  });
}

/** İdempotency anahtarı (çift dokunuşa karşı, 14 §6.2 idempotencyKey). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
