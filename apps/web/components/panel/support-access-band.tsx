'use client';

import { Eye, KeyRound } from 'lucide-react';
import type { SupportAccessNotice, SupportAccessNoticesResponse } from '@siparis/core/admin/support-access';
import { Banner } from '@/components/ui/banner';
import { useApiQuery } from '@/lib/api';
import { hasRole, type Me } from '@/lib/auth';
import { formatDateTime, formatTime } from '@/lib/format';

/** Erişim bittikten sonra kaydın bantta kaldığı süre: işletme paneli açtığında olanı görsün. */
const RECENT_MS = 24 * 3600 * 1000;
/** Açık oturumu yakalamak için yoklama aralığı (destek oturumu en fazla 30 dk sürer). */
const POLL_MS = 60_000;

function noticeText(n: SupportAccessNotice): string {
  const who = n.supportAgentName ?? 'Destek ekibi';
  const when = formatDateTime(n.at);
  if (n.kind === 'password_reset') return `Parolanız destek ekibi tarafından sıfırlandı (${who}, ${when}).`;
  if (n.kind === 'ended') return `Destek erişimi sona erdi (${who}, ${when}).`;
  return `Destek ekibi panelinizi görüntüledi (${who}, ${when}).`;
}

/**
 * Destek erişimi bandı (00 §4 "işletmeye bildirim", 04 §7 destek bandı, 08 §2 madde 4 DPA).
 *
 * Denetim bulgusu: impersonation başlarken `notifications` satırı yazılıyor ama hiçbir ekran okumuyordu —
 * işletme destek erişiminden fiilen HİÇ haberdar olmuyordu. Bu bant o kaydı işletmenin gözüne getirir:
 *   - Açık oturum varsa kırmızı bant (kim, ne zamana kadar).
 *   - Kapandıktan sonra 24 saat boyunca sarı bant (kim, ne zaman).
 *
 * Destek oturumunun kendisinde GÖSTERİLMEZ: o görünümde `PanelBands` zaten "salt-okunur destek oturumu"
 * bandını basıyor; bu bant işletmenin kendi gözü içindir.
 */
export function SupportAccessBand({ me }: { me: Me }) {
  const enabled = !me.impersonating && Boolean(me.tenant) && hasRole(me, ['owner', 'manager']);
  const q = useApiQuery<SupportAccessNoticesResponse>(['panel', 'support-access'], '/admin/support-access/notices', {
    enabled,
    refetchInterval: enabled ? POLL_MS : undefined,
    staleTime: 30_000,
    retry: false,
  });

  if (!enabled || !q.data) return null;
  const { active, notices } = q.data;

  if (active.length > 0) {
    const first = active[0]!;
    const who = first.supportAgentName ?? 'Destek ekibi';
    const extra = active.length > 1 ? ` (+${active.length - 1} kişi daha)` : '';
    return (
      <Banner tone="alarm" icon={Eye}>
        Destek ekibi hesabınızı görüntülüyor: {who}
        {extra} · {formatTime(first.startedAt)}–{formatTime(first.expiresAt)}. Yalnız okuyabilir, hiçbir değişiklik yapamaz.
      </Banner>
    );
  }

  // En yeni kayıt (liste yeniden eskiye). Buraya gelindiyse açık oturum YOK: `started` kaydı da kapanmış
  // erişimi anlatır — 30 dk dolup oturum sunucuda düşerse `end` çağrılmaz, yani bitiş satırı hiç yazılmaz.
  const recent = notices.find((n) => Date.now() - Date.parse(n.at) < RECENT_MS);
  if (!recent) return null;
  return (
    <Banner tone="warn" icon={recent.kind === 'password_reset' ? KeyRound : Eye}>
      {noticeText(recent)} Beklemediğiniz bir erişimse destek ekibine yazın.
    </Banner>
  );
}
