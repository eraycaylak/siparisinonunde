// SSE bağlantı sınırı (açık soru 5): şube ve işletme tavanı, en eski bağlantının kapatılması, yeni bağlantının
// reddedilmemesi, yavaş retry ve slot bırakma. Birim testleri sahte ServerResponse ile çalışır (veritabanı yok);
// son blok gerçek HTTP akışıyla sınırın uçtan uca çalıştığını doğrular.

import type { FastifyBaseLogger } from 'fastify';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAlertCooldown } from '../src/lib/alert';
import {
  resolveSseLimits,
  SSE_EVICTED_RETRY_MS,
  SSE_MAX_PER_BRANCH,
  SSE_MAX_PER_TENANT,
  SseConnectionLimiter,
} from '../src/plugins/sse-limit';
import { createTestContext, sleep, type TestContext, type TestTenant } from './helpers';

/** Sınırlayıcının dokunduğu yüzey: write / end / 'close' / writableEnded / destroyed / headersSent. */
class FakeRes extends EventEmitter {
  written: string[] = [];
  writableEnded = false;
  destroyed = false;
  headersSent = true;
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
  end(): this {
    if (!this.writableEnded) {
      this.writableEnded = true;
      this.emit('close');
    }
    return this;
  }
  /**
   * İstemcinin koptuğu hâl. Ölçülen gerçek davranış (node 22, aborted fetch): `destroyed` true olur,
   * `writableEnded` OLMAZ, başlık hiç gitmemişse `headersSent` de false kalır ve 'close' BİR KEZ yayılır.
   */
  abort(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.headersSent = false;
    this.emit('close');
    return this;
  }
  asRes(): ServerResponse {
    return this as unknown as ServerResponse;
  }
}

type LogLine = Record<string, unknown>;
type FakeLog = { error: (line: LogLine, msg?: string) => void };

/** Sınırlayıcının kullandığı log yüzeyi: yalnız `warn` (kapatma hatası) ve `error` (uyarı satırı). */
function fakeLog(onError: (line: LogLine) => void = () => {}): FastifyBaseLogger {
  const noop = () => {};
  const log: FakeLog & Record<string, unknown> = {
    error: (line: LogLine) => onError(line),
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    silent: noop,
    level: 'silent',
  };
  log.child = () => log;
  return log as unknown as FastifyBaseLogger;
}

function limiterWith(perBranch: number, perTenant: number): SseConnectionLimiter {
  return new SseConnectionLimiter({ log: fakeLog(), limits: { perBranch, perTenant } });
}

const KEY = { tenantId: 't1', branchId: 'b1' };

beforeEach(() => {
  resetAlertCooldown();
});

describe('SseConnectionLimiter', () => {
  it('sınıra kadar bağlantı açılır, hiçbiri kapatılmaz', () => {
    const limiter = limiterWith(3, 10);
    const res = [new FakeRes(), new FakeRes(), new FakeRes()];
    for (const r of res) expect(limiter.admit(r.asRes(), KEY).evicted).toBe(0);
    expect(limiter.branchCount('b1')).toBe(3);
    expect(limiter.tenantCount('t1')).toBe(3);
    expect(res.every((r) => !r.writableEnded)).toBe(true);
  });

  it('şube sınırı aşılınca EN ESKİ kapanır, yeni bağlantı ayakta kalır', () => {
    const limiter = limiterWith(2, 10);
    const oldest = new FakeRes();
    const middle = new FakeRes();
    const newest = new FakeRes();
    limiter.admit(oldest.asRes(), KEY);
    limiter.admit(middle.asRes(), KEY);
    const third = limiter.admit(newest.asRes(), KEY);

    expect(third.evicted).toBe(1);
    expect(oldest.writableEnded).toBe(true);
    expect(middle.writableEnded).toBe(false);
    expect(newest.writableEnded).toBe(false);
    expect(limiter.branchCount('b1')).toBe(2);
  });

  it('kapatılan bağlantıya yavaş retry ve limit olayı yazılır (Last-Event-ID ile telafi edilir)', () => {
    const limiter = limiterWith(1, 10);
    const oldest = new FakeRes();
    limiter.admit(oldest.asRes(), KEY);
    limiter.admit(new FakeRes().asRes(), KEY);

    const out = oldest.written.join('');
    expect(out).toContain(`retry: ${SSE_EVICTED_RETRY_MS}`);
    expect(out).toContain('event: limit');
    expect(out).toContain('"reason":"too_many_streams"');
    expect(SSE_EVICTED_RETRY_MS).toBeGreaterThan(3000); // varsayılan retry'dan yavaş: çırpınma olmaz
  });

  it('işletme sınırı şubeler arasında da uygulanır', () => {
    const limiter = limiterWith(10, 2);
    const first = new FakeRes();
    limiter.admit(first.asRes(), { tenantId: 't1', branchId: 'b1' });
    limiter.admit(new FakeRes().asRes(), { tenantId: 't1', branchId: 'b2' });
    const third = limiter.admit(new FakeRes().asRes(), { tenantId: 't1', branchId: 'b3' });

    expect(third.evicted).toBe(1);
    expect(first.writableEnded).toBe(true);
    expect(limiter.tenantCount('t1')).toBe(2);
    expect(limiter.branchCount('b1')).toBe(0);
  });

  it('başka işletmenin bağlantıları sayılmaz', () => {
    const limiter = limiterWith(1, 1);
    const mine = new FakeRes();
    limiter.admit(mine.asRes(), { tenantId: 't1', branchId: 'b1' });
    const other = limiter.admit(new FakeRes().asRes(), { tenantId: 't2', branchId: 'b2' });
    expect(other.evicted).toBe(0);
    expect(mine.writableEnded).toBe(false);
    expect(limiter.size).toBe(2);
  });

  it("bağlantı kapanınca slot bırakılır ('close' ve elle release iki kez güvenli)", () => {
    const limiter = limiterWith(2, 10);
    const a = new FakeRes();
    const admission = limiter.admit(a.asRes(), KEY);
    expect(limiter.branchCount('b1')).toBe(1);
    a.end(); // istemci koptu
    expect(limiter.branchCount('b1')).toBe(0);
    admission.release();
    expect(limiter.branchCount('b1')).toBe(0);
    expect(limiter.size).toBe(0);
    // Slot boşaldığı için yeni bağlantı kimseyi kapatmaz
    expect(limiter.admit(new FakeRes().asRes(), KEY).evicted).toBe(0);
  });

  it("admit'ten ÖNCE kopmuş bağlantı slot tutmaz ('close' bir daha gelmez)", () => {
    // Regresyon: stream.ts akışı açarken birkaç veritabanı turu yapar; istemci o sırada koparsa
    // res.once('close') HİÇ çalışmaz ve kayıt sonsuza kadar kümede kalırdı.
    const limiter = limiterWith(2, 10);
    const dead = new FakeRes();
    dead.abort();
    const admission = limiter.admit(dead.asRes(), KEY);

    expect(admission.evicted).toBe(0);
    expect(limiter.branchCount('b1')).toBe(0);
    expect(limiter.tenantCount('t1')).toBe(0);
    expect(limiter.size).toBe(0);
  });

  it('ölü kayıt birikmesi canlı akışı kapatmaz ve sahte uyarı üretmez', () => {
    const sent: LogLine[] = [];
    const limiter = new SseConnectionLimiter({
      log: fakeLog((line) => {
        if (line.alert === 'sse_connection_limit') sent.push(line);
      }),
      limits: { perBranch: 2, perTenant: 10 },
    });
    // İki kopmuş açılış + iki canlı akış: sınır 2 ama ölüler sayılmadığı için kimse kapatılmaz
    for (let i = 0; i < 2; i++) limiter.admit(new FakeRes().abort().asRes(), KEY);
    const live = [new FakeRes(), new FakeRes()];
    for (const r of live) limiter.admit(r.asRes(), KEY);

    expect(limiter.branchCount('b1')).toBe(2);
    expect(live.every((r) => !r.writableEnded)).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('sınırlar ortamdan okunur; geçersiz değer varsayılana düşer', () => {
    expect(resolveSseLimits(undefined, {})).toEqual({ perBranch: SSE_MAX_PER_BRANCH, perTenant: SSE_MAX_PER_TENANT });
    expect(resolveSseLimits(undefined, { SSE_MAX_PER_BRANCH: '3', SSE_MAX_PER_TENANT: '7' })).toEqual({ perBranch: 3, perTenant: 7 });
    // 0, negatif ve sayı olmayan değer kapıyı kapatmaz: varsayılana düşer
    expect(resolveSseLimits(undefined, { SSE_MAX_PER_BRANCH: '0' }).perBranch).toBe(SSE_MAX_PER_BRANCH);
    expect(resolveSseLimits(undefined, { SSE_MAX_PER_BRANCH: '-2' }).perBranch).toBe(SSE_MAX_PER_BRANCH);
    expect(resolveSseLimits(undefined, { SSE_MAX_PER_BRANCH: 'cok' }).perBranch).toBe(SSE_MAX_PER_BRANCH);
    expect(resolveSseLimits({ SSE_MAX_PER_BRANCH: 4 }, { SSE_MAX_PER_BRANCH: '9' }).perBranch).toBe(4);
  });

  it('sınır aşılınca uyarı gönderilir', () => {
    const sent: LogLine[] = [];
    const limiter = new SseConnectionLimiter({
      log: fakeLog((line) => {
        if (line.alert === 'sse_connection_limit') sent.push(line);
      }),
      limits: { perBranch: 1, perTenant: 10 },
    });
    limiter.admit(new FakeRes().asRes(), KEY);
    limiter.admit(new FakeRes().asRes(), KEY);
    // alert() ateşle-ve-unut ama log satırı (kanal olmasa bile) eşzamanlı yazılır
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ severity: 'warning', branchId: 'b1', tenantId: 't1', evicted: 1, perBranch: 1 });
  });
});

// --- Uçtan uca: gerçek SSE akışı ------------------------------------------------------------------

let ctx: TestContext;
let baseUrl: string;
let t: TestTenant;

async function connect(cookie: string, branchId: string) {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/panel/stream?branchId=${branchId}`, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  let text = '';
  const pump = (async () => {
    try {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
      }
    } catch {
      /* iptal */
    }
  })();
  return {
    close: () => controller.abort(),
    body: () => text,
    ended: async () => {
      await pump;
      return true;
    },
  };
}

describe('GET /panel/stream bağlantı sınırı', () => {
  beforeAll(async () => {
    ctx = await createTestContext();
    baseUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    t = await ctx.createTenantWithOwner();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('şube sınırı aşılınca en eski akış kapanır, yeni akış açık kalır', async () => {
    // Testte sınırı 2'ye indirmek için doğrudan sınırlayıcıya değil, rotanın kullandığı örneğe bakılır:
    // SSE_MAX_PER_BRANCH kadar bağlantı açılır, bir fazlası en eskiyi kapatır.
    const opened: Awaited<ReturnType<typeof connect>>[] = [];
    for (let i = 0; i < SSE_MAX_PER_BRANCH; i++) opened.push(await connect(t.ownerCookie, t.branchId));
    await sleep(100);
    expect(ctx.app.branchEvents.streamCount).toBe(SSE_MAX_PER_BRANCH);

    const extra = await connect(t.ownerCookie, t.branchId);
    // En eski akış sunucu tarafından bitirilir
    await opened[0]!.ended();
    expect(opened[0]!.body()).toContain('event: limit');
    for (let i = 0; i < 40 && ctx.app.branchEvents.streamCount > SSE_MAX_PER_BRANCH; i++) await sleep(25);
    expect(ctx.app.branchEvents.streamCount).toBe(SSE_MAX_PER_BRANCH);

    for (const o of opened.slice(1)) o.close();
    extra.close();
    for (let i = 0; i < 40 && ctx.app.branchEvents.streamCount > 0; i++) await sleep(25);
    expect(ctx.app.branchEvents.streamCount).toBe(0);
  });
});
