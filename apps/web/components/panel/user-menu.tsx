'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeftRight, ChevronDown, LogOut, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';
import { currentRole, useLogout, useSwitchTenant, type Me } from '@/lib/auth';
import { PLATFORM_ROLE_LABELS, TENANT_ROLE_LABELS } from '@/lib/labels';

/** Kullanıcı menüsü: ad, rol, işletme değiştir, tema, çıkış. */
export function UserMenu({ me, loginPath = '/panel/giris', className }: { me: Me; loginPath?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const logout = useLogout(loginPath);
  const switchTenant = useSwitchTenant();
  const role = currentRole(me);
  const roleLabel = role ? TENANT_ROLE_LABELS[role] : me.user.platformRole ? PLATFORM_ROLE_LABELS[me.user.platformRole] : '';
  const others = me.memberships.filter((m) => m.tenantId !== me.tenant?.id);

  const doLogout = () => {
    logout.mutate(undefined, { onError: (err) => toast.error(errorMessage(err, 'Çıkış yapılamadı. Tekrar deneyin.')) });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex min-h-hit items-center gap-2 rounded-md px-2 text-start hover:bg-accent',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          className,
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-fg">
          {me.user.name.trim().charAt(0).toLocaleUpperCase('tr-TR') || <UserRound className="size-4" />}
        </span>
        <span className="hidden min-w-0 flex-col leading-tight lg:flex">
          <span className="truncate text-sm font-semibold text-fg">{me.user.name}</span>
          <span className="truncate text-xs text-fg-muted">{roleLabel}</span>
        </span>
        <ChevronDown aria-hidden className="hidden size-4 text-fg-muted lg:block" />
        <span className="sr-only lg:hidden">Hesap menüsü: {me.user.name}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={me.user.name} description={roleLabel} side="right" size="sm">
        <div className="flex flex-col gap-6">
          {me.tenant ? (
            <div>
              <p className="text-sm font-semibold text-fg-muted">İşletme</p>
              <p className="text-base font-semibold text-fg">{me.tenant.name}</p>
            </div>
          ) : null}
          {others.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-fg-muted">Başka işletmeye geç</p>
              {others.map((m) => (
                <Button
                  key={m.tenantId}
                  variant="secondary"
                  block
                  loading={switchTenant.isPending && switchTenant.variables === m.tenantId}
                  onClick={() =>
                    switchTenant.mutate(m.tenantId, {
                      onSuccess: () => {
                        setOpen(false);
                        router.replace(m.role === 'courier' ? '/kurye' : '/panel');
                      },
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  <ArrowLeftRight aria-hidden />
                  {m.tenantName} · {TENANT_ROLE_LABELS[m.role]}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-fg-muted">Tema</p>
            <ThemeToggle />
          </div>
          <Button variant="secondary" block onClick={doLogout} loading={logout.isPending}>
            <LogOut aria-hidden />
            Çıkış yap
          </Button>
        </div>
      </Sheet>
    </>
  );
}
