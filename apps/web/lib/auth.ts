// Kimlik: 14 §6.1 (/api/v1/auth/*). Oturum HttpOnly "sid" çerezindedir; istemci yalnız /auth/me okur.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  MembershipDto,
  SignupRequest,
  SignupResponse,
  TenantDto,
  UserDto,
} from '@siparis/core/contracts/auth';
import type { TenantRole } from '@siparis/core/enums';
import { ApiError, apiFetch, isApiError } from './api';

// Tipler API sözleşmesinden (packages/core/src/contracts/auth.ts).
export type Me = MeResponse;
export type AuthUser = UserDto;
export type Membership = MembershipDto;
export type MeTenant = TenantDto;
export type { LoginResponse, SignupResponse };

export type LoginInput = LoginRequest & {
  /** Platform yöneticisi için TOTP (API "totp_required" döndürürse gönderilir). */
  totp?: string;
};

export type SignupInput = SignupRequest;

export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** GET /auth/me; oturum yoksa (401) null döner. */
export async function fetchMe(signal?: AbortSignal): Promise<Me | null> {
  try {
    const me = await apiFetch<Me>('/auth/me', { signal });
    return {
      ...me,
      tenant: me.tenant ?? null,
      role: me.role ?? null,
      branchId: me.branchId ?? null,
      memberships: me.memberships ?? [],
      readOnly: Boolean(me.readOnly),
      impersonating: me.impersonating ?? null,
    };
  } catch (err) {
    if (isApiError(err) && err.status === 401) return null;
    throw err;
  }
}

export function login(input: LoginInput): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: input });
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST', body: {} });
}

export function signup(input: SignupInput): Promise<SignupResponse> {
  return apiFetch<SignupResponse>('/auth/signup', { method: 'POST', body: input });
}

export function switchTenant(tenantId: string): Promise<unknown> {
  return apiFetch('/auth/switch-tenant', { method: 'POST', body: { tenantId } });
}

export function courierExchange(token: string): Promise<unknown> {
  return apiFetch('/auth/courier/exchange', { method: 'POST', body: { token } });
}

/** Oturum bilgisi. data: Me | null (null = giriş yok). Ağ hatasında error dolar, yönlendirme yapılmaz. */
export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery<Me | null, ApiError>({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    enabled: options.enabled ?? true,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation<LoginResponse, ApiError, LoginInput>({
    mutationFn: login,
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] });
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation<SignupResponse, ApiError, SignupInput>({
    mutationFn: signup,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

/**
 * Çıkış: oturumu kapatır ve sayfayı tamamen yeniden yükleyerek giriş sayfasına gider
 * (önbellekteki işletme verisi de silinmiş olur). Hata olursa yönlendirmez.
 */
export function useLogout(redirectTo = '/panel/giris') {
  return useMutation<void, ApiError, void>({
    mutationFn: () => logout(),
    onSuccess: () => {
      window.location.replace(redirectTo);
    },
  });
}

export function useSwitchTenant() {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: switchTenant,
    onSuccess: async () => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] });
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

export function useCourierExchange() {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: courierExchange,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Yardımcılar

/** Seçili işletmedeki rol. */
export function currentRole(me: Me | null | undefined): TenantRole | null {
  if (!me) return null;
  if (me.role) return me.role;
  const tenantId = me.tenant?.id;
  const m = tenantId ? me.memberships.find((x) => x.tenantId === tenantId) : me.memberships[0];
  return m?.role ?? null;
}

export function hasRole(me: Me | null | undefined, roles: readonly TenantRole[]): boolean {
  const role = currentRole(me);
  return role !== null && roles.includes(role);
}

/** Canlı akış için şube kimliği: me.branchId → üyelik şubesi → işletmenin varsayılan şubesi. Yoksa null. */
export function currentBranchId(me: Me | null | undefined): string | null {
  if (!me) return null;
  if (me.branchId) return me.branchId;
  const tenantId = me.tenant?.id;
  const m = me.memberships.find((x) => x.tenantId === tenantId);
  if (m?.branchId) return m.branchId;
  return me.tenant?.defaultBranchId ?? null;
}

/** Açık yönlendirmeye karşı: yalnız "/" ile başlayan, "//" ile başlamayan yollar. */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

/** Girişten sonra varsayılan hedef. */
export function homePathFor(me: Pick<Me, 'isPlatformAdmin' | 'memberships'> & Partial<Pick<Me, 'role' | 'tenant'>>): string {
  const role = me.role ?? me.memberships[0]?.role ?? null;
  if (role === 'courier') return '/kurye';
  if (role) return '/panel';
  if (me.isPlatformAdmin) return '/admin';
  return '/panel';
}
