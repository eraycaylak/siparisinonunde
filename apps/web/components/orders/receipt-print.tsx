'use client';

// Fiş yazdırma görünümü (04 §4.14): 80 mm (ya da 58 mm) CSS, window.print. Mutfak fişi fiyatsız ve kişisel verisiz;
// paket fişinde adres ve tarif tam, telefon maskeli, "Mali değeri yoktur". Yeniden baskıda "KOPYA".
// Şube fiş ayarları (branches.receipt_settings → Receipt.layout/waLine/footerText) uygulanır: genişlik, yazı boyutu,
// kopya sayısı, işletme adı boyutu, WhatsApp satırı, alt bilgi. `?type=kitchen,delivery` birden çok fişi art arda basar.

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Receipt } from '@siparis/core/orders/contracts';
import { Button, Spinner } from '@/components/ui';
import { apiFetch, errorMessage, type ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, trUpper } from '@/lib/format';

type Kind = 'kitchen' | 'delivery';

function parseKinds(raw: string | null): Kind[] {
  const out: Kind[] = [];
  for (const part of (raw ?? '').split(',')) {
    const k = part.trim();
    if ((k === 'kitchen' || k === 'delivery') && !out.includes(k)) out.push(k);
  }
  return out.length ? out : ['kitchen'];
}

export function ReceiptPrint({ orderId }: { orderId: string }) {
  const sp = useSearchParams();
  const kinds = parseKinds(sp.get('type'));
  const widthParam = sp.get('width');
  const auto = sp.get('auto') === '1';
  const q = useQuery<Receipt[], ApiError>({
    queryKey: ['receipt', orderId, kinds.join(',')],
    // `signal` bilerek kullanılmaz: print=1 baskıyı kaydeder; iptal edilip yeniden istenirse (ör. React StrictMode'da
    // bağla-sök-bağla) ilk baskı "KOPYA" görünürdü. Sinyal tüketilmeyince React Query süren isteği yeniden kullanır.
    queryFn: () => Promise.all(kinds.map((type) => apiFetch<Receipt>(`/panel/orders/${orderId}/receipt`, { query: { type, print: '1' } }))),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const printed = useRef(false);
  useEffect(() => {
    if (q.data && auto && !printed.current) {
      printed.current = true;
      const t = setTimeout(() => window.print(), 150);
      return () => clearTimeout(t);
    }
  }, [q.data, auto]);

  if (q.isPending) return <Spinner label="Fiş hazırlanıyor" />;
  if (q.isError || !q.data?.length) return <p className="p-4">{errorMessage(q.error, 'Fiş yüklenemedi.')}</p>;
  const first = q.data[0]!;
  const width = widthParam === '58' ? 58 : widthParam === '80' ? 80 : first.layout.widthMm;
  const pages = q.data.flatMap((r) => Array.from({ length: r.layout.copies }, (_, i) => ({ r, key: `${r.type}-${i}` })));
  return (
    <div className="bg-white text-black">
      <style>{`
        @page { size: ${width}mm auto; margin: 2mm; }
        @media print { .no-print { display: none !important; } body { background: #fff !important; } }
        .receipt { width: ${width - 4}mm; margin: 0 auto; font-family: system-ui, sans-serif; line-height: 1.35; color: #000; }
        .receipt hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .receipt + .receipt { break-before: page; page-break-before: always; }
        @media screen { .receipt + .receipt { margin-top: 16px; border-top: 2px dashed #999; padding-top: 8px; } }
      `}</style>
      <div className="no-print flex justify-center gap-2 p-3">
        <Button onClick={() => window.print()}>Yazdır</Button>
        <Button variant="secondary" onClick={() => window.close()}>
          Kapat
        </Button>
      </div>
      {pages.map(({ r, key }) => (
        <ReceiptBody key={key} r={r} />
      ))}
    </div>
  );
}

function ReceiptBody({ r }: { r: Receipt }) {
  const large = r.layout.fontSize === 'large';
  return (
    <div className={cn('receipt', large ? 'text-[15px]' : 'text-[13px]')}>
      <p className={cn('text-center font-bold', r.layout.showLogo && 'text-lg')}>{r.business.name}</p>
      {r.copy ? <p className="text-center text-base font-extrabold">KOPYA</p> : null}
      <p className="text-center text-3xl font-extrabold">#{r.number}</p>
      <p className="text-center font-bold">{trUpper(r.fulfillmentLabel)}</p>
      <p className="text-center">
        Sipariş {r.placedAt}
        {r.estimatedReadyAt ? ` · Hedef ${r.estimatedReadyAt}` : ''}
      </p>
      <hr />
      {r.items.map((i, idx) => (
        <div key={idx} className="mb-1">
          <div className="flex justify-between gap-2">
            <span className="font-bold">
              {i.quantity}× {i.name}
            </span>
            {i.lineTotalKurus != null ? <span className="whitespace-nowrap">{formatMoney(i.lineTotalKurus)}</span> : null}
          </div>
          {i.options.map((o, j) => (
            <div key={j} className={o.removal ? 'ps-3 text-[1.15em] font-extrabold' : 'ps-3'}>
              {o.removal ? trUpper(o.text) : o.text}
            </div>
          ))}
          {i.note ? <div className="ms-3 bg-neutral-200 px-1">Not: {i.note}</div> : null}
        </div>
      ))}
      {r.note ? (
        <>
          <hr />
          <p className="bg-neutral-200 px-1 font-bold">Sipariş notu: {r.note}</p>
        </>
      ) : null}
      {r.wantsCutlery ? <p>Çatal-bıçak isteniyor</p> : null}
      {r.customer ? (
        <>
          <hr />
          {r.customer.name ? <p className="font-bold">{r.customer.name}</p> : null}
          {r.customer.phoneMasked ? <p>Tel: {r.customer.phoneMasked}</p> : null}
          {r.customer.neighborhood ? <p>{r.customer.neighborhood} Mah.</p> : null}
          {r.customer.addressLine ? <p>{r.customer.addressLine}</p> : null}
          {r.customer.directions ? <p className="font-bold">Tarif: {r.customer.directions}</p> : null}
        </>
      ) : null}
      {r.totals ? (
        <>
          <hr />
          <div className="flex justify-between">
            <span>Ara toplam</span>
            <span>{formatMoney(r.totals.subtotalKurus)}</span>
          </div>
          {r.totals.deliveryFeeKurus ? (
            <div className="flex justify-between">
              <span>Teslimat</span>
              <span>{formatMoney(r.totals.deliveryFeeKurus)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-[1.15em] font-extrabold">
            <span>TOPLAM (KDV dahil)</span>
            <span>{formatMoney(r.totals.totalKurus)}</span>
          </div>
        </>
      ) : null}
      {r.payment ? (
        <>
          <p className="font-bold">{trUpper(r.payment.label)}</p>
          {r.payment.changeForKurus && r.payment.changeKurus ? (
            <p>
              {formatMoney(r.payment.changeForKurus)}&apos;ye para üstü: {formatMoney(r.payment.changeKurus)}
            </p>
          ) : null}
        </>
      ) : null}
      {r.waLine || r.footerText ? (
        <>
          <hr />
          {r.waLine ? <p className="text-center">{r.waLine}</p> : null}
          {r.footerText ? <p className="whitespace-pre-wrap text-center">{r.footerText}</p> : null}
        </>
      ) : null}
      <hr />
      <p className="text-center text-[11px]">
        {r.footer} · {r.printedAt}
      </p>
    </div>
  );
}
