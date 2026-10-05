import { describe, expect, it } from 'vitest';
import {
  ORDERING_BLOCKED_STAGES,
  TRIAL_GRACE_DAYS,
  canTransitionLifecycle,
  isOrderingBlockedStage,
  trialDeadline,
  trialEnforcementTarget,
} from '../src/admin/lifecycle';
import { LIFECYCLE_STAGES, type LifecycleStage } from '../src/enums';

// 00 §9: online sipariş yalnız salt-okunur / askı / kapanış aşamalarında durur
const BLOCKED: LifecycleStage[] = ['read_only', 'suspended', 'churned'];
const DAY = 86_400_000;

describe('sipariş alma kapısı (00 §9)', () => {
  it('kapalı aşama listesi kararlar dosyasıyla birebir', () => {
    expect([...ORDERING_BLOCKED_STAGES].sort()).toEqual([...BLOCKED].sort());
  });

  it('her aşama için tek karar: yalnız read_only/suspended/churned sipariş almaz', () => {
    for (const stage of LIFECYCLE_STAGES) {
      expect(isOrderingBlockedStage(stage), stage).toBe(BLOCKED.includes(stage));
    }
  });

  it('deneme ve pilot aşaması sipariş alır (ücretsiz dönem kapanmaz)', () => {
    expect(isOrderingBlockedStage('trial')).toBe(false);
    expect(isOrderingBlockedStage('pilot')).toBe(false);
    // Dunning G..G+10: ödeme gecikse de sipariş sürer (00 §9)
    expect(isOrderingBlockedStage('past_due')).toBe(false);
  });
});

describe('deneme bitişi (00 §9, 05 §A.2.1)', () => {
  const base = {
    lifecycleStage: 'trial' as LifecycleStage,
    subscriptionStatus: 'trialing' as const,
    now: new Date('2026-10-05T09:00:00Z'),
  };

  it('trial → read_only geçişi izinli (deneme bitişi uygulanabilsin)', () => {
    expect(canTransitionLifecycle('trial', 'read_only')).toBe(true);
    // Ödeme alınınca geri dönüş de izinli olmalı
    expect(canTransitionLifecycle('read_only', 'active')).toBe(true);
    // Deneme elle uzatılabilsin: tek çıkış `active` olursa ödeme almadan "ödedi" sayılır (MRR)
    expect(canTransitionLifecycle('read_only', 'trial')).toBe(true);
  });

  it('uyarı bandı (3 gün) dolmadan aşama düşmez', () => {
    expect(TRIAL_GRACE_DAYS).toBe(3);
    // Deneme dün bitti: bant sürüyor
    expect(trialEnforcementTarget({ ...base, trialEndsAt: new Date(base.now.getTime() - DAY) })).toBeNull();
    // Tam sınırda (bitiş + 3 gün): bant doldu
    expect(trialEnforcementTarget({ ...base, trialEndsAt: new Date(base.now.getTime() - 3 * DAY) })).toBe('read_only');
  });

  it('bant dolduğunda ve plan seçilmediğinde read_only', () => {
    expect(trialEnforcementTarget({ ...base, trialEndsAt: new Date(base.now.getTime() - 10 * DAY) })).toBe('read_only');
    // Abonelik satırı hiç yoksa da uygulanır
    expect(trialEnforcementTarget({ ...base, subscriptionStatus: null, trialEndsAt: new Date(base.now.getTime() - 10 * DAY) })).toBe('read_only');
  });

  it('ücretli plana geçmiş işletmeye dokunulmaz', () => {
    expect(trialEnforcementTarget({ ...base, subscriptionStatus: 'active', trialEndsAt: new Date(base.now.getTime() - 10 * DAY) })).toBeNull();
  });

  it('deneme dışındaki aşamalar bu işin konusu değil', () => {
    const trialEndsAt = new Date(base.now.getTime() - 10 * DAY);
    for (const stage of LIFECYCLE_STAGES.filter((s) => s !== 'trial')) {
      expect(trialEnforcementTarget({ ...base, lifecycleStage: stage, trialEndsAt }), stage).toBeNull();
    }
  });

  it('trial_ends_at boşsa karar verilmez (sessizce sipariş kapatılmaz)', () => {
    expect(trialEnforcementTarget({ ...base, trialEndsAt: null })).toBeNull();
  });

  it('uyarı bandı çağrı başına değiştirilebilir', () => {
    const trialEndsAt = new Date(base.now.getTime() - 5 * DAY);
    expect(trialEnforcementTarget({ ...base, trialEndsAt, graceDays: 7 })).toBeNull();
    expect(trialEnforcementTarget({ ...base, trialEndsAt, graceDays: 0 })).toBe('read_only');
    expect(trialDeadline(new Date('2026-10-01T00:00:00Z')).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(trialDeadline(new Date('2026-10-01T00:00:00Z'), 0).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
