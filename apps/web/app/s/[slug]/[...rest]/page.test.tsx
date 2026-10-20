// Vitrin altında eşleşmeyen yol (O3, 00 §12a madde 11): kök 404'e (platform/panel bağlantılı) değil, vitrinin nötr
// 404'üne (app/s/not-found.tsx) düşmesi için notFound() çağrılır.

import { describe, expect, it } from 'vitest';
import StorefrontUnknownPath, { metadata } from './page';

describe('/s/[slug]/[...rest]', () => {
  it('notFound() fırlatır (en yakın sınır app/s/not-found.tsx)', () => {
    let digest: unknown;
    try {
      StorefrontUnknownPath();
    } catch (err) {
      digest = (err as { digest?: unknown }).digest;
    }
    expect(String(digest)).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('nötr başlık ve önizleme (kök düzenin "Yemek Gelsin · …" başlığı görünmez), noindex', () => {
    expect(metadata.title).toEqual({ absolute: 'Sayfa bulunamadı' });
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(JSON.stringify(metadata)).not.toContain('Yemek Gelsin');
  });
});
