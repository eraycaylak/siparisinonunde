// Ortak WhatsApp numarası (00 §12a madde 8): işletme modları, 'shared' hesap satırı, dükkan kodu, seçilebilir dükkanlar.
// Mimari: ortak numara modundaki her işletmenin varsayılan şubesinde provider='shared' bir wa_accounts satırı vardır
// (kimlik bilgisi yok, status 'connected', display_phone = platform numarası). Konuşma, mesaj, müşteri ve giden iş hattı
// bu satır üzerinden işletme başına aynen çalışır (tenant yalıtımı korunur); gönderim platform sağlayıcısıyla yapılır
// (wa/registry.ts providerForAccount). Tek gerçek: çalışma anında satırın provider'ı; tenants.wa_mode yöneticinin
// seçtiği mod — applyWaMode ikisini birlikte değiştirir.

import {
  formatPhone,
  pickWaCode,
  sharedPrefillText,
  sharedWaLink,
  toWaMeDigits,
  type WaMode,
} from '@siparis/core';
import { branches, tenants, waAccounts, type Database } from '@siparis/db';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { platformDisplayPhone, type Config } from '../../config';
import { randomToken } from '../../lib/tokens';
import type { WaAccountRow } from '../../wa/registry';

type TenantRow = typeof tenants.$inferSelect;

/** Ortak numara listesinde görünmeyen (sipariş almayan) yaşam döngüsü aşamaları. */
const NOT_SELECTABLE_STAGES = ['suspended', 'read_only', 'churned'] as const;


/** İşletmenin varsayılan şubesi (Faz 1: tek şube). */
async function defaultBranchOf(db: Database, tenantId: string) {
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.tenantId, tenantId))
    .orderBy(desc(branches.isDefault), asc(branches.createdAt))
    .limit(1);
  return b ?? null;
}

/** İşletmenin (varsayılan şube) WhatsApp hesap satırı. */
export async function tenantWaAccount(db: Database, tenantId: string): Promise<WaAccountRow | null> {
  const branch = await defaultBranchOf(db, tenantId);
  if (!branch) return null;
  const [acc] = await db.select().from(waAccounts).where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.branchId, branch.id)));
  return acc ?? null;
}

/**
 * Ortak numara modundaki işletmenin 'shared' satırını garanti eder (yoksa açar, gösterim numarasını günceller).
 * Kendi numara modundaki işletmede dokunmaz (null). Kayıt, admin mod değişimi, seed ve yönlendirici kullanır.
 */
export async function ensureSharedWaAccount(tx: Database, config: Config, tenantId: string): Promise<WaAccountRow | null> {
  const [t] = await tx.select({ waMode: tenants.waMode }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t || t.waMode !== 'shared') return null;
  const branch = await defaultBranchOf(tx, tenantId);
  if (!branch) return null;
  const display = platformDisplayPhone(config);
  const [existing] = await tx.select().from(waAccounts).where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.branchId, branch.id)));
  if (existing?.provider === 'shared') {
    if (existing.displayPhone === display && existing.status === 'connected') return existing;
    const [u] = await tx
      .update(waAccounts)
      .set({ displayPhone: display, status: 'connected', lastError: null, updatedAt: new Date() })
      .where(eq(waAccounts.id, existing.id))
      .returning();
    return u!;
  }
  if (existing) {
    // Kendi numarası satırı ortak numaraya çevrilir (sohbet geçmişi aynı satırda kalır; anahtar ve numara kimliği silinir)
    const [u] = await tx
      .update(waAccounts)
      .set({
        provider: 'shared',
        displayPhone: display,
        phoneNumberId: null,
        wabaId: null,
        apiKeyEnc: null,
        webhookToken: randomToken(24),
        status: 'connected',
        lastError: null,
        version: sql`${waAccounts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(waAccounts.id, existing.id))
      .returning();
    return u!;
  }
  const [created] = await tx
    .insert(waAccounts)
    .values({ tenantId, branchId: branch.id, provider: 'shared', displayPhone: display, webhookToken: randomToken(24), status: 'connected' })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx.select().from(waAccounts).where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.branchId, branch.id)));
  return again ?? null;
}

/**
 * WhatsApp modunu değiştirir (admin). shared: satır ortak numaraya çevrilir/açılır. own: ortak numara satırı
 * 'disconnected' olur (işletme sahibi panelden kendi numarasını bağlar); kendi hesabı zaten varsa dokunulmaz.
 */
export async function applyWaMode(tx: Database, config: Config, tenantId: string, mode: WaMode): Promise<void> {
  await tx.update(tenants).set({ waMode: mode, version: sql`${tenants.version} + 1` }).where(eq(tenants.id, tenantId));
  if (mode === 'shared') {
    await ensureSharedWaAccount(tx, config, tenantId);
    return;
  }
  await tx
    .update(waAccounts)
    .set({
      provider: config.WA_DEFAULT_PROVIDER,
      displayPhone: null,
      status: 'disconnected',
      webhookToken: randomToken(24),
      lastError: null,
      version: sql`${waAccounts.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.provider, 'shared')));
}

/** Açılışta: ortak numara satırlarının gösterim numarası yapılandırmayla aynı olsun (PLATFORM_WA_DISPLAY_PHONE). */
export async function syncSharedWaAccounts(db: Database, config: Config): Promise<number> {
  const display = platformDisplayPhone(config);
  const rows = await db
    .update(waAccounts)
    .set({ displayPhone: display, updatedAt: new Date() })
    .where(and(eq(waAccounts.provider, 'shared'), sql`${waAccounts.displayPhone} is distinct from ${display}`))
    .returning({ id: waAccounts.id });
  return rows.length;
}

/** Kayıtta dükkan kodu: slug'dan, çakışmada rakam soneki (core pickWaCode; migration 0900 ile aynı kural). */
export async function generateWaCode(db: Database, slugOrName: string): Promise<string> {
  return pickWaCode(slugOrName, async (code) => {
    const [hit] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.waCode, code)).limit(1);
    return Boolean(hit);
  });
}

// ---------------------------------------------------------------------------
// Seçilebilir dükkanlar (dükkan seçici, #KOD, ad eşleşmesi)

export interface SharedShop {
  tenantId: string;
  name: string;
  slug: string;
  code: string | null;
  accountId: string;
  branchId: string;
  neighborhood: string | null;
  district: string;
  city: string;
}

/** Ortak numarada seçilebilir mi: ortak mod + canlı (web_live_at) + sipariş açık + askı/salt-okunur/kapanış değil. */
export function tenantSelectableReason(t: Pick<TenantRow, 'waMode' | 'orderingEnabled' | 'webLiveAt' | 'lifecycleStage' | 'suspensionReason'>): string | null {
  if (t.waMode !== 'shared') return 'İşletme kendi WhatsApp numarasını kullanıyor.';
  if (!t.webLiveAt) return 'Canlıya geçince ortak numaradaki dükkan listesinde görünürsünüz.';
  if (!t.orderingEnabled) return 'Online sipariş kapalı olduğu için dükkan listesinde görünmüyorsunuz.';
  if (t.suspensionReason || (NOT_SELECTABLE_STAGES as readonly string[]).includes(t.lifecycleStage)) {
    return 'Hesap askıda ya da salt-okunur olduğu için dükkan listesinde görünmüyorsunuz.';
  }
  return null;
}

/** Seçilebilir dükkanlar (ad sırasıyla, Türkçe). `tenantIds` verilirse yalnız onlar. */
export async function selectableSharedShops(db: Database, opts: { tenantIds?: string[] } = {}): Promise<SharedShop[]> {
  if (opts.tenantIds && !opts.tenantIds.length) return [];
  const rows = await db
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      code: tenants.waCode,
      accountId: waAccounts.id,
      branchId: waAccounts.branchId,
      neighborhood: branches.neighborhood,
      district: branches.district,
      city: branches.city,
    })
    .from(tenants)
    .innerJoin(waAccounts, and(eq(waAccounts.tenantId, tenants.id), eq(waAccounts.provider, 'shared'), eq(waAccounts.status, 'connected')))
    .innerJoin(branches, eq(branches.id, waAccounts.branchId))
    .where(
      and(
        eq(tenants.waMode, 'shared'),
        eq(tenants.orderingEnabled, true),
        isNotNull(tenants.webLiveAt),
        isNull(tenants.suspensionReason),
        notInArray(tenants.lifecycleStage, [...NOT_SELECTABLE_STAGES]),
        opts.tenantIds ? inArray(tenants.id, opts.tenantIds) : undefined,
      ),
    );
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Kodla işletme (her modda; kod yoksa null). */
export async function tenantByWaCode(db: Database, code: string): Promise<TenantRow | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.waCode, code)).limit(1);
  return t ?? null;
}

/** İşletmenin bağlı ortak numara satırı (yönlendirme hedefi); yoksa null. */
export async function sharedAccountOf(db: Database, tenantId: string): Promise<WaAccountRow | null> {
  const [acc] = await db
    .select()
    .from(waAccounts)
    .where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.provider, 'shared'), ne(waAccounts.status, 'disconnected')))
    .orderBy(asc(waAccounts.createdAt))
    .limit(1);
  return acc ?? null;
}

// ---------------------------------------------------------------------------
// QR / bağlantı

export interface SharedLinkInfo {
  code: string | null;
  displayPhone: string | null;
  displayPhoneFormatted: string | null;
  prefillText: string | null;
  waLink: string | null;
}

/** Ortak numara bağlantısı (QR içeriği): kod ya da numara yoksa alanlar null. */
export function sharedLinkInfo(config: Config, t: Pick<TenantRow, 'name' | 'waCode'>): SharedLinkInfo {
  const phone = platformDisplayPhone(config);
  const code = t.waCode ?? null;
  return {
    code,
    displayPhone: phone,
    displayPhoneFormatted: phone ? formatPhone(phone) : null,
    prefillText: code ? sharedPrefillText(t.name, code) : null,
    waLink: code && phone ? sharedWaLink(phone, t.name, code) : null,
  };
}

/** "WhatsApp'tan yaz" bağlantısı: ortak numarada kodlu ön-dolu metin, kendi numarada yalın wa.me. */
export function whatsappLinkFor(acc: Pick<WaAccountRow, 'provider' | 'displayPhone'>, t: Pick<TenantRow, 'name' | 'waCode'>): string | null {
  if (!acc.displayPhone) return null;
  if (acc.provider === 'shared') return t.waCode ? sharedWaLink(acc.displayPhone, t.name, t.waCode) : `https://wa.me/${toWaMeDigits(acc.displayPhone)}`;
  return `https://wa.me/${toWaMeDigits(acc.displayPhone)}`;
}
