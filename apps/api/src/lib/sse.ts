// SSE yardımcıları: LISTEN branch_events ile süreçler arası dağıtım, Last-Event-ID tekrar oynatma, 15 sn ping.

import { SSE_PING_INTERVAL_MS, type TenantRole } from '@siparis/core';
import type { Database, Sql } from '@siparis/db';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'node:http';
import { countBranchEventsAfter, latestBranchSeq, listBranchEventsAfter } from './events';

type Listener = (seq: number) => void;

/** Tek LISTEN bağlantısı; bildirimleri şube dinleyicilerine dağıtır. */
export class BranchEventHub {
  private listeners = new Map<string, Set<Listener>>();
  private listening: Promise<void> | null = null;
  private unlisten: (() => Promise<void>) | null = null;
  private streams = new Set<ServerResponse>();
  private closed = false;

  constructor(
    private readonly sql: Sql,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** LISTEN hazır olana kadar bekler (ilk aboneye kadar bağlantı açılmaz). */
  ready(): Promise<void> {
    if (!this.listening) {
      this.listening = this.sql
        .listen('branch_events', (payload) => this.dispatch(payload))
        .then((meta) => {
          this.unlisten = meta.unlisten;
        })
        .catch((err) => {
          this.listening = null;
          throw err;
        });
    }
    return this.listening;
  }

  private dispatch(payload: string) {
    try {
      const { branch_id, seq } = JSON.parse(payload) as { branch_id: string; seq: number };
      const set = this.listeners.get(branch_id);
      if (set) for (const l of set) l(Number(seq));
    } catch (err) {
      this.log.warn({ err }, 'branch_events bildirimi çözülemedi');
    }
  }

  subscribe(branchId: string, listener: Listener): () => void {
    let set = this.listeners.get(branchId);
    if (!set) {
      set = new Set();
      this.listeners.set(branchId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(branchId);
    };
  }

  trackStream(res: ServerResponse): () => void {
    this.streams.add(res);
    return () => this.streams.delete(res);
  }

  /** Açık SSE bağlantısı sayısı. */
  get streamCount(): number {
    return this.streams.size;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Kapanışta açık akışları bitirir ve LISTEN'i kapatır. */
  async close(): Promise<void> {
    this.closed = true;
    for (const res of this.streams) {
      try {
        res.end();
      } catch {
        /* yok say */
      }
    }
    this.streams.clear();
    this.listeners.clear();
    if (this.unlisten) {
      try {
        await this.unlisten();
      } catch {
        /* yok say */
      }
    }
  }
}

/** SSE çerçevesi. */
export function formatSseEvent(event: { id?: number | string; type: string; data: unknown }): string {
  let out = '';
  if (event.id != null) out += `id: ${event.id}\n`;
  out += `event: ${event.type}\n`;
  out += `data: ${JSON.stringify(event.data)}\n\n`;
  return out;
}

/** Fiyat alanlarını (…Kurus) derinlemesine çıkarır — mutfak projeksiyonu (00 §4: mutfak fiyat görmez). */
export function stripPrices(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPrices);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/kurus$/i.test(k)) continue;
      out[k] = stripPrices(v);
    }
    return out;
  }
  return value;
}

const PERSONAL_KEYS = new Set(['customerName', 'customerPhoneMasked', 'customerPhone', 'addressLine', 'directions', 'lat', 'lng', 'customer']);

/** Müşterinin adı/telefonu/adresi/konumu alanlarını derinlemesine null'lar — mutfak projeksiyonu (04 §4.14). */
export function scrubPersonal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubPersonal);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = PERSONAL_KEYS.has(k) ? null : scrubPersonal(v);
    return out;
  }
  return value;
}

const CONVERSATION_ROLES: readonly TenantRole[] = ['owner', 'manager', 'cashier'];

/**
 * Olayı role göre süzer; null = bu role gönderilmez (07 §6.7). Mutfak REST projeksiyonuyla aynı veriyi alır:
 * fiyat yok, müşterinin kişisel verisi yok.
 */
export function projectEventForRole(type: string, payload: unknown, role: TenantRole): unknown | null {
  if (type.startsWith('conversation.') && !CONVERSATION_ROLES.includes(role)) return null;
  if (role === 'kitchen') return scrubPersonal(stripPrices(payload));
  return payload;
}

/** Last-Event-ID başlığı ya da ?lastEventId sorgusu. */
export function parseLastEventId(request: FastifyRequest): number | null {
  const header = request.headers['last-event-id'];
  const q = (request.query as Record<string, unknown> | undefined)?.lastEventId;
  const raw = (Array.isArray(header) ? header[0] : header) ?? (typeof q === 'string' ? q : undefined);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Bu sayıdan fazla kaçırılmış olay varsa tekrar oynatma yerine `resync` gönderilir. */
export const MAX_REPLAY_EVENTS = 1000;

export interface OpenBranchStreamOptions {
  db: Database;
  hub: BranchEventHub;
  tenantId: string;
  branchId: string;
  role: TenantRole;
  lastEventId: number | null;
  pingMs?: number;
}

/**
 * Şube SSE akışını açar. Yetki kontrolü çağırandadır. Last-Event-ID varsa kaçırılan olaylar DB'den
 * sırayla gönderilir, sonra canlı akışa geçilir.
 */
export async function openBranchStream(request: FastifyRequest, reply: FastifyReply, opts: OpenBranchStreamOptions): Promise<void> {
  const { db, hub, tenantId, branchId, role } = opts;
  await hub.ready();

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  let closed = false;
  let lastSeq = opts.lastEventId ?? (await latestBranchSeq(db, branchId));
  let draining = false;
  let again = false;

  const write = (chunk: string) => {
    if (!closed && !res.writableEnded) res.write(chunk);
  };

  const drain = async (): Promise<void> => {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    try {
      do {
        again = false;
        const rows = await listBranchEventsAfter(db, { tenantId, branchId, afterSeq: lastSeq, limit: 500 });
        for (const row of rows) {
          lastSeq = row.seq;
          const data = projectEventForRole(row.type, row.payload, role);
          if (data !== null) write(formatSseEvent({ id: row.seq, type: row.type, data }));
        }
        if (rows.length === 500) again = true;
      } while (again && !closed);
    } catch (err) {
      request.log.warn({ err }, 'SSE olay okuma hatası');
    } finally {
      draining = false;
    }
  };

  const unsubscribe = hub.subscribe(branchId, (seq) => {
    if (seq > lastSeq) void drain();
  });
  const untrack = hub.trackStream(res);
  const ping = setInterval(() => write(formatSseEvent({ type: 'ping', data: { at: new Date().toISOString() } })), opts.pingMs ?? SSE_PING_INTERVAL_MS);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    unsubscribe();
    untrack();
  };
  request.raw.on('close', cleanup);
  res.on('close', cleanup);

  if (opts.lastEventId != null) {
    const missed = await countBranchEventsAfter(db, branchId, opts.lastEventId);
    if (missed > MAX_REPLAY_EVENTS) {
      lastSeq = await latestBranchSeq(db, branchId);
      write(formatSseEvent({ type: 'resync', data: { reason: 'too_many_missed_events' } }));
    }
  }
  // Bağlantı sırasında gelmiş olayları da kapsar
  await drain();
}
