'use client';

// Ayarlar › Bu cihazda bildirimler (04 §4.1, §4.5; 06 §7.8): bu tarayıcının Web Push durumu, aç/kapa anahtarı,
// test bildirimi ve iOS (ana ekrana ekleme, 16.4+) yardımı. Tercih cihaz başınadır; hesap ayarı değildir.

import { useCallback, useEffect, useState } from 'react';
import { BellRing, CircleCheck, CircleX, Send, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import type { PushPublicKeyResponse } from '@siparis/core/notifications/contracts';
import { Alert, Badge, Button, Switch } from '@/components/ui';
import { Section, SettingsShell } from '@/components/settings/settings-shell';
import { errorMessage, useApiQuery } from '@/lib/api';
import { currentRole, useMe } from '@/lib/auth';
import {
  currentPlatform,
  currentSubscription,
  disablePush,
  enablePush,
  isPushOptedOut,
  isPushSupported,
  notificationPermission,
  sameApplicationServerKey,
  sendTestPush,
  type PushEnableResult,
  type PushPlatform,
} from './push-client';

export const PUSH_PUBLIC_KEY_QUERY = ['panel', 'push', 'public-key'] as const;

interface DeviceState {
  supported: boolean;
  platform: PushPlatform;
  permission: NotificationPermission | 'unsupported';
  /** Tarayıcıdaki abonelik (sunucu anahtarıyla eşleşen) */
  endpoint: string | null;
  optedOut: boolean;
}

const PERMISSION_TEXT: Record<DeviceState['permission'], string> = {
  granted: 'Verildi',
  default: 'Henüz sorulmadı',
  denied: 'Engellendi',
  unsupported: 'Desteklenmiyor',
};

/** enablePush başarısızlığının kullanıcı metni. */
export function pushFailureText(result: Exclude<PushEnableResult, { ok: true }>): string {
  switch (result.reason) {
    case 'denied':
      return 'Bildirim izni engellendi. Tarayıcı ayarlarından bu site için bildirimlere izin verin.';
    case 'dismissed':
      return 'Bildirim izni verilmedi. Tekrar denediğinizde çıkan pencerede "İzin ver"e dokunun.';
    case 'server_disabled':
      return 'Bildirim servisi henüz açılmadı. Platform yöneticisine haber verin.';
    case 'needs_home_screen':
      return 'iPhone ve iPad\'de bildirim için önce paneli ana ekrana ekleyin.';
    case 'unsupported':
      return 'Bu tarayıcı bildirimleri desteklemiyor.';
    case 'opted_out':
      return 'Bu cihazda bildirimler kapalı.';
    default:
      return 'Bildirimler açılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
  }
}

export function DevicePushSettingsScreen() {
  const me = useMe();
  const role = currentRole(me.data);
  const canSeeSettings = role === 'owner' || role === 'manager';
  return (
    <SettingsShell
      title="Bu cihazda bildirimler"
      description="Yeni sipariş geldiğinde bu telefona, tablete ya da bilgisayara bildirim gelsin. Ayar yalnız bu cihazı etkiler."
      backHref={canSeeSettings ? '/panel/ayarlar' : null}
      className="max-w-3xl"
    >
      <DevicePushSettings impersonating={Boolean(me.data?.impersonating)} kitchen={role === 'kitchen'} />
    </SettingsShell>
  );
}

function StatusRow({ label, ok, value }: { label: string; ok: boolean | null; value: string }) {
  return (
    <div className="flex min-h-hit flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-base text-fg">{label}</dt>
      <dd>
        <Badge variant={ok == null ? 'neutral' : ok ? 'success' : 'danger'}>
          {ok == null ? null : ok ? <CircleCheck aria-hidden /> : <CircleX aria-hidden />}
          {value}
        </Badge>
      </dd>
    </div>
  );
}

export function DevicePushSettings({ impersonating, kitchen }: { impersonating: boolean; kitchen: boolean }) {
  const key = useApiQuery<PushPublicKeyResponse>([...PUSH_PUBLIC_KEY_QUERY], '/panel/push/public-key', { staleTime: 5 * 60_000 });
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | null>(null);

  const refresh = useCallback(async () => {
    const supported = isPushSupported();
    let endpoint: string | null = null;
    if (supported) {
      const sub = await currentSubscription().catch(() => null);
      const publicKey = key.data?.publicKey;
      if (sub && (!publicKey || sameApplicationServerKey(sub.options.applicationServerKey, publicKey))) endpoint = sub.endpoint;
    }
    setDevice({ supported, platform: currentPlatform(), permission: notificationPermission(), endpoint, optedOut: isPushOptedOut() });
  }, [key.data?.publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const serverEnabled = key.data?.enabled ?? null;
  const on = Boolean(device?.endpoint) && !device?.optedOut;

  // Kullanıcı jesti içinde: enablePush izni ilk adımda ister
  const turnOn = async () => {
    setBusy('on');
    const res = await enablePush();
    setBusy(null);
    await refresh();
    if (res.ok) toast.success('Bu cihazda bildirimler açıldı.');
    else toast.error(pushFailureText(res));
  };

  const turnOff = async () => {
    setBusy('off');
    try {
      await disablePush();
      toast.success('Bu cihazda bildirimler kapatıldı.');
    } catch (err) {
      toast.error(errorMessage(err, 'Bildirimler kapatılamadı. Tekrar deneyin.'));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const test = async () => {
    if (!device?.endpoint) return;
    setBusy('test');
    try {
      const res = await sendTestPush(device.endpoint);
      if (res.sent) toast.success('Test bildirimi gönderildi. Birkaç saniye içinde gelmezse cihazın bildirim ayarlarını kontrol edin.');
      else if (res.reason === 'not_found' || res.reason === 'disabled') toast.error('Bu cihazın kaydı bulunamadı. Bildirimleri kapatıp yeniden açın.');
      else if (res.reason === 'push_disabled') toast.error('Bildirim servisi henüz açılmadı. Platform yöneticisine haber verin.');
      else toast.error('Test bildirimi gönderilemedi. Biraz sonra tekrar deneyin.');
    } catch (err) {
      toast.error(errorMessage(err, 'Test bildirimi gönderilemedi.'));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  if (impersonating) {
    return (
      <Alert variant="info" title="Destek görünümü">
        Bildirim ayarı işletmenin kendi cihazlarında yapılır; destek görünümünde kullanılamaz.
      </Alert>
    );
  }

  const platform = device?.platform;
  const blocked = device?.permission === 'denied';
  const canToggle = Boolean(device?.supported) && serverEnabled === true && !blocked;

  return (
    <div className="flex flex-col gap-6">
      {serverEnabled === false ? (
        <Alert variant="warning" title="Bildirim servisi kapalı">
          Platform yöneticisi bildirim anahtarlarını henüz tanımlamadı. Sipariş uyarıları panel sesi, WhatsApp ve SMS ile gelmeye devam eder.
        </Alert>
      ) : null}
      {key.isError ? (
        <Alert variant="danger" title="Bildirim durumu alınamadı">
          {errorMessage(key.error)}
        </Alert>
      ) : null}

      <Section title="Bu cihaz" description="Panel kapalıyken ya da ekran kilitliyken yeni siparişi bildirimle haber verir.">
        {platform?.needsHomeScreen ? (
          <Alert variant="info" title="iPhone ve iPad: önce ana ekrana ekleyin">
            <p>Bildirimler iPhone ve iPad&apos;de yalnız ana ekrana eklenen panelde çalışır (iOS 16.4 ve üzeri).</p>
            <ol className="mt-2 list-decimal space-y-1 ps-5">
              <li>Safari&apos;de alttaki Paylaş simgesine dokunun.</li>
              <li>&quot;Ana Ekrana Ekle&quot;yi seçin ve &quot;Ekle&quot;ye dokunun.</li>
              <li>Paneli ana ekrandaki &quot;Siparişler&quot; simgesinden açın, giriş yapın ve bu sayfadan bildirimleri açın.</li>
            </ol>
          </Alert>
        ) : null}
        {platform?.iosTooOld ? (
          <Alert variant="warning" title="iOS sürümü eski">
            Bu cihazın iOS sürümü web bildirimlerini desteklemiyor (iOS 16.4 ve üzeri gerekir). Ayarlar › Genel › Yazılım Güncelleme ile güncelleyebilirsiniz.
          </Alert>
        ) : null}
        {device && !device.supported && !platform?.needsHomeScreen && !platform?.iosTooOld ? (
          <Alert variant="warning" title="Bu tarayıcı desteklemiyor">
            Bildirim için Android&apos;de Chrome, bilgisayarda Chrome, Edge ya da Firefox kullanın. Gizli sekmede bildirim çalışmaz.
          </Alert>
        ) : null}
        {blocked ? (
          <Alert variant="danger" title="Bildirim izni engellenmiş">
            Tarayıcı bu site için bildirimleri engelliyor. Adres çubuğundaki kilit simgesine dokunun, Bildirimler&apos;i &quot;İzin ver&quot; yapın ve
            sayfayı yenileyin. Ana ekrana eklenmiş uygulamada: cihaz Ayarları › Bildirimler › Siparişler.
          </Alert>
        ) : null}

        <Switch
          checked={on}
          disabled={busy !== null || (!on && !canToggle)}
          onCheckedChange={(v) => void (v ? turnOn() : turnOff())}
          label="Bu cihazda bildirimleri aç"
          description={kitchen ? 'Mutfak bildiriminde sipariş numarası ve ürün adedi görünür, tutar görünmez.' : 'Bildirimde sipariş numarası, ürün adedi ve tutar görünür.'}
        />

        <dl className="flex flex-col">
          <StatusRow
            label="Bildirim izni"
            ok={device?.permission === 'granted' ? true : device?.permission === 'default' ? null : device ? false : null}
            value={device ? PERMISSION_TEXT[device.permission] : 'Kontrol ediliyor'}
          />
          <StatusRow label="Bu cihazın kaydı" ok={device ? on : null} value={!device ? 'Kontrol ediliyor' : on ? 'Kayıtlı, bildirim alır' : 'Kayıtlı değil'} />
        </dl>

        {on ? (
          <div>
            <Button variant="secondary" onClick={() => void test()} loading={busy === 'test'} className="max-sm:w-full">
              <Send aria-hidden /> Test bildirimi gönder
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title="Nasıl çalışır">
        <ul className="flex flex-col gap-3 text-base text-fg">
          <li className="flex gap-3">
            <BellRing aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-muted" />
            <span>
              Yeni sipariş gelince bildirim hemen gider. Bildirimde müşterinin adı, telefonu ve adresi görünmez; ayrıntı için bildirime dokunup
              paneli açın.
            </span>
          </li>
          <li className="flex gap-3">
            <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-muted" />
            <span>
              Bildirim alarm sesinin yerini tutmaz. Vardiya başında &quot;Siparişleri almaya başla&quot;ya dokunun ve paneli açık bırakın. Sipariş
              2 dakikada onaylanmazsa işletme sahibine WhatsApp, 5 dakikada SMS uyarısı ayrıca gider.
            </span>
          </li>
          <li className="flex gap-3">
            <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-muted" />
            <span>
              Android&apos;de bildirimin sesli gelmesi için Chrome&apos;un bildirim sesi açık olmalı ve pil tasarrufu Chrome&apos;u kısıtlamamalı.
              Çıkış yapınca bu cihazın kaydı silinir; aynı cihazda yeniden giriş yapınca kendiliğinden yenilenir.
            </span>
          </li>
        </ul>
      </Section>
    </div>
  );
}
