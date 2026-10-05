// Panel yazma kapıları.
//
// 1) Menü rotalarının rol yardımcıları (04 §2.3–2.4): owner/manager menüyü düzenler; cashier/kitchen yalnız okur
//    ve "tükendi" aç/kapar.
// 2) `tenantWritable` — işletme aboneliğinin YAZMA kapısı (00 §9, 05 §A.2.1, 08 §6.3). `read_only` (deneme bitti
//    ya da dunning G+10), `suspended` ve `churned` aşamalarında panel OKUNUR kalır, yazma kapanır: menü ve fiyat
//    düzenleme, ayarlar, teslimat bölgesi, personel ekleme/düzenleme ve telefon siparişi kaydı. Operasyonel
//    aksiyonlar ("tükendi", duraklat/yoğun, kurye oturumu) açık kalır — hâlihazırda alınmış siparişler
//    tamamlanabilsin.
//    Kapı ada bağlı DEĞİLDİR (denetim 04.10.2026 (C)): `tenantMenuWritable` yalnız menüye takılıydı, dokümanın
//    kapalı dediği ayar ve personel uçları açık kalmıştı. Aşama listesi tek kaynaktan gelir
//    (`@siparis/core/admin/lifecycle` → `isOrderingBlockedStage`, 00 §9).

import type { TenantRole } from '@siparis/core';
import { isOrderingBlockedStage } from '@siparis/core/admin/lifecycle';
import { tenants, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../../lib/errors';
import { requireTenantRole, tenantAuth } from '../../plugins/auth';

export const MENU_EDIT_ROLES: readonly TenantRole[] = ['owner', 'manager'];
export const MENU_READ_ROLES: readonly TenantRole[] = ['owner', 'manager', 'cashier', 'kitchen'];

/** Salt-okunur abonelikte 403 gövdesinin varsayılan Türkçe mesajı. */
export const TENANT_READ_ONLY_MESSAGE = 'Aboneliğiniz şu an salt-okunur durumda; değişiklik yapılamaz. Ödeme alındığında yeniden açılır.';

/**
 * İşletme aboneliği yazmaya kapalıysa 403 `tenant_read_only`. `message` ile uca özgü cümle verilir
 * (menü / ayar / personel / telefon siparişi); kod hep aynı kalır, panel tek yerde karşılar.
 *
 * Tenant satırı okunamazsa kapı AÇILIR: `requireTenantRole` zaten geçerli bir üyelik görmüştür, yani satırın
 * yokluğu pratikte imkânsızdır (üyelik tenant'la birlikte silinir ve oturum `tenant_required` ile düşer);
 * burada 403 atmak yalnız ulaşılamaz bir dal eklerdi.
 */
export function tenantWritable(db: Database, message: string = TENANT_READ_ONLY_MESSAGE): preHandlerAsyncHookHandler {
  return async function tenantWritableHook(request: FastifyRequest, _reply: FastifyReply) {
    const auth = tenantAuth(request);
    const [t] = await db.select({ stage: tenants.lifecycleStage }).from(tenants).where(eq(tenants.id, auth.tenantId));
    if (t && isOrderingBlockedStage(t.stage)) throw new AppError(403, 'tenant_read_only', message);
  };
}

/** Menü düzenleme: owner/manager + yazılabilir oturum + yazılabilir abonelik. */
export function menuEditGuard(db: Database): preHandlerAsyncHookHandler[] {
  return [
    requireTenantRole(MENU_EDIT_ROLES),
    tenantWritable(db, 'Aboneliğiniz şu an salt-okunur durumda; menü düzenlenemez. Ödeme alındığında düzenleme yeniden açılır.'),
  ];
}
