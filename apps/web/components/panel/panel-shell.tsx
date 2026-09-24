'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Ellipsis, LockKeyhole, Store } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { ScreenError, ScreenLoading } from '@/components/common/screen-state';
import { buttonVariants } from '@/components/ui/button';
import { ConnectionBanner, ConnectionIndicator } from '@/components/ui/connection-banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { currentBranchId, currentRole, useLogout, useMe, type Me } from '@/lib/auth';
import { TENANT_ROLE_LABELS } from '@/lib/labels';
import { MOBILE_TAB_HREFS, isActive, isPathAllowed, navForRole, settingsForRole, type PanelNavItem } from './nav-config';
import { PanelBands } from './panel-bands';
import { PanelStreamProvider, usePanelStream } from './stream-provider';
import { UserMenu } from './user-menu';
import { OrderingQuickActions } from '@/components/settings/ordering-quick-actions';

/** Oturum gerektirmeyen panel yolları. */
export const PANEL_PUBLIC_PATHS = ['/panel/giris', '/panel/kayit'] as const;

function isPublic(pathname: string) {
  return (PANEL_PUBLIC_PATHS as readonly string[]).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Panel kabuğu: oturum koruması (useMe → 401 ise /panel/giris?next=…), rol bazlı menü,
 * tek SSE bağlantısı, üst bar ve bantlar. /panel/giris ve /panel/kayit korumasızdır.
 */
export function PanelShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/panel';
  if (isPublic(pathname)) return <>{children}</>;
  return <GuardedPanel pathname={pathname}>{children}</GuardedPanel>;
}

function GuardedPanel({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const role = currentRole(me.data);

  useEffect(() => {
    if (me.data === null) {
      const next = `${pathname}${typeof window !== 'undefined' ? window.location.search : ''}`;
      router.replace(`/panel/giris?next=${encodeURIComponent(next)}`);
    } else if (me.data && role === 'courier') {
      router.replace('/kurye');
    }
  }, [me.data, role, pathname, router]);

  if (me.isPending) return <ScreenLoading />;
  if (me.isError && me.data === undefined) return <ScreenError error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data || role === 'courier') return <ScreenLoading label="Yönlendiriliyor…" />;
  if (!me.data.tenant || !role) return <NoTenant me={me.data} />;

  const onboarding = pathname === '/panel/kurulum' || pathname.startsWith('/panel/kurulum/');
  const streamEnabled = role === 'owner' || role === 'manager' || role === 'cashier' || role === 'kitchen';

  return (
    <PanelStreamProvider branchId={currentBranchId(me.data)} enabled={streamEnabled}>
      <PanelChrome me={me.data} pathname={pathname} minimal={onboarding}>
        {isPathAllowed(pathname, role) ? (
          children
        ) : (
          <EmptyState
            icon={LockKeyhole}
            title="Bu sayfa için yetkiniz yok"
            description="Bu bölümü işletme sahibi ya da yönetici kullanabilir."
            action={
              <Link href="/panel" className={buttonVariants({ variant: 'secondary' })}>
                Canlı siparişlere dön
              </Link>
            }
          />
        )}
      </PanelChrome>
    </PanelStreamProvider>
  );
}

function NoTenant({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <EmptyState
        icon={Store}
        title="Bu hesaba bağlı işletme yok"
        description={me.isPlatformAdmin ? 'Platform hesabıyla giriş yaptınız. Yönetim paneline geçebilirsiniz.' : 'İşletme sahibinizden sizi personel olarak eklemesini isteyin.'}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {me.isPlatformAdmin ? (
              <Link href="/admin" className={buttonVariants({ variant: 'primary' })}>
                Yönetim paneli
              </Link>
            ) : null}
            <button
              type="button"
              className={buttonVariants({ variant: 'secondary' })}
              onClick={() => logout.mutate()}
            >
              Çıkış yap
            </button>
          </div>
        }
      />
    </div>
  );
}

/** Üst çubuk sipariş alma durumu + hızlı aksiyonlar (durdur / yoğunum) — components/settings/ordering-quick-actions. */
function OrderingIndicator() {
  return <OrderingQuickActions />;
}

function NavLink({ item, pathname, variant }: { item: PanelNavItem; pathname: string; variant: 'rail' | 'side' | 'tab' | 'sheet' }) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  if (variant === 'tab') {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold',
          active ? 'text-fg' : 'text-fg-muted',
        )}
      >
        <span className={cn('flex h-8 w-14 items-center justify-center rounded-full', active && 'bg-accent')}>
          <Icon aria-hidden className="size-5" />
        </span>
        {item.label}
      </Link>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center rounded-md font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        variant === 'rail'
          ? 'min-h-16 flex-col justify-center gap-1 px-1 text-center text-xs xl:min-h-hit xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:text-start xl:text-base'
          : 'min-h-hit gap-3 px-3 text-base',
        active ? 'bg-primary text-primary-fg' : 'text-fg hover:bg-accent',
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

function PanelChrome({ me, pathname, minimal, children }: { me: Me; pathname: string; minimal: boolean; children: ReactNode }) {
  const role = currentRole(me);
  const items = navForRole(role);
  const tabs = MOBILE_TAB_HREFS.map((href) => items.find((i) => i.href === href)).filter((i): i is PanelNavItem => Boolean(i));
  const rest = items.filter((i) => !(MOBILE_TAB_HREFS as readonly string[]).includes(i.href));
  const settings = settingsForRole(role);
  const [moreOpen, setMoreOpen] = useState(false);
  const stream = usePanelStream();

  useEffect(() => setMoreOpen(false), [pathname]);

  // Yapışkan üst alanın (bantlar + üst bar) yüksekliği → yan menünün konumu.
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const top = topRef.current;
    const root = rootRef.current;
    if (!top || !root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => root.style.setProperty('--panel-top', `${top.offsetHeight}px`));
    ro.observe(top);
    return () => ro.disconnect();
  }, []);

  const moreActive = rest.some((i) => isActive(pathname, i));

  return (
    <div ref={rootRef} className={cn('flex min-h-dvh flex-col bg-surface', !minimal && 'max-md:[--bottom-offset:4.5rem]')}>
      <a
        href="#panel-icerik"
        className="sr-only z-[90] rounded-md bg-primary px-4 py-3 font-semibold text-primary-fg focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        İçeriğe geç
      </a>
      <div ref={topRef} className="sticky top-0 z-40" data-print-hide>
        <PanelBands me={me} />
        <ConnectionBanner onRetry={stream?.reconnect} />
        <header className="border-b border-border bg-surface-raised">
          <div className="flex h-16 items-center gap-3 px-3 sm:px-4">
            <Link href="/panel" className="flex min-w-0 items-center gap-2 rounded-md p-1" aria-label="Canlı siparişler">
              <LogoMark className="size-8" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-base font-bold text-fg">{me.tenant?.name}</span>
                {role ? <span className="truncate text-xs text-fg-muted">{TENANT_ROLE_LABELS[role]}</span> : null}
              </span>
            </Link>
            <div className="ms-auto flex items-center gap-1 sm:gap-3">
              <OrderingIndicator />
              <ConnectionIndicator />
              <UserMenu me={me} />
            </div>
          </div>
        </header>
      </div>

      <div className="flex flex-1">
        {!minimal ? (
          <nav
            aria-label="Panel menüsü"
            className="sticky top-[var(--panel-top,4rem)] hidden h-[calc(100dvh-var(--panel-top,4rem))] w-24 shrink-0 flex-col gap-1 overflow-y-auto border-e border-border bg-surface-raised p-2 md:flex xl:w-60 xl:p-3"
            data-print-hide
          >
            {items.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} variant="rail" />
            ))}
          </nav>
        ) : null}
        <main id="panel-icerik" tabIndex={-1} className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-6 max-md:pb-24">
          {children}
        </main>
      </div>

      {!minimal ? (
        <nav
          aria-label="Alt menü"
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden"
          data-print-hide
        >
          {tabs.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} variant="tab" />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            className={cn(
              'flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold',
              moreActive ? 'text-fg' : 'text-fg-muted',
            )}
          >
            <span className={cn('flex h-8 w-14 items-center justify-center rounded-full', moreActive && 'bg-accent')}>
              <Ellipsis aria-hidden className="size-5" />
            </span>
            Diğer
          </button>
        </nav>
      ) : null}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="Diğer" side="bottom">
        <nav aria-label="Diğer bölümler" className="flex flex-col gap-1">
          {rest.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} variant="sheet" />
          ))}
          {settings.length > 0 ? (
            <>
              <p className="mt-3 px-3 text-xs font-bold uppercase tracking-wider text-fg-muted">Ayarlar</p>
              {settings.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} variant="sheet" />
              ))}
            </>
          ) : null}
        </nav>
      </Sheet>
    </div>
  );
}
