// Künyenin (6563 m.3) ortamdan okunuşu — Next'e bağımlılığı yoktur; `getLegalEntity()` (istek anı) ve
// `scripts/check-legal.ts` (dağıtım kapısı) aynı okumayı paylaşır.
//
// GEÇERLİ AD YALNIZ `LEGAL_*`'DIR. `NEXT_PUBLIC_LEGAL_*` bilerek okunmaz:
//   - `NEXT_PUBLIC_` önekli değer `next build` sırasında koda satır içi gömülür (Next rehberi: "Bundling Environment
//     Variables for the Browser"). Derleme ortamında tanımlıysa çalışma zamanındaki değer hiç okunmaz.
//   - API'nin fail-closed sipariş kapısı (`apps/api/src/services/orders/legal-gate.ts`) da yalnız `LEGAL_*`'ı sayar.
//     Böylece "kapı açık" ⇒ künyeyi gösteren her web yüzeyi de değeri görür; biri yedek adı kabul edip öteki
//     etmeseydi sipariş alınırken sayfa "Eksik yapılandırma" basabilirdi.
// Değer `env[ad]` ile, değişken bir anahtarla okunur: derleyici bunu satır içine gömemez.

import type { LegalEntityField } from './site';

/**
 * Künye alanı → ortam değişkeni adı. `apps/web/lib/site.ts` `LEGAL_ENTITY_FIELDS`'in `env` sütunuyla birebir aynıdır
 * (o dosya yasal metin içerik özetine girdiği için eşleme orada dışa açılmadı; sapmayı `legal-entity.test.ts` yakalar).
 */
export const LEGAL_ENTITY_ENV = {
  title: 'LEGAL_ENTITY_NAME',
  type: 'LEGAL_ENTITY_TYPE',
  address: 'LEGAL_ENTITY_ADDRESS',
  email: 'LEGAL_SUPPORT_EMAIL',
  phone: 'LEGAL_ENTITY_PHONE',
  taxOffice: 'LEGAL_ENTITY_TAX_OFFICE',
  taxNo: 'LEGAL_ENTITY_TAX_NO',
  mersis: 'LEGAL_ENTITY_MERSIS',
  chamber: 'LEGAL_ENTITY_CHAMBER',
  kep: 'LEGAL_ENTITY_KEP',
} as const satisfies Record<LegalEntityField, string>;

/** Çağrı anındaki ortamdan ham künye (yalnız `LEGAL_*`). Boşluk kırpma ve eksik denetimi `resolveLegalEntity`'dedir. */
export function readLegalEntityEnv(
  env: Record<string, string | undefined> = process.env,
): Record<LegalEntityField, string | undefined> {
  const raw = {} as Record<LegalEntityField, string | undefined>;
  for (const field of Object.keys(LEGAL_ENTITY_ENV) as LegalEntityField[]) {
    raw[field] = env[LEGAL_ENTITY_ENV[field]];
  }
  return raw;
}
