// Taslak sözleşme kapısı (denetim B2 · docs/08 §7.5 · FAZ 0.3 kapı tarafı).
//
// NEDEN: müşteriye "Taslak, hukuki inceleme bekliyor" ibareli mesafeli satış sözleşmesi onaylatılıyor ve kabul
// kaydına `…-taslak` sürümü kalıcı yazılıyordu — yani taslak metinle sözleşme kuruluyordu. `scripts/check-legal.ts`
// bunu derleme/CI'da raporluyor ama ÇALIŞMA ZAMANI kapısı yoktu: metin taslak kalsa bile canlı vitrin sipariş
// almaya devam ediyordu.
//
// KURAL (fail-closed): CANLI dağıtımda (NODE_ENV=production + DEPLOY_ENV=production) yasal metin sürümü taslaksa,
// künyenin 6563 m.3 zorunlu alanları eksikse ya da metnin içerik özeti sabitlenmemişse sipariş oluşturma REDDEDİLİR.
// Gizli staging (DEPLOY_ENV=dev, demo verili) ve geliştirme/test ortamı kapsam DIŞIDIR: orada gerçek tüketiciyle
// sözleşme kurulmaz, kapı açılsa demo akışları ve testler kullanılamaz hâle gelirdi.
//
// Gerekçeler (`reasons`) YALNIZ log ve uyarı kanalı içindir; müşteriye `legalOrderingBlocked()` mesajı gösterilir.

import { LEGAL_DOCUMENT_VERSION, isDraftLegalVersion } from '@siparis/core';
import { AppError } from '../../lib/errors';

/**
 * Künyenin eksikse yayına engel olan alanları: `apps/web/lib/site.ts` içindeki `LEGAL_ENTITY_FIELDS`'in
 * `required: true` VE `fallback`'i olmayan alanlarının ortam değişkenleri. (Marka e-postası `LEGAL_SUPPORT_EMAIL`
 * zorunlu ama sabit bir yedeği var, yani hiç boş kalmaz; bu yüzden listede yoktur.)
 * apps/api, apps/web'i içe aktaramaz (ayrı paket); sapmayı `apps/api/test/legal-gate.test.ts` yakalar.
 */
export const REQUIRED_LEGAL_ENTITY_ENVS = [
  'LEGAL_ENTITY_NAME',
  'LEGAL_ENTITY_TYPE',
  'LEGAL_ENTITY_ADDRESS',
  'LEGAL_ENTITY_PHONE',
  'LEGAL_ENTITY_TAX_OFFICE',
  'LEGAL_ENTITY_TAX_NO',
] as const;

/**
 * Metin sürümüyle birlikte dondurulan içerik özeti (08 §7.5). `scripts/check-legal.ts` içindeki
 * `PINNED_TEXT_DIGEST` ile BİREBİR aynı olmalıdır: o betik özeti yasal metin KAYNAKLARINDAN üretip bu değerle
 * karşılaştırır (metin değişip sürüm aynı kalırsa CI kırmızı yanar), buradaki kopya ise aynı özeti çalışma zamanında
 * kabul kaydına yazmak için kullanılır. Sapmayı `apps/api/test/legal-gate.test.ts` yakalar.
 * Sürüm yükseltirken: `node --import tsx scripts/check-legal.ts --ozet` çıktısını İKİ yere de ekleyin.
 */
const LEGAL_TEXT_DIGESTS: Record<string, string> = {
  '2026-09-28-taslak': '0fb5c574496153a3a8855b79a3e1a15c7ac34b062e70c69c7153e05371c2d54f',
};

/** Yürürlükteki sürümün içerik özeti; sabitlenmemişse null (kabul kaydı neyin kabul edildiğini kanıtlayamaz). */
export function legalTextDigest(version: string = LEGAL_DOCUMENT_VERSION): string | null {
  return LEGAL_TEXT_DIGESTS[version] ?? null;
}

/** Künyenin eksik zorunlu alanlarının ortam değişkeni adları. `NEXT_PUBLIC_` öneki de kabul edilir (site.ts ile aynı). */
export function missingLegalEntityEnvs(env: Record<string, string | undefined> = process.env): string[] {
  return REQUIRED_LEGAL_ENTITY_ENVS.filter((name) => !(env[name]?.trim() || env[`NEXT_PUBLIC_${name}`]?.trim()));
}

/** Canlı dağıtım mı: gerçek işletmeler ve gerçek tüketiciler. Gizli staging (`DEPLOY_ENV=dev`) buna dahil DEĞİLDİR. */
export function isLiveDeployment(config: { NODE_ENV: string; DEPLOY_ENV: string }): boolean {
  return config.NODE_ENV === 'production' && config.DEPLOY_ENV === 'production';
}

export interface LegalGateState {
  /** Sipariş oluşturma reddedilecek mi (yalnız canlı dağıtımda true olabilir). */
  blocked: boolean;
  /** Türkçe gerekçeler — log ve uyarı kanalı için; müşteriye GÖSTERİLMEZ. */
  reasons: string[];
  /** Canlı dağıtım mı (kapının uygulanıp uygulanmadığını açıklar). */
  live: boolean;
  version: string;
  textDigest: string | null;
}

/** Kapının durumu: gerekçeler ortamdan bağımsız hesaplanır, uygulanması yalnız canlı dağıtımda olur. */
export function legalOrderingGate(
  config: { NODE_ENV: string; DEPLOY_ENV: string },
  env: Record<string, string | undefined> = process.env,
): LegalGateState {
  const version = LEGAL_DOCUMENT_VERSION;
  const textDigest = legalTextDigest(version);
  const reasons: string[] = [];
  if (isDraftLegalVersion(version)) {
    reasons.push(`Yasal metin sürümü taslak: "${version}" (packages/core/src/enums.ts LEGAL_DOCUMENT_VERSION).`);
  }
  const missing = missingLegalEntityEnvs(env);
  if (missing.length) reasons.push(`Künye eksik (6563 m.3). Tanımlanması gereken ortam değişkenleri: ${missing.join(', ')}.`);
  if (!textDigest) {
    reasons.push(`"${version}" sürümü için yasal metin içerik özeti sabitlenmemiş; kabul kaydı neyin kabul edildiğini kanıtlayamaz.`);
  }
  const live = isLiveDeployment(config);
  return { blocked: live && reasons.length > 0, reasons, live, version, textDigest };
}

/** Müşteriye dönen hata: anlaşılır Türkçe, teknik ayrıntı yok (hangi alanın eksik olduğu sızmaz). */
export function legalOrderingBlocked(): AppError {
  return new AppError(
    503,
    'ordering_unavailable',
    'Şu an sipariş alamıyoruz. Lütfen işletmeyi telefonla arayarak siparişinizi verebilirsiniz.',
  );
}

/** Açılışta log'a ve uyarı kanalına giden tek satır. */
export function legalGateAlertMessage(state: LegalGateState): string {
  return state.blocked
    ? `Sipariş ucu KAPALI: yasal metinler yayına hazır değil (${state.reasons.length} gerekçe). Müşteriler sipariş veremiyor.`
    : `Yasal metinler yayına hazır değil (${state.reasons.length} gerekçe); kapı yalnız canlı dağıtımda uygulanır.`;
}
