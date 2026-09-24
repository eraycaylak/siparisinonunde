'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BranchStatePayload, StreamEventType } from '@siparis/core/contracts/events';
import { useBranchStream, type BranchStreamEvent, type StreamStatus } from '@/lib/sse';

/** Akış yeniden bağlandığında dinleyicilere giden sanal olay (kaçanları tazeleyin). */
export const STREAM_RECONNECTED = 'stream.reconnected';

type Listener = (event: BranchStreamEvent) => void;

interface PanelStreamValue {
  status: StreamStatus;
  lastEventAt: number | null;
  /** Son "branch.state" olayı (üst bar sipariş alma durumu). */
  branchState: BranchStatePayload | null;
  subscribe: (listener: Listener) => () => void;
  reconnect: () => void;
}

const PanelStreamContext = createContext<PanelStreamValue | null>(null);

/**
 * Panel genelinde tek SSE bağlantısı (yeni sipariş başka ekrandayken de duyulur, 04 §1.1 #1).
 * Sayfalar ikinci bağlantı açmaz; usePanelEvent ile abone olur.
 */
export function PanelStreamProvider({
  branchId,
  enabled,
  children,
}: {
  branchId: string | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const listeners = useRef(new Set<Listener>());
  const [branchState, setBranchState] = useState<BranchStatePayload | null>(null);

  const dispatch = useCallback((event: BranchStreamEvent) => {
    for (const l of listeners.current) {
      try {
        l(event);
      } catch (err) {
        console.error('[panel-stream] dinleyici hatası', err);
      }
    }
  }, []);

  const onEvent = useCallback(
    (event: BranchStreamEvent) => {
      if (event.type === 'branch.state') setBranchState(event.data as BranchStatePayload);
      dispatch(event);
    },
    [dispatch],
  );

  const stream = useBranchStream(branchId, onEvent, {
    enabled,
    onOpen: ({ reconnected }) => {
      if (reconnected) dispatch({ type: STREAM_RECONNECTED, data: null, id: null, receivedAt: Date.now() });
    },
  });

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<PanelStreamValue>(
    () => ({ status: stream.status, lastEventAt: stream.lastEventAt, branchState, subscribe, reconnect: stream.reconnect }),
    [stream.status, stream.lastEventAt, branchState, subscribe, stream.reconnect],
  );

  return <PanelStreamContext.Provider value={value}>{children}</PanelStreamContext.Provider>;
}

/** Panel akış durumu; sağlayıcı dışında null. */
export function usePanelStream(): PanelStreamValue | null {
  return useContext(PanelStreamContext);
}

/**
 * Olaylara abone ol: usePanelEvent(['order.created','order.updated'], (e) => …).
 * '*' tüm olaylar; STREAM_RECONNECTED ve 'resync' ile /panel/orders/active tazelenmeli.
 */
export function usePanelEvent(
  types: ReadonlyArray<StreamEventType | typeof STREAM_RECONNECTED> | '*',
  handler: (event: BranchStreamEvent) => void,
): void {
  const ctx = useContext(PanelStreamContext);
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  const key = types === '*' ? '*' : types.join(',');
  useEffect(() => {
    if (!ctx) return;
    const wanted = key === '*' ? null : new Set(key.split(','));
    return ctx.subscribe((e) => {
      if (!wanted || wanted.has(e.type)) handlerRef.current(e);
    });
  }, [ctx, key]);
}
