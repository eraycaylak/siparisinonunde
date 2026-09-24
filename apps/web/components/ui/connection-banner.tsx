'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleCheck, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { useStreamStatus, type StreamStatus } from '@/lib/sse';
import { Banner } from './banner';
import { Button } from './button';

/** Yeniden bağlanma bu süreyi aşarsa kırmızı "Bağlantı yok" gösterilir (04 §4.17: 45 sn). */
const OFFLINE_ESCALATE_MS = 45_000;

export interface ConnectionBannerProps {
  /** Verilmezse sayfadaki akışın genel durumu okunur (useStreamStatus). */
  status?: StreamStatus;
  /** Durumun başladığı an (ms). */
  since?: number;
  lastEventAt?: number | null;
  onRetry?: () => void;
  className?: string;
}

/**
 * Bağlantı bandı (UI-09): yeniden bağlanıyor (amber) → 45 sn sonra ya da çevrimdışıyken kırmızı;
 * bağlantı dönünce 5 sn yeşil "Bağlantı geri geldi".
 */
export function ConnectionBanner(props: ConnectionBannerProps) {
  const global = useStreamStatus();
  const status = props.status ?? global.status;
  const since = props.since ?? global.since;
  const lastEventAt = props.lastEventAt ?? global.lastEventAt;
  const [now, setNow] = useState(() => Date.now());
  const [restored, setRestored] = useState(false);
  const prev = useRef<StreamStatus>(status);

  useEffect(() => {
    const wasDown = prev.current === 'reconnecting' || prev.current === 'offline';
    prev.current = status;
    if (status === 'open' && wasDown) {
      setRestored(true);
      const t = setTimeout(() => setRestored(false), 5_000);
      return () => clearTimeout(t);
    }
    if (status !== 'open') setRestored(false);
    return undefined;
  }, [status]);

  useEffect(() => {
    if (status !== 'reconnecting') return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [status]);

  const lastText = lastEventAt ? ` Son güncelleme ${formatTime(lastEventAt)}.` : '';

  if (status === 'offline' || (status === 'reconnecting' && since > 0 && now - since > OFFLINE_ESCALATE_MS)) {
    return (
      <Banner
        tone="alarm"
        icon={WifiOff}
        className={props.className}
        action={
          props.onRetry ? (
            <Button variant="secondary" size="sm" onClick={props.onRetry}>
              Tekrar dene
            </Button>
          ) : undefined
        }
      >
        Bağlantı yok — yeni siparişler gelmeyebilir. İnterneti kontrol edin.{lastText}
      </Banner>
    );
  }
  if (status === 'reconnecting') {
    return (
      <Banner tone="warn" icon={RefreshCw} className={props.className}>
        Yeniden bağlanıyor… Yeni siparişler birkaç saniye gecikebilir.
      </Banner>
    );
  }
  if (restored) {
    return (
      <Banner tone="ok" icon={CircleCheck} className={props.className}>
        Bağlantı geri geldi.
      </Banner>
    );
  }
  return null;
}

/** Üst bar bağlantı göstergesi: "Canlı" / "Bağlanıyor" / "Bağlantı yok" (ikon + kelime). */
export function ConnectionIndicator({ className }: { className?: string }) {
  const { status } = useStreamStatus();
  if (status === 'idle') return null;
  const map = {
    open: { text: 'Canlı', dot: 'bg-status-ready-fg', cls: 'text-fg' },
    connecting: { text: 'Bağlanıyor', dot: 'bg-band-warn animate-pulse', cls: 'text-fg-muted' },
    reconnecting: { text: 'Bağlanıyor', dot: 'bg-band-warn animate-pulse', cls: 'text-fg-muted' },
    offline: { text: 'Bağlantı yok', dot: '', cls: 'text-status-new-fg' },
  } as const;
  const m = map[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold', m.cls, className)}>
      {status === 'offline' ? (
        <WifiOff aria-hidden className="size-4" />
      ) : (
        <span aria-hidden className={cn('size-2.5 rounded-full', m.dot)} />
      )}
      <span>{m.text}</span>
    </span>
  );
}
