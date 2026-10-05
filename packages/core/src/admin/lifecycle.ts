// İşletme yaşam döngüsü geçiş kuralları (05 §A.2.1; 00 §7). Admin aksiyonları: deneme uzatma, pilot atama,
// askıya alma, geri açma ve abonelik akışının elle yönetimi (Faz 1 manuel).

import type { LifecycleStage, SubscriptionStatus } from '../enums';
import type { AdminPermission } from './permissions';

/**
 * İzinli geçişler: 05 §A.2.1 durum diyagramı + admin askısı (policy/abuse/legal: canlı her aşamadan)
 * + askıdan geri açma (askıdan önceki aşamalara) + pilot atama (kurulum/deneme → pilot).
 */
export const LIFECYCLE_TRANSITIONS: Record<LifecycleStage, readonly LifecycleStage[]> = {
  lead: ['onboarding'],
  onboarding: ['pilot', 'trial', 'suspended'],
  pilot: ['active', 'suspended'],
  // trial → read_only: deneme bitişi (00 §9; uyarı bandı dolunca online sipariş alma durur)
  trial: ['active', 'pilot', 'read_only', 'suspended'],
  active: ['past_due', 'suspended', 'churned'],
  past_due: ['active', 'read_only', 'suspended'],
  // read_only → trial: deneme bitişi uygulandıktan sonra denemenin elle uzatılması (05 §A.2.1). Bu kenar
  // olmazsa `cron.trial_watch`'ın düşürdüğü işletmenin tek çıkışı `active` olur, yani hiç ödeme almadan
  // "ödedi" sayılır (MRR'a sızar; 05 §MRR). `suspended → trial` ile aynı mantık.
  read_only: ['active', 'trial', 'suspended'],
  suspended: ['active', 'trial', 'pilot', 'onboarding', 'churned'],
  churned: ['onboarding'],
};

export function canTransitionLifecycle(from: LifecycleStage, to: LifecycleStage): boolean {
  return from === to || LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * Sipariş alınmayan aşamalar (00 §9, 05 §A.2.1): `read_only` (deneme bitti ya da dunning G+10),
 * `suspended` (askı), `churned` (kapanış). Bu liste **tek kaynaktır**; `read_only`'de panel ve veriler
 * okunabilir kalır (dışa aktarma, 90 gün dönüş hakkı), yalnız yeni sipariş alınmaz: vitrin "şu an online
 * sipariş alınmıyor, lütfen arayın" moduna geçer.
 *
 * **Listeyi KOPYALAMAYIN** — `isOrderingBlockedStage()` çağırın. Denetim 04.10.2026 (D) bulgusunda liste üç ayrı
 * dosyada elle yazılıydı (`messaging/context.ts`, `messaging/shared.ts`, `panel/menu-guards.ts`); üçü o gün
 * AYNI üç aşamayı içeriyordu, yani kanallar arasında fark henüz oluşmamıştı. Bulgu da zarar değil YOLDU: dört
 * kopyadan biri 00 §9 güncellenirken atlanırsa vitrin düğmeyi gizlerken aynı işletme başka kanaldan sipariş
 * almaya devam eder ve bunu hiçbir test yakalamaz. Tüketiciler (hepsi bu fonksiyonu çağırır): vitrin
 * `services/storefront/load.ts`, sipariş ucu
 * `services/orders/store-context.ts`, WhatsApp kanalı `services/messaging/context.ts`, ortak numara dükkan
 * seçici `services/messaging/shared.ts`, panel yazma kapısı `routes/panel/menu-guards.ts`.
 * Listenin uzunluğu `packages/core/test/lifecycle.test.ts` ile sabitlenmiştir: yeni bir aşama eklenince test
 * kırılır ve kararın 00 §9'a yazılması gerekir.
 */
export const ORDERING_BLOCKED_STAGES: readonly LifecycleStage[] = ['read_only', 'suspended', 'churned'];

/** Aşama sipariş almayı kapatıyor mu (00 §9). Tek kaynak: `ORDERING_BLOCKED_STAGES`. */
export function isOrderingBlockedStage(stage: LifecycleStage): boolean {
  return ORDERING_BLOCKED_STAGES.includes(stage);
}

/** Deneme bitişi uyarı bandı (00 §9, 04 §7.13: "3 gün içinde paket seçmezseniz online sipariş alma durur"). */
export const TRIAL_GRACE_DAYS = 3;

/** Deneme bitişinin fiilen uygulandığı an: `trial_ends_at` + uyarı bandı. */
export function trialDeadline(trialEndsAt: Date, graceDays: number = TRIAL_GRACE_DAYS): Date {
  return new Date(trialEndsAt.getTime() + graceDays * 86_400_000);
}

/** Deneme bitişi kararının girdisi (saf: saat ve veritabanı dışarıda kalır). */
export interface TrialEnforcementInput {
  lifecycleStage: LifecycleStage;
  trialEndsAt: Date | null;
  /** Güncel abonelik durumu (abonelik satırı yoksa null). */
  subscriptionStatus: SubscriptionStatus | null;
  now: Date;
  /** Uyarı bandı (gün); varsayılan TRIAL_GRACE_DAYS. */
  graceDays?: number;
}

/**
 * Denemesi biten işletmenin geçmesi gereken aşama; geçiş gerekmiyorsa `null`. Tablo güdümlü karar (00 §9):
 * yalnız `trial` aşamasındaki, ücretli plana geçmemiş ve `trial_ends_at` + uyarı bandı dolmuş işletme
 * `read_only` olur. Pilot, aktif, askıdaki ve zaten `read_only` işletmeye dokunulmaz; `trial_ends_at` boşsa
 * (deneme bitişi hiç yazılmamışsa) karar verilmez — sessizce sipariş kapatmaktan iyidir.
 */
export function trialEnforcementTarget(input: TrialEnforcementInput): LifecycleStage | null {
  const { lifecycleStage, trialEndsAt, subscriptionStatus, now } = input;
  if (lifecycleStage !== 'trial') return null;
  if (!trialEndsAt) return null;
  // Ücretli plana geçmiş (aşama türetmesi ayrıca düzeltir): deneme bitişi uygulanmaz
  if (subscriptionStatus === 'active') return null;
  if (now < trialDeadline(trialEndsAt, input.graceDays ?? TRIAL_GRACE_DAYS)) return null;
  return 'read_only';
}

/** Abonelik durumu → aşama (05 §A.2.1 eşlemesi). */
export const SUBSCRIPTION_STATUS_TO_STAGE: Record<SubscriptionStatus, LifecycleStage> = {
  trialing: 'trial',
  active: 'active',
  past_due: 'past_due',
  read_only: 'read_only',
  suspended: 'suspended',
  cancelled: 'churned',
};

/** Aşama → abonelik durumu (yalnız abonelikten türeyen aşamalar). */
export const STAGE_TO_SUBSCRIPTION_STATUS: Partial<Record<LifecycleStage, SubscriptionStatus>> = {
  trial: 'trialing',
  active: 'active',
  past_due: 'past_due',
  read_only: 'read_only',
  suspended: 'suspended',
  churned: 'cancelled',
};

/**
 * Abonelik durumundan aşama türetir. Öncelik (05 §A.2.1): churned > suspended > read_only > past_due >
 * onboarding > pilot > trial > active — kurulumu bitmemiş ya da pilot işletme deneme/aktif abonelikte aşamasını korur.
 */
export function deriveLifecycleStage(current: LifecycleStage, status: SubscriptionStatus): LifecycleStage {
  const mapped = SUBSCRIPTION_STATUS_TO_STAGE[status];
  if (mapped === 'trial' || mapped === 'active') {
    if (current === 'onboarding' || current === 'pilot') return current;
  }
  return mapped;
}

/** Geçiş için gereken yetki (05 §A.3). */
export function lifecycleTransitionPermission(from: LifecycleStage, to: LifecycleStage): AdminPermission {
  if (to === 'suspended') return 'tenants:suspend';
  if (from === 'suspended') return 'tenants:unsuspend';
  if (to === 'pilot') return 'tenants:assign_pilot';
  return 'tenants:lifecycle';
}
