'use client';

// Fiş yazdırma görünümü (04 §4.14): 80 mm (ya da 58 mm) CSS, window.print. Mutfak fişi fiyatsız ve kişisel verisiz;
// paket fişinde adres ve tarif tam, telefon maskeli, "Mali değeri yoktur". Yeniden baskıda "KOPYA".

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Receipt } from '@siparis/core/orders/contracts';
import { Button, Spinner } from '@/components/ui';
import { errorMessage, useApiQuery } from '@/lib/api';
import { formatMoney, trUpper } from '@/lib/format';

export function ReceiptPrint({ orderId }: { orderId: string }) {
  const sp = useSearchParams();
  const type = sp.get('type') === 'delivery' ? 'delivery' : 'kitchen';
  const width = sp.get('width') === '58' ? 58 : 80;
  const auto = sp.get('auto') === '1';
  const q = useApiQuery<Receipt>(['receipt', orderId, type], `/panel/orders/${orderId}/receipt`, {
    query: { type, print: '1' },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
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
  if (q.isError || !q.data) return <p className="p-4">{errorMessage(q.error, 'Fiş yüklenemedi.')}</p>;
  const r = q.data;
  return (
    <div className="bg-white text-black">
      <style>{`
        @page { size: ${width}mm auto; margin: 2mm; }
        @media print { .no-print { display: none !important; } body { background: #fff !important; } }
        .receipt { width: ${width - 4}mm; margin: 0 auto; font: 13px/1.35 system-ui, sans-serif; color: #000; }
        .receipt hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
      `}</style>
      <div className="no-print flex justify-center gap-2 p-3">
        <Button onClick={() => window.print()}>Yazdır</Button>
        <Button variant="secondary" onClick={() => window.close()}>
          Kapat
        </Button>
      </div>
      <div className="receipt">
        <p className="text-center font-bold">{r.business.name}</p>
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
              <div key={j} className={o.removal ? 'ps-3 text-[15px] font-extrabold' : 'ps-3'}>
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
            <div className="flex justify-between text-base font-extrabold">
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
        <hr />
        <p className="text-center text-[11px]">
          {r.footer} · {r.printedAt}
        </p>
      </div>
    </div>
  );
}
