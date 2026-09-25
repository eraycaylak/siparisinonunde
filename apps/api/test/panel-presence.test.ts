// Panel çevrimdışı dedektörü (06 §7.7, 04 §4.17): SSE akışı açılınca şube varlığı yazılır (mutfak ve destek oturumu
// hariç); cron.panel_presence yalnız sipariş alan ve sipariş ekranı görülmeyen şubelerde sahibine platform.alert
// `panel_offline` kuyruğa atar (şube başına 60 dk'da en çok 1; kapalı/duraklatılmış/kurulumdaki işletmede yok).

import { branchPanelPresence, branches, jobs, notifications, openingHours, tenants } from '@siparis/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processDueJobs, registeredCrons } from '../src/lib/jobs';
import { detectOfflinePanels, touchBranchPresence } from '../src/services/push/presence';
import { createTestContext, sleep, type TestContext, type TestTenant } from './helpers';
import { setupStore } from './orders-helpers';

let ctx: TestContext;
let baseUrl: string;

const MIN = 60_000;
/** Cuma 12:00 (Europe/Istanbul) */
const T0 = new Date('2026-09-25T09:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * MIN);

const presence = async (branchId: string) => (await ctx.db.select().from(branchPanelPresence).where(eq(branchPanelPresence.branchId, branchId)))[0];
const setPresence = (t: TestTenant, lastSeenAt: Date | null, offlineAlertedAt: Date | null = null) =>
  ctx.db
    .insert(branchPanelPresence)
    .values({ branchId: t.branchId, tenantId: t.tenantId, lastSeenAt, offlineAlertedAt })
    .onConflictDoUpdate({ target: branchPanelPresence.branchId, set: { lastSeenAt, offlineAlertedAt } });
/** Şubenin haftalık saatlerini her gün aynı aralıkla değiştirir. */
async function setHours(t: TestTenant, opensAt: string, closesAt: string) {
  await ctx.db.delete(openingHours).where(eq(openingHours.branchId, t.branchId));
  await ctx.db
    .insert(openingHours)
    .values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId: t.tenantId, branchId: t.branchId, weekday, opensAt, closesAt })));
}
const alertsFor = (alerts: { branchId: string; minutes: number }[], t: TestTenant) => alerts.filter((a) => a.branchId === t.branchId);
const alertJobs = (t: TestTenant) =>
  ctx.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, 'platform.alert'), eq(jobs.tenantId, t.tenantId), sql`${jobs.payload}->>'kind' = 'panel_offline'`));

async function openStream(cookie: string, branchId: string): Promise<AbortController> {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/panel/stream?branchId=${branchId}`, { headers: { cookie, accept: 'text/event-stream' }, signal: controller.signal });
  expect(res.status).toBe(200);
  // İlk çerçeveleri oku (akış açılışı ve varlık yazımı tamamlansın)
  const reader = res.body!.getReader();
  await reader.read();
  void (async () => {
    try {
      for (;;) if ((await reader.read()).done) break;
    } catch {
      /* iptal */
    }
  })();
  return controller;
}

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 2_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(25);
  }
}

beforeAll(async () => {
  ctx = await createTestContext();
  baseUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await ctx.close();
});

describe('varlık yazımı (SSE akışı)', () => {
  it('sahip/kasiyer akışı açınca şube görülür; mutfak ve destek oturumu varlık yazmaz', async () => {
    const t = await ctx.createTenantWithOwner();
    const kitchen = await ctx.createStaff(t.tenantId, 'kitchen');
    const k = await openStream(kitchen.cookie, t.branchId);
    const admin = await ctx.createUser({ isPlatformAdmin: true, platformRole: 'support_agent' });
    const imp = await openStream(await ctx.sessionCookie(admin.id, { tenantId: t.tenantId, kind: 'impersonation' }), t.branchId);
    await sleep(150);
    expect(await presence(t.branchId)).toBeUndefined();
    k.abort();
    imp.abort();

    const before = Date.now();
    const cashier = await ctx.createStaff(t.tenantId, 'cashier');
    const c = await openStream(cashier.cookie, t.branchId);
    const row = await waitFor(() => presence(t.branchId));
    expect(row).toMatchObject({ tenantId: t.tenantId });
    expect(row!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // Görülen şube şu an çevrimdışı sayılmaz
    expect(alertsFor(await detectOfflinePanels(ctx.db), t)).toEqual([]);
    c.abort();
  });

  it('dakikalık yenileme ucuzdur: 20 sn içinde tekrar yazmaz', async () => {
    const t = await ctx.createTenantWithOwner();
    await touchBranchPresence(ctx.db, t, at(0));
    await touchBranchPresence(ctx.db, t, new Date(T0.getTime() + 10_000));
    expect((await presence(t.branchId))!.lastSeenAt).toEqual(at(0));
    await touchBranchPresence(ctx.db, t, new Date(T0.getTime() + 30_000));
    expect((await presence(t.branchId))!.lastSeenAt).toEqual(new Date(T0.getTime() + 30_000));
  });
});

describe('cron.panel_presence', () => {
  it('dakikada bir çalışan cron olarak kayıtlı', () => {
    expect(registeredCrons()).toContainEqual(expect.objectContaining({ name: 'panel_presence', type: 'cron.panel_presence', schedule: { everyMinutes: 1 } }));
  });

  it('açık şubede 5 dk görülmeyen panel: sahibine platform uyarısı; 60 dk içinde tekrar yok', async () => {
    const s = await setupStore(ctx);
    const fresh = await ctx.createTenantWithOwner();
    await setPresence(s, at(-6));
    await setPresence(fresh, at(-1));

    const first = await detectOfflinePanels(ctx.db, at(0));
    expect(alertsFor(first, s)).toEqual([{ tenantId: s.tenantId, branchId: s.branchId, minutes: 6 }]);
    expect(alertsFor(first, fresh)).toEqual([]);
    const queued = await alertJobs(s);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ queue: 'notify', status: 'pending' });
    expect(queued[0]!.payload).toEqual({ tenantId: s.tenantId, branchId: s.branchId, kind: 'panel_offline', minutes: 6 });
    expect((await presence(s.branchId))!.offlineAlertedAt).toEqual(at(0));

    // Tekillik: sonraki dakikalarda yeni uyarı yok
    expect(alertsFor(await detectOfflinePanels(ctx.db, at(1)), s)).toEqual([]);
    expect(alertsFor(await detectOfflinePanels(ctx.db, at(59)), s)).toEqual([]);
    expect(await alertJobs(s)).toHaveLength(1);
    // 60 dk sonra hâlâ görülmüyorsa yeniden
    expect(alertsFor(await detectOfflinePanels(ctx.db, at(61)), s)).toEqual([{ tenantId: s.tenantId, branchId: s.branchId, minutes: 67 }]);
    expect(await alertJobs(s)).toHaveLength(2);

    // İş: platform numarasından sahibine şablon (mock), kayıt metni tr.ts
    await processDueJobs({ db: ctx.db, config: ctx.config, log: ctx.app.log, now: at(62), where: sql`type = 'platform.alert'` });
    const sent = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, s.tenantId), eq(notifications.kind, 'panel_offline')));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]).toMatchObject({ channel: 'platform_wa', status: 'sent', branchId: s.branchId });
    expect(sent[0]!.payload).toMatchObject({ template: 'isletme_panel_cevrimdisi_v1' });
    const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, s.tenantId));
    expect(String(sent[0]!.payload.text)).toBe(
      `${tenant!.name}: sipariş ekranı 6 dakikadır kapalı görünüyor. Siparişleri kaçırmamak için paneli açın.`,
    );
  });

  it('panel bu arada açılırsa uyarı atılmaz', async () => {
    const t = await ctx.createTenantWithOwner();
    await setPresence(t, at(-4));
    expect(alertsFor(await detectOfflinePanels(ctx.db, at(0)), t)).toEqual([]);
    await touchBranchPresence(ctx.db, t, at(3));
    expect(alertsFor(await detectOfflinePanels(ctx.db, at(7)), t)).toEqual([]);
    expect(alertsFor(await detectOfflinePanels(ctx.db, at(8.5)), t)).toEqual([{ tenantId: t.tenantId, branchId: t.branchId, minutes: 5 }]);
  });

  it('çalışma saati dışında ve duraklatılmış şubede uyarı yok; duraklatma bitince açılış sayılır', async () => {
    const closed = await ctx.createTenantWithOwner();
    await setHours(closed, '20:00', '23:00');
    const paused = await ctx.createTenantWithOwner();
    await ctx.db.update(branches).set({ pausedUntil: at(30) }).where(eq(branches.id, paused.branchId));
    const resumed = await ctx.createTenantWithOwner();
    await ctx.db.update(branches).set({ pausedUntil: at(-3) }).where(eq(branches.id, resumed.branchId));

    const alerts = await detectOfflinePanels(ctx.db, at(0));
    expect(alertsFor(alerts, closed)).toEqual([]);
    expect(alertsFor(alerts, paused)).toEqual([]);
    // Duraklatma 3 dk önce bitti: hiç görülmeyen panel için 10 dk pay
    expect(alertsFor(alerts, resumed)).toEqual([]);
    expect(alertsFor(await detectOfflinePanels(ctx.db, at(7.5)), resumed)).toEqual([{ tenantId: resumed.tenantId, branchId: resumed.branchId, minutes: 10 }]);
  });

  it('yeni açılan şube: açılıştan beri hiç görülmediyse 10 dk sonra (açılış öncesi görülmesi sayılmaz)', async () => {
    const never = await ctx.createTenantWithOwner();
    await setHours(never, '11:52', '23:00');
    const early = await ctx.createTenantWithOwner();
    await setHours(early, '11:52', '23:00');
    await setPresence(early, at(-10)); // 11:50, açılıştan önce

    const a0 = await detectOfflinePanels(ctx.db, at(0));
    expect(alertsFor(a0, never)).toEqual([]);
    expect(alertsFor(a0, early)).toEqual([]);
    const a1 = await detectOfflinePanels(ctx.db, at(2.5));
    expect(alertsFor(a1, never)).toEqual([{ tenantId: never.tenantId, branchId: never.branchId, minutes: 10 }]);
    expect(alertsFor(a1, early)).toEqual([{ tenantId: early.tenantId, branchId: early.branchId, minutes: 10 }]);
  });

  it('sipariş almayan ya da kurulumdaki/demo işletmede çalışmaz', async () => {
    const off = await ctx.createTenantWithOwner();
    await ctx.db.update(tenants).set({ orderingEnabled: false }).where(eq(tenants.id, off.tenantId));
    const onboarding = await ctx.createTenantWithOwner();
    await ctx.db.update(tenants).set({ lifecycleStage: 'onboarding' }).where(eq(tenants.id, onboarding.tenantId));
    const demo = await ctx.createTenantWithOwner();
    await ctx.db.update(tenants).set({ isDemo: true }).where(eq(tenants.id, demo.tenantId));
    const notLive = await ctx.createTenantWithOwner();
    await ctx.db.update(tenants).set({ webLiveAt: null }).where(eq(tenants.id, notLive.tenantId));
    const suspended = await ctx.createTenantWithOwner();
    await ctx.db.update(tenants).set({ lifecycleStage: 'suspended' }).where(eq(tenants.id, suspended.tenantId));
    const live = await ctx.createTenantWithOwner();

    const alerts = await detectOfflinePanels(ctx.db, at(0));
    for (const t of [off, onboarding, demo, notLive, suspended]) expect(alertsFor(alerts, t)).toEqual([]);
    // 7/24 açık, hiç görülmemiş canlı işletme uyarılır (açılış dün 00:00)
    expect(alertsFor(alerts, live)).toHaveLength(1);
    for (const t of [off, onboarding, demo, notLive, suspended]) expect(await alertJobs(t)).toHaveLength(0);
  });
});
