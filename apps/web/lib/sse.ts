'use client';

// Şube olay akışı (14 §7.1): GET /api/v1/panel/stream?branchId= (SSE).
// Tarayıcı kendi yeniden bağlanmasında Last-Event-ID başlığını otomatik gönderir.
// Sunucu bağlantıyı kapatırsa (401/5xx) biz geri çekilmeyle yeniden bağlanırız ve
// son olay kimliğini ?lastEventId= ile iletiriz (yeni EventSource başlığı göndermez).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { STREAM_EVENT_TYPES, type StreamEventMap, type StreamEventType } from '@siparis/core/contracts/events';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline';

export type { StreamEventMap, StreamEventType };

export interface BranchStreamEvent<T = unknown> {
  /** 14 §7.1 olay adı ('order.created', 'order.updated', 'order.alarm', 'conversation.*', 'branch.state', 'resync'). */
  type: StreamEventType | (string & {});
  data: T;
  /** branch_events.seq (Last-Event-ID). */
  id: string | null;
  receivedAt: number;
}

export interface BranchStreamOptions {
  enabled?: boolean;
  /** Bağlantı (yeniden) açıldığında; reconnected=true ise kaçan veriyi tazeleyin (ör. /panel/orders/active). */
  onOpen?: (info: { reconnected: boolean }) => void;
  /** Bu süre boyunca hiç olay (ping dahil) gelmezse bağlantı yenilenir. Varsayılan 45 sn. */
  staleAfterMs?: number;
  /** Ek olay türleri (varsayılan: 14 §7.1 listesi). */
  extraEventTypes?: string[];
  /** Test/özel uç nokta için yol. Varsayılan /api/v1/panel/stream. */
  path?: string;
}

export interface BranchStreamState {
  status: StreamStatus;
  lastEventId: string | null;
  lastEventAt: number | null;
  /** Bağlantıyı hemen yeniden kurar. */
  reconnect: () => void;
}

// ---------------------------------------------------------------------------
// Uygulama geneli bağlantı durumu (üst bar göstergesi okur)

interface GlobalStreamSnapshot {
  status: StreamStatus;
  lastEventAt: number | null;
  since: number;
}

let globalSnapshot: GlobalStreamSnapshot = { status: 'idle', lastEventAt: null, since: 0 };
const globalListeners = new Set<() => void>();

function setGlobal(patch: Partial<GlobalStreamSnapshot>): void {
  const next = { ...globalSnapshot, ...patch };
  if (patch.status && patch.status !== globalSnapshot.status) next.since = Date.now();
  if (next.status === globalSnapshot.status && next.lastEventAt === globalSnapshot.lastEventAt) return;
  globalSnapshot = next;
  for (const l of globalListeners) l();
}

function subscribeGlobal(listener: () => void): () => void {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

const serverSnapshot: GlobalStreamSnapshot = { status: 'idle', lastEventAt: null, since: 0 };

/** Açık akışın durumu (sayfada akış yoksa 'idle'). */
export function useStreamStatus(): GlobalStreamSnapshot {
  return useSyncExternalStore(
    subscribeGlobal,
    () => globalSnapshot,
    () => serverSnapshot,
  );
}

// ---------------------------------------------------------------------------

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

function buildUrl(path: string, branchId: string | null, lastEventId: string | null): string {
  const sp = new URLSearchParams();
  if (branchId) sp.set('branchId', branchId);
  if (lastEventId) sp.set('lastEventId', lastEventId);
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

function parseData(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Olay türüne göre daraltma: if (isStreamEvent(e, 'order.created')) e.data.order … */
export function isStreamEvent<K extends StreamEventType>(
  event: BranchStreamEvent,
  type: K,
): event is BranchStreamEvent<StreamEventMap[K]> & { type: K } {
  return event.type === type;
}

/**
 * Şube olay akışına bağlanır. branchId null ise parametresiz bağlanır (API varsayılan şubeyi seçer).
 * onEvent her render'da değişebilir; son hali çağrılır.
 */
export function useBranchStream<T = unknown>(
  branchId: string | null | undefined,
  onEvent: (event: BranchStreamEvent<T>) => void,
  options: BranchStreamOptions = {},
): BranchStreamState {
  const { enabled = true, staleAfterMs = 45_000, path = '/api/v1/panel/stream' } = options;
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(options.onOpen);
  const lastEventIdRef = useRef<string | null>(null);
  const extraTypesKey = (options.extraEventTypes ?? []).join(',');

  useEffect(() => {
    onEventRef.current = onEvent;
    onOpenRef.current = options.onOpen;
  });

  // Şube değişince eski kimlik geçersiz.
  useEffect(() => {
    lastEventIdRef.current = null;
  }, [branchId]);

  const reconnect = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || branchId === undefined || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setStatus('idle');
      setGlobal({ status: 'idle' });
      return;
    }

    let es: EventSource | null = null;
    let disposed = false;
    let attempt = 0;
    let everOpened = false;
    let lastActivity = Date.now();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const update = (s: StreamStatus) => {
      if (disposed) return;
      setStatus(s);
      setGlobal({ status: s });
    };

    const touch = () => {
      lastActivity = Date.now();
      setLastEventAt(lastActivity);
      setGlobal({ lastEventAt: lastActivity });
    };

    const handle = (type: string) => (ev: MessageEvent<string>) => {
      touch();
      if (ev.lastEventId) lastEventIdRef.current = ev.lastEventId;
      const data = parseData(ev.data);
      let eventType = type;
      if (type === 'message' && data && typeof data === 'object' && 'type' in data) {
        eventType = String((data as { type: unknown }).type);
      }
      if (eventType === 'ping') return;
      try {
        onEventRef.current({
          type: eventType,
          data: (type === 'message' && data && typeof data === 'object' && 'data' in data
            ? (data as { data: unknown }).data
            : data) as T,
          id: ev.lastEventId || null,
          receivedAt: lastActivity,
        });
      } catch (err) {
        console.error('[sse] olay işleyici hatası', err);
      }
    };

    const types = Array.from(new Set<string>([...STREAM_EVENT_TYPES, ...(extraTypesKey ? extraTypesKey.split(',') : [])]));

    const close = () => {
      if (es) {
        es.close();
        es = null;
      }
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 30_000;
      attempt += 1;
      update(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      close();
      update(everOpened ? 'reconnecting' : 'connecting');
      const source = new EventSource(buildUrl(path, branchId, lastEventIdRef.current), { withCredentials: true });
      es = source;
      source.onopen = () => {
        const reconnected = everOpened;
        everOpened = true;
        attempt = 0;
        touch();
        update('open');
        onOpenRef.current?.({ reconnected });
      };
      source.onerror = () => {
        if (disposed || es !== source) return;
        if (source.readyState === EventSource.CLOSED) {
          close();
          scheduleRetry();
        } else {
          // Tarayıcı kendisi yeniden bağlanıyor (Last-Event-ID ile).
          update(navigator.onLine === false ? 'offline' : 'reconnecting');
        }
      };
      source.addEventListener('message', handle('message') as EventListener);
      for (const t of types) source.addEventListener(t, handle(t) as EventListener);
    };

    // Sessiz kopmaya karşı bekçi: ping 15 sn'de bir gelir; 45 sn sessizlikte yeniden bağlan.
    const watchdog = setInterval(() => {
      if (!es || disposed) return;
      if (Date.now() - lastActivity > staleAfterMs) {
        close();
        attempt = 0;
        connect();
      }
    }, 5_000);

    const onOnline = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      attempt = 0;
      connect();
    };
    const onOffline = () => update('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    connect();

    return () => {
      disposed = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      close();
      setGlobal({ status: 'idle' });
    };
  }, [branchId, enabled, nonce, path, staleAfterMs, extraTypesKey]);

  return { status, lastEventId: lastEventIdRef.current, lastEventAt, reconnect };
}
