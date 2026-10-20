import type { Metadata } from 'next';
import { QrCode } from 'lucide-react';

// Bilinmeyen QR kodu (00 §12a madde 11, O4): nötr bilgi. Liste, öneri, başka işletme, platform tanıtımı ya da panel
// bağlantısı YOKTUR (yalnız yazılım; dizin görünümü yok). Arama motorlarına kapalı.
export const metadata: Metadata = {
  title: { absolute: 'QR kodu bulunamadı' },
  description: 'Bu QR kodu bir sipariş sayfasına bağlı değil.',
  robots: { index: false, follow: false },
};

export default function QrNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-4 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-surface text-fg-muted">
        <QrCode aria-hidden className="size-8" />
      </span>
      <h1 className="text-3xl font-bold text-fg">QR kodu bulunamadı</h1>
      <p className="max-w-md text-lg text-fg-muted">
        Bu QR kodu bir sipariş sayfasına bağlı değil. Kodu yeniden okutun ya da işletmeden güncel bağlantıyı isteyin.
      </p>
    </main>
  );
}
