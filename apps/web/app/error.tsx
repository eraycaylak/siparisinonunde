'use client';

import { useEffect } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Rota hata sınırı (UI-08): ne oldu + ne yapmalı + [Tekrar dene]; teknik kod yalnız "Ayrıntı" altında. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-status-new-bg text-status-new-fg">
        <TriangleAlert aria-hidden className="size-8" />
      </span>
      <h1 className="text-2xl font-bold text-fg sm:text-3xl">Bir şeyler ters gitti</h1>
      <p className="max-w-md text-lg text-fg-muted">Sayfa yüklenirken beklenmeyen bir hata oluştu. Tekrar deneyin; sorun sürerse bize yazın.</p>
      <Button size="lg" onClick={reset}>
        <RotateCcw aria-hidden />
        Tekrar dene
      </Button>
      {error.digest ? (
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">Ayrıntı</summary>
          <p className="mt-1 font-mono">Hata kodu: {error.digest}</p>
        </details>
      ) : null}
    </main>
  );
}
