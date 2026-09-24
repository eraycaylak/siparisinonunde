// Uygulama hataları → 14 §6 hata biçimi: { error: { code, message, details? } }

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message = 'Geçersiz istek.', details?: unknown, code = 'bad_request') =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Oturum açmanız gerekiyor.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Bu işlem için yetkiniz yok.', code = 'forbidden') => new AppError(403, code, message);
export const notFound = (message = 'Kayıt bulunamadı.') => new AppError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const gone = (code: string, message: string) => new AppError(410, code, message);
export const tooManyRequests = (retryAfterSec: number) =>
  new AppError(429, 'rate_limited', 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', { retryAfterSec });
