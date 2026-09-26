// `platform.alert` işi: platform WhatsApp numarasından işletme sahibine uyarı şablonu (02 §5.3, §10.3 basamak 3).
// PLATFORM_WA_PROVIDER=mock → gönderim notifications tablosuna ('platform_wa') + log. cloud/d360 → platform hesabı
// (config: PLATFORM_WA_API_KEY + PLATFORM_WA_PHONE_NUMBER_ID). Ortak numara (00 §12a madde 8) aynı platform numarasıdır. onboarding_test'te sipariş no "TEST #<no>".
// ops bayrağı platform_wa_alerts kapalıysa gönderilmez (Meta kesintisi, 10 §6.6).
// panel_offline (cron.panel_presence, 06 §7.7): şablon isletme_panel_cevrimdisi_v1 [işletme(· şube), dakika]; kayıt metni
// tr.ts panelOfflineAlertText. Tekillik (şube başına 60 dk'da 1) dedektördedir.

import { formatTL, maskPhone, panelOfflineAlertText, type PlatformTemplateName } from '@siparis/core';
import { memberships, notifications, orders, users, type Database } from '@siparis/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { isFlagEnabled } from '../../lib/flags';
import { isWaSendError } from '../../wa/errors';
import { getWaProvider, platformAccountRef } from '../../wa/registry';
import { loadBranch, loadTenant } from './context';
import { renderTemplateBody } from './template-bodies';

export interface PlatformAlertPayload {
  tenantId: string;
  branchId?: string | null;
  /** new_order_alarm | wa_disconnected | wa_payment_missing | panel_offline | ... */
  kind: string;
  orderId?: string | null;
  text?: string | null;
  /** new_order_alarm: bekleme dakikası (verilmezse sipariş zamanından hesaplanır) */
  waitingMinutes?: number | null;
  /** panel_offline: sipariş ekranının görülmediği dakika (cron.panel_presence, 06 §7.7) */
  minutes?: number | null;
}

export interface PlatformAlertDeps {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
}

export type PlatformAlertOutcome = { status: 'sent' | 'skipped' | 'failed'; reason?: string; notificationIds: string[] };

async function record(
  db: Database,
  p: PlatformAlertPayload,
  input: { status: 'sent' | 'skipped' | 'failed'; recipientUserId?: string | null; payload: Record<string, unknown>; providerRef?: string | null; error?: string | null },
): Promise<string> {
  const [n] = await db
    .insert(notifications)
    .values({
      tenantId: p.tenantId,
      branchId: p.branchId ?? null,
      orderId: p.orderId ?? null,
      recipientUserId: input.recipientUserId ?? null,
      kind: p.kind,
      channel: 'platform_wa',
      payload: input.payload,
      status: input.status,
      providerRef: input.providerRef ?? null,
      error: input.error ?? null,
      sentAt: input.status === 'sent' ? new Date() : null,
    })
    .returning({ id: notifications.id });
  return n!.id;
}

export async function handlePlatformAlert(deps: PlatformAlertDeps, p: PlatformAlertPayload, now: Date = new Date()): Promise<PlatformAlertOutcome> {
  const { db, config, log } = deps;
  const tenant = await loadTenant(db, p.tenantId);
  if (!tenant) return { status: 'skipped', reason: 'tenant_not_found', notificationIds: [] };
  const branch = p.branchId ? await loadBranch(db, p.tenantId, p.branchId) : undefined;

  const [order] = p.orderId ? await db.select().from(orders).where(and(eq(orders.id, p.orderId), eq(orders.tenantId, p.tenantId))) : [];
  if (p.kind === 'new_order_alarm') {
    if (!order) return { status: 'skipped', reason: 'order_not_found', notificationIds: [] };
    // Sipariş artık 'new' değilse ya da bekleyen ret varsa gitmez; canary'de hiç
    if (order.status !== 'new' || order.rejectionScheduledAt || order.testKind === 'canary') {
      return { status: 'skipped', reason: 'not_waiting', notificationIds: [] };
    }
    const orderBranch = branch ?? (await loadBranch(db, p.tenantId, order.branchId));
    if (orderBranch?.alarmPolicy && orderBranch.alarmPolicy.platform_wa_enabled === false) {
      return { status: 'skipped', reason: 'policy_disabled', notificationIds: [] };
    }
    // Sipariş başına tek platform uyarısı (WABA uyarısı tekrarlanmaz)
    const [dup] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.orderId, order.id), eq(notifications.kind, p.kind), eq(notifications.channel, 'platform_wa'), eq(notifications.status, 'sent')))
      .limit(1);
    if (dup) return { status: 'skipped', reason: 'already_sent', notificationIds: [] };
  }

  let template: PlatformTemplateName | null = null;
  let params: string[] = [];
  let testLabel = false;
  /** Kayıt/önizleme metni (verilmezse şablon gövdesi) */
  let summary: string | null = null;
  switch (p.kind) {
    case 'new_order_alarm': {
      testLabel = order!.testKind === 'onboarding_test';
      const startedAt = order!.verifiedAt ?? order!.placedAt;
      const waited = p.waitingMinutes && p.waitingMinutes > 0 ? Math.round(p.waitingMinutes) : Math.max(1, Math.round((now.getTime() - startedAt.getTime()) / 60_000));
      template = 'isletme_yeni_siparis_v1';
      params = [tenant.name, testLabel ? `TEST #${order!.number}` : `#${order!.number}`, String(waited), formatTL(order!.totalKurus)];
      break;
    }
    case 'wa_disconnected':
      template = 'isletme_baglanti_sorunu_v1';
      params = [tenant.name, p.text?.trim() || 'bağlantı hatası'];
      break;
    case 'wa_payment_missing':
      template = 'isletme_meta_odeme_v1';
      params = [tenant.name];
      break;
    case 'panel_offline': {
      // Tek şubede işletme adı; ek şubede "İşletme · Şube" (şablon {{1}})
      const label = branch && !branch.isDefault ? `${tenant.name} · ${branch.name}` : tenant.name;
      const minutes = p.minutes && p.minutes > 0 ? Math.round(p.minutes) : 5;
      template = 'isletme_panel_cevrimdisi_v1';
      params = [label, String(minutes)];
      summary = panelOfflineAlertText({ isletme: label, dk: minutes });
      break;
    }
    default:
      template = null;
  }
  const text = summary ?? (template ? renderTemplateBody(template, params) : (p.text ?? `${tenant.name}: ${p.kind}`));
  const basePayload: Record<string, unknown> = { template, params, text, testLabel, provider: config.PLATFORM_WA_PROVIDER };

  if (!(await isFlagEnabled(db, 'platform_wa_alerts'))) {
    const id = await record(db, p, { status: 'skipped', payload: { ...basePayload, reason: 'platform_wa_alerts_off' } });
    return { status: 'skipped', reason: 'flag_off', notificationIds: [id] };
  }

  // Alıcılar: işletme sahibi (owner) telefonları
  const owners = await db
    .select({ id: users.id, phone: users.phone })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, p.tenantId), eq(memberships.role, 'owner'), isNull(memberships.disabledAt), isNull(users.disabledAt), sql`${users.phone} is not null`));
  if (!owners.length) {
    const id = await record(db, p, { status: 'skipped', payload: { ...basePayload, reason: 'owner_phone_missing' } });
    log.warn({ tenantId: p.tenantId, kind: p.kind }, 'platform uyarısı: sahip telefonu yok');
    return { status: 'skipped', reason: 'owner_phone_missing', notificationIds: [id] };
  }

  const ids: string[] = [];
  let anySent = false;
  for (const owner of owners) {
    const payload = { ...basePayload, to: maskPhone(owner.phone) };
    if (config.PLATFORM_WA_PROVIDER === 'mock') {
      ids.push(await record(db, p, { status: 'sent', recipientUserId: owner.id, payload, providerRef: 'mock' }));
      log.info({ tenantId: p.tenantId, kind: p.kind, to: maskPhone(owner.phone), template }, 'platform uyarısı (mock)');
      anySent = true;
      continue;
    }
    try {
      const provider = getWaProvider(config.PLATFORM_WA_PROVIDER);
      const acc = platformAccountRef(config);
      const res = template
        ? await provider.sendTemplate(acc, { phone: owner.phone! }, template, 'tr', params)
        : await provider.sendText(acc, { phone: owner.phone! }, text);
      ids.push(await record(db, p, { status: 'sent', recipientUserId: owner.id, payload, providerRef: res.wamid }));
      anySent = true;
    } catch (err) {
      const msg = isWaSendError(err) ? `${err.code}: ${err.message}` : String(err);
      ids.push(await record(db, p, { status: 'failed', recipientUserId: owner.id, payload, error: msg.slice(0, 300) }));
      log.error({ err, tenantId: p.tenantId, kind: p.kind }, 'platform uyarısı gönderilemedi');
    }
  }
  return { status: anySent ? 'sent' : 'failed', notificationIds: ids };
}
