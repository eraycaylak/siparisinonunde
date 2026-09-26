// İşletmeler (05 A-03, A-04): liste, 360° detay, gerekçeli düzenleme, sipariş listesi.

import {
  adminTenantDetailSchema,
  adminTenantListQuerySchema,
  adminTenantListResponseSchema,
  adminTenantOrdersQuerySchema,
  adminTenantOrdersResponseSchema,
  adminTenantPatchSchema,
} from '@siparis/core/admin/contracts';
import {
  STAGE_TO_SUBSCRIPTION_STATUS,
  canTransitionLifecycle,
  deriveLifecycleStage,
  lifecycleTransitionPermission,
} from '@siparis/core/admin/lifecycle';
import { SALES_REP_MAX_TRIAL_EXTENSION_DAYS, adminCan, type AdminPermission } from '@siparis/core/admin/permissions';
import {
  LIFECYCLE_STAGE_LABELS,
  WA_CODE_PROBLEM_MESSAGES,
  normalizeWaCode,
  waCodeProblem,
  type LifecycleStage,
  type SubscriptionStatus,
  type SuspensionReason,
  type WaMode,
} from '@siparis/core';
import { auditLog, subscriptions, tenants } from '@siparis/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { currentSubscription, listTenantOrders, listTenants, loadTenantDetail } from '../../services/admin/tenants';
import { adminActor, adminAudit, auditSensitiveRead, requireAdmin } from '../../services/admin/util';
import { applyWaMode } from '../../services/messaging/shared';

const paramsSchema = z.object({ id: z.uuid() });
const waCodeTaken = () => conflict('wa_code_taken', 'Bu dükkan kodu başka bir işletmede kullanılıyor.');
const DAY_MS = 86400000;

type Change = { from: unknown; to: unknown };

const routes: FastifyPluginAsyncZod = async (app) => {
  // GET /admin/tenants?q=&stage=&cursor=
  app.get(
    '/tenants',
    {
      preHandler: requireAdmin('tenants:read'),
      schema: { querystring: adminTenantListQuerySchema, response: { 200: adminTenantListResponseSchema } },
    },
    async (request) => listTenants(app.db, request.query),
  );

  // GET /admin/tenants/:id — hassas okuma: audit'e yazılır (05 §A.1 #6)
  app.get(
    '/tenants/:id',
    {
      preHandler: requireAdmin('tenants:read'),
      schema: { params: paramsSchema, response: { 200: adminTenantDetailSchema } },
    },
    async (request) => {
      const actor = adminActor(request);
      const detail = await loadTenantDetail(app.db, request.params.id, actor.role);
      if (!detail) throw notFound('İşletme bulunamadı.');
      await auditSensitiveRead(app.db, actor, detail.tenant.id, 'admin.tenant_view');
      return detail;
    },
  );

  // GET /admin/tenants/:id/orders?cursor= — müşteri kişisel verisi yok
  app.get(
    '/tenants/:id/orders',
    {
      preHandler: requireAdmin('tenants:read'),
      schema: { params: paramsSchema, querystring: adminTenantOrdersQuerySchema, response: { 200: adminTenantOrdersResponseSchema } },
    },
    async (request) => {
      const actor = adminActor(request);
      const [t] = await app.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, request.params.id));
      if (!t) throw notFound('İşletme bulunamadı.');
      if (!request.query.cursor) await auditSensitiveRead(app.db, actor, t.id, 'admin.tenant_orders_view');
      return listTenantOrders(app.db, t.id, request.query);
    },
  );

  // PATCH /admin/tenants/:id — plan, aşama, askı sebebi, sipariş alma, deneme bitişi, abonelik, dükkan kodu ve
  // WhatsApp modu (ortak numara / kendi numarası; 00 §12a madde 8); gerekçe zorunlu
  app.patch(
    '/tenants/:id',
    {
      preHandler: requireAdmin('tenants:read'),
      schema: { params: paramsSchema, body: adminTenantPatchSchema, response: { 200: adminTenantDetailSchema } },
    },
    async (request) => {
      const actor = adminActor(request);
      const role = actor.role;
      const body = request.body;
      const tenantId = request.params.id;
      const need = (perm: AdminPermission, message?: string) => {
        if (!adminCan(role, perm)) throw forbidden(message ?? 'Bu değişiklik için yetkiniz yok.');
      };

      const saved = app.db.transaction(async (tx) => {
        const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
        if (!t) throw notFound('İşletme bulunamadı.');
        const sub = await currentSubscription(tx, tenantId);
        const now = new Date();

        const tenantPatch: Partial<typeof tenants.$inferInsert> = {};
        const subPatch: Partial<typeof subscriptions.$inferInsert> = {};
        const tenantChanges: Record<string, Change> = {};
        const subChanges: Record<string, Change> = {};

        // Plan (A-08: abonelik değişikliği)
        if (body.planCode !== undefined && body.planCode !== t.planCode) {
          need('tenants:subscription', 'Plan değişikliğini yalnız finans ekibi yapabilir.');
          tenantPatch.planCode = body.planCode;
          tenantChanges.planCode = { from: t.planCode, to: body.planCode };
          if (sub && sub.planCode !== body.planCode) {
            subPatch.planCode = body.planCode;
            subChanges.planCode = { from: sub.planCode, to: body.planCode };
          }
        }

        // Kurucu üye indirimi
        const fd = body.subscription?.founderDiscountBp;
        if (fd !== undefined && fd !== (sub?.founderDiscountBp ?? null)) {
          need('tenants:subscription', 'Abonelik indirimini yalnız finans ekibi değiştirebilir.');
          subPatch.founderDiscountBp = fd;
          subChanges.founderDiscountBp = { from: sub?.founderDiscountBp ?? null, to: fd };
        }

        // Aşama ve abonelik durumu (05 §A.2.1 eşlemesi ve türetme önceliği)
        let targetStage: LifecycleStage = t.lifecycleStage;
        let targetSubStatus: SubscriptionStatus | undefined = sub?.status;
        const reqSubStatus = body.subscription?.status;
        if (reqSubStatus !== undefined && reqSubStatus !== sub?.status) {
          need('tenants:subscription', 'Abonelik durumunu yalnız finans ekibi değiştirebilir.');
          targetSubStatus = reqSubStatus;
          if (body.lifecycleStage === undefined) targetStage = deriveLifecycleStage(t.lifecycleStage, reqSubStatus);
        }
        if (body.lifecycleStage !== undefined) {
          targetStage = body.lifecycleStage;
          if (reqSubStatus !== undefined) {
            if (deriveLifecycleStage(t.lifecycleStage, reqSubStatus) !== targetStage) {
              throw badRequest('Aşama ile abonelik durumu uyuşmuyor.', undefined, 'inconsistent_status');
            }
          } else {
            const mapped = STAGE_TO_SUBSCRIPTION_STATUS[targetStage];
            if (mapped && targetStage !== t.lifecycleStage) targetSubStatus = mapped;
          }
        }
        if (targetStage !== t.lifecycleStage) {
          if (!canTransitionLifecycle(t.lifecycleStage, targetStage)) {
            throw conflict(
              'invalid_lifecycle_transition',
              `"${LIFECYCLE_STAGE_LABELS[t.lifecycleStage]}" aşamasından "${LIFECYCLE_STAGE_LABELS[targetStage]}" aşamasına geçilemez.`,
              { from: t.lifecycleStage, to: targetStage },
            );
          }
          const perm = lifecycleTransitionPermission(t.lifecycleStage, targetStage);
          need(perm);
          if (perm === 'tenants:unsuspend' && role === 'finance' && t.suspensionReason !== 'payment') {
            throw forbidden('Finans ekibi yalnız ödeme kaynaklı askıyı kaldırabilir.');
          }
          tenantPatch.lifecycleStage = targetStage;
          tenantChanges.lifecycleStage = { from: t.lifecycleStage, to: targetStage };
        }

        // Askı sebebi (core SUSPENSION_REASONS; askıda zorunlu)
        let suspensionReason: SuspensionReason | null = body.suspensionReason !== undefined ? body.suspensionReason : (t.suspensionReason ?? null);
        if (targetStage === 'suspended') {
          if (!suspensionReason) {
            throw new AppError(400, 'suspension_reason_required', 'Askıya alma sebebini seçin.', {
              issues: [{ path: '/suspensionReason', message: 'Askıya alma sebebini seçin.' }],
            });
          }
          if (t.lifecycleStage === 'suspended' && suspensionReason !== t.suspensionReason) need('tenants:suspend');
        } else {
          if (body.suspensionReason) {
            throw new AppError(400, 'suspension_reason_not_allowed', 'Askı sebebi yalnız askıdaki işletme için seçilebilir.', {
              issues: [{ path: '/suspensionReason', message: 'Askı sebebi yalnız askıdaki işletme için seçilebilir.' }],
            });
          }
          suspensionReason = null;
        }
        if (suspensionReason !== (t.suspensionReason ?? null)) {
          tenantPatch.suspensionReason = suspensionReason;
          tenantChanges.suspensionReason = { from: t.suspensionReason ?? null, to: suspensionReason };
        }

        // Tenant bazında kill-switch (00 §4)
        if (body.orderingEnabled !== undefined && body.orderingEnabled !== t.orderingEnabled) {
          need('tenants:ordering');
          tenantPatch.orderingEnabled = body.orderingEnabled;
          tenantChanges.orderingEnabled = { from: t.orderingEnabled, to: body.orderingEnabled };
        }

        // Deneme bitişi (SR: tek sefer, en fazla 14 gün uzatma)
        if (body.trialEndsAt !== undefined) {
          const next = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
          const current = t.trialEndsAt ?? null;
          if ((next?.getTime() ?? null) !== (current?.getTime() ?? null)) {
            need('tenants:extend_trial');
            if (role === 'sales_rep') {
              if (!next || (current && next.getTime() <= current.getTime())) {
                throw forbidden('Satış ekibi deneme süresini yalnız uzatabilir.', 'trial_extension_only');
              }
              const base = Math.max(current?.getTime() ?? 0, now.getTime());
              if (next.getTime() - base > SALES_REP_MAX_TRIAL_EXTENSION_DAYS * DAY_MS + 60_000) {
                throw forbidden(`Satış ekibi denemeyi en fazla ${SALES_REP_MAX_TRIAL_EXTENSION_DAYS} gün uzatabilir.`, 'trial_extension_limit');
              }
              const [prev] = await tx
                .select({ id: auditLog.id })
                .from(auditLog)
                .where(
                  and(
                    eq(auditLog.tenantId, tenantId),
                    eq(auditLog.action, 'admin.tenant_update'),
                    sql`${auditLog.data}->>'actorRole' = 'sales_rep'`,
                    sql`${auditLog.data}->'changes' ? 'trialEndsAt'`,
                  ),
                )
                .limit(1);
              if (prev) throw forbidden('Satış ekibi deneme süresini yalnız bir kez uzatabilir.', 'trial_extension_used');
            }
            tenantPatch.trialEndsAt = next;
            tenantChanges.trialEndsAt = { from: current?.toISOString() ?? null, to: next?.toISOString() ?? null };
            if (sub && (sub.trialEndsAt?.getTime() ?? null) !== (next?.getTime() ?? null)) {
              subPatch.trialEndsAt = next;
              subChanges.trialEndsAt = { from: sub.trialEndsAt?.toISOString() ?? null, to: next?.toISOString() ?? null };
            }
          }
        }

        // Ortak numara (00 §12a madde 8): dükkan kodu (tekil, QR'daki #KOD) ve WhatsApp modu
        if (body.waCode !== undefined) {
          const code = normalizeWaCode(body.waCode);
          const problem = code ? waCodeProblem(code) : 'format';
          if (!code || problem) {
            const message = WA_CODE_PROBLEM_MESSAGES[problem ?? 'format'];
            throw new AppError(400, 'invalid_wa_code', message, { issues: [{ path: '/waCode', message }] });
          }
          if (code !== t.waCode) {
            need('tenants:whatsapp', 'Dükkan kodunu yalnız platform yöneticisi değiştirebilir.');
            const [taken] = await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.waCode, code), ne(tenants.id, tenantId)));
            if (taken) throw waCodeTaken();
            tenantPatch.waCode = code;
            tenantChanges.waCode = { from: t.waCode ?? null, to: code };
          }
        }
        let waModeChange: WaMode | null = null;
        if (body.waMode !== undefined && body.waMode !== t.waMode) {
          need('tenants:whatsapp', 'WhatsApp modunu yalnız platform yöneticisi değiştirebilir.');
          waModeChange = body.waMode;
          tenantChanges.waMode = { from: t.waMode, to: body.waMode };
        }

        if (targetSubStatus && targetSubStatus !== sub?.status) {
          subPatch.status = targetSubStatus;
          subChanges.status = { from: sub?.status ?? null, to: targetSubStatus };
        }

        const tenantChanged = Object.keys(tenantPatch).length > 0 || waModeChange !== null;
        const subChanged = Object.keys(subChanges).length > 0;
        if (!tenantChanged && !subChanged) {
          throw badRequest('Değişiklik yok: gönderilen değerler zaten güncel.', undefined, 'no_changes');
        }

        if (tenantChanged) {
          await tx
            .update(tenants)
            .set({ ...tenantPatch, version: sql`${tenants.version} + 1` })
            .where(eq(tenants.id, tenantId));
          // Mod değişince WhatsApp hesap satırı da çevrilir (ortak numara satırı açılır ya da kapatılır)
          if (waModeChange) await applyWaMode(tx, app.config, tenantId, waModeChange);
          await adminAudit(tx, actor, {
            tenantId,
            action: 'admin.tenant_update',
            entityType: 'tenant',
            entityId: tenantId,
            data: { reason: body.reason, changes: tenantChanges },
          });
        }

        if (subChanged) {
          let subId = sub?.id ?? null;
          if (sub) {
            await tx
              .update(subscriptions)
              .set({ ...subPatch, version: sql`${subscriptions.version} + 1` })
              .where(eq(subscriptions.id, sub.id));
          } else if (subPatch.status !== undefined || subPatch.founderDiscountBp !== undefined) {
            const [created] = await tx
              .insert(subscriptions)
              .values({
                tenantId,
                planCode: tenantPatch.planCode ?? t.planCode,
                status: subPatch.status ?? STAGE_TO_SUBSCRIPTION_STATUS[targetStage] ?? 'trialing',
                trialEndsAt: tenantPatch.trialEndsAt !== undefined ? tenantPatch.trialEndsAt : t.trialEndsAt,
                founderDiscountBp: subPatch.founderDiscountBp ?? null,
              })
              .returning({ id: subscriptions.id });
            subId = created?.id ?? null;
          }
          if (subId) {
            await adminAudit(tx, actor, {
              tenantId,
              action: 'admin.subscription_update',
              entityType: 'subscription',
              entityId: subId,
              data: { reason: body.reason, changes: subChanges },
            });
          }
        }
      });
      await saved.catch((err: unknown) => {
        // Eşzamanlı aynı kod: benzersiz indeks (tenants_wa_code_uk)
        if ((err as { code?: string } | null)?.code === '23505') throw waCodeTaken();
        throw err;
      });

      const detail = await loadTenantDetail(app.db, tenantId, role);
      if (!detail) throw notFound('İşletme bulunamadı.');
      return detail;
    },
  );
};

export default routes;
