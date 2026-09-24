'use client';

// Dilim 4 ayar uç noktaları için React Query kancaları (14 §6.3 Ayarlar/Personel).

import { useQueryClient } from '@tanstack/react-query';
import type {
  BranchPatch,
  BranchSettings,
  BranchState,
  OnboardingStatus,
  StaffDto,
  TenantPatch,
  TenantSettings,
  ZoneDto,
} from '@siparis/core/settings/contracts';
import { apiFetch, useApiMutation, useApiQuery } from '@/lib/api';
import { currentBranchId, ME_QUERY_KEY, useMe } from '@/lib/auth';

export const SETTINGS_KEYS = {
  tenant: ['panel', 'tenant'] as const,
  branch: (id: string | null) => ['panel', 'branch', id] as const,
  zones: (id: string | null) => ['panel', 'zones', id] as const,
  staff: ['panel', 'staff'] as const,
  couriers: ['panel', 'couriers'] as const,
  onboarding: ['panel', 'onboarding'] as const,
};

/** Oturumdaki şube (me.branchId → üyelik → varsayılan). */
export function useBranchId(): string | null {
  const me = useMe();
  return currentBranchId(me.data);
}

export function useTenantSettings() {
  return useApiQuery<TenantSettings>(SETTINGS_KEYS.tenant, '/panel/tenant');
}

export function useUpdateTenant() {
  return useApiMutation<TenantPatch, TenantSettings>('/panel/tenant', {
    method: 'PATCH',
    invalidate: [SETTINGS_KEYS.tenant, ME_QUERY_KEY, SETTINGS_KEYS.onboarding],
  });
}

export function useBranchSettings(branchId: string | null) {
  return useApiQuery<BranchSettings>(SETTINGS_KEYS.branch(branchId), branchId ? `/panel/branches/${branchId}` : null);
}

export function useUpdateBranch(branchId: string | null) {
  const qc = useQueryClient();
  return useApiMutation<BranchPatch, BranchSettings>(`/panel/branches/${branchId}`, {
    method: 'PATCH',
    invalidate: [SETTINGS_KEYS.onboarding],
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEYS.branch(branchId), data);
    },
  });
}

export function useZones(branchId: string | null) {
  return useApiQuery<{ items: ZoneDto[] }>(SETTINGS_KEYS.zones(branchId), branchId ? '/panel/zones' : null, {
    query: { branchId: branchId ?? undefined },
  });
}

export function useStaff() {
  return useApiQuery<{ items: StaffDto[] }>(SETTINGS_KEYS.staff, '/panel/staff');
}

export function useOnboarding(enabled = true) {
  return useApiQuery<OnboardingStatus>(SETTINGS_KEYS.onboarding, enabled ? '/panel/onboarding' : null);
}

/** Duraklat / yoğun hızlı aksiyonları (04 §4.10). */
export async function pauseBranch(branchId: string, minutes: number | 'until_close' | 'end_of_day' | null): Promise<BranchState> {
  return apiFetch<BranchState>(`/panel/branches/${branchId}/pause`, { method: 'POST', body: { minutes } });
}

export async function setBranchBusy(branchId: string, extraMinutes: number): Promise<BranchState> {
  return apiFetch<BranchState>(`/panel/branches/${branchId}/busy`, { method: 'POST', body: { extraMinutes } });
}
