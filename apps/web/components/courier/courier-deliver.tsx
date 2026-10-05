'use client';

// Kurye teslim alt sayfaları (04 §9.2): "Teslim ettim" (ödeme yöntemi) ve "Teslim edilemedi" (sebep çipleri).
// Teslim gönderimi 5 sn "Geri al" penceresinden sonra gider (yanlışlıkla basılan teslim geri alınabilsin).

import { useEffect, useState } from 'react';
import type { CourierOrder } from '@siparis/core/orders/contracts';
import { MEAL_CARD_BRAND_LABELS, type MealCardBrand } from '@siparis/core/enums';
import { DELIVERY_FAILURE_REASONS, DELIVERY_FAILURE_REASON_LABELS, type DeliveryFailureReason } from '@siparis/core/orders/delivery';
import { Alert, Button, Field, RadioGroup, Select, Sheet, Textarea } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { paymentCourierLabel } from '@/components/orders/labels';
import { deliverOptions, deliverReady, type DeliverMode } from './courier-logic';

/** Teslim + ödeme alt sayfası: "285 TL nakit alındı" (varsayılan) ya da şubede açık farklı bir yöntem. */
export function DeliverSheet({
  order: current,
  onClose,
  onConfirm,
}: {
  order: CourierOrder | null;
  onClose: () => void;
  /** Gönderim hemen yapılmaz: 5 sn "Geri al" penceresi için çağırana bildirilir. */
  onConfirm: (order: CourierOrder, mode: DeliverMode, brand: MealCardBrand | '') => void;
}) {
  // Sheet hep bağlı kalır (yerel <dialog> açık/kapalı geçişi); kapanırken son sipariş gösterilir
  const [last, setLast] = useState<CourierOrder | null>(current);
  if (current && current !== last) setLast(current);
  const order = current ?? last;
  const [mode, setMode] = useState<DeliverMode>('as_ordered');
  const [brand, setBrand] = useState<MealCardBrand | ''>('');

  useEffect(() => {
    if (current) {
      setMode('as_ordered');
      setBrand('');
    }
  }, [current?.id]);

  const asOrdered = order ? `${formatMoney(order.totalKurus)} ${paymentCourierLabel(order.paymentMethod, order.mealCardBrand).toLocaleLowerCase('tr-TR')} alındı` : '';
  const options = order ? [{ value: 'as_ordered' as DeliverMode, label: asOrdered }, ...deliverOptions(order)] : [];
  return (
    <Sheet
      open={Boolean(current)}
      onOpenChange={(o) => !o && onClose()}
      side="bottom"
      title={order ? `#${order.number} teslim` : 'Teslim'}
      footer={
        <Button
          size="xl"
          block
          variant="success"
          disabled={!deliverReady(mode, brand)}
          onClick={() => {
            if (order) onConfirm(order, mode, brand);
          }}
        >
          Teslim ettim
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <RadioGroup legend="Ödeme" value={mode} onValueChange={(v) => setMode(v as DeliverMode)} options={options} />
        {mode === 'meal_card_on_delivery' ? (
          <Select
            aria-label="Yemek kartı markası"
            value={brand}
            placeholder="Marka seçin"
            onChange={(e) => setBrand(e.target.value as MealCardBrand)}
            options={(Object.keys(MEAL_CARD_BRAND_LABELS) as MealCardBrand[]).map((b) => ({ value: b, label: MEAL_CARD_BRAND_LABELS[b] }))}
          />
        ) : null}
        <p className="text-sm text-fg-muted">Teslim ettiğinizi onayladıktan sonra 5 saniye boyunca geri alabilirsiniz.</p>
      </div>
    </Sheet>
  );
}

/**
 * "Teslim edilemedi" alt sayfası (04 §9.2): sebep çipleri; sipariş iptal EDİLMEZ, işletmeye uyarı gider ve
 * karar işletmenindir (tekrar dene ya da iptal).
 */
export function UndeliverableSheet({
  order: current,
  onClose,
  onSubmit,
}: {
  order: CourierOrder | null;
  onClose: () => void;
  onSubmit: (order: CourierOrder, body: { reason: DeliveryFailureReason; note?: string }) => Promise<void>;
}) {
  const [last, setLast] = useState<CourierOrder | null>(current);
  if (current && current !== last) setLast(current);
  const order = current ?? last;
  const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current) {
      setReason(null);
      setNote('');
      setError(null);
    }
  }, [current?.id]);

  const noteMissing = reason === 'other' && !note.trim();
  const submit = async () => {
    if (!order || !reason || noteMissing) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(order, { reason, ...(note.trim() ? { note: note.trim() } : {}) });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bildirim gönderilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={Boolean(current)}
      onOpenChange={(o) => !o && onClose()}
      side="bottom"
      title={order ? `#${order.number} teslim edilemedi` : 'Teslim edilemedi'}
      description="Sebebi seçin. Sipariş iptal edilmez; işletmeye bildirilir ve kararı işletme verir."
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="danger" size="lg" onClick={submit} disabled={!reason || noteMissing} loading={busy}>
            Bildir
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <RadioGroup
          legend="Sebep"
          variant="chips"
          value={reason}
          onValueChange={(v) => setReason(v as DeliveryFailureReason)}
          options={DELIVERY_FAILURE_REASONS.map((r) => ({ value: r, label: DELIVERY_FAILURE_REASON_LABELS[r] }))}
        />
        <Field label="Açıklama" hint={reason === 'other' ? '"Diğer" sebebinde zorunlu' : 'İsteğe bağlı'} error={noteMissing ? 'Kısa bir açıklama yazın.' : undefined}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} rows={2} />
        </Field>
        {error ? <Alert variant="danger">{error}</Alert> : null}
      </div>
    </Sheet>
  );
}
