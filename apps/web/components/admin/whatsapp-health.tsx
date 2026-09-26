'use client';

import { useState } from 'react';
import { MessageCircle, RefreshCw } from 'lucide-react';
import type { AdminWaListResponse, AdminWaSharedNumber } from '@siparis/core/admin/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useApiQuery } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { HealthBadge, InfoRow, QueryError } from './common';
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
        description="Ortak numara ve tüm işletme numaraları; kırmızılar üstte. Sessiz: şube açıkken 2 saattir webhook gelmedi (ortak numara satırlarında sessizlik sayılmaz)."
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
      {q.data?.sharedNumber ? <SharedNumberSummary s={q.data.sharedNumber} /> : null}
      {q.isError ? <QueryError error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isPending ? <Spinner label="Hesaplar yükleniyor" /> : null}
      {q.data && q.data.items.length === 0 ? (
        <EmptyState icon={MessageCircle} title={problems ? 'Sorunlu hesap yok' : 'WhatsApp hesabı yok'} />
      ) : null}
      {q.data && q.data.items.length > 0 ? <WaAccountsTable items={q.data.items} /> : null}
    </>
  );
}

/** Ortak numara (00 §12a madde 8): platformun tek numarasının yapılandırması ve son 24 saat. */
function SharedNumberSummary({ s }: { s: AdminWaSharedNumber }) {
  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Ortak numara · {s.displayName}</CardTitle>
          <HealthBadge health={s.health} />
        </div>
        <CardDescription>Ortak numaradaki işletmelerin tümü bu numaradan mesaj alır ve gönderir; dükkan seçici mesajları platform düzeyindedir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {s.problems.length ? (
          <ul className="flex flex-col gap-1 rounded-md bg-warning-bg p-3 text-sm text-fg">
            {s.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <dl className="grid gap-x-6 divide-y divide-border lg:grid-cols-2 lg:divide-y-0">
          <InfoRow label="Numara">{s.displayPhoneFormatted}</InfoRow>
          <InfoRow label="Sağlayıcı">{s.providerLabel}</InfoRow>
          <InfoRow label="Webhook">{s.webhookUrlMasked ? <span className="break-all font-mono text-sm">{s.webhookUrlMasked}</span> : 'Tanımlı değil'}</InfoRow>
          <InfoRow label="Son webhook">
            {s.lastWebhookAt ? <span title={formatDateTime(s.lastWebhookAt)}>{formatRelative(s.lastWebhookAt)}</span> : 'Hiç gelmedi'}
          </InfoRow>
          <InfoRow label="İşletmeler">
            {s.shops.total} işletme · {s.shops.selectable} tanesi dükkan listesinde
          </InfoRow>
          <InfoRow label="Seçici mesajları (24 sa)">
            {s.platform24h.inbound} gelen / {s.platform24h.outbound} giden
            {s.platform24h.failed ? ` · ${s.platform24h.failed} başarısız` : ''}
          </InfoRow>
        </dl>
      </CardContent>
    </Card>
  );
}
