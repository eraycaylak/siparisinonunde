// Canlı ortam önyüklemesi (00 §12a madde 10): üretim veritabanı boş başlar; demo seed ÇALIŞMAZ. Dağıtım iş akışı her
// seferinde yalnız bayrakları üretim varsayılanlarıyla "garanti eder" (scripts/bootstrap-production.ts) ve ilk platform
// yöneticisini create-admin.ts --if-missing ile açar. Aynı bayrak kuralları SEED_MODE=admin'de de kullanılır
// (Cloudflare ortamı, VPS hazır olana kadar; seed.ts seedAdminOnly).
//
// Kural: eksik bayrak üretim varsayılanıyla eklenir; var olan bayrağa dokunulmaz (platform yöneticisinin
// /admin/bayraklar kararı dağıtımla geri alınmaz). Tek istisna sms_fallback: hiç elle değiştirilmediyse
// (updated_by_user_id boş) SMS sağlayıcısının yapılandırmasını izler — Netgsm sonradan tanımlanınca açılır, kaldırılınca
// kapanır.

import { KILL_SWITCHES, type KillSwitch } from '@siparis/core';
import { count, eq } from 'drizzle-orm';
import type { Database } from './client';
import { featureFlags, tenants } from './schema/index';

/** Bilinen bayrakların açıklamaları (admin > Bayraklar). */
export const FLAG_DESCRIPTIONS: Record<string, string> = {
  signup_open: 'Yeni işletme kaydı',
  wa_onboarding: 'WhatsApp bağlama akışı',
  campaigns_global: 'Kampanya modülü (Faz 2)',
  llm_parsing: 'Yapay zeka ile serbest metin siparişi (Faz 2)',
  sms_fallback: 'SMS yedeği (OTP ve kritik durum SMS)',
  platform_wa_alerts: 'Platform WhatsApp uyarı şablonları',
};

export type ProductionFlagKey = KillSwitch | 'platform_wa_alerts';

export interface ProductionFlagOptions {
  /** Netgsm tanımlı mı (SMS_PROVIDER=netgsm ve NETGSM_USERCODE/PASSWORD/HEADER dolu); sms_fallback bunu izler */
  smsConfigured: boolean;
  /**
   * Yeni işletme kaydı açık mı başlasın. Türkiye VPS'inde true (varsayılan). Cloudflare ortamında (veriler Türkiye
   * dışında) false: SEED_MODE=admin + DEPLOY_ENV=dev.
   */
  signupOpen?: boolean;
}

/** Üretim varsayılanları (00 §12a madde 10). */
export function productionFlagDefaults(opts: ProductionFlagOptions): Record<ProductionFlagKey, boolean> {
  return {
    signup_open: opts.signupOpen ?? true,
    wa_onboarding: true,
    campaigns_global: false,
    llm_parsing: false,
    sms_fallback: opts.smsConfigured,
    platform_wa_alerts: true,
  };
}

/** Ortamdan SMS yapılandırması: Netgsm seçili ve üç değer dolu (apps/api/src/config.ts productionConfigErrors ile aynı). */
export function isSmsConfigured(env: Record<string, string | undefined>): boolean {
  const filled = (k: string) => Boolean(env[k]?.trim());
  return env.SMS_PROVIDER?.trim() === 'netgsm' && filled('NETGSM_USERCODE') && filled('NETGSM_PASSWORD') && filled('NETGSM_HEADER');
}

export interface FlagOutcome {
  key: ProductionFlagKey;
  enabled: boolean;
  /** created: yeni eklendi · updated: sms_fallback SMS yapılandırmasını izledi · kept: dokunulmadı */
  action: 'created' | 'updated' | 'kept';
}

/** Bayrakları üretim varsayılanlarıyla garanti eder (idempotent; açıklama yukarıda). */
export async function ensureProductionFlags(db: Database, opts: ProductionFlagOptions): Promise<FlagOutcome[]> {
  const defaults = productionFlagDefaults(opts);
  const keys: ProductionFlagKey[] = [...KILL_SWITCHES, 'platform_wa_alerts'];
  const out: FlagOutcome[] = [];
  for (const key of keys) {
    const kind = key === 'platform_wa_alerts' ? 'ops' : 'kill_switch';
    const inserted = await db
      .insert(featureFlags)
      .values({ key, enabled: defaults[key], kind, description: FLAG_DESCRIPTIONS[key] ?? null })
      .onConflictDoNothing()
      .returning({ key: featureFlags.key });
    if (inserted.length) {
      out.push({ key, enabled: defaults[key], action: 'created' });
      continue;
    }
    const [row] = await db
      .select({ enabled: featureFlags.enabled, updatedBy: featureFlags.updatedByUserId })
      .from(featureFlags)
      .where(eq(featureFlags.key, key));
    if (key === 'sms_fallback' && row && row.updatedBy === null && row.enabled !== defaults.sms_fallback) {
      await db.update(featureFlags).set({ enabled: defaults.sms_fallback }).where(eq(featureFlags.key, key));
      out.push({ key, enabled: defaults.sms_fallback, action: 'updated' });
      continue;
    }
    out.push({ key, enabled: row?.enabled ?? defaults[key], action: 'kept' });
  }
  return out;
}

/** Demo işletme sayısı (is_demo). Üretimde 0 olmalı; önyükleme betiği uyarır. */
export async function countDemoTenants(db: Database): Promise<number> {
  const [row] = await db.select({ n: count() }).from(tenants).where(eq(tenants.isDemo, true));
  return Number(row?.n ?? 0);
}
