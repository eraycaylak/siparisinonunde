// Akış B doğrulama kanalları (03 §3.2, §3.2.1): WhatsApp kodu (wa_accounts 'connected') ya da SMS OTP
// ("WhatsApp'sız mod": platform sms_fallback + tenants.sms_fallback_enabled).

import { orderCodePrefillText, toWaMeDigits } from '@siparis/core';
import { orderVerificationCodes, waAccounts, type Database } from '@siparis/db';
import { and, desc, eq } from 'drizzle-orm';
import { channelDelivers, type Config } from '../../config';
import { isFlagEnabled } from '../../lib/flags';
import { generateOrderCode } from '../../lib/tokens';
import { whatsappLinkFor } from '../messaging/shared';
import type { TenantRow } from './store-context';

/** Kodun geçerlilik süresi (00 §5: awaiting_customer 30 dk). */
export const VERIFICATION_CODE_TTL_MS = 30 * 60 * 1000;

export interface VerificationChannels {
  /** İşletmenin WhatsApp hesabı bağlı mı (status 'connected'). */
  waConnected: boolean;
  /** wa.me için işletme numarası (E.164); ortak numarada platform numarası (00 §12a madde 8). */
  waDisplayPhone: string | null;
  /** "WhatsApp'tan yaz" bağlantısı: ortak numarada dükkan kodlu ön-dolu metin, kendi numarada yalın wa.me. */
  waLink: string | null;
  /**
   * SMS OTP yedeği kullanılabilir mi: işletme ayarı + `sms_fallback` bayrağı + **kanalın gerçekten teslim etmesi**.
   * Üçüncü koşul olmadan canlı ortamda `SMS_PROVIDER=mock` iken müşteriye SMS yedeği teklif ediliyor, kod
   * istediğinde "gönderildi" deniyor ama hiçbir SMS gitmiyordu (denetim 2026-10-04 madde 4.4).
   */
  smsAvailable: boolean;
}

/** `smsAvailable` kararını etkileyen yapılandırma alanları (`channelDelivers`). */
export type VerificationConfig = Pick<Config, 'NODE_ENV' | 'DEPLOY_ENV' | 'PLATFORM_WA_PROVIDER' | 'SMS_PROVIDER'>;

/**
 * `config` ZORUNLUDUR (isteğe bağlı bırakılırsa unutulan bir çağrı yeri sessizce eski yalana döner): taklit
 * sağlayıcı canlı ortamda hiçbir SMS göndermediği için `smsAvailable` false olur ve vitrin SMS yedeğini hiç
 * teklif etmez — müşteri "işletmeyi arayın" yolunu görür (03 §3.2.1).
 */
export async function loadVerificationChannels(
  db: Database,
  tenant: TenantRow,
  branchId: string,
  config: VerificationConfig,
): Promise<VerificationChannels> {
  const accounts = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenant.id))
    .orderBy(desc(waAccounts.updatedAt));
  const acc = accounts.find((a) => a.branchId === branchId) ?? accounts[0];
  const waConnected = Boolean(acc && acc.status === 'connected' && acc.displayPhone);
  const smsAvailable = tenant.smsFallbackEnabled && channelDelivers(config, 'sms') && (await isFlagEnabled(db, 'sms_fallback'));
  return {
    waConnected,
    waDisplayPhone: waConnected ? (acc!.displayPhone ?? null) : null,
    waLink: waConnected ? whatsappLinkFor(acc!, tenant) : null,
    smsAvailable,
  };
}

/** https://wa.me/<rakamlar>?text=Sipariş kodu: ABC123 */
export function buildWaLink(displayPhone: string, code: string): string {
  return `https://wa.me/${toWaMeDigits(displayPhone)}?text=${encodeURIComponent(orderCodePrefillText(code))}`;
}

/** 6 karakterlik sipariş kodunu yazar (bekleyen kodlar tüm işletmelerde tekil — ortak numara yönlendiricisi kodu işletme bilmeden bulur; çakışmada yeniden üretir). */
export async function createVerificationCode(tx: Database, tenantId: string, orderId: string, now = new Date()): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateOrderCode();
    const rows = await tx
      .insert(orderVerificationCodes)
      .values({ tenantId, orderId, code, expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS) })
      .onConflictDoNothing()
      .returning({ code: orderVerificationCodes.code });
    if (rows.length) return rows[0]!.code;
  }
  throw new Error('Sipariş kodu üretilemedi');
}

export async function findVerificationCode(db: Database, tenantId: string, orderId: string) {
  const [row] = await db
    .select()
    .from(orderVerificationCodes)
    .where(and(eq(orderVerificationCodes.tenantId, tenantId), eq(orderVerificationCodes.orderId, orderId)));
  return row;
}
