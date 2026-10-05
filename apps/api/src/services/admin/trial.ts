// Deneme bitişini uygulayan iş (00 §9, 05 §A.2.1): `trial_ends_at` + uyarı bandı dolmuş ve ücretli plana
// geçmemiş işletme `read_only` aşamasına düşer → vitrin ve WhatsApp "şu an online sipariş alınmıyor, lütfen
// arayın" moduna geçer; panel, veriler ve dışa aktarma açık kalır (90 gün dönüş hakkı).
// Karar saf fonksiyonda: @siparis/core/admin/lifecycle trialEnforcementTarget. Burada yalnız veritabanı tarafı var.
// Cron kaydı: `cron.trial_watch`, günlük 04:00 — `apps/api/src/jobs/cron/index.ts` → `registerCronJobs`
// (14 §cron tablosu). Kaydı eklemeden önce (denetim 04.10.2026 (A)) bu fonksiyon yalnız testten çağrılıyordu,
// yani deneme bitişi canlıda hiç uygulanmıyordu; kayıt `apps/api/test/jobs-cron.test.ts` ile sabitlenmiştir.

import { STAGE_TO_SUBSCRIPTION_STATUS, TRIAL_GRACE_DAYS, trialEnforcementTarget } from '@siparis/core/admin/lifecycle';
import { subscriptions, tenants, type Database } from '@siparis/db';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit';
import { currentSubscription } from './tenants';

export interface TrialEnforcementResult {
  tenantId: string;
  slug: string;
  /** Uygulanan aşama (bugün yalnız 'read_only'). */
  stage: 'read_only';
}

/**
 * Süresi dolan denemeleri kapatır. İdempotent: aşamayı yalnız hâlâ `trial` olan satırda değiştirir (koşullu
 * update), bu arada admin tarafından uzatılan/ödeyen işletmeye dokunmaz. Abonelik durumu da aynı transaction'da
 * aşamayla eşitlenir (05 §A.2.1 eşlemesi) ki `deriveLifecycleStage` sonradan işletmeyi sessizce `trial`e
 * döndürmesin. Aktör sistemdir: `audit_log.actor_user_id` boş, `data.actorType = 'system'`.
 */
export async function enforceTrialEnds(db: Database, now: Date = new Date(), graceDays: number = TRIAL_GRACE_DAYS): Promise<TrialEnforcementResult[]> {
  const cutoff = new Date(now.getTime() - graceDays * 86_400_000);
  const due = await db
    .select({ id: tenants.id, slug: tenants.slug, trialEndsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(and(eq(tenants.lifecycleStage, 'trial'), isNotNull(tenants.trialEndsAt), lte(tenants.trialEndsAt, cutoff)));

  const applied: TrialEnforcementResult[] = [];
  for (const row of due) {
    const done = await db.transaction(async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, row.id)).for('update');
      if (!t) return false;
      const sub = await currentSubscription(tx, t.id);
      const target = trialEnforcementTarget({
        lifecycleStage: t.lifecycleStage,
        trialEndsAt: t.trialEndsAt,
        subscriptionStatus: sub?.status ?? null,
        now,
        graceDays,
      });
      if (target !== 'read_only') return false;

      await tx
        .update(tenants)
        .set({ lifecycleStage: target, version: sql`${tenants.version} + 1` })
        .where(and(eq(tenants.id, t.id), eq(tenants.lifecycleStage, 'trial')));

      const subStatus = STAGE_TO_SUBSCRIPTION_STATUS[target];
      if (sub && subStatus && sub.status !== subStatus) {
        await tx
          .update(subscriptions)
          .set({ status: subStatus, version: sql`${subscriptions.version} + 1` })
          .where(eq(subscriptions.id, sub.id));
      }

      await audit(tx, {
        tenantId: t.id,
        action: 'tenant.trial_ended',
        entityType: 'tenant',
        entityId: t.id,
        data: {
          actorType: 'system',
          from: 'trial',
          to: target,
          trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
          graceDays,
          subscriptionStatus: { from: sub?.status ?? null, to: sub && subStatus ? subStatus : (sub?.status ?? null) },
        },
      });
      return true;
    });
    if (done) applied.push({ tenantId: row.id, slug: row.slug, stage: 'read_only' });
  }
  return applied;
}
