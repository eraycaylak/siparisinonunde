'use client';

// "Sepetiniz güncellendi" onay akışı (K10/K12, 03 §3.4): fark listesi + eski→yeni toplam + [Güncel sepetle devam].
// Müşteri onaylamadan sipariş ilerlemez; yeni tutar onayı yeni bir onay anıdır (08 §4.4 tutar hash'i).
// Erişilebilirlik: açılışta odak başlığa gider, özet cümlesi canlı bölgede duyurulur, akış yalnız klavyeyle
// tamamlanabilir (başlık programatik odaklı, aksiyonlar yerel <button>).

import { useEffect, useId, useRef, useState } from 'react';
import { PackageX } from 'lucide-react';
import { Alert, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { CartChangeView } from './cart-change';

export interface CartChangeNoticeProps {
  view: CartChangeView;
  /** "Güncel sepetle devam": yeni toplamı onaylar. */
  onConfirm: () => void;
  /** "Vazgeçtim": siparişi iptal eder ya da menüye döner. */
  onReject: () => void;
  confirmLabel?: string;
  rejectLabel?: string;
  busy?: boolean;
  error?: string | null;
  className?: string;
}

export function CartChangeNotice({
  view,
  onConfirm,
  onReject,
  confirmLabel = 'Güncel sepetle devam',
  rejectLabel = 'Vazgeçtim, siparişi iptal et',
  busy = false,
  error = null,
  className,
}: CartChangeNoticeProps) {
  const titleId = useId();
  const listId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Canlı bölge boş doğar, özet efektte yazılır: ekran okuyucular yalnız DEĞİŞEN canlı bölgeyi duyurur.
  const [announced, setAnnounced] = useState('');

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    setAnnounced(view.summary);
  }, [view.summary]);

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={view.lines.length ? listId : undefined}
      className={cn('flex flex-col gap-4 rounded-lg border-2 border-warning/60 bg-warning-bg p-4', className)}
    >
      <p className="sr-only" role="status">
        {announced}
      </p>
      <div className="flex items-start gap-3">
        <PackageX aria-hidden className="mt-0.5 size-6 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sepetiniz güncellendi
          </h2>
          <p className="text-base text-fg-muted">Devam etmek için güncel sepeti onaylamanız gerekiyor.</p>
        </div>
      </div>

      {view.lines.length ? (
        <ul id={listId} className="flex list-disc flex-col gap-1 ps-5 text-base">
          {view.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {view.totalKurus != null ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-warning/40 pt-3">
          {view.previousTotalKurus != null && view.previousTotalKurus !== view.totalKurus ? (
            <>
              <dt className="text-fg-muted">Önceki toplam</dt>
              <dd className="text-end tabular-nums text-fg-muted line-through">{formatMoney(view.previousTotalKurus)}</dd>
            </>
          ) : null}
          {/* Döküm: fark yalnız teslimat ücretinden geliyorsa müşteri nedenini burada görür. */}
          {view.subtotalKurus != null ? (
            <>
              <dt className="text-fg-muted">Ürünler</dt>
              <dd className="text-end tabular-nums">{formatMoney(view.subtotalKurus)}</dd>
            </>
          ) : null}
          {view.deliveryFeeKurus != null ? (
            <>
              <dt className="text-fg-muted">Teslimat ücreti</dt>
              <dd className="text-end tabular-nums">{formatMoney(view.deliveryFeeKurus)}</dd>
            </>
          ) : null}
          <dt className="font-bold">Yeni toplam (KDV dahil)</dt>
          <dd className="text-end text-lg font-bold tabular-nums">{formatMoney(view.totalKurus)}</dd>
        </dl>
      ) : null}

      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="flex flex-col gap-2">
        <Button size="lg" block loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="lg" block disabled={busy} onClick={onReject}>
          {rejectLabel}
        </Button>
      </div>
    </section>
  );
}
