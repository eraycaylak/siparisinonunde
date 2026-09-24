'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AudioLines, Hand, Image as ImageIcon, MapPin, MessageCircleQuestion, Play, RefreshCw, Send, Smartphone, Sparkles } from 'lucide-react';
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
}

interface ThreadResponse {
  conversation: { id: string; mode: 'bot' | 'human'; humanUntil: string | null; optedOut: boolean; lastInboundAt: string | null } | null;
  customer: { id: string; name: string | null; phone: string | null; bsuid: string | null } | null;
  messages: ChatMessage[];
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

const LS_KEY = 'dev-wa-sim';
const POLL_MS = 2_000;

function loadPrefs(): { accountId?: string; phone?: string; name?: string; bsuid?: string } {
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** /dev/whatsapp: mock WhatsApp hesabıyla müşteri gibi yazma, butonlara basma, echo, SMS kutusu, platform uyarıları. */
export function WhatsappSimulator() {
  const accounts = useApiQuery<{ items: DevAccount[] }>(['dev', 'wa', 'accounts'], '/dev/wa/accounts');
  const [accountId, setAccountId] = useState('');
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
    if (p.accountId) setAccountId(p.accountId);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify({ accountId, phone, name, bsuid }));
    } catch {
      // yoksay
    }
  }, [accountId, phone, name, bsuid]);
  useEffect(() => {
    const items = accounts.data?.items ?? [];
    if (items.length && !items.some((a) => a.id === accountId)) setAccountId(items[0]!.id);
  }, [accounts.data, accountId]);

  const account = accounts.data?.items.find((a) => a.id === accountId) ?? null;
  const recipientReady = !!accountId && (!!phone.trim() || !!bsuid.trim());
  const thread = useApiQuery<ThreadResponse>(
    ['dev', 'wa', 'thread', accountId, phone.trim(), bsuid.trim()],
    recipientReady ? '/dev/wa/thread' : null,
    { query: { waAccountId: accountId, phone: phone.trim() || undefined, bsuid: bsuid.trim() || undefined }, refetchInterval: POLL_MS, retry: false },
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
    async (message: InboundMessage) => {
      if (!recipientReady) {
        toast.error('Önce işletme numarası ve müşteri telefonu seçin.');
        return false;
      }
      setBusy(true);
      try {
        await apiFetch('/dev/wa/inbound', { method: 'POST', query: { sync: '1' }, body: { waAccountId: accountId, from: from(), message } });
        await thread.refetch();
        return true;
      } catch (err) {
        toast.error(errorMessage(err, 'Mesaj gönderilemedi.'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accountId, from, recipientReady, thread],
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
    if (!t || !recipientReady) return;
    setBusy(true);
    try {
      await apiFetch('/dev/wa/echo', { method: 'POST', query: { sync: '1' }, body: { waAccountId: accountId, to: from(), text: t } });
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
  const humanActive = conv?.mode === 'human' && (!conv.humanUntil || new Date(conv.humanUntil) > new Date());

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>İşletme ve müşteri</CardTitle>
            <CardDescription>Mock WhatsApp hesabına müşteri gibi yazın. Mesajlar gerçek webhook hattından geçer.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {accounts.isError ? <Alert variant="danger">{errorMessage(accounts.error)}</Alert> : null}
            <Field label="İşletme numarası">
              <Select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                options={(accounts.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.tenantName} · ${a.displayPhone ?? a.provider}` }))}
                placeholder={accounts.isPending ? 'Yükleniyor…' : 'Hesap seçin'}
              />
            </Field>
            {account ? (
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList label="Simülatör bölümleri">
          <TabsTrigger value="chat">Sohbet</TabsTrigger>
          <TabsTrigger value="sms">SMS kutusu</TabsTrigger>
          <TabsTrigger value="alerts">Platform uyarıları</TabsTrigger>
        </TabsList>

        <TabsContent value="chat">
          <Card className="flex h-[calc(100dvh-12rem)] min-h-[560px] flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{account ? account.tenantName : 'İşletme seçin'}</p>
                <p className="text-sm text-fg-muted">{account?.displayPhone ?? ''}</p>
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
                <p className="py-10 text-center text-sm text-fg-muted">Henüz mesaj yok. Aşağıdan "merhaba" yazın.</p>
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
                        onButton={(id, title) => void sendInbound({ type: 'button_reply', id, title })}
                        onListSelect={(id, title) => void sendInbound({ type: 'list_reply', id, title })}
                        onSendLocation={() => void sendInbound({ type: 'location', lat: 39.8181, lng: 34.8147, name: 'Yozgat Merkez' })}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border p-2">
              {['merhaba', 'yetkili', 'DUR', 'BAŞLAT', 'kaça kadar açıksınız', 'Sipariş kodu: '].map((q) => (
                <Button
                  key={q}
                  variant="ghost"
                  size="sm"
                  className="border border-border"
                  onClick={() => (q.endsWith(': ') ? setText(q) : void sendInbound({ type: 'text', text: q }))}
                  disabled={busy}
                >
                  {q.trim()}
                </Button>
              ))}
              <Button variant="ghost" size="sm" className="border border-border" onClick={() => void sendInbound({ type: 'request_welcome' })} disabled={busy}>
                <Sparkles aria-hidden />
                Sohbeti aç
              </Button>
              <Button variant="ghost" size="sm" className="border border-border" onClick={() => void sendInbound({ type: 'location', lat: 39.8181, lng: 34.8147, name: 'Yozgat Merkez' })} disabled={busy}>
                <MapPin aria-hidden />
                Konum
              </Button>
              <Button variant="ghost" size="sm" className="border border-border" onClick={() => void sendInbound({ type: 'audio' })} disabled={busy}>
                <AudioLines aria-hidden />
                Ses
              </Button>
              <Button variant="ghost" size="sm" className="border border-border" onClick={() => void sendInbound({ type: 'image' })} disabled={busy}>
                <ImageIcon aria-hidden />
                Görsel
              </Button>
              <Button variant="ghost" size="sm" className="border border-border" onClick={() => void sendInbound({ type: 'unsupported' })} disabled={busy}>
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
          </Card>
          {humanActive ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
              <Hand aria-hidden className="size-4" />
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
              <CardDescription>Platform WhatsApp numarasından işletme sahibine giden şablonlar.</CardDescription>
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
