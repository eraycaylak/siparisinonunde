// Duraklatma süresi dolunca branch.state (14 §7.1): cron.branch_pause_end her dakika süresi geçmiş duraklatmayı
// temizler ve güncel durumu SSE'ye yayınlar; tekrar çalışınca ikinci olay üretmez; gelecekteki duraklatmaya dokunmaz.

import { branchStatePayloadSchema } from '@siparis/core';
import { branchEvents, branches } from '@siparis/db';
import { and, desc, eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishExpiredPauses } from '../src/jobs/cron/index';
import { processDueJobs, registeredCrons, scheduleCronJobs } from '../src/lib/jobs';
import { createTestContext, type TestContext, type TestTenant } from './helpers';
import { readSseUntil } from './settings-helpers';

let ctx: TestContext;
let a: TestTenant;
let b: TestTenant;
let baseUrl: string;
const log = pino({ level: 'silent' });

const pause = (t: TestTenant, minutes: number | null) =>
  ctx.request({ method: 'POST', url: `/api/v1/panel/branches/${t.branchId}/pause`, cookie: t.ownerCookie, body: { minutes, reason: 'Fırın arızası' } });

async function stateEvents(branchId: string) {
  return ctx.db
    .select()
    .from(branchEvents)
    .where(and(eq(branchEvents.branchId, branchId), eq(branchEvents.type, 'branch.state')))
    .orderBy(desc(branchEvents.seq));
}

async function expirePause(t: TestTenant) {
  await ctx.db.update(branches).set({ pausedUntil: new Date(Date.now() - 1000) }).where(eq(branches.id, t.branchId));
}

beforeAll(async () => {
  ctx = await createTestContext();
  baseUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  a = await ctx.createTenantWithOwner({ name: 'Duraklat A' });
  b = await ctx.createTenantWithOwner({ name: 'Duraklat B' });
});
afterAll(async () => {
  await ctx.close();
});

describe('cron.branch_pause_end', () => {
  it('her dakika çalışan cron olarak kayıtlı', () => {
    const c = registeredCrons().find((x) => x.type === 'cron.branch_pause_end');
    expect(c?.schedule).toEqual({ everyMinutes: 1 });
  });

  it('süresi dolan duraklatma: pausedUntil temizlenir, branch.state (open) SSE ile gelir; ikinci çalıştırma olay üretmez', async () => {
    expect((await pause(a, 30)).json().orderingState).toBe('paused');
    await expirePause(a);
    const before = (await stateEvents(a.branchId)).length;

    const waiting = readSseUntil(
      `${baseUrl}/api/v1/panel/stream?branchId=${a.branchId}`,
      a.ownerCookie,
      (e) => e.event === 'branch.state' && (e.data as { orderingState?: string }).orderingState === 'open',
    );
    await new Promise((r) => setTimeout(r, 300));

    // Worker yolu: cron işi kuyruğa girer ve işlenir
    await scheduleCronJobs(ctx.db);
    await processDueJobs({ db: ctx.db, config: ctx.config, log, queues: ['cron'] });

    const [row] = await ctx.db.select().from(branches).where(eq(branches.id, a.branchId));
    expect(row!.pausedUntil).toBeNull();
    expect(row!.pauseReason).toBeNull();
    const evs = await stateEvents(a.branchId);
    expect(evs.length).toBe(before + 1);
    expect(branchStatePayloadSchema.parse(evs[0]!.payload)).toMatchObject({ orderingState: 'open', pausedUntil: null });
    expect(evs[0]!.tenantId).toBe(a.tenantId);

    const sse = await waiting;
    expect(sse, 'SSE üzerinden branch.state gelmeli').not.toBeNull();
    expect(sse!.data).toMatchObject({ orderingState: 'open', pausedUntil: null });

    // Yayınlandı: tekrar çalıştırma yeni olay yazmaz
    expect(await publishExpiredPauses(ctx.db)).toBe(0);
    expect((await stateEvents(a.branchId)).length).toBe(before + 1);
  });

  it('gelecekteki duraklatmaya dokunmaz; yalnız süresi dolan şube yayınlanır (şube/tenant ayrı)', async () => {
    expect((await pause(a, 30)).json().orderingState).toBe('paused');
    expect((await pause(b, 30)).json().orderingState).toBe('paused');
    await expirePause(b);
    const aBefore = (await stateEvents(a.branchId)).length;
    const bBefore = (await stateEvents(b.branchId)).length;

    expect(await publishExpiredPauses(ctx.db)).toBe(1);
    const [ra] = await ctx.db.select().from(branches).where(eq(branches.id, a.branchId));
    const [rb] = await ctx.db.select().from(branches).where(eq(branches.id, b.branchId));
    expect(ra!.pausedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(ra!.pauseReason).toBe('Fırın arızası');
    expect(rb!.pausedUntil).toBeNull();
    expect((await stateEvents(a.branchId)).length).toBe(aBefore);
    expect((await stateEvents(b.branchId)).length).toBe(bBefore + 1);
    await pause(a, null);
  });

  it('sürüm artmaz (açık ayar formu çakışma almaz)', async () => {
    await pause(a, 30);
    const [before] = await ctx.db.select().from(branches).where(eq(branches.id, a.branchId));
    await expirePause(a);
    await publishExpiredPauses(ctx.db);
    const [after] = await ctx.db.select().from(branches).where(eq(branches.id, a.branchId));
    expect(after!.version).toBe(before!.version);
  });
});
