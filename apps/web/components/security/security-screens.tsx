'use client';

import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsShell } from '@/components/settings/settings-shell';
import { currentRole, needsTotpEnrollment, useMe } from '@/lib/auth';
import { TotpManager } from './totp-manager';

/** /admin/guvenlik — platform yöneticisinin kendi hesabı (TOTP zorunluysa kurulmadan diğer admin ekranları kapalı). */
export function AdminSecurityScreen() {
  const me = useMe();
  const mustEnroll = needsTotpEnrollment(me.data);
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Güvenlik" description="Platform hesabınızın iki adımlı doğrulaması." />
      {mustEnroll ? (
        <Alert variant="warning" title="Devam etmek için iki adımlı doğrulamayı açın" className="mb-4">
          Yönetim ekranları, hesabınızda iki adımlı doğrulama açılana kadar kapalıdır.
        </Alert>
      ) : null}
      <TotpManager />
    </div>
  );
}

/** /panel/ayarlar/guvenlik — işletme kullanıcısının kendi hesabı (isteğe bağlı; sahibe önerilir). */
export function PanelSecurityScreen() {
  const me = useMe();
  const role = currentRole(me.data);
  const canSeeSettings = role === 'owner' || role === 'manager';
  return (
    <SettingsShell
      title="Güvenlik"
      description="Hesabınız için iki adımlı doğrulama. Bu ayar yalnız sizin girişinizi etkiler; personelin hesapları ayrıdır."
      backHref={canSeeSettings ? '/panel/ayarlar' : null}
      className="max-w-3xl"
    >
      <TotpManager recommended={role === 'owner'} />
    </SettingsShell>
  );
}
