// Kademeli alarm zinciri (00 §10, 04 §4.5) — zamanlama ve politika normalizasyonu.

import { ALARM_STEP } from '@siparis/core/orders/contracts';
import { DEFAULT_ALARM_POLICY, type AlarmPolicy } from '@siparis/db';

export interface NormalizedAlarmPolicy {
  autoCancelMinutes: number;
  customerNoticeMinutes: number;
  platformWaEnabled: boolean;
  smsEnabled: boolean;
}

/** Otomatik iptal 10–30 dk; müşteri bilgisi en geç iptalden 5 dk önce (00 §10). */
export function normalizeAlarmPolicy(raw: Partial<AlarmPolicy> | null | undefined): NormalizedAlarmPolicy {
  const p = { ...DEFAULT_ALARM_POLICY, ...(raw ?? {}) };
  const auto = Math.min(30, Math.max(10, Math.round(Number(p.auto_cancel_minutes) || 15)));
  let notice = Math.round(Number(p.customer_notice_minutes) || 10);
  notice = Math.max(1, Math.min(notice, auto - 5));
  return {
    autoCancelMinutes: auto,
    customerNoticeMinutes: notice,
    platformWaEnabled: p.platform_wa_enabled !== false,
    smsEnabled: p.sms_enabled !== false,
  };
}

export { ALARM_STEP };
export type AlarmStep = Exclude<(typeof ALARM_STEP)[keyof typeof ALARM_STEP], 1>;

export interface PlannedAlarmStep {
  step: AlarmStep;
  delayMs: number;
}

/** test_kind'e göre planlanacak adımlar: onboarding_test kısaltılmış (60 sn + 2 dk), canary dış bildirimsiz. */
export function planAlarmSteps(policy: NormalizedAlarmPolicy, testKind: 'onboarding_test' | 'canary' | null | undefined): PlannedAlarmStep[] {
  const MIN = 60_000;
  const repeat: PlannedAlarmStep = { step: ALARM_STEP.REPEAT, delayMs: MIN };
  if (testKind === 'onboarding_test') {
    return [repeat, { step: ALARM_STEP.PLATFORM_WA, delayMs: 2 * MIN }];
  }
  if (testKind === 'canary') {
    return [repeat, { step: ALARM_STEP.AUTO_CANCEL, delayMs: policy.autoCancelMinutes * MIN }];
  }
  return [
    repeat,
    { step: ALARM_STEP.PLATFORM_WA, delayMs: 2 * MIN },
    { step: ALARM_STEP.SMS, delayMs: 5 * MIN },
    { step: ALARM_STEP.CUSTOMER_NOTICE, delayMs: policy.customerNoticeMinutes * MIN },
    { step: ALARM_STEP.AUTO_CANCEL, delayMs: policy.autoCancelMinutes * MIN },
  ];
}

export const alarmDedupeKey = (orderId: string, step: number) => `alarm:${orderId}:${step}`;
export const finalizeRejectionKey = (orderId: string) => `finalize_rejection:${orderId}`;
export const awaitingTimeoutKey = (orderId: string) => `awaiting_timeout:${orderId}`;
