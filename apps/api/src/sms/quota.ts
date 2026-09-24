// SMS adil kullanım kotası (00 §4): Esnaf 100, Pro 300, Zincir şube başına 300 SMS/ay.
// Kota aşımında SMS yine gönderilir, işletme uyarılır (notifications). Ay sınırı Europe/Istanbul.

import { DEFAULT_TIMEZONE, localDateString, zonedTimeToUtc, type PlanCode } from '@siparis/core';
import { branches, smsMessages, tenants, type Database } from '@siparis/db';
import { and, count, eq, gte, ne } from 'drizzle-orm';

export const SMS_PLAN_QUOTAS: Record<PlanCode, number> = { esnaf: 100, pro: 300, zincir: 300 };

/** Ayın ilk anı (İstanbul) ve ay anahtarı 'YYYY-MM'. */
export function monthStart(now: Date = new Date()): { start: Date; key: string } {
  const local = localDateString(now, DEFAULT_TIMEZONE);
  const key = local.slice(0, 7);
  return { start: zonedTimeToUtc(`${key}-01`, '00:00', DEFAULT_TIMEZONE), key };
}

export async function smsQuotaForTenant(db: Database, tenantId: string): Promise<number> {
  const [t] = await db.select({ planCode: tenants.planCode }).from(tenants).where(eq(tenants.id, tenantId));
  const plan = t?.planCode ?? 'esnaf';
  if (plan !== 'zincir') return SMS_PLAN_QUOTAS[plan];
  const [b] = await db.select({ n: count() }).from(branches).where(eq(branches.tenantId, tenantId));
  return SMS_PLAN_QUOTAS.zincir * Math.max(1, Number(b?.n ?? 1));
}

export async function smsUsageThisMonth(db: Database, tenantId: string, now: Date = new Date()): Promise<number> {
  const { start } = monthStart(now);
  const [r] = await db
    .select({ n: count() })
    .from(smsMessages)
    .where(
      and(
        eq(smsMessages.tenantId, tenantId),
        eq(smsMessages.countsTowardQuota, true),
        ne(smsMessages.status, 'failed'),
        gte(smsMessages.createdAt, start),
      ),
    );
  return Number(r?.n ?? 0);
}
