'use client';

import { useState } from 'react';
import { MessageCircle, RefreshCw } from 'lucide-react';
import type { AdminWaListResponse } from '@siparis/core/admin/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useApiQuery } from '@/lib/api';
import { QueryError } from './common';
import { WaAccountsTable } from './wa-table';

/** A-06 WhatsApp sağlık tablosu: hata kırmızı, sessizlik (açık saatte 2 sa webhook yok) sarı. */
export function WhatsappHealthScreen() {
  const [problems, setProblems] = useState(false);
  const q = useApiQuery<AdminWaListResponse>(['admin', 'whatsapp', problems], '/admin/whatsapp', {
    query: { problems: problems ? '1' : undefined },
    refetchInterval: 60_000,
  });
  const s = q.data?.summary;

  return (
    <>
      <PageHeader
        title="WhatsApp sağlığı"
        description="Tüm işletme numaraları; kırmızılar üstte. Sessiz: şube açıkken 2 saattir webhook gelmedi."
        actions={
          <Button variant="secondary" onClick={() => void q.refetch()} loading={q.isFetching}>
            <RefreshCw aria-hidden />
            Yenile
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {s ? (
          <div className="flex flex-wrap gap-2" aria-label="Özet">
            <Badge variant="neutral">Toplam {s.total}</Badge>
            <Badge variant="danger">Kırmızı {s.red}</Badge>
            <Badge variant="warning">Sarı {s.yellow}</Badge>
            <Badge variant="success">Yeşil {s.green}</Badge>
            <Badge variant="warning">Sessiz {s.silent}</Badge>
          </div>
        ) : null}
        <Switch className="ms-auto" checked={problems} onCheckedChange={setProblems} label="Yalnız sorunlular" showStateText={false} />
      </div>
      {q.isError ? <QueryError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isPending ? <Spinner label="Hesaplar yükleniyor" /> : null}
      {q.data && q.data.items.length === 0 ? (
        <EmptyState icon={MessageCircle} title={problems ? 'Sorunlu hesap yok' : 'WhatsApp hesabı yok'} />
      ) : null}
      {q.data && q.data.items.length > 0 ? <WaAccountsTable items={q.data.items} /> : null}
    </>
  );
}
