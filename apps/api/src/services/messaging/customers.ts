// WhatsApp müşteri kimliği (02 §8.3): (tenant, BSUID) birincil; yoksa telefon. Otomatik birleştirme yalnız
// BSUID'siz kayıt + WhatsApp kaynaklı telefon durumunda (kural 2); çatışmada birleştirme yok (kural 4).
// Konuşma: (tenant, wa_account, customer) tekil.

import { conversations, customers, type Database } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import type { WaRecipient, WaSender } from '../../wa/types';

export type CustomerRow = typeof customers.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;

async function byBsuid(tx: Database, tenantId: string, bsuid: string): Promise<CustomerRow | undefined> {
  const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.waBsuid, bsuid)));
  return c;
}

async function byPhone(tx: Database, tenantId: string, phone: string): Promise<CustomerRow | undefined> {
  const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.phoneE164, phone)));
  return c;
}

/** Gelen mesajın göndereni (ya da echo alıcısı) için müşteri kaydı. Ad yalnız boşsa profilden yazılır. */
export async function upsertWaCustomer(tx: Database, tenantId: string, who: WaSender | WaRecipient): Promise<CustomerRow> {
  const bsuid = who.bsuid ?? null;
  const phone = who.phone ?? null;
  const name = 'name' in who && who.name ? who.name.trim().slice(0, 80) : null;
  const username = 'username' in who && who.username ? who.username.slice(0, 80) : null;

  if (bsuid) {
    const existing = await byBsuid(tx, tenantId, bsuid);
    if (existing) {
      const patch: Partial<typeof customers.$inferInsert> = {};
      if (!existing.phoneE164 && phone && !(await byPhone(tx, tenantId, phone))) patch.phoneE164 = phone;
      if (!existing.name && name) patch.name = name;
      if (username && existing.waUsername !== username) patch.waUsername = username;
      if (!Object.keys(patch).length) return existing;
      const [u] = await tx.update(customers).set({ ...patch, updatedAt: new Date() }).where(eq(customers.id, existing.id)).returning();
      return u!;
    }
  }
  if (phone) {
    const p = await byPhone(tx, tenantId, phone);
    if (p) {
      if (!bsuid || p.waBsuid === bsuid) {
        if (!p.name && name) {
          const [u] = await tx.update(customers).set({ name, updatedAt: new Date() }).where(eq(customers.id, p.id)).returning();
          return u!;
        }
        return p;
      }
      if (!p.waBsuid) {
        // Kural 2: BSUID'siz kayıt (telefon siparişi / SMS OTP) + WhatsApp kaynaklı telefon → tek kayıt
        const [u] = await tx
          .update(customers)
          .set({ waBsuid: bsuid, name: p.name ?? name, waUsername: username ?? p.waUsername, updatedAt: new Date() })
          .where(eq(customers.id, p.id))
          .returning();
        return u!;
      }
      // Kural 4: aynı telefon, farklı BSUID → otomatik birleştirme yok; yeni kayıt telefonsuz açılır
      const [c] = await tx.insert(customers).values({ tenantId, waBsuid: bsuid, phoneE164: null, name, waUsername: username }).returning();
      return c!;
    }
  }
  const [c] = await tx.insert(customers).values({ tenantId, waBsuid: bsuid, phoneE164: phone, name, waUsername: username }).returning();
  return c!;
}

/** Müşterinin bu WhatsApp hesabındaki konuşması (yoksa oluşturur). */
export async function upsertConversation(
  tx: Database,
  account: { id: string; tenantId: string; branchId: string },
  customerId: string,
): Promise<ConversationRow> {
  await tx
    .insert(conversations)
    .values({ tenantId: account.tenantId, branchId: account.branchId, waAccountId: account.id, customerId })
    .onConflictDoNothing({ target: [conversations.tenantId, conversations.waAccountId, conversations.customerId] });
  const [conv] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, account.tenantId), eq(conversations.waAccountId, account.id), eq(conversations.customerId, customerId)));
  return conv!;
}

/** İnsan modu etkin mi (human_until null = süresiz). */
export function humanModeActive(conv: Pick<ConversationRow, 'mode' | 'humanUntil'>, now: Date): boolean {
  return conv.mode === 'human' && (conv.humanUntil == null || conv.humanUntil > now);
}

/** 24 saat müşteri hizmeti penceresi açık mı (güvenlik payı: pencere sonuna 5 dk kala kapalı sayılır). */
export const WINDOW_MS = 24 * 60 * 60_000;
export const WINDOW_SAFETY_MS = 5 * 60_000;
export function windowOpen(lastInboundAt: Date | null | undefined, now: Date, safetyMs = WINDOW_SAFETY_MS): boolean {
  return !!lastInboundAt && now.getTime() < lastInboundAt.getTime() + WINDOW_MS - safetyMs;
}
