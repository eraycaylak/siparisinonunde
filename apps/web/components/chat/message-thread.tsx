'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, Hand, Phone, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch, errorMessage, isApiError } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/lib/labels';
import type { OrderStatus } from '@siparis/core';
import { Composer } from './composer';
import { ModeBadge } from './conversation-list';
import { MessageBubble } from './message-bubble';
import { customerLabel, type ChatMessage, type ConversationItem, type ListResult } from './types';

export interface MessageThreadProps {
  conversation: ConversationItem;
  messages: ChatMessage[];
  loading?: boolean;
  error?: unknown;
  onBack?: () => void;
  /** Mesaj/konuşma değişti (yeniden çek) */
  onChanged: () => void;
  /** Eski mesajlar için sonraki cursor */
  nextCursor?: string;
}

function modeText(c: ConversationItem): string {
  if (!c.humanActive) return 'Bot yanıtlıyor';
  if (!c.humanUntil) return 'Personel yanıtlıyor · bot kapalı';
  return `Personel yanıtlıyor · bot susuyor (bitiş ${formatTime(c.humanUntil)})`;
}

/** Sağ bölüm: başlık (müşteri, mod anahtarı), mesaj akışı, yanıt kutusu. */
export function MessageThread({ conversation: c, messages, loading, error, onBack, onChanged, nextCursor }: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const lastIdRef = useRef<string | null>(null);

  // Konuşma değişince eski sayfaları sıfırla
  useEffect(() => {
    setOlder([]);
    setOlderCursor(undefined);
    lastIdRef.current = null;
  }, [c.id]);

  const all = [...older, ...messages].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
  const cursor = olderCursor ?? nextCursor;
  const newestId = all[all.length - 1]?.id ?? null;

  // Yeni mesaj gelince en alta kaydır
  useLayoutEffect(() => {
    if (!newestId || newestId === lastIdRef.current) return;
    lastIdRef.current = newestId;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newestId]);

  const loadOlder = useCallback(async () => {
    if (!cursor) return;
    setLoadingOlder(true);
    try {
      const res = await apiFetch<ListResult<ChatMessage>>(`/panel/conversations/${c.id}/messages`, { query: { cursor, limit: 50 } });
      setOlder((prev) => [...[...res.items].reverse(), ...prev]);
      setOlderCursor(res.nextCursor ?? '');
    } catch (err) {
      toast.error(errorMessage(err, 'Eski mesajlar yüklenemedi.'));
    } finally {
      setLoadingOlder(false);
    }
  }, [c.id, cursor]);

  const send = async (text: string) => {
    setSending(true);
    try {
      await apiFetch(`/panel/conversations/${c.id}/messages`, { method: 'POST', body: { text } });
      onChanged();
      return true;
    } catch (err) {
      if (isApiError(err) && err.code === 'window_closed') onChanged();
      toast.error(errorMessage(err, 'Mesaj gönderilemedi.'));
      return false;
    } finally {
      setSending(false);
    }
  };

  const setMode = async (mode: 'bot' | 'human') => {
    setModeBusy(true);
    try {
      await apiFetch(`/panel/conversations/${c.id}/mode`, { method: 'POST', body: { mode } });
      toast.success(mode === 'human' ? 'Konuşmayı devraldınız. Bot bu sohbette yanıt vermeyecek.' : 'Konuşma bota bırakıldı.');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setModeBusy(false);
    }
  };

  const windowReason = !c.windowOpen
    ? 'Müşterinin son mesajının üzerinden 24 saat geçti. WhatsApp kuralları gereği serbest mesaj gönderilemez; müşteri yeniden yazınca yanıtlayabilir ya da telefonla arayabilirsiniz.'
    : null;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`${customerLabel(c.customer)} ile sohbet`}>
      <header className="flex flex-col gap-2 border-b border-border bg-surface-raised p-3">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button variant="ghost" size="icon" aria-label="Sohbet listesine dön" onClick={onBack} className="shrink-0 md:hidden">
              <ArrowLeft aria-hidden />
            </Button>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="truncate text-lg font-bold">{customerLabel(c.customer)}</h2>
            {c.customer.phoneMasked ? (
              <p className="flex items-center gap-1 truncate text-sm text-fg-muted">
                <Phone aria-hidden className="size-3.5 shrink-0" />
                {c.customer.phoneMasked}
              </p>
            ) : null}
          </div>
          <ModeBadge c={c} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-fg-muted">{modeText(c)}</p>
          {c.humanActive ? (
            <Button variant="secondary" size="md" loading={modeBusy} onClick={() => void setMode('bot')}>
              <Bot aria-hidden />
              Bota bırak
            </Button>
          ) : (
            <Button variant="primary" size="md" loading={modeBusy} onClick={() => void setMode('human')}>
              <Hand aria-hidden />
              Konuşmayı devral
            </Button>
          )}
        </div>
        {c.activeOrder ? (
          <div className="flex w-full flex-wrap items-center gap-2 text-sm">
            <ShoppingBag aria-hidden className="size-4 text-fg-muted" />
            <span>Açık sipariş</span>
            <Link href="/panel/siparisler" className="font-semibold underline underline-offset-2">
              #{c.activeOrder.number}
            </Link>
            <Badge variant="info" size="sm">
              {ORDER_STATUS_LABELS[c.activeOrder.status as OrderStatus] ?? c.activeOrder.status}
            </Badge>
          </div>
        ) : null}
        {c.optedOut ? (
          <p className="w-full text-sm text-fg-muted">Müşteri otomatik mesajları durdurdu (DUR). Yalnız kendi siparişinin bildirimleri gider.</p>
        ) : null}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-surface px-3 py-4" aria-live="polite" aria-relevant="additions">
        {cursor ? (
          <div className="mb-3 flex justify-center">
            <Button variant="ghost" size="sm" loading={loadingOlder} onClick={() => void loadOlder()}>
              Daha eski mesajlar
            </Button>
          </div>
        ) : null}
        {loading && !all.length ? (
          <div className="flex justify-center py-10">
            <Spinner size="lg" label="Mesajlar yükleniyor" />
          </div>
        ) : null}
        {error ? <Alert variant="danger" title="Mesajlar yüklenemedi">{errorMessage(error)}</Alert> : null}
        <ol className="flex flex-col gap-2">
          {all.map((m) => (
            <li key={m.id}>
              <MessageBubble message={m} side={m.direction === 'out' ? 'right' : 'left'} />
            </li>
          ))}
        </ol>
      </div>

      <Composer disabled={!c.windowOpen} disabledReason={windowReason} sending={sending} onSend={send} />
    </section>
  );
}
