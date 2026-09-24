'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { ScreenError, ScreenLoading } from '@/components/common/screen-state';
import { UserMenu } from '@/components/panel/user-menu';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { currentRole, useMe } from '@/lib/auth';

/** Kurye kabuğu (mobil). /kurye/giris korumasızdır; diğerleri kurye oturumu ister. */
export function CourierShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/kurye';
  if (pathname === '/kurye/giris') return <>{children}</>;
  return <GuardedCourier>{children}</GuardedCourier>;
}

function GuardedCourier({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <ScreenLoading />;
  if (me.isError && me.data === undefined) return <ScreenError error={me.error} onRetry={() => void me.refetch()} />;
  const role = currentRole(me.data);
  if (!me.data || !role) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          icon={KeyRound}
          title="Oturum süreniz doldu"
          description="İşletmenizden yeni giriş linki isteyin. Linki açınca siparişleriniz burada görünür."
          action={
            <Link href="/panel/giris?next=%2Fkurye" className={buttonVariants({ variant: 'secondary' })}>
              Parolayla giriş
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-40 border-b border-border bg-surface-raised">
        <div className="mx-auto flex h-16 max-w-lg items-center gap-3 px-3">
          <LogoMark className="size-8" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-base font-bold text-fg">{me.data.tenant?.name}</span>
            <span className="text-xs text-fg-muted">Kurye</span>
          </span>
          <div className="ms-auto">
            <UserMenu me={me.data} loginPath="/kurye/giris" />
          </div>
        </div>
      </header>
      <main id="kurye-icerik" className="mx-auto w-full max-w-lg flex-1 px-3 py-4">
        {children}
      </main>
    </div>
  );
}
