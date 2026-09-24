'use client';

import './globals.css';

/** Kök düzen hatası: kendi <html> ve <body>'sini çizer. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="tr">
      <body className="min-h-dvh bg-bg text-fg">
        <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-2xl font-bold">Bir şeyler ters gitti</h1>
          <p className="max-w-md text-lg text-fg-muted">Sayfa yüklenemedi. Tekrar deneyin; sorun sürerse bize yazın.</p>
          <button
            type="button"
            onClick={reset}
            className="min-h-12 rounded-md bg-primary px-5 text-base font-semibold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Tekrar dene
          </button>
          {error.digest ? <p className="text-sm text-fg-muted">Hata kodu: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
