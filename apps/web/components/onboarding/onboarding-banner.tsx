'use client';

import Link from 'next/link';
import { Rocket } from 'lucide-react';
import { useOnboarding } from '@/components/settings/api';
import { buttonVariants } from '@/components/ui/button';
import { currentRole, useMe } from '@/lib/auth';

/** Kurulum tamamlanmadıysa ayarlarda "Kuruluma devam et" kartı (04 §3.7: kalınan adımdan devam). */
export function OnboardingBanner() {
  const me = useMe();
  const role = currentRole(me.data);
  const allowed = role === 'owner' || role === 'manager';
  const q = useOnboarding(allowed);
  if (!allowed || !q.data || q.data.liveAt) return null;
  const pct = Math.round((q.data.doneCount / q.data.totalCount) * 100);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <Rocket aria-hidden className="size-6 text-fg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-fg">Kurulum %{pct} tamamlandı</span>
        <span className="text-sm text-fg-muted">
          {q.data.webLiveAt ? 'Web siparişine açıksınız; tam canlı için kalan adımları tamamlayın.' : 'Canlıya geçmek için kalan adımları tamamlayın.'}
        </span>
      </div>
      <Link href="/panel/kurulum" className={buttonVariants({ variant: 'primary' })}>
        Kuruluma devam et
      </Link>
    </div>
  );
}
