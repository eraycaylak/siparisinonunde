'use client';

import { Bot, Search, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { customerLabel, type ConversationItem } from './types';

export type ConversationFilter = 'all' | 'unread' | 'human';

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'unread', label: 'Okunmamış' },
  { value: 'human', label: 'Personelde' },
];

export function ModeBadge({ c }: { c: Pick<ConversationItem, 'mode' | 'humanActive'> }) {
  return c.humanActive ? (
    <Badge variant="danger" size="sm">
      <UserRound aria-hidden />
      İnsan
    </Badge>
  ) : (
    <Badge variant="neutral" size="sm">
      <Bot aria-hidden />
      Bot
    </Badge>
  );
}

export interface ConversationListProps {
  items: ConversationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  filter: ConversationFilter;
  onFilterChange: (f: ConversationFilter) => void;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function ConversationList({
  items,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  loading,
  hasMore,
  onLoadMore,
}: ConversationListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <label className="relative block">
          <span className="sr-only">Sohbet ara</span>
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
          <Input type="search" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Ad, telefonun son hanesi…" className="ps-10" />
        </label>
        <div role="group" aria-label="Filtre" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => onFilterChange(f.value)}
              className={cn(
                'min-h-10 flex-1 rounded-md px-2 text-sm font-semibold transition-colors',
                filter === f.value ? 'bg-primary text-primary-fg' : 'bg-surface text-fg hover:bg-accent',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Sohbetler" aria-busy={loading || undefined}>
        {items.map((c) => {
          const active = c.id === selectedId;
          const unread = c.unreadCount > 0;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full min-h-hit-primary flex-col gap-1 border-b border-border px-3 py-3 text-start transition-colors',
                  active ? 'bg-accent' : 'hover:bg-surface',
                  c.humanActive && !active && 'border-s-4 border-s-status-new-fg',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <span className={cn('min-w-0 flex-1 truncate text-base', unread ? 'font-bold' : 'font-semibold')}>{customerLabel(c.customer)}</span>
                  {c.lastMessageAt ? <span className="shrink-0 text-xs text-fg-muted">{formatRelative(c.lastMessageAt)}</span> : null}
                </span>
                <span className="flex w-full items-center gap-2">
                  <span className={cn('min-w-0 flex-1 truncate text-sm', unread ? 'text-fg' : 'text-fg-muted')}>{c.lastMessagePreview || ' '}</span>
                  {unread ? (
                    <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-success px-1.5 text-xs font-bold text-success-fg" aria-label={`${c.unreadCount} okunmamış`}>
                      {c.unreadCount > 99 ? '99+' : c.unreadCount}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <ModeBadge c={c} />
                  {c.activeOrder ? (
                    <Badge variant="info" size="sm">
                      Sipariş #{c.activeOrder.number}
                    </Badge>
                  ) : null}
                  {c.customer.phoneMasked ? <span className="text-xs text-fg-muted">{c.customer.phoneMasked}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
        {hasMore && onLoadMore ? (
          <li className="p-3">
            <button type="button" onClick={onLoadMore} className="min-h-hit w-full rounded-md border border-border text-sm font-semibold hover:bg-accent">
              Daha fazla sohbet
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
