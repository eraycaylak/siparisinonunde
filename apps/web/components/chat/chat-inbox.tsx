'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { STREAM_RECONNECTED, usePanelEvent } from '@/components/panel/stream-provider';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch, errorMessage, useApiQuery } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ConversationList, type ConversationFilter } from './conversation-list';
import { MessageThread } from './message-thread';
import type { ChatMessage, ConversationItem, ListResult } from './types';

const LIST_KEY = ['panel', 'conversations'] as const;
const threadKey = (id: string) => ['panel', 'conversation', id, 'messages'] as const;
const convKey = (id: string) => ['panel', 'conversation', id] as const;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function readSelected(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('c');
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * Gelen kutusu (04 P-08): solda konuşma listesi, sağda mesaj akışı. Telefonda tek sütun (liste ↔ sohbet).
 * Canlı güncelleme panel SSE'sinden (conversation.message / conversation.updated); ikinci bağlantı açılmaz.
 */
export function ChatInbox() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const q = useDebounced(query.trim());

  useEffect(() => setSelectedId(readSelected()), []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    try {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('c', id);
      else url.searchParams.delete('c');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // yoksay
    }
  }, []);

  const list = useApiQuery<ListResult<ConversationItem>>([...LIST_KEY, { q, filter }], '/panel/conversations', {
    query: { q: q || undefined, filter: filter === 'all' ? undefined : filter, limit: 50 },
    refetchInterval: 60_000,
  });
  const [extra, setExtra] = useState<ConversationItem[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | undefined>(undefined);
  useEffect(() => {
    setExtra([]);
    setExtraCursor(undefined);
  }, [q, filter]);
  const items = useMemo(() => {
    const base = list.data?.items ?? [];
    return [...base, ...extra.filter((e) => !base.some((b) => b.id === e.id))];
  }, [list.data, extra]);
  const moreCursor = extraCursor ?? list.data?.nextCursor;
  const loadMore = async () => {
    if (!moreCursor) return;
    const res = await apiFetch<ListResult<ConversationItem>>('/panel/conversations', {
      query: { q: q || undefined, filter: filter === 'all' ? undefined : filter, limit: 50, cursor: moreCursor },
    });
    setExtra((prev) => [...prev, ...res.items]);
    setExtraCursor(res.nextCursor ?? '');
  };

  const conv = useApiQuery<ConversationItem>(selectedId ? convKey(selectedId) : ['panel', 'conversation', 'none'], selectedId ? `/panel/conversations/${selectedId}` : null);
  const thread = useApiQuery<ListResult<ChatMessage>>(
    selectedId ? threadKey(selectedId) : ['panel', 'conversation', 'none', 'messages'],
    selectedId ? `/panel/conversations/${selectedId}/messages` : null,
    { query: { limit: 60 }, refetchInterval: 20_000 },
  );
  const messages = useMemo(() => [...(thread.data?.items ?? [])].reverse(), [thread.data]);

  // Açık sohbette okunmamışı sıfırla
  const unread = conv.data?.unreadCount ?? 0;
  useEffect(() => {
    if (!selectedId || unread === 0) return;
    void apiFetch(`/panel/conversations/${selectedId}/read`, { method: 'POST' })
      .then(() => {
        void qc.invalidateQueries({ queryKey: LIST_KEY });
        void qc.invalidateQueries({ queryKey: convKey(selectedId) });
      })
      .catch(() => {});
  }, [selectedId, unread, qc]);

  const refreshSelected = useCallback(() => {
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    if (selectedId) {
      void qc.invalidateQueries({ queryKey: convKey(selectedId) });
      void qc.invalidateQueries({ queryKey: threadKey(selectedId) });
    }
  }, [qc, selectedId]);

  usePanelEvent(['conversation.message', 'conversation.updated', 'resync', STREAM_RECONNECTED], (e) => {
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    const cid = (e.data as { conversationId?: string } | null)?.conversationId;
    if (!selectedId) return;
    if (!cid || cid === selectedId) {
      void qc.invalidateQueries({ queryKey: convKey(selectedId) });
      if (e.type !== 'conversation.updated') void qc.invalidateQueries({ queryKey: threadKey(selectedId) });
    }
  });

  const selected = conv.data ?? items.find((i) => i.id === selectedId) ?? null;

  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-surface-raised md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]',
        'h-[calc(100dvh-var(--panel-top,4rem)-7rem)] md:h-[calc(100dvh-var(--panel-top,4rem)-3rem)]',
      )}
    >
      <div className={cn('min-h-0 min-w-0 border-border md:border-e', selectedId ? 'hidden md:block' : 'block')}>
        {list.isError ? (
          <div className="p-3">
            <Alert variant="danger" title="Sohbetler yüklenemedi">
              {errorMessage(list.error)}
            </Alert>
          </div>
        ) : list.isPending ? (
          <div className="flex justify-center p-8">
            <Spinner size="lg" label="Sohbetler yükleniyor" />
          </div>
        ) : items.length === 0 && !q && filter === 'all' ? (
          <div className="p-3">
            <EmptyState
              icon={MessagesSquare}
              title="Henüz sohbet yok"
              description="Müşterileriniz WhatsApp numaranıza yazdığında sohbetler burada görünür."
            />
          </div>
        ) : (
          <ConversationList
            items={items}
            selectedId={selectedId}
            onSelect={(id) => select(id)}
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            loading={list.isFetching}
            hasMore={!!moreCursor}
            onLoadMore={() => void loadMore()}
          />
        )}
      </div>
      <div className={cn('min-h-0 min-w-0', selectedId ? 'block' : 'hidden md:block')}>
        {selected ? (
          <MessageThread
            conversation={selected}
            messages={messages}
            loading={thread.isPending}
            error={thread.isError ? thread.error : null}
            nextCursor={thread.data?.nextCursor}
            onBack={() => select(null)}
            onChanged={refreshSelected}
          />
        ) : selectedId && conv.isError ? (
          <div className="p-4">
            <Alert variant="danger" title="Sohbet açılamadı">
              {errorMessage(conv.error)}
            </Alert>
          </div>
        ) : (
          <div className="hidden h-full items-center justify-center p-6 md:flex">
            <EmptyState icon={MessagesSquare} title="Bir sohbet seçin" description="Soldaki listeden bir sohbet seçerek mesajları görün ve yanıtlayın." />
          </div>
        )}
      </div>
    </div>
  );
}
