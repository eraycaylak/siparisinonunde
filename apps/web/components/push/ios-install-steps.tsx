'use client';

// iOS "Ana Ekrana Ekle" rehberinin görünümü. İki yerde kullanılır:
//  1) Vardiya başlat ekranı (04 §4.1) — ses/izin akışının yanında, [Nasıl eklenir?] ile çekmece açılır.
//  2) Ayarlar › Bu cihazda bildirimler — aynı adımlar, kutu içinde.
// Metinler components/push/ios-install.ts içindedir (saf, birim testli).

import { useEffect, useState } from 'react';
import { Share, Smartphone } from 'lucide-react';
import { Alert, Button, Sheet } from '@/components/ui';
import { currentPlatform } from './push-client';
import { IOS_INSTALL_SHORT, iosBrowserOf, iosInstallGuide, shouldOfferIosInstall, type IosInstallGuide } from './ios-install';

/** Saf adım listesi (birim testinde `renderToStaticMarkup` ile sınanır). */
export function IosInstallSteps({ guide }: { guide: IosInstallGuide }) {
  return (
    <div className="flex flex-col gap-3 text-start">
      <p className="text-base text-fg">{guide.why}</p>
      <ol className="list-decimal space-y-2 ps-5 text-base text-fg">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.fallback ? <p className="text-sm text-fg-muted">{guide.fallback}</p> : null}
    </div>
  );
}

/** Ayarlar ekranındaki kutu (eski satır içi listenin yerine; tek kaynak). */
export function IosInstallAlert({ guide }: { guide: IosInstallGuide }) {
  return (
    <Alert variant="info" title={guide.title}>
      <IosInstallSteps guide={guide} />
    </Alert>
  );
}

/**
 * Vardiya ekranındaki uyarı + rehber çekmecesi. iOS değilse ya da panel ana ekrandan açıldıysa hiçbir şey basmaz.
 * Platform yalnız bağlanmadan SONRA okunur: sunucu render'ında `navigator` yoktur, doğrudan okumak hidrasyon
 * uyuşmazlığı üretir.
 */
export function IosInstallPrompt({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState<IosInstallGuide | null>(null);

  useEffect(() => {
    if (!shouldOfferIosInstall(currentPlatform())) return;
    setGuide(iosInstallGuide(iosBrowserOf(navigator.userAgent)));
  }, []);

  if (!guide) return null;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-start">
        <Smartphone aria-hidden className="size-5 shrink-0 text-fg-muted" />
        <p className="min-w-0 flex-1 text-sm font-semibold text-fg">{IOS_INSTALL_SHORT}</p>
        <Button variant="secondary" size="md" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Share aria-hidden /> Nasıl eklenir?
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen} title={guide.title} size="lg" footer={<Button variant="secondary" block onClick={() => setOpen(false)}>Kapat</Button>}>
        <IosInstallSteps guide={guide} />
      </Sheet>
    </div>
  );
}
