// QR kısa bağlantısı (00 §2, §12a madde 11; O4): yemekgelsin.net/q/<kod> → işletmenin vitrini. Kod = tenants.wa_code
// (büyük/küçük harf duyarsız, Türkçe harfler katlanır: normalizeWaCode). Bilinmeyen kod null; yanıt YALNIZ slug'dır
// (işletme adı, telefonu, kimliği, modu ya da başka bir işletme bilgisi dönmez). İşletmenin WhatsApp modu ve yaşam
// döngüsü aşaması bakılmaz: sipariş almayan (askıda, salt-okunur, kapanmış, canlıya geçmemiş) işletme de vitrine
// gider, vitrin bandı durumu gösterir (00 §9 "/q/<kod> yönlendirmesi kapı değildir").
//
// Emekli kod (`retired_wa_codes`; 00 §3 "Emekli QR kodu"): platform yöneticisi kodu değiştirdiyse eski kod ESKİ
// SAHİBİNE çözülür. Kod başka işletmeye verilemediği için sahadaki eski QR hiçbir zaman başka bir vitrine gitmez.

import { normalizeWaCode } from '@siparis/core';
import { tenants, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { waCodeOwner } from '../messaging/shared';

export async function findSlugByQrCode(db: Database, raw: string): Promise<string | null> {
  const code = normalizeWaCode(raw);
  if (!code) return null;
  const owner = await waCodeOwner(db, code);
  if (!owner) return null;
  const [t] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, owner.tenantId)).limit(1);
  return t?.slug ?? null;
}
