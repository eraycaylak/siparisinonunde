import { describe, expect, it } from 'vitest';
import { ApiError, apiPath, errorMessage, fieldErrorsOf, withQuery } from './api';

describe('api yardımcıları', () => {
  it('yol çözümleme', () => {
    expect(apiPath('/auth/me')).toBe('/api/v1/auth/me');
    expect(apiPath('auth/me')).toBe('/api/v1/auth/me');
    expect(apiPath('/api/v1/panel/stream')).toBe('/api/v1/panel/stream');
    expect(withQuery('/x', { a: 1, b: '', c: null, d: 'ş' })).toBe('/x?a=1&d=%C5%9F');
  });

  it('alan hataları: API issues biçimi, İngilizce mesaj yerine Türkçe', () => {
    const err = new ApiError(400, 'validation_error', 'Gönderilen bilgiler geçersiz.', {
      issues: [
        { path: '/email', message: 'Invalid email address' },
        { path: '/phone', message: 'Telefon geçersiz.' },
      ],
    });
    expect(fieldErrorsOf(err)).toEqual({ email: 'Bu alanı kontrol edin.', phone: 'Telefon geçersiz.' });
  });

  it('alan hataları: zod dizi ve fieldErrors', () => {
    expect(fieldErrorsOf(new ApiError(422, 'x', 'm', [{ path: ['name'], message: 'Ad gerekli.' }]))).toEqual({ name: 'Ad gerekli.' });
    expect(fieldErrorsOf(new ApiError(422, 'x', 'm', { fieldErrors: { city: ['İl gerekli.'] } }))).toEqual({ city: 'İl gerekli.' });
  });

  it('hata metni', () => {
    expect(errorMessage(new ApiError(0, 'network_error', 'Sunucuya ulaşılamadı.'))).toBe('Sunucuya ulaşılamadı.');
    expect(errorMessage(new Error('x'), 'Varsayılan')).toBe('Varsayılan');
  });
});
