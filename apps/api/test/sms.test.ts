// sms.send (mock sağlayıcı, kota uyarısı, kill-switch) ve platform.alert (mock → notifications, TEST etiketi).

import { featureFlags, notifications, orders, smsMessages, tenants, users } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob } from '../src/lib/jobs';
import { handlePlatformAlert } from '../src/services/messaging/platform-alert';
import { handleSmsSend } from '../src/services/messaging/sms-send';
import { smsQuotaForTenant } from '../src/sms/index';
import { createTestContext, type TestContext, type TestTenant } from './helpers';
import { runJobs, silentLog } from './wa-helpers';

let ctx: TestContext;
let t: TestTenant;
const deps = () => ({ db: ctx.db, config: ctx.config, log: silentLog });

beforeAll(async () => {
  ctx = await createTestContext();
  t = await ctx.createTenantWithOwner({ name: 'SMS Pide' });
  await ctx.db.update(users).set({ phone: '+905371112233' }).where(eq(users.id, t.owner.id));
});
afterAll(async () => {
  await ctx.close();
});

describe('sms.send', () => {
  it('iş kuyruğundan: mock sağlayıcı sms_messages\'a yazar', async () => {
    await enqueueJob(ctx.db, {
      queue: 'notify',
      type: 'sms.send',
      payload: { tenantId: t.tenantId, to: '0532 111 22 33', body: 'SMS Pide sipariş doğrulama kodunuz: 123456.', purpose: 'otp', countsTowardQuota: true },
    });
    expect(await runJobs(ctx, ['sms.send'])).toBe(1);
    const [row] = await ctx.db.select().from(smsMessages).where(eq(smsMessages.toPhone, '+905321112233'));
    expect(row).toMatchObject({ tenantId: t.tenantId, purpose: 'otp', provider: 'mock', status: 'sent', countsTowardQuota: true });
    expect(row!.providerMessageId).toMatch(/^mock-sms\./);
  });

  it('kota: Esnaf 100 → %80 uyarı ve aşım uyarısı (ayda bir), SMS yine gider', async () => {
    const s = await ctx.createTenantWithOwner({ name: 'Kota Esnaf' });
    await ctx.db.update(tenants).set({ planCode: 'esnaf' }).where(eq(tenants.id, s.tenantId));
    expect(await smsQuotaForTenant(ctx.db, s.tenantId)).toBe(100);
    await ctx.db.insert(smsMessages).values(
      Array.from({ length: 79 }, () => ({ tenantId: s.tenantId, toPhone: '+905320000000', body: 'x', purpose: 'status' as const, provider: 'mock', status: 'sent' as const, countsTowardQuota: true })),
    );
    const send = () => handleSmsSend(deps(), { tenantId: s.tenantId, to: '+905321234567', body: 'Durum', purpose: 'status', countsTowardQuota: true });
    expect((await send()).status).toBe('sent'); // 80 → uyarı
    const warn = await ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, s.tenantId), eq(notifications.kind, 'sms_quota_warning')));
    expect(warn).toHaveLength(1);
    await ctx.db.insert(smsMessages).values(
      Array.from({ length: 20 }, () => ({ tenantId: s.tenantId, toPhone: '+905320000000', body: 'x', purpose: 'status' as const, provider: 'mock', status: 'sent' as const, countsTowardQuota: true })),
    );
    expect((await send()).status).toBe('sent'); // 101 → aşım
    expect((await send()).status).toBe('sent');
    const exceeded = await ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, s.tenantId), eq(notifications.kind, 'sms_quota_exceeded')));
    expect(exceeded).toHaveLength(1);
    expect(exceeded[0]!.payload).toMatchObject({ quota: 100 });
  });

  it('Zincir: şube başına 300', async () => {
    const s = await ctx.createTenantWithOwner({ name: 'Zincir' });
    await ctx.db.update(tenants).set({ planCode: 'zincir' }).where(eq(tenants.id, s.tenantId));
    expect(await smsQuotaForTenant(ctx.db, s.tenantId)).toBe(300);
  });

  it('sms_fallback kapalı → OTP/durum SMS\'i gitmez; alarm SMS\'i gider', async () => {
    await ctx.db.insert(featureFlags).values({ key: 'sms_fallback', enabled: false, kind: 'kill_switch' }).onConflictDoUpdate({ target: featureFlags.key, set: { enabled: false } });
    const r1 = await handleSmsSend(deps(), { tenantId: t.tenantId, to: '+905329998877', body: 'Kod', purpose: 'otp' });
    expect(r1).toMatchObject({ status: 'skipped', reason: 'kill_switch' });
    const r2 = await handleSmsSend(deps(), { tenantId: t.tenantId, to: '+905329998877', body: 'Yeni sipariş bekliyor', purpose: 'alarm' });
    expect(r2.status).toBe('sent');
    await ctx.db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, 'sms_fallback'));
  });

  it('geçersiz telefon atlanır', async () => {
    expect(await handleSmsSend(deps(), { tenantId: t.tenantId, to: 'abc', body: 'x', purpose: 'status' })).toMatchObject({ status: 'skipped', reason: 'invalid_phone' });
  });
});

describe('platform.alert', () => {
  it('yeni sipariş alarmı (mock) → notifications platform_wa + şablon parametreleri', async () => {
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new', totalKurus: 45000 });
    await enqueueJob(ctx.db, { queue: 'notify', type: 'platform.alert', payload: { tenantId: t.tenantId, branchId: t.branchId, kind: 'new_order_alarm', orderId: order.id } });
    await runJobs(ctx, ['platform.alert']);
    const rows = await ctx.db.select().from(notifications).where(and(eq(notifications.orderId, order.id), eq(notifications.channel, 'platform_wa')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'new_order_alarm', status: 'sent', recipientUserId: t.owner.id });
    expect(rows[0]!.payload).toMatchObject({ template: 'isletme_yeni_siparis_v1', to: '0*** *** 22 33', testLabel: false });
    expect((rows[0]!.payload as { params: string[] }).params).toEqual(['SMS Pide', `#${order.number}`, expect.any(String), '450,00 TL']);
    expect(String(rows[0]!.payload.text)).toContain('Yeni sipariş onay bekliyor. İşletme: SMS Pide');
    // Aynı sipariş için ikinci uyarı gitmez
    const again = await handlePlatformAlert(deps(), { tenantId: t.tenantId, kind: 'new_order_alarm', orderId: order.id });
    expect(again).toMatchObject({ status: 'skipped', reason: 'already_sent' });
  });

  it('onboarding_test → "TEST #<no>"; canary / artık yeni değil → gitmez', async () => {
    const test = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new', extra: { testKind: 'onboarding_test' } });
    const r = await handlePlatformAlert(deps(), { tenantId: t.tenantId, kind: 'new_order_alarm', orderId: test.id });
    expect(r.status).toBe('sent');
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.orderId, test.id));
    expect((n!.payload as { params: string[] }).params[1]).toBe(`TEST #${test.number}`);

    const canary = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new', extra: { testKind: 'canary', number: 0 } });
    expect(await handlePlatformAlert(deps(), { tenantId: t.tenantId, kind: 'new_order_alarm', orderId: canary.id })).toMatchObject({ status: 'skipped' });
    const accepted = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'accepted' });
    expect(await handlePlatformAlert(deps(), { tenantId: t.tenantId, kind: 'new_order_alarm', orderId: accepted.id })).toMatchObject({ status: 'skipped', reason: 'not_waiting' });
    const pending = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    await ctx.db.update(orders).set({ rejectionScheduledAt: new Date() }).where(eq(orders.id, pending.id));
    expect(await handlePlatformAlert(deps(), { tenantId: t.tenantId, kind: 'new_order_alarm', orderId: pending.id })).toMatchObject({ status: 'skipped', reason: 'not_waiting' });
  });

  it('sahip telefonu yoksa skipped kaydı; bağlantı sorunu şablonu', async () => {
    const s = await ctx.createTenantWithOwner({ name: 'Telefonsuz' });
    const r = await handlePlatformAlert(deps(), { tenantId: s.tenantId, kind: 'wa_disconnected', text: 'Token geçersiz (190)' });
    expect(r).toMatchObject({ status: 'skipped', reason: 'owner_phone_missing' });
    const ok = await handlePlatformAlert(deps(), { tenantId: t.tenantId, kind: 'wa_disconnected', text: 'Token geçersiz (190)' });
    expect(ok.status).toBe('sent');
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.id, ok.notificationIds[0]!));
    expect(String(n!.payload.text)).toContain('WhatsApp bağlantısında sorun var (Token geçersiz (190))');
  });

  it('platform_wa_alerts kapalı → gönderilmez', async () => {
    await ctx.db.insert(featureFlags).values({ key: 'platform_wa_alerts', enabled: false, kind: 'ops' }).onConflictDoUpdate({ target: featureFlags.key, set: { enabled: false } });
    const order = await ctx.createOrder({ tenantId: t.tenantId, branchId: t.branchId, status: 'new' });
    expect(await handlePlatformAlert(deps(), { tenantId: t.tenantId, kind: 'new_order_alarm', orderId: order.id })).toMatchObject({ status: 'skipped', reason: 'flag_off' });
    await ctx.db.update(featureFlags).set({ enabled: true }).where(eq(featureFlags.key, 'platform_wa_alerts'));
  });
});
