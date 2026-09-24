// Storefront verisi (sunucu tarafı): GET /api/v1/store/:slug — API_INTERNAL_URL üzerinden.
// React cache() ile aynı istekte layout, sayfa ve generateMetadata tek çağrı yapar.
// Checkout (dilim 2) da aynı yardımcıyı kullanabilir: `import { getStorefront } from '@/components/storefront/data'`.

import { cache } from 'react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { apiFetch, isApiError } from '@/lib/api';

export type { StorefrontView };

export type StorefrontResult =
  | { kind: 'ok'; store: StorefrontView }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export const getStorefront = cache(async (slug: string): Promise<StorefrontResult> => {
  try {
    const store = await apiFetch<StorefrontView>(`/store/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    return { kind: 'ok', store };
  } catch (err) {
    if (isApiError(err) && err.status === 404) return { kind: 'not_found' };
    return { kind: 'error', message: err instanceof Error ? err.message : 'Sunucuya ulaşılamadı.' };
  }
});
