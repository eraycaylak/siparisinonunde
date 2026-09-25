// Push abonelikleri (push_subscriptions): cihaz başına tekil endpoint. Tüm sorgular tenant_id ile süzülür.

import type { TenantRole } from '@siparis/core';
import { memberships, pushSubscriptions, sessions, users, type Database } from '@siparis/db';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PushSendResult } from './client';

/** Yeni sipariş bildirimini alan roller (kurye hariç tüm panel rolleri; mutfak yükünde tutar yoktur). */
export const PUSH_RECIPIENT_ROLES: readonly TenantRole[] = ['owner', 'manager', 'cashier', 'kitchen'];

export interface UpsertPushSubscriptionInput {
  tenantId: string;
  branchId: string | null;
  userId: string;
  sessionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * Abonelik ekler ya da aynı endpoint'i günceller: cihaz başka kullanıcı/işletmeyle yeniden abone olursa bağ
 * yenilenir (paylaşımlı tablette personel değişimi), kapatılmış abonelik yeniden açılır.
 */
export async function upsertPushSubscription(db: Database, input: UpsertPushSubscriptionInput): Promise<{ id: string; branchId: string | null }> {
  const values = {
    tenantId: input.tenantId,
    branchId: input.branchId,
    userId: input.userId,
    sessionId: input.sessionId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    userAgent: input.userAgent?.slice(0, 300) ?? null,
  };
  const [row] = await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        tenantId: values.tenantId,
        branchId: values.branchId,
        userId: values.userId,
        sessionId: values.sessionId,
        p256dh: values.p256dh,
        auth: values.auth,
        userAgent: values.userAgent,
        disabledAt: null,
        failedAt: null,
        lastError: null,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: pushSubscriptions.id, branchId: pushSubscriptions.branchId });
  return row!;
}

/** Kullanıcının bu işletmedeki aboneliğini siler (yalnız kendi cihazı). Silindiyse true. */
export async function removePushSubscription(db: Database, input: { tenantId: string; userId: string; endpoint: string }): Promise<boolean> {
  const rows = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.tenantId, input.tenantId),
        eq(pushSubscriptions.userId, input.userId),
        eq(pushSubscriptions.endpoint, input.endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export interface PushRecipient {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  role: TenantRole;
}

/**
 * Şubenin yeni sipariş bildirimini alacak etkin abonelikler: işletmede etkin üyeliği olan (kurye hariç), şubeye
 * erişen (üyelik şube kısıtı ve aboneliğin şubesi) ve oturumu geçerli kişisel oturum olan kullanıcıların cihazları.
 */
export async function listPushRecipients(
  db: Database,
  input: { tenantId: string; branchId: string; subscriptionId?: string | null; now?: Date },
): Promise<PushRecipient[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      role: memberships.role,
    })
    .from(pushSubscriptions)
    .innerJoin(memberships, and(eq(memberships.tenantId, pushSubscriptions.tenantId), eq(memberships.userId, pushSubscriptions.userId)))
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .leftJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId))
    .where(
      and(
        eq(pushSubscriptions.tenantId, input.tenantId),
        input.subscriptionId ? eq(pushSubscriptions.id, input.subscriptionId) : undefined,
        isNull(pushSubscriptions.disabledAt),
        isNull(memberships.disabledAt),
        isNull(users.disabledAt),
        inArray(memberships.role, [...PUSH_RECIPIENT_ROLES]),
        or(isNull(memberships.branchId), eq(memberships.branchId, input.branchId)),
        or(isNull(pushSubscriptions.branchId), eq(pushSubscriptions.branchId, input.branchId)),
        or(isNull(pushSubscriptions.sessionId), and(eq(sessions.kind, 'user'), gt(sessions.expiresAt, now))),
      ),
    );
  return rows;
}

/** Gönderim sonucunu aboneliğe işler: başarı zamanı, hata ya da (404/410) kapatma. */
export async function recordPushResult(db: Database, tenantId: string, subscriptionId: string, result: PushSendResult): Promise<void> {
  const where = and(eq(pushSubscriptions.id, subscriptionId), eq(pushSubscriptions.tenantId, tenantId));
  if (result.ok) {
    await db.update(pushSubscriptions).set({ lastSuccessAt: sql`now()`, lastError: null }).where(where);
    return;
  }
  await db
    .update(pushSubscriptions)
    .set({
      failedAt: sql`now()`,
      lastError: result.error.slice(0, 200),
      ...(result.kind === 'gone' ? { disabledAt: sql`now()` } : {}),
    })
    .where(where);
}
