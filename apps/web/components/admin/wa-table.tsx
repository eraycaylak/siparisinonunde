'use client';

import Link from 'next/link';
import { MoonStar } from 'lucide-react';
import type { AdminWaAccount } from '@siparis/core/admin/contracts';
import { Badge } from '@/components/ui/badge';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { formatDateTime, formatRelative } from '@/lib/format';
import { WA_PROVIDER_LABELS } from './admin-labels';
import { HealthBadge, WaStatusBadge } from './common';

/** A-06 WhatsApp sağlık tablosu (kırmızılar üstte; sıralama API'de). */
export function WaAccountsTable({ items, showTenant = true }: { items: AdminWaAccount[]; showTenant?: boolean }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Sağlık</TH>
          {showTenant ? <TH>İşletme</TH> : null}
          <TH>Şube / numara</TH>
          <TH>Durum</TH>
          <TH>Son webhook</TH>
          <TH className="text-end">24 sa gelen / giden</TH>
          <TH>Son hata</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((a) => (
          <TR key={a.id}>
            <TD>
              <div className="flex flex-col items-start gap-1">
                <HealthBadge health={a.health} />
                {a.silent ? (
                  <Badge variant="warning" size="sm">
                    <MoonStar aria-hidden />
                    Sessiz
                  </Badge>
                ) : null}
              </div>
            </TD>
            {showTenant ? (
              <TD>
                <Link href={`/admin/isletmeler/${a.tenantId}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                  {a.tenantName}
                </Link>
                <div className="text-sm text-fg-muted">{a.tenantSlug}</div>
              </TD>
            ) : null}
            <TD className="whitespace-nowrap">
              <div>{a.branchName}</div>
              <div className="text-sm text-fg-muted">
                {a.displayPhoneMasked ?? 'Numara yok'} · {WA_PROVIDER_LABELS[a.provider]}
              </div>
            </TD>
            <TD>
              <WaStatusBadge status={a.status} />
              <div className="mt-1 text-xs text-fg-muted">{a.branchOpen ? 'Şube açık' : 'Şube kapalı'}</div>
            </TD>
            <TD className="whitespace-nowrap">
              {a.lastWebhookAt ? (
                <span title={formatDateTime(a.lastWebhookAt)}>{formatRelative(a.lastWebhookAt)}</span>
              ) : (
                <span className="text-fg-muted">Hiç gelmedi</span>
              )}
            </TD>
            <TD className="text-end tabular-nums whitespace-nowrap">
              {a.inbound24h} / {a.outbound24h}
              {a.failed24h > 0 ? <div className="text-xs text-status-new-fg">{a.failed24h} başarısız</div> : null}
            </TD>
            <TD className="max-w-xs">
              {a.lastError ? <span className="line-clamp-3 text-sm">{a.lastError}</span> : <span className="text-fg-muted">—</span>}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
