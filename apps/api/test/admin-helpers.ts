// Admin dilimi test yardımcıları: rol başına platform kullanıcısı ve çerezi, WA hesabı, iş kaydı.

import { PLATFORM_ROLES, type PlatformRole } from '@siparis/core';
import { conversations, customers, jobs, messages, waAccounts } from '@siparis/db';
import { randomUUID } from 'node:crypto';
import type { TestContext, TestUser } from './helpers';

export type PlatformUsers = Record<PlatformRole, { user: TestUser; cookie: string }>;

export async function createPlatformUsers(ctx: TestContext): Promise<PlatformUsers> {
  const out = {} as PlatformUsers;
  for (const role of PLATFORM_ROLES) {
    const user = await ctx.createUser({ name: `Platform ${role}`, isPlatformAdmin: true, platformRole: role });
    out[role] = { user, cookie: await ctx.sessionCookie(user.id) };
  }
  return out;
}

export async function createWaAccount(
  ctx: TestContext,
  opts: { tenantId: string; branchId: string; status?: 'connected' | 'disconnected' | 'error'; lastWebhookAt?: Date | null; lastError?: string | null },
) {
  const [acc] = await ctx.db
    .insert(waAccounts)
    .values({
      tenantId: opts.tenantId,
      branchId: opts.branchId,
      provider: 'mock',
      displayPhone: '+905550001122',
      phoneNumberId: `pn-${randomUUID().slice(0, 8)}`,
      webhookToken: `wh-${randomUUID()}`,
      apiKeyEnc: 'v1:gizli:anahtar:deger',
      status: opts.status ?? 'connected',
      lastWebhookAt: opts.lastWebhookAt === undefined ? new Date() : opts.lastWebhookAt,
      lastError: opts.lastError ?? null,
    })
    .returning();
  return acc!;
}

/** Hesaba bir konuşma ve `inbound` gelen + `outbound` giden mesaj ekler. */
export async function addMessages(ctx: TestContext, acc: { id: string; tenantId: string; branchId: string }, inbound: number, outbound: number) {
  const [cust] = await ctx.db
    .insert(customers)
    .values({ tenantId: acc.tenantId, phoneE164: `+90532${Math.floor(1000000 + Math.random() * 8999999)}`, name: 'Mesaj Müşteri' })
    .returning();
  const [conv] = await ctx.db
    .insert(conversations)
    .values({ tenantId: acc.tenantId, branchId: acc.branchId, waAccountId: acc.id, customerId: cust!.id })
    .returning();
  const rows = [
    ...Array.from({ length: inbound }, () => ({ direction: 'in' as const, sentBy: 'customer' as const })),
    ...Array.from({ length: outbound }, () => ({ direction: 'out' as const, sentBy: 'bot' as const })),
  ];
  if (rows.length) {
    await ctx.db.insert(messages).values(
      rows.map((r) => ({
        tenantId: acc.tenantId,
        conversationId: conv!.id,
        direction: r.direction,
        kind: 'text' as const,
        body: 'merhaba',
        status: 'delivered' as const,
        sentBy: r.sentBy,
        wamid: `mock.${randomUUID()}`,
      })),
    );
  }
}

export async function createJob(
  ctx: TestContext,
  opts: { status?: 'pending' | 'failed' | 'done'; type?: string; tenantId?: string | null; payload?: Record<string, unknown>; attempts?: number },
) {
  const [job] = await ctx.db
    .insert(jobs)
    .values({
      queue: 'notify',
      type: opts.type ?? 'test.admin_noop',
      payload: opts.payload ?? {},
      status: opts.status ?? 'failed',
      attempts: opts.attempts ?? 5,
      maxAttempts: 5,
      lastError: opts.status === 'failed' || !opts.status ? 'Error: sağlayıcı yanıt vermedi' : null,
      tenantId: opts.tenantId ?? null,
      finishedAt: opts.status === 'failed' || !opts.status ? new Date() : null,
    })
    .returning();
  return job!;
}
