'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AudioLines, Hand, Image as ImageIcon, MapPin, MessageCircleQuestion, Play, QrCode, RefreshCw, Send, Smartphone, Sparkles, Store } from 'lucide-react';
import { toast } from 'sonner';
import { MessageBubble } from '@/components/chat/message-bubble';
import type { ChatMessage } from '@/components/chat/types';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatTime } from '@/lib/format';

interface DevAccount {
  id: string;
  tenantName: string;
  slug: string;
  branchName: string;
  provider: string;
  displayPhone: string | null;
  status: string;
  /** 'shared': ortak numara satırı (mesajlar platform numarasına gider) */
  mode?: 'shared' | 'own';
  waCode?: string | null;
}

interface SharedShop {
  tenantId: string;
  tenantName: string;
  slug: string;
  waAccountId: string;
  code: string | null;
  prefillText: string | null;
  waLink: string | null;
  selectable: boolean;
}

interface AccountsResponse {
  items: DevAccount[];
  /** Ortak numara (00 §12a madde 8): tek numara; dükkanlar QR'daki #KOD ile seçilir */
  sharedNumber?: { displayName: string; displayPhone: string | null; displayPhoneFormatted: string | null; shops: SharedShop[] };
}

/** Ortak sohbette mesaj: hangi dükkanın konuşmasında ya da platform düzeyinde (dükkan seçici). */
type ThreadMessage = ChatMessage & { tenantId?: string | null; tenantName?: string | null; platform?: boolean; wamid?: string | null };

interface ThreadResponse {
  shared?: boolean;
  conversation: { id: string; mode: 'bot' | 'human'; humanUntil: string | null; optedOut: boolean; lastInboundAt: string | null; tenantName?: string | null } | null;
  customer: { id: string; name: string | null; phone: string | null; bsuid: string | null } | null;
  route?: { currentTenantId: string | null; currentTenantName: string | null; recentTenantIds: string[]; lastRoutedAt: string | null } | null;
  messages: ThreadMessage[];
}

interface SmsItem {
  id: string;
  tenantName: string | null;
  to: string;
  body: string;
  purpose: string;
  status: string;
  createdAt: string;
}

interface AlertItem {
  id: string;
  tenantName: string | null;
  kind: string;
  status: string;
  text: string | null;
  template: string | null;
  to: string | null;
  createdAt: string;
}

type InboundMessage =
  | { type: 'text'; text: string }
  | { type: 'button_reply' | 'list_reply'; id: string; title: string }
  | { type: 'location'; lat: number; lng: number; name?: string }
  | { type: 'audio' | 'image' | 'unsupported' | 'request_welcome' };

/** Hedef seçimindeki ortak numara değeri (diğer değerler kendi numaralı işletmelerin hesap kimlikleri). */
const SHARED = 'shared';
const LS_KEY = 'dev-wa-sim';
const POLL_MS = 2_000;
/** Ortak numarada etkin dükkan süresi (API SHARED_ROUTE_ACTIVE_MS ile aynı) */
const ROUTE_ACTIVE_MS = 24 * 60 * 60_000;
const LOCATION = { type: 'location', lat: 39.8181, lng: 34.8147, name: 'Yozgat Merkez' } as const;
const OWN_QUICK = ['merhaba', 'yetkili', 'DUR', 'BAŞLAT', 'kaça kadar açıksınız', 'Sipariş kodu: '];
const SHARED_QUICK = ['merhaba', 'dükkanlar', 'değiştir', 'yetkili', 'DUR', 'BAŞLAT', 'Sipariş kodu: '];

function loadPrefs(): { accountId?: string; phone?: string; name?: string; bsuid?: string } {
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Ortak sohbette mesajın yönlendirme etiketi (geliştirici görünümü; WhatsApp'ta görünmez). */
function routeTag(m: ThreadMessage) {
  if (m.platform) {
    return (
      <Badge variant="info" size="sm">
        {m.direction === 'in' ? 'Dükkan seçilmedi' : 'Siparişin Önünde · dükkan seçici'}
      </Badge>
    );
  }
  if (!m.tenantName) return null;
  return (
    <Badge variant="outline" size="sm">
      <Store aria-hidden />
      {m.direction === 'in' ? `→ ${m.tenantName}` : m.tenantName}
    </Badge>
  );
}

/**
 * /dev/whatsapp: müşteri gibi yazma, butonlara ve liste satırlarına basma, SMS kutusu, platform uyarıları.
 * Ortak numara (varsayılan): tek sohbet; QR çipleri dükkanın ön-dolu mesajını (#KOD) gönderir, dükkan seçici ve dükkan
 * mesajları aynı akışta görünür. Kendi numaralı işletme: işletmenin hesabı + işletme telefonundan yazma (echo).
 */
export function WhatsappSimulator() {
  const accounts = useApiQuery<AccountsResponse>(['dev', 'wa', 'accounts'], '/dev/wa/accounts');
  const [target, setTarget] = useState('');
  const [phone, setPhone] = useState('0532 000 11 22');
  const [name, setName] = useState('Deneme Müşteri');
  const [bsuid, setBsuid] = useState('');
  const [text, setText] = useState('');
  const [echoText, setEchoText] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const p = loadPrefs();
    if (p.phone) setPhone(p.phone);
    if (p.name) setName(p.name);
    if (p.bsuid) setBsuid(p.bsuid);
    if (p.accountId) setTarget(p.accountId);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({ accountId: target, phone, name, bsuid }));
    } catch {
      // yoksay
    }
  }, [target, phone, name, bsuid]);

  const shared = accounts.data?.sharedNumber ?? null;
  const ownAccounts = useMemo(() => (accounts.data?.items ?? []).filter((a) => (a.mode ?? (a.provider === 'shared' ? 'shared' : 'own')) === 'own'), [accounts.data]);
  const shops = shared?.shops ?? [];

  // Geçersiz ya da eski (ortak numara satırı kimliği) seçim → ortak numara; ortak numara yoksa ilk hesap
  useEffect(() => {
    if (!accounts.data) return;
    if (target === SHARED && shared) return;
    if (target && ownAccounts.some((a) => a.id === target)) return;
    setTarget(shared ? SHARED : (ownAccounts[0]?.id ?? ''));
  }, [accounts.data, target, shared, ownAccounts]);

  const isShared = target === SHARED;
  const account = isShared ? null : (ownAccounts.find((a) => a.id === target) ?? null);
  const recipientReady = !!target && (!!phone.trim() || !!bsuid.trim());
  const thread = useApiQuery<ThreadResponse>(
    ['dev', 'wa', 'thread', target, phone.trim(), bsuid.trim()],
    recipientReady ? '/dev/wa/thread' : null,
    {
      query: { ...(isShared ? { shared: '1' } : { waAccountId: target }), phone: phone.trim() || undefined, bsuid: bsuid.trim() || undefined },
      refetchInterval: POLL_MS,
      retry: false,
    },
  );
  const sms = useApiQuery<{ items: SmsItem[] }>(['dev', 'sms'], '/dev/sms', { refetchInterval: tab === 'sms' ? POLL_MS : 10_000, query: { limit: 50 } });
  const alerts = useApiQuery<{ items: AlertItem[] }>(['dev', 'platform-alerts'], '/dev/platform-alerts', { refetchInterval: tab === 'alerts' ? POLL_MS : 10_000, query: { limit: 50 } });

  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  const newest = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!newest || newest === lastIdRef.current) return;
    lastIdRef.current = newest;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest]);

  const from = useCallback(() => ({ phone: phone.trim() || null, name: name.trim() || null, bsuid: bsuid.trim() || null }), [phone, name, bsuid]);

  const sendInbound = useCallback(
    async (message: InboundMessage, opts: { contextWamid?: string | null } = {}) => {
      if (!recipientReady) {
        toast.error('Önce numara ve müşteri telefonu seçin.');
        return false;
      }
      setBusy(true);
      try {
        const body = isShared
          ? { shared: true, from: from(), message, ...(opts.contextWamid ? { contextWamid: opts.contextWamid } : {}) }
          : { waAccountId: target, from: from(), message };
        await apiFetch('/dev/wa/inbound', { method: 'POST', query: { sync: '1' }, body });
        await thread.refetch();
        return true;
      } catch (err) {
        toast.error(errorMessage(err, 'Mesaj gönderilemedi.'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [target, isShared, from, recipientReady, thread],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (await sendInbound({ type: 'text', text: t })) setText('');
  };

  const onEcho = async (e: FormEvent) => {
    e.preventDefault();
    const t = echoText.trim();
    if (!t || !recipientReady || isShared) return;
    setBusy(true);
    try {
      await apiFetch('/dev/wa/echo', { method: 'POST', query: { sync: '1' }, body: { waAccountId: target, to: from(), text: t } });
      setEchoText('');
      await thread.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const flush = async () => {
    try {
      const r = await apiFetch<{ processed: number }>('/dev/jobs/flush', { method: 'POST' });
      toast.success(`${r.processed} iş çalıştırıldı.`);
      await Promise.all([thread.refetch(), sms.refetch(), alerts.refetch()]);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const conv = thread.data?.conversation ?? null;
  const route = thread.data?.route ?? null;
  const humanActive = conv?.mode === 'human' && (!conv.humanUntil || new Date(conv.humanUntil) > new Date());
  // Yönlendirici kodsuz mesajı son 24 saatte konuşulan dükkana verir (14 §8.1); sonrası dükkan seçici
  const routeActive = !!route?.currentTenantName && !!route.lastRoutedAt && Date.now() - Date.parse(route.lastRoutedAt) <= ROUTE_ACTIVE_MS;
  const targetOptions = [
    ...(shared ? [{ value: SHARED, label: `${shared.displayName} · ortak numara` }] : []),
    ...ownAccounts.map((a) => ({ value: a.id, label: `${a.tenantName} · ${a.displayPhone ?? a.provider} · kendi numarası` })),
  ];
  const chipClass = 'border border-border';

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Numara ve müşteri</CardTitle>
            <CardDescription>
              Müşteri gibi yazın; mesajlar gerçek webhook hattından geçer. Ortak numarada dükkanı QR çipiyle (#KOD) seçin ya da kodsuz yazıp dükkan seçiciyi
              görün.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {accounts.isError ? <Alert variant="danger">{errorMessage(accounts.error)}</Alert> : null}
            <Field label="WhatsApp numarası">
              <Select value={target} onChange={(e) => setTarget(e.target.value)} options={targetOptions} placeholder={accounts.isPending ? 'Yükleniyor…' : 'Numara seçin'} />
            </Field>
            {isShared && shared ? (
              <div className="flex flex-col gap-1 text-sm text-fg-muted">
                <p>
                  Ortak numarada {shops.length} işletme · {shops.filter((s) => s.selectable).length} tanesi dükkan listesinde. Sohbetin altındaki QR çipi
                  (#KOD), dükkanın QR’ı okutulunca WhatsApp’ta hazır gelen mesajı gönderir.
                </p>
                <ul className="flex flex-col gap-0.5">
                  {shops.map((s) => (
                    <li key={s.tenantId}>
                      <span className="font-mono font-semibold text-fg">#{s.code ?? '—'}</span> {s.tenantName}
                      {!s.selectable ? ' · listede değil' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : account ? (
              <p className="text-sm text-fg-muted">
                Sağlayıcı: <strong>{account.provider}</strong> · Durum: <strong>{account.status}</strong> · Vitrin: /s/{account.slug}
              </p>
            ) : null}
            <Field label="Müşteri telefonu">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Profil adı">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="BSUID (isteğe bağlı)" hint="Telefonu boş bırakıp yalnız BSUID ile kullanıcı adı senaryosunu deneyin.">
              <Input value={bsuid} onChange={(e) => setBsuid(e.target.value)} placeholder="TR.123456789" />
            </Field>
            <Button variant="secondary" onClick={() => void flush()}>
              <Play aria-hidden />
              Bekleyen işleri çalıştır
            </Button>
            <p className="text-xs text-fg-muted">Worker çalışmıyorsa giden mesajlar (6 sn aralıklı) ve bildirimler bu düğmeyle işlenir.</p>
          </CardContent>
        </Card>

      </div>

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <TabsList label="Simülatör bölümleri">
          <TabsTrigger value="chat">Sohbet</TabsTrigger>
          <TabsTrigger value="sms">SMS kutusu</TabsTrigger>
          <TabsTrigger value="alerts">Platform uyarıları</TabsTrigger>
        </TabsList>

        <TabsContent value="chat">
          <Card className="flex h-[calc(100dvh-12rem)] min-h-[560px] flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{isShared ? (shared?.displayName ?? 'Ortak numara') : account ? account.tenantName : 'Numara seçin'}</p>
                <p className="text-sm text-fg-muted">
                  {isShared ? (shared?.displayPhoneFormatted ?? '') : (account?.displayPhone ?? '')}
                  {isShared ? (
                    <span>
                      {' · '}
                      {routeActive ? `Etkin dükkan: ${route!.currentTenantName}` : route?.currentTenantName ? `Son dükkan: ${route.currentTenantName} (24 saat geçti)` : 'Dükkan seçilmedi'}
                    </span>
                  ) : null}
                </p>
              </div>
              {conv ? (
                <Badge variant={humanActive ? 'danger' : 'neutral'} size="sm">
                  {humanActive ? 'İnsan modu' : 'Bot'}
                </Badge>
              ) : null}
              {conv?.optedOut ? <Badge variant="warning" size="sm">Opt-out</Badge> : null}
              <Button variant="ghost" size="icon" aria-label="Yenile" onClick={() => void thread.refetch()}>
                <RefreshCw aria-hidden />
              </Button>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-surface px-3 py-4">
              {!messages.length ? (
                <p className="py-10 text-center text-sm text-fg-muted">
                  {isShared ? 'Henüz mesaj yok. Soldan bir dükkanın QR çipine basın ya da kodsuz "merhaba" yazın.' : 'Henüz mesaj yok. Aşağıdan "merhaba" yazın.'}
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {messages.map((m) => (
                    <li key={m.id}>
                      <MessageBubble
                        message={m}
                        side={m.direction === 'in' ? 'right' : 'left'}
                        interactive={m.direction === 'out'}
                        openLinks
                        showCode
                        tag={isShared ? routeTag(m) : undefined}
                        onButton={(id, title) => void sendInbound({ type: 'button_reply', id, title }, { contextWamid: m.wamid })}
                        onListSelect={(id, title) => void sendInbound({ type: 'list_reply', id, title }, { contextWamid: m.wamid })}
                        onSendLocation={() => void sendInbound(LOCATION, { contextWamid: m.wamid })}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto border-t border-border p-2 sm:max-h-none">
              {isShared
                ? shops
                    .filter((s) => s.code)
                    .map((s) => (
                      <Button
                        key={s.tenantId}
                        variant="ghost"
                        size="sm"
                        className={chipClass}
                        title={`${s.tenantName} QR kodunu okut`}
                        onClick={() => void sendInbound({ type: 'text', text: s.prefillText ?? `#${s.code}` })}
                        disabled={busy}
                      >
                        <QrCode aria-hidden />#{s.code}
                      </Button>
                    ))
                : null}
              {(isShared ? SHARED_QUICK : OWN_QUICK).map((q) => (
                <Button
                  key={q}
                  variant="ghost"
                  size="sm"
                  className={chipClass}
                  onClick={() => (q.endsWith(': ') ? setText(q) : void sendInbound({ type: 'text', text: q }))}
                  disabled={busy}
                >
                  {q.trim()}
                </Button>
              ))}
              <Button variant="ghost" size="sm" className={chipClass} onClick={() => void sendInbound({ type: 'request_welcome' })} disabled={busy}>
                <Sparkles aria-hidden />
                Sohbeti aç
              </Button>
              <Button variant="ghost" size="sm" className={chipClass} onClick={() => void sendInbound(LOCATION)} disabled={busy}>
                <MapPin aria-hidden />
                Konum
              </Button>
              <Button variant="ghost" size="sm" className={chipClass} onClick={() => void sendInbound({ type: 'audio' })} disabled={busy}>
                <AudioLines aria-hidden />
                Ses
              </Button>
              <Button variant="ghost" size="sm" className={chipClass} onClick={() => void sendInbound({ type: 'image' })} disabled={busy}>
                <ImageIcon aria-hidden />
                Görsel
              </Button>
              <Button variant="ghost" size="sm" className={chipClass} onClick={() => void sendInbound({ type: 'unsupported' })} disabled={busy}>
                <MessageCircleQuestion aria-hidden />
                Desteklenmeyen
              </Button>
            </div>

            <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border bg-surface-raised p-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Müşteri mesajı</span>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Müşteri olarak yazın…" />
              </label>
              <Button type="submit" size="icon" aria-label="Gönder" loading={busy} disabled={!text.trim()}>
                {busy ? null : <Send aria-hidden />}
              </Button>
            </form>
            {!isShared ? (
              <form onSubmit={onEcho} className="flex items-end gap-2 border-t border-dashed border-border bg-surface p-3">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">İşletme telefonundan yaz</span>
                  <Input value={echoText} onChange={(e) => setEchoText(e.target.value)} placeholder="İşletme telefonundan yaz (echo)…" />
                </label>
                <Button type="submit" variant="secondary" disabled={!echoText.trim() || busy}>
                  <Smartphone aria-hidden />
                  <span className="hidden sm:inline">İşletme telefonundan yaz</span>
                  <span className="sm:hidden">Echo</span>
                </Button>
              </form>
            ) : null}
          </Card>
          {humanActive ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
              <Hand aria-hidden className="size-4" />
              {isShared && conv?.tenantName ? `${conv.tenantName}: ` : ''}
              {conv?.humanUntil ? `Bot susuyor (bitiş ${formatTime(conv.humanUntil)}).` : 'Bot, panelden bota bırakılana kadar susuyor.'}
            </p>
          ) : null}
        </TabsContent>

        <TabsContent value="sms">
          <Card>
            <CardHeader>
              <CardTitle>SMS kutusu (mock)</CardTitle>
              <CardDescription>OTP, kritik durum ve alarm SMS’leri.</CardDescription>
            </CardHeader>
            <CardContent>
              {!sms.data?.items.length ? (
                <p className="text-sm text-fg-muted">Henüz SMS yok.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sms.data.items.map((s) => (
                    <li key={s.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                        <span>{formatDateTime(s.createdAt)}</span>
                        <span>→ {s.to}</span>
                        <Badge size="sm" variant="neutral">
                          {s.purpose}
                        </Badge>
                        <Badge size="sm" variant={s.status === 'failed' ? 'danger' : 'success'}>
                          {s.status}
                        </Badge>
                        {s.tenantName ? <span>{s.tenantName}</span> : null}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{s.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Platform uyarıları (mock)</CardTitle>
              <CardDescription>Platform WhatsApp numarasından (ortak numara) işletme sahibine giden şablonlar.</CardDescription>
            </CardHeader>
            <CardContent>
              {!alerts.data?.items.length ? (
                <p className="text-sm text-fg-muted">Henüz uyarı yok.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {alerts.data.items.map((a) => (
                    <li key={a.id} className={cn('rounded-md border border-border p-3', a.status !== 'sent' && 'opacity-70')}>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                        <span>{formatDateTime(a.createdAt)}</span>
                        {a.to ? <span>→ {a.to}</span> : null}
                        <Badge size="sm" variant="neutral">
                          {a.kind}
                        </Badge>
                        <Badge size="sm" variant={a.status === 'sent' ? 'success' : 'warning'}>
                          {a.status}
                        </Badge>
                        {a.template ? <span className="font-mono">{a.template}</span> : null}
                        {a.tenantName ? <span>{a.tenantName}</span> : null}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
