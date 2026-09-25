'use client';

import { useState, type ReactNode } from 'react';
import {
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  ExternalLink,
  FileText,
  List,
  MapPin,
  MessageSquareReply,
  Mic,
  Image as ImageIcon,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import type { ChatMessage } from './types';

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Sağda gösterilen taraf (panelde işletme, simülatörde müşteri). */
  side: 'left' | 'right';
  /** Butonlar tıklanabilir mi (yalnız simülatörde müşteri gözünden). */
  interactive?: boolean;
  onButton?: (id: string, title: string) => void;
  onListSelect?: (id: string, title: string) => void;
  onSendLocation?: () => void;
  /** Bot mesajlarında M-kodunu göster (geliştirici görünümü). */
  showCode?: boolean;
  /** CTA bağlantıları açılabilir mi (panelde müşteri token'ı tüketilmesin diye kapalı). */
  openLinks?: boolean;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;
const IS_URL = /^https?:\/\//;

function Linkified({ text, openLinks }: { text: string; openLinks: boolean }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        IS_URL.test(p) && openLinks ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 [overflow-wrap:anywhere]">
            {p}
          </a>
        ) : (
          <span key={i} className={IS_URL.test(p) ? '[overflow-wrap:anywhere]' : undefined}>
            {p}
          </span>
        ),
      )}
    </>
  );
}

function senderLabel(m: ChatMessage): string {
  if (m.direction === 'in') return 'Müşteri';
  switch (m.sentBy) {
    case 'bot':
      return m.templateName ? 'Otomatik (şablon)' : 'Otomatik';
    case 'user':
      return m.sentByName ? m.sentByName : 'Personel';
    case 'business_phone':
      return 'İşletme telefonu';
    default:
      return 'İşletme';
  }
}

function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'queued':
      return <Clock aria-label="Sırada" className="size-3.5" />;
    case 'sent':
      return <Check aria-label="Gönderildi" className="size-3.5" />;
    case 'delivered':
      return <CheckCheck aria-label="İletildi" className="size-3.5" />;
    case 'read':
      return <CheckCheck aria-label="Okundu" className="size-3.5 text-info" />;
    case 'failed':
      return <CircleAlert aria-label="Gönderilemedi" className="size-3.5 text-destructive" />;
    default:
      return null;
  }
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'audio') return <Mic aria-hidden className="size-4" />;
  if (kind === 'image') return <ImageIcon aria-hidden className="size-4" />;
  if (kind === 'location') return <MapPin aria-hidden className="size-4" />;
  if (kind === 'echo') return <Smartphone aria-hidden className="size-4" />;
  if (kind === 'button_reply' || kind === 'list_reply') return <MessageSquareReply aria-hidden className="size-4" />;
  if (kind === 'system') return <FileText aria-hidden className="size-4" />;
  return null;
}

function ChoiceChip({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-h-10 items-center justify-center rounded-md border border-dashed border-border-strong px-3 text-sm font-semibold text-fg-muted">
      {children}
    </span>
  );
}

/** WhatsApp benzeri mesaj balonu (panel sohbeti ve simülatör ortak). */
export function MessageBubble({
  message: m,
  side,
  interactive = false,
  onButton,
  onListSelect,
  onSendLocation,
  showCode = false,
  openLinks = false,
}: MessageBubbleProps) {
  const [listOpen, setListOpen] = useState(false);
  const mine = side === 'right';
  const failed = m.status === 'failed';
  const icon = <KindIcon kind={m.kind} />;
  return (
    <div className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex max-w-[88%] flex-col gap-2 rounded-lg px-3 py-2 shadow-sm sm:max-w-[75%]',
          mine ? 'rounded-tr-sm bg-status-ready-bg text-fg' : 'rounded-tl-sm border border-border bg-surface-raised text-fg',
          failed && 'ring-2 ring-destructive/60',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-fg-muted">
          {icon}
          <span>{senderLabel(m)}</span>
          {showCode && m.code ? <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px]">{m.code}</span> : null}
          {m.templateName ? <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px]">{m.templateName}</span> : null}
          {m.orderNumber ? <span className="rounded bg-surface px-1.5 py-0.5">Sipariş #{m.orderNumber}</span> : null}
        </div>

        {m.body ? (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-6">
            <Linkified text={m.body} openLinks={openLinks} />
          </p>
        ) : null}

        {m.location ? (
          <a
            href={`https://www.openstreetmap.org/?mlat=${m.location.lat}&mlon=${m.location.lng}#map=17/${m.location.lat}/${m.location.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-hit items-center gap-2 text-sm font-semibold underline underline-offset-2"
          >
            <MapPin aria-hidden className="size-4" />
            Haritada gör ({m.location.lat.toFixed(4)}, {m.location.lng.toFixed(4)})
          </a>
        ) : null}

        {m.cta ? (
          interactive || openLinks ? (
            <a
              href={m.cta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-hit items-center justify-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-base font-semibold text-info hover:bg-accent"
            >
              <ExternalLink aria-hidden className="size-4" />
              {m.cta.label}
            </a>
          ) : (
            <ChoiceChip>
              <ExternalLink aria-hidden className="me-1.5 size-4" />
              {m.cta.label}
            </ChoiceChip>
          )
        ) : null}

        {m.buttons?.length ? (
          <div className="flex flex-col gap-1.5">
            {m.buttons.map((b) =>
              interactive && onButton ? (
                <Button key={b.id} variant="secondary" size="md" block className="text-info" onClick={() => onButton(b.id, b.title)}>
                  {b.title}
                </Button>
              ) : (
                <ChoiceChip key={b.id}>{b.title}</ChoiceChip>
              ),
            )}
          </div>
        ) : null}

        {m.list ? (
          <div className="flex flex-col gap-1.5">
            {interactive && onListSelect ? (
              <>
                <Button variant="secondary" size="md" block className="text-info" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
                  <List aria-hidden />
                  {m.list.buttonTitle}
                </Button>
                {listOpen
                  ? m.list.rows.map((r) => (
                      <Button
                        key={r.id}
                        variant="ghost"
                        size="md"
                        block
                        className="justify-start border border-border"
                        onClick={() => {
                          setListOpen(false);
                          onListSelect(r.id, r.title);
                        }}
                      >
                        {r.title}
                      </Button>
                    ))
                  : null}
              </>
            ) : (
              <>
                <ChoiceChip>
                  <List aria-hidden className="me-1.5 size-4" />
                  {m.list.buttonTitle}
                </ChoiceChip>
                <p className="text-xs text-fg-muted">{m.list.rows.map((r) => r.title).join(' · ')}</p>
              </>
            )}
          </div>
        ) : null}

        {m.locationRequest ? (
          interactive && onSendLocation ? (
            <Button variant="secondary" size="md" block className="text-info" onClick={onSendLocation}>
              <MapPin aria-hidden />
              Konum gönder
            </Button>
          ) : (
            <ChoiceChip>Konum gönder</ChoiceChip>
          )
        ) : null}

        <div className="flex items-center justify-end gap-1 text-[11px] text-fg-muted">
          {failed ? <span className="font-semibold text-destructive">Gönderilemedi{m.errorCode ? ` (${m.errorCode})` : ''}</span> : null}
          <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
          {m.direction === 'out' && m.kind !== 'echo' ? <StatusIcon status={m.status} /> : null}
        </div>
      </div>
    </div>
  );
}
