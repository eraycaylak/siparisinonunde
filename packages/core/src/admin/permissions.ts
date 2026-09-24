// Admin rol × aksiyon matrisi (05 §A.3). Tek kaynak: API karar verir, arayüz yalnız gizler.
// PO platform_owner · PA platform_admin · SA support_agent · F finance · SR sales_rep.

import type { PlatformRole } from '../enums';

const ALL: readonly PlatformRole[] = ['platform_owner', 'platform_admin', 'support_agent', 'finance', 'sales_rep'];

export const ADMIN_PERMISSIONS = {
  /** A-02 kontrol paneli (SA/F/SR okuma). */
  'overview:read': ALL,
  /** A-03/A-04 işletme listesi ve detayı (SA/F okuma; SR kısıtlı — Faz 1'de okuma). */
  'tenants:read': ALL,
  /** Yaşam döngüsü (abonelik akışı) geçişleri: aktif, ödeme gecikti, salt-okunur, kayıp… */
  'tenants:lifecycle': ['platform_owner', 'platform_admin', 'finance'],
  /** Pilot atama. */
  'tenants:assign_pilot': ['platform_owner', 'platform_admin', 'finance'],
  /** Deneme uzatma (SR: tek sefer, en fazla 14 gün). */
  'tenants:extend_trial': ALL.filter((r) => r !== 'support_agent'),
  /** Admin askısı. */
  'tenants:suspend': ['platform_owner', 'platform_admin'],
  /** Askıyı kaldırma (F yalnız ödeme kaynaklı askıyı). */
  'tenants:unsuspend': ['platform_owner', 'platform_admin', 'finance'],
  /** Plan ve abonelik değişikliği, kurucu üye indirimi (A-08). */
  'tenants:subscription': ['platform_owner', 'finance'],
  /** Tenant bazında ordering_enabled kill-switch'i (A-13). */
  'tenants:ordering': ['platform_owner', 'platform_admin'],
  /** A-09 salt-okunur impersonation. */
  'impersonation:start': ['platform_owner', 'platform_admin', 'support_agent'],
  /** A-10 not ve etiket ekleme (herkes). */
  'notes:write': ALL,
  /** Başkasının notunu düzenleme/silme. */
  'notes:manage_any': ['platform_owner', 'platform_admin'],
  /** A-06 WhatsApp sağlığı görüntüleme (F yok). */
  'whatsapp:read': ['platform_owner', 'platform_admin', 'support_agent', 'sales_rep'],
  /** A-11 DLQ görüntüleme (SA okuma). */
  'jobs:read': ['platform_owner', 'platform_admin', 'support_agent'],
  /** A-11 yeniden işleme. */
  'jobs:retry': ['platform_owner', 'platform_admin'],
  /** A-13 feature flag / kill-switch. */
  'flags:read': ['platform_owner', 'platform_admin'],
  'flags:write': ['platform_owner', 'platform_admin'],
  /** A-20 lead yönetimi (PA/F okuma). */
  'leads:read': ['platform_owner', 'platform_admin', 'finance', 'sales_rep'],
  'leads:write': ['platform_owner', 'sales_rep'],
  /** A-18 audit log (SA yalnız kendi kayıtları, F yalnız finans kayıtları). */
  'audit:read': ['platform_owner', 'platform_admin', 'support_agent', 'finance'],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

/** Rolü null olan platform kullanıcısı hiçbir kısıtlı izne sahip değildir; platform_owner her şeye. */
export function adminCan(role: PlatformRole | null | undefined, permission: AdminPermission): boolean {
  if (!role) return false;
  if (role === 'platform_owner') return true;
  return (ADMIN_PERMISSIONS[permission] as readonly PlatformRole[]).includes(role);
}

/** SR deneme uzatma üst sınırı (05 §A.3: tek sefer, en fazla 14 gün). */
export const SALES_REP_MAX_TRIAL_EXTENSION_DAYS = 14;
