// SSE: gerçek HTTP ile Last-Event-ID tekrar oynatma, canlı akış (LISTEN/NOTIFY), rol projeksiyonu.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { appendBranchEvent } from '../src/lib/events';
import { MAX_REPLAY_EVENTS, formatSseEvent, projectEventForRole, stripPrices } from '../src/lib/sse';
import { createTestContext, sleep, type TestContext, type TestTenant } from './helpers';

let ctx: TestContext;
let baseUrl: string;
let t: TestTenant;
let other: TestTenant;

interface SseEvent {
  id?: string;
  event: string;
  data: any;
}

class SseClient {
  private buf = '';
  private queue: SseEvent[] = [];
  private waiters: ((e: SseEvent | null) => void)[] = [];
  private done = false;
  constructor(
    private readonly res: Response,
    private readonly controller: AbortController,
  ) {
    void this.pump();
  }

  private async pump() {
    const reader = this.res.body!.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = this.buf.indexOf('\n\n')) >= 0) {
          const raw = this.buf.slice(0, idx);
          this.buf = this.buf.slice(idx + 2);
          const ev = parse(raw);
          if (ev && ev.event !== 'ping') this.push(ev);
        }
      }
    } catch {
      /* iptal */
    }
    this.done = true;
    for (const w of this.waiters.splice(0)) w(null);
  }

  private push(ev: SseEvent) {
    const w = this.waiters.shift();
    if (w) w(ev);
    else this.queue.push(ev);
  }

  next(timeoutMs = 3000): Promise<SseEvent | null> {
    const q = this.queue.shift();
    if (q) return Promise.resolve(q);
    if (this.done) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(fn);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(null);
      }, timeoutMs);
      const fn = (e: SseEvent | null) => {
        clearTimeout(timer);
        resolve(e);
      };
      this.waiters.push(fn);
    });
  }

  close() {
    this.controller.abort();
  }
}

function parse(raw: string): SseEvent | null {
  const ev: Partial<SseEvent> = {};
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('id: ')) ev.id = line.slice(4);
    else if (line.startsWith('event: ')) ev.event = line.slice(7);
    else if (line.startsWith('data: ')) data += line.slice(6);
  }
  if (!ev.event) return null;
  return { id: ev.id, event: ev.event, data: data ? JSON.parse(data) : null };
}

async function connect(cookie: string, opts: { branchId: string; lastEventId?: number; viaQuery?: boolean }) {
  const controller = new AbortController();
  const q = new URLSearchParams({ branchId: opts.branchId });
  const headers: Record<string, string> = { cookie, accept: 'text/event-stream' };
  if (opts.lastEventId != null) {
    if (opts.viaQuery) q.set('lastEventId', String(opts.lastEventId));
    else headers['last-event-id'] = String(opts.lastEventId);
  }
  const res = await fetch(`${baseUrl}/api/v1/panel/stream?${q}`, { headers, signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  return new SseClient(res, controller);
}

const append = (tenant: TestTenant, type: string, payload: Record<string, unknown>) =>
  ctx.db.transaction((tx) => appendBranchEvent(tx, { tenantId: tenant.tenantId, branchId: tenant.branchId, type, payload }));

beforeAll(async () => {
  ctx = await createTestContext();
  baseUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  t = await ctx.createTenantWithOwner();
  other = await ctx.createTenantWithOwner();
});

afterAll(async () => {
  await ctx.close();
});

describe('SSE /panel/stream', () => {
  it('Last-Event-ID ile kaçırılanlar sırayla, sonra canlı olaylar; başka şubenin olayı gelmez', async () => {
    const s1 = await append(t, 'order.updated', { n: 1 });
    const s2 = await append(t, 'order.updated', { n: 2 });
    const s3 = await append(t, 'order.created', { n: 3 });
    expect(s2).toBeGreaterThan(s1);

    const client = await connect(t.ownerCookie, { branchId: t.branchId, lastEventId: s1 });
    const e2 = await client.next();
    const e3 = await client.next();
    expect([e2?.id, e3?.id]).toEqual([String(s2), String(s3)]);
    expect(e2).toMatchObject({ event: 'order.updated', data: { n: 2 } });
    expect(e3).toMatchObject({ event: 'order.created', data: { n: 3 } });

    await append(other, 'order.created', { foreign: true });
    const s4 = await append(t, 'order.updated', { n: 4 });
    const e4 = await client.next();
    expect(e4).toMatchObject({ id: String(s4), event: 'order.updated', data: { n: 4 } });
    expect(await client.next(300)).toBeNull();
    client.close();
  });

  it('Last-Event-ID yoksa geçmiş gönderilmez; ?lastEventId sorgusu da desteklenir', async () => {
    const old = await append(t, 'order.updated', { old: true });
    const live = await connect(t.ownerCookie, { branchId: t.branchId });
    expect(await live.next(300)).toBeNull();
    const fresh = await append(t, 'order.updated', { fresh: true });
    expect(await live.next()).toMatchObject({ id: String(fresh), data: { fresh: true } });
    live.close();

    const viaQuery = await connect(t.ownerCookie, { branchId: t.branchId, lastEventId: old, viaQuery: true });
    expect(await viaQuery.next()).toMatchObject({ id: String(fresh) });
    viaQuery.close();
  });

  it('eşzamanlı yazılan olaylar atlanmadan gelir', async () => {
    const client = await connect(t.ownerCookie, { branchId: t.branchId });
    await sleep(50);
    const seqs = await Promise.all(Array.from({ length: 10 }, (_, i) => append(t, 'order.updated', { i })));
    const got: string[] = [];
    for (let i = 0; i < 10; i++) {
      const e = await client.next();
      if (e?.id) got.push(e.id);
    }
    expect(got).toEqual([...seqs].sort((x, y) => x - y).map(String));
    client.close();
  });

  it('mutfak projeksiyonu: fiyat alanları ve müşterinin kişisel verisi çıkarılır, sohbet olayları gitmez', async () => {
    const kitchen = await ctx.createStaff(t.tenantId, 'kitchen');
    const client = await connect(kitchen.cookie, { branchId: t.branchId });
    await append(t, 'conversation.message', { conversationId: 'x', preview: 'merhaba' });
    const s = await append(t, 'order.created', {
      order: {
        id: 'o1',
        totalKurus: 12345,
        customerName: 'Ayşe Kaya',
        customerPhoneMasked: '0*** *** 22 66',
        neighborhood: 'Aşağınohutlu',
        items: [{ name: 'Pide', lineTotalKurus: 100 }],
      },
    });
    const e = await client.next();
    expect(e?.id).toBe(String(s));
    expect(e?.data).toEqual({
      order: { id: 'o1', customerName: null, customerPhoneMasked: null, neighborhood: 'Aşağınohutlu', items: [{ name: 'Pide' }] },
    });
    expect(JSON.stringify(e?.data)).not.toContain('Ayşe');
    client.close();
    // Sahip aynı olayı tam görür
    expect(projectEventForRole('order.created', { order: { customerName: 'Ayşe Kaya', totalKurus: 1 } }, 'owner')).toEqual({
      order: { customerName: 'Ayşe Kaya', totalKurus: 1 },
    });
  });

  it('çok fazla kaçırılmış olayda resync gönderilir', async () => {
    const start = await append(t, 'order.updated', { marker: true });
    await ctx.db.execute(sql`
      insert into branch_events (tenant_id, branch_id, type, payload)
      select ${t.tenantId}::uuid, ${t.branchId}::uuid, 'order.updated', '{}'::jsonb
        from generate_series(1, ${MAX_REPLAY_EVENTS + 5})`);
    const client = await connect(t.ownerCookie, { branchId: t.branchId, lastEventId: start });
    const e = await client.next();
    expect(e).toMatchObject({ event: 'resync', data: { reason: 'too_many_missed_events' } });
    expect(e?.id).toBeUndefined();
    const live = await append(t, 'order.updated', { after: true });
    expect(await client.next()).toMatchObject({ id: String(live) });
    client.close();
  });

  it('bağlantı kapanınca abonelik temizlenir', async () => {
    // Önceki testlerin kapanan bağlantıları temizlensin
    for (let i = 0; i < 40 && ctx.app.branchEvents.streamCount > 0; i++) await sleep(25);
    const before = ctx.app.branchEvents.streamCount;
    expect(before).toBe(0);
    const client = await connect(t.ownerCookie, { branchId: t.branchId });
    await sleep(50);
    expect(ctx.app.branchEvents.streamCount).toBe(before + 1);
    client.close();
    for (let i = 0; i < 20 && ctx.app.branchEvents.streamCount > before; i++) await sleep(25);
    expect(ctx.app.branchEvents.streamCount).toBe(before);
  });

  it('yardımcılar', () => {
    expect(formatSseEvent({ id: 5, type: 'order.updated', data: { a: 1 } })).toBe('id: 5\nevent: order.updated\ndata: {"a":1}\n\n');
    expect(stripPrices({ totalKurus: 1, nested: [{ priceKurus: 2, name: 'x' }] })).toEqual({ nested: [{ name: 'x' }] });
  });
});
