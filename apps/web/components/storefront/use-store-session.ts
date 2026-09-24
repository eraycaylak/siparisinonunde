'use client';

/**
 * Storefront oturumu (14 §6.2, 03 §3.1 adım 3): sayfa açılınca POST /store/:slug/session.
 * URL'de ?l=<token> varsa gövdeyle gönderilir; başarıda token adres çubuğundan silinir (history.replaceState).
 * Token GET isteğinde tüketilmez (önizleme/prefetch yakmasın) — yalnız bu POST çerez (sf_link_<slug>) yazar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreSessionView } from '@siparis/core/menu/contracts';
import { apiFetch } from '@/lib/api';

export type StoreSessionState =
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: StoreSessionView }
  | { status: 'error'; data: null };

const EMPTY_SESSION: StoreSessionView = { customer: null, lastOrder: null, linkStatus: 'none', lastOrderSource: null };

export function useStoreSession(slug: string) {
  const [state, setState] = useState<StoreSessionState>({ status: 'loading', data: null });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    const linkToken = url.searchParams.get('l');
    apiFetch<StoreSessionView>(`/store/${encodeURIComponent(slug)}/session`, {
      method: 'POST',
      body: linkToken ? { linkToken } : {},
    })
      .then((data) => {
        setState({ status: 'ready', data });
        if (linkToken) {
          url.searchParams.delete('l');
          window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        }
      })
      .catch(() => setState({ status: 'error', data: null }));
  }, [slug]);

  /** "Ben değilim" / "Bu cihazı unut": çerezleri siler, bağlamı temizler. */
  const forget = useCallback(async () => {
    await apiFetch(`/store/${encodeURIComponent(slug)}/session`, { method: 'DELETE' });
    setState({ status: 'ready', data: EMPTY_SESSION });
  }, [slug]);

  return { ...state, forget };
}
