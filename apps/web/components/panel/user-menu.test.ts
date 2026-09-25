import { describe, expect, it } from 'vitest';
import type { TenantRole } from '@siparis/core/enums';
import type { Me } from '@/lib/auth';
import { PANEL_DEVICE_PUSH_PATH, PANEL_SECURITY_PATH, showsDevicePushLink, showsSecurityLink } from './user-menu';

function meAs(role: TenantRole | null, extra: Partial<Me> = {}): Me {
  return {
    user: { id: 'u1', name: 'Elif', email: null, phone: null, isPlatformAdmin: false, platformRole: null },
    tenant: role
      ? {
          id: 't1',
          name: 'Bozok Pide Salonu',
          slug: 'bozok-pide',
          lifecycleStage: 'pilot',
          planCode: 'pro',
          trialEndsAt: null,
          orderingEnabled: true,
          brandColor: null,
          logoUrl: null,
          defaultBranchId: 'b1',
        }
      : null,
    role,
    branchId: null,
    memberships: role ? [{ tenantId: 't1', tenantName: 'Bozok Pide Salonu', tenantSlug: 'bozok-pide', role, branchId: 'b1' }] : [],
    isPlatformAdmin: false,
    totpEnabled: false,
    readOnly: false,
    impersonating: null,
    ...extra,
  };
}

describe('kullanıcı menüsünde Güvenlik bağlantısı', () => {
  it('kişisel hesabı olan tüm roller panelde görür (kasiyer ve mutfak Ayarlar menüsünü görmez)', () => {
    expect(PANEL_SECURITY_PATH).toBe('/panel/ayarlar/guvenlik');
    for (const role of ['owner', 'manager', 'cashier', 'kitchen'] as const) {
      expect(showsSecurityLink('/panel', meAs(role))).toBe(true);
      expect(showsSecurityLink('/panel/menu', meAs(role))).toBe(true);
    }
  });

  it('kurye, rolsüz oturum ve panel dışı kabuklar (kurye, admin) görmez', () => {
    expect(showsSecurityLink('/panel', meAs('courier'))).toBe(false);
    expect(showsSecurityLink('/kurye', meAs('courier'))).toBe(false);
    expect(showsSecurityLink('/panel', meAs(null))).toBe(false);
    expect(showsSecurityLink('/admin', meAs('owner'))).toBe(false);
    expect(showsSecurityLink(null, meAs('owner'))).toBe(false);
  });

  it('destek görüntülemesinde (impersonation) gösterilmez', () => {
    const imp = meAs('owner', {
      readOnly: true,
      impersonating: { tenantId: '00000000-0000-4000-8000-000000000001', impersonatorUserId: '00000000-0000-4000-8000-000000000002', expiresAt: '2026-09-25T12:00:00.000Z' },
    });
    expect(showsSecurityLink('/panel', imp)).toBe(false);
  });
});

describe('kullanıcı menüsünde "Bu cihazda bildirimler" bağlantısı', () => {
  it('Güvenlik ile aynı kural: panelde kurye hariç roller; panel dışı ve destek görüntülemesinde yok', () => {
    expect(PANEL_DEVICE_PUSH_PATH).toBe('/panel/ayarlar/bildirimler/cihaz');
    for (const role of ['owner', 'manager', 'cashier', 'kitchen'] as const) expect(showsDevicePushLink('/panel', meAs(role))).toBe(true);
    expect(showsDevicePushLink('/panel', meAs('courier'))).toBe(false);
    expect(showsDevicePushLink('/admin', meAs('owner'))).toBe(false);
    expect(showsDevicePushLink(null, meAs('owner'))).toBe(false);
    const imp = meAs('cashier', {
      readOnly: true,
      impersonating: { tenantId: '00000000-0000-4000-8000-000000000001', impersonatorUserId: '00000000-0000-4000-8000-000000000002', expiresAt: '2026-09-25T12:00:00.000Z' },
    });
    expect(showsDevicePushLink('/panel', imp)).toBe(false);
  });
});
