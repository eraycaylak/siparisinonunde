'use client';

import type { ReactNode } from 'react';
import { RotateCcw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';

/** Tam ekran yükleniyor durumu. */
export function ScreenLoading({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-fg-muted" role="status">
      <Spinner size="lg" />
      <span className="text-base">{label}</span>
    </div>
  );
}

/** Tam ekran hata: ne oldu + ne yapmalı + [Tekrar dene] (UI-08). Oturum sorgusu ağ hatasında giriş sayfasına atmaz. */
export function ScreenError({ error, onRetry, children }: { error: unknown; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-status-new-bg text-status-new-fg">
        <WifiOff aria-hidden className="size-7" />
      </span>
      <h1 className="text-xl font-bold text-fg">Sunucuya ulaşılamadı</h1>
      <p className="max-w-md text-base text-fg-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button onClick={onRetry} size="lg">
          <RotateCcw aria-hidden />
          Tekrar dene
        </Button>
      ) : null}
      {children}
    </div>
  );
}
