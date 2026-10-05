// WhatsApp gönderim hataları ve Meta hata kodu eşlemesi (02 §10.1, §7.7).

export type WaErrorAction =
  /** 131047: 24 saat penceresi kapalı → aynı içerik için şablona düş */
  | 'window_closed'
  /** 131026: teslim edilemez (WhatsApp yok / eski sürüm) */
  | 'undeliverable'
  /** 190: token geçersiz → hesap 'error', gönderim duraklar */
  | 'account_token'
  /** 131042: ödeme/uygunluk → hesap 'error', gönderim duraklar */
  | 'account_payment'
  /** 131049 / 131050: pazarlama bastırma (Faz 2 kampanya) */
  | 'marketing_suppressed'
  /** 132xxx: şablon hatası */
  | 'template_error'
  /** Ağ hatası, 5xx, 130429, 131056, 4, 80007 → geri çekilip yeniden dene */
  | 'retry'
  /** Diğer: kalıcı hata */
  | 'fail';

export function classifyWaErrorCode(code: string | number | null | undefined, httpStatus?: number | null): WaErrorAction {
  const c = code == null ? '' : String(code);
  switch (c) {
    case '131047':
      return 'window_closed';
    case '131026':
      return 'undeliverable';
    case '190':
      return 'account_token';
    case '131042':
      return 'account_payment';
    case '131049':
    case '131050':
      return 'marketing_suppressed';
    case '130429':
    case '131056':
    case '4':
    case '80007':
    case '131000':
    case '131016':
    case 'network':
    case 'timeout':
      return 'retry';
  }
  if (/^132\d{3}$/.test(c)) return 'template_error';
  if (httpStatus != null && httpStatus >= 500) return 'retry';
  if (httpStatus === 429) return 'retry';
  return 'fail';
}

/**
 * "Mesaj sınırı" hatası mı (131048). Meta bu kodu İKİ durumda döndürür: numaranın spam kısıtı ve numaranın
 * 24 saatlik MESSAGING LIMIT tavanının dolması. Sınıflandırma `fail` olarak KALIR (docs/02 §10.1 "yeniden dene:
 * hayır" — spam kısıtına körlemesine yeniden denemek kaliteyi daha da düşürür), ama ortak numarada bu kod
 * PLATFORM arızasıdır: tüm dükkanların yeni müşteriye giden mesajları durur. Eskiden yalnız `markFailed` +
 * `log.warn` üretiyordu, kimse görmüyordu (denetim açık soru 2). Artık `services/messaging/waba-quota.ts`
 * kritik uyarı gönderir.
 */
export const MESSAGING_LIMIT_CODE = '131048';

export function isMessagingLimitCode(code: string | number | null | undefined): boolean {
  return code != null && String(code) === MESSAGING_LIMIT_CODE;
}

export class WaSendError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly action: WaErrorAction;
  readonly retryable: boolean;

  constructor(code: string | number, message: string, opts: { httpStatus?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = 'WaSendError';
    this.code = String(code);
    this.httpStatus = opts.httpStatus ?? null;
    this.action = classifyWaErrorCode(this.code, this.httpStatus);
    this.retryable = opts.retryable ?? this.action === 'retry';
  }
}

export function isWaSendError(err: unknown): err is WaSendError {
  return err instanceof WaSendError;
}

/** Hesap sağlığı için kısa Türkçe açıklama (wa_accounts.last_error, platform uyarısı). */
export function waErrorSummary(err: WaSendError): string {
  switch (err.action) {
    case 'account_token':
      return 'Erişim anahtarı geçersiz ya da süresi dolmuş (190)';
    case 'account_payment':
      return 'Meta ödeme yöntemi eksik ya da geçersiz (131042)';
    case 'window_closed':
      return '24 saat penceresi kapalı (131047)';
    case 'undeliverable':
      return 'Mesaj teslim edilemedi, müşterinin WhatsApp’ı yok olabilir (131026)';
    case 'template_error':
      return `Şablon hatası (${err.code})`;
    case 'retry':
      return `Geçici hata (${err.code})`;
    default:
      if (isMessagingLimitCode(err.code)) return 'Numaranın mesaj sınırı doldu ya da kısıtlandı (131048)';
      return `Gönderim hatası (${err.code}): ${err.message}`.slice(0, 300);
  }
}
