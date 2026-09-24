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
  trial: ['active', 'pilot', 'suspended'],
  active: ['past_due', 'suspended', 'churned'],
  past_due: ['active', 'read_only', 'suspended'],
  read_only: ['active', 'suspended'],
  suspended: ['active', 'trial', 'pilot', 'onboarding', 'churned'],
  churned: ['onboarding'],
};

export function canTransitionLifecycle(from: LifecycleStage, to: LifecycleStage): boolean {
  return from === to || LIFECYCLE_TRANSITIONS[from].includes(to);
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
