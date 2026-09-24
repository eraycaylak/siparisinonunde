'use client';

import { useRouter } from 'next/navigation';
import { Clock, Lock, ShieldAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { apiFetch, errorMessage } from '@/lib/api';
import { ME_QUERY_KEY, type Me } from '@/lib/auth';
import { formatDate, formatTime } from '@/lib/format';

/** Üst bantlar: salt-okunur destek oturumu, abonelik durumu, deneme bitişi (UI-09). */
export function PanelBands({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();

  const endImpersonation = async () => {
    try {
      await apiFetch('/admin/impersonation/end', { method: 'POST', body: {} });
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.push('/admin');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const stage = me.tenant?.lifecycleStage;
  const trialEnds = me.tenant?.trialEndsAt ? new Date(me.tenant.trialEndsAt) : null;
  const trialSoon =
    stage === 'trial' && trialEnds !== null && trialEnds.getTime() - Date.now() < 3 * 24 * 3600 * 1000 && trialEnds.getTime() > Date.now();

  return (
    <>
      {me.readOnly ? (
        <Banner
          tone="alarm"
          icon={ShieldAlert}
          action={
            me.impersonating ? (
              <Button variant="secondary" size="sm" onClick={endImpersonation}>
                Oturumu bitir
              </Button>
            ) : undefined
          }
        >
          Destek oturumu: salt-okunur, değişiklik yapılamaz.
          {me.impersonating?.expiresAt ? ` Bitiş ${formatTime(me.impersonating.expiresAt)}.` : ''}
        </Banner>
      ) : null}
      {stage === 'read_only' ? (
        <Banner tone="warn" icon={Lock}>
          Ödemeniz alınamadı. Siparişleriniz alınmaya devam ediyor; ayarlar kilitli.
        </Banner>
      ) : null}
      {stage === 'suspended' ? (
        <Banner tone="alarm" icon={Lock}>
          Online sipariş alma durdu. Ödeme yapınca dakikalar içinde açılır.
        </Banner>
      ) : null}
      {trialSoon && trialEnds ? (
        <Banner tone="warn" icon={Clock}>
          Deneme süreniz {formatDate(trialEnds)} günü bitiyor. Paket seçmezseniz online sipariş alma durur.
        </Banner>
      ) : null}
    </>
  );
}
