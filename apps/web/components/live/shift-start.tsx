'use client';

// "Vardiyayı başlat" tam ekran kartı (04 §4.1): dokunuş ses kilidini açar (kısa test sesi), Wake Lock ister.
// Bekleyen yeni sipariş varsa kartın üstünde kırmızı uyarı görünür (kartlar bu ekranın arkasında kalır).

import { useState } from 'react';
import { BellRing, CircleCheck, CircleX, Play, Volume2, Wifi } from 'lucide-react';
import { Button } from '@/components/ui';
import { alarmSound, type ScreenWake } from './alarm-sound';

export function ShiftStart({
  businessName,
  wake,
  waitingCount = 0,
  onStarted,
  onSkip,
}: {
  businessName: string;
  wake: ScreenWake;
  /** Bekleyen (onay bekleyen) yeni sipariş sayısı. */
  waitingCount?: number;
  onStarted: (info: { audio: boolean; wakeLock: boolean }) => void;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ audio: boolean; wakeLock: boolean } | null>(null);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  const start = async () => {
    setBusy(true);
    const audio = await alarmSound.unlock();
    const wakeLock = await wake.enable();
    setBusy(false);
    setResult({ audio, wakeLock });
    if (audio) onStarted({ audio, wakeLock });
  };

  const Check = ({ ok, children }: { ok: boolean; children: string }) => (
    <li className="flex items-center gap-2 text-base">
      {ok ? <CircleCheck aria-hidden className="size-5 text-status-ready-fg" /> : <CircleX aria-hidden className="size-5 text-status-new-fg" />}
      {children}
    </li>
  );

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="vardiya-baslik" className="fixed inset-0 z-[80] flex items-center justify-center bg-surface p-4">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 rounded-xl border border-border bg-surface-raised p-4 text-center shadow-lg sm:p-10">
        <h1 id="vardiya-baslik" className="text-2xl font-bold">
          {businessName}
        </h1>
        {waitingCount > 0 ? (
          <p role="alert" className="flex w-full items-center justify-center gap-2 rounded-md bg-band-alarm px-3 py-2 text-base font-bold text-band-alarm-fg">
            <BellRing aria-hidden className="size-5 shrink-0" />
            {waitingCount} yeni sipariş onay bekliyor
          </p>
        ) : null}
        <p className="text-base text-fg-muted">Yeni siparişleri sesli duymak için vardiyayı başlatın. Ekran açık kalır.</p>
        <Button size="xl" block onClick={start} loading={busy}>
          <Play aria-hidden /> Siparişleri almaya başla
        </Button>
        {result ? (
          <ul className="flex flex-col items-start gap-2">
            <Check ok={result.audio}>{result.audio ? 'Ses açık (ding çaldı)' : 'Ses açılamadı'}</Check>
            <Check ok={result.wakeLock}>{result.wakeLock ? 'Ekran açık kalacak' : 'Ekran kapanabilir (tarayıcı desteklemiyor)'}</Check>
            <Check ok={online}>{online ? 'İnternet bağlı' : 'İnternet yok'}</Check>
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Volume2 aria-hidden className="size-4" /> Cihazın sesini açık tutun. <Wifi aria-hidden className="size-4" />
          </p>
        )}
        {result && !result.audio ? (
          <p className="text-sm text-fg-muted">Cihaz sesini ve sessiz modu kontrol edip tekrar deneyin.</p>
        ) : null}
        <button type="button" onClick={onSkip} className="min-h-hit text-sm font-semibold text-fg-muted underline underline-offset-4">
          Sesi açmadan devam et
        </button>
      </div>
    </div>
  );
}
