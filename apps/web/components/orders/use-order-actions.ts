'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OrderCardResponse, PanelCancelRequest, PanelRejectRequest } from '@siparis/core/orders/contracts';
import { errorMessage, isApiError } from '@/lib/api';
import { ORDERS_ACTIVE_KEY, ORDERS_LIST_KEY, orderActions, orderDetailKey, upsertCard } from './api';

/**
 * Sipariş aksiyonları: başarılı yanıttaki kart önbelleğe yazılır; hata Türkçe tostla gösterilir ve
 * 409 (başka cihaz değiştirdi / bekleyen ret) durumunda liste tazelenir. Hata yeniden fırlatılır.
 */
export function useOrderActions() {
  const qc = useQueryClient();
  return useMemo(() => {
    async function run<T extends OrderCardResponse>(id: string, fn: () => Promise<T>, success?: string): Promise<T> {
      try {
        const res = await fn();
        upsertCard(qc, res.order);
        void qc.invalidateQueries({ queryKey: orderDetailKey(id) });
        void qc.invalidateQueries({ queryKey: ORDERS_LIST_KEY });
        if (success) toast.success(success);
        return res;
      } catch (err) {
        toast.error(errorMessage(err, 'İşlem yapılamadı. Tekrar deneyin.'));
        if (isApiError(err) && (err.status === 409 || err.status === 404)) {
          void qc.invalidateQueries({ queryKey: ORDERS_ACTIVE_KEY });
          void qc.invalidateQueries({ queryKey: orderDetailKey(id) });
        }
        throw err;
      }
    }
    return {
      accept: (id: string, eta: number, version?: number) => run(id, () => orderActions.accept(id, eta, version)),
      reject: (id: string, body: PanelRejectRequest) => run(id, () => orderActions.reject(id, body)),
      undoReject: (id: string) => run(id, () => orderActions.undoReject(id), 'Ret geri alındı.'),
      advance: (id: string, to: 'preparing' | 'ready' | 'on_the_way' | 'delivered', version?: number) =>
        run(id, () => orderActions.advance(id, to, version)),
      cancel: (id: string, body: PanelCancelRequest) => run(id, () => orderActions.cancel(id, body), 'Sipariş iptal edildi.'),
      delay: (id: string, extra: number) => run(id, () => orderActions.delay(id, extra), `Gecikme bildirildi (+${extra} dk).`),
      assignCourier: (id: string, userId: string | null, onTheWay: boolean) =>
        run(id, () => orderActions.assignCourier(id, userId, onTheWay), userId ? (onTheWay ? 'Kurye atandı, yolda.' : 'Kurye atandı.') : 'Kurye kaldırıldı.'),
      verify: (id: string) => run(id, () => orderActions.verify(id), 'Sipariş doğrulandı.'),
      decide: (id: string, reqId: string, approve: boolean) =>
        run(id, () => orderActions.decideCancelRequest(id, reqId, approve), approve ? 'Sipariş iptal edildi (müşteri istedi).' : 'İptal talebi reddedildi.'),
    };
  }, [qc]);
}

export type OrderActions = ReturnType<typeof useOrderActions>;
