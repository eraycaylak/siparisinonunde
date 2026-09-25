'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Building2,
  Flag,
  Gauge,
  Inbox,
  LockKeyhole,
  MessageCircle,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { ScreenError, ScreenLoading } from '@/components/common/screen-state';
import { UserMenu } from '@/components/panel/user-menu';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { apiFetch, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ME_QUERY_KEY, needsTotpEnrollment, useMe } from '@/lib/auth';
import { formatTime } from '@/lib/format';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

/** Admin menüsü (05 A.4; 14 §9). */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: '/admin', label: 'Özet', icon: Gauge, exact: true },
  { href: '/admin/isletmeler', label: 'İşletmeler', icon: Building2 },
  { href: '/admin/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { href: '/admin/isler', label: 'İşler', icon: Briefcase },
  { href: '/admin/bayraklar', label: 'Bayraklar', icon: Flag },
  { href: '/admin/leadler', label: 'Lead’ler', icon: Inbox },
  { href: '/admin/denetim', label: 'Denetim', icon: ScrollText },
  { href: '/admin/guvenlik', label: 'Güvenlik', icon: ShieldCheck },
];

const PUBLIC = ['/admin/giris'];

/** İki adımlı doğrulama zorunlu ve kurulmamışken açılabilen tek sayfa (API diğer admin uçlarını 403 ile kapatır). */
export const ADMIN_SECURITY_PATH = '/admin/guvenlik';

function active(pathname: string, item: AdminNavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Platform yönetim kabuğu: me.isPlatformAdmin zorunlu; /admin/giris hariç. */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  if (PUBLIC.includes(pathname)) return <>{children}</>;
  return <GuardedAdmin pathname={pathname}>{children}</GuardedAdmin>;
}

function GuardedAdmin({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const qc = useQueryClient();
  const restoreTried = useRef(false);

  useEffect(() => {
    if (me.data !== null) return;
    const toLogin = () => {
      const next = `${pathname}${window.location.search}`;
      router.replace(`/admin/giris?next=${encodeURIComponent(next)}`);
    };
    // Süresi dolmuş destek oturumundan dönüş: saklanan yönetim oturumunu geri yüklemeyi bir kez dene.
    if (restoreTried.current) return toLogin();
    restoreTried.current = true;
    apiFetch<{ restored: boolean }>('/admin/impersonation/end', { method: 'POST', body: {} })
      .then((r) => (r.restored ? qc.invalidateQueries({ queryKey: ME_QUERY_KEY }) : toLogin()))
      .catch(toLogin);
  }, [me.data, pathname, router, qc]);

  // TOTP zorunlu ve kurulmamış platform yöneticisi: yalnız Güvenlik sayfası
  const mustEnroll = needsTotpEnrollment(me.data);
  const blocked = mustEnroll && pathname !== ADMIN_SECURITY_PATH;
  useEffect(() => {
    if (blocked) router.replace(ADMIN_SECURITY_PATH);
  }, [blocked, router]);

  if (me.isPending) return <ScreenLoading />;
  if (me.isError && me.data === undefined) return <ScreenError error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) return <ScreenLoading label="Yönlendiriliyor…" />;
  if (me.data.impersonating) return <ImpersonationActive expiresAt={me.data.impersonating.expiresAt} />;
  if (!me.data.isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          icon={LockKeyhole}
          title="Bu alan yalnız platform ekibi içindir"
          description="Hesabınızın platform yetkisi yok."
          action={
            <Link href="/panel" className={buttonVariants({ variant: 'secondary' })}>
              İşletme paneline git
            </Link>
          }
        />
      </div>
    );
  }
  if (blocked) return <ScreenLoading label="Yönlendiriliyor…" />;
  const nav = mustEnroll ? ADMIN_NAV.filter((i) => i.href === ADMIN_SECURITY_PATH) : ADMIN_NAV;

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#admin-icerik"
        className="sr-only z-[90] rounded-md bg-primary px-4 py-3 font-semibold text-primary-fg focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        İçeriğe geç
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-surface-raised">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-4">
          <Link href="/admin" className="flex items-center gap-2 rounded-md p-1">
            <LogoMark />
            <span className="text-base font-bold text-fg">Yönetim</span>
          </Link>
          <Badge variant="ink" size="sm">
            Platform
          </Badge>
          <div className="ms-auto">
            <UserMenu me={me.data} loginPath="/admin/giris" />
          </div>
        </div>
        <nav aria-label="Yönetim menüsü (mobil)" className="flex gap-1 overflow-x-auto border-t border-border px-2 py-1 lg:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(pathname, item) ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-hit shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold',
                active(pathname, item) ? 'bg-primary text-primary-fg' : 'text-fg hover:bg-accent',
              )}
            >
              <item.icon aria-hidden className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="flex flex-1">
        <nav
          aria-label="Yönetim menüsü"
          className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col gap-1 overflow-y-auto border-e border-border bg-surface-raised p-3 lg:flex"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(pathname, item) ? 'page' : undefined}
              className={cn(
                'flex min-h-hit items-center gap-3 rounded-md px-3 text-base font-semibold',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active(pathname, item) ? 'bg-primary text-primary-fg' : 'text-fg hover:bg-accent',
              )}
            >
              <item.icon aria-hidden className="size-5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <main id="admin-icerik" tabIndex={-1} className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Bu tarayıcının oturumu salt-okunur destek oturumuna çevrilmişken (impersonation) admin ekranları çalışmaz
 * (API destek oturumunu reddeder). Panele dönme ya da destek oturumunu bitirip yönetim oturumunu geri yükleme.
 */
function ImpersonationActive({ expiresAt }: { expiresAt: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ restored: boolean; redirectTo: string }>('/admin/impersonation/end', { method: 'POST', body: {} });
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      if (!r.restored) router.replace(r.redirectTo || '/admin/giris');
    } catch (err) {
      setError(errorMessage(err, 'Destek oturumu bitirilemedi.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-16">
      <EmptyState
        icon={ShieldAlert}
        title="Destek görünümü açık"
        description={`Bu tarayıcı şu an bir işletme panelini salt-okunur görüntülüyor (bitiş ${formatTime(expiresAt)}). Yönetim ekranları için önce destek oturumunu bitirin.`}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/panel" className={buttonVariants({ variant: 'secondary' })}>
              Panele dön
            </Link>
            <Button variant="danger" onClick={end} loading={busy}>
              Destek oturumunu bitir
            </Button>
          </div>
        }
      />
      {error ? <Alert variant="danger">{error}</Alert> : null}
    </div>
  );
}
