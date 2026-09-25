import { describe, expect, it } from 'vitest';
import { currentBranchId, currentRole, hasRole, homePathFor, needsTotpEnrollment, safeNextPath, type Me } from './auth';

const me: Me = {
  user: { id: 'u1', name: 'Elif', email: null, phone: null, isPlatformAdmin: false, platformRole: null },
  tenant: {
    id: 't1',
    name: 'Bozok Pide Salonu',
    slug: 'bozok-pide',
    lifecycleStage: 'pilot',
    planCode: 'pro',
    trialEndsAt: null,
    orderingEnabled: true,
    brandColor: null,
    logoUrl: null,
    defaultBranchId: 'b0',
  },
  role: null,
  branchId: null,
  memberships: [{ tenantId: 't1', tenantName: 'Bozok Pide Salonu', tenantSlug: 'bozok-pide', role: 'cashier', branchId: 'b1' }],
  isPlatformAdmin: false,
  totpEnabled: false,
  readOnly: false,
  impersonating: null,
};

describe('auth yardımcıları', () => {
  it('güvenli yönlendirme', () => {
    expect(safeNextPath('/panel/menu', '/panel')).toBe('/panel/menu');
    expect(safeNextPath('//evil.com', '/panel')).toBe('/panel');
    expect(safeNextPath('https://evil.com', '/panel')).toBe('/panel');
    expect(safeNextPath(null, '/panel')).toBe('/panel');
  });

  it('rol ve şube', () => {
    expect(currentRole(me)).toBe('cashier');
    expect(hasRole(me, ['owner', 'cashier'])).toBe(true);
    expect(hasRole(me, ['owner'])).toBe(false);
    expect(currentBranchId(me)).toBe('b1');
    expect(currentBranchId({ ...me, branchId: 'b9' })).toBe('b9');
    expect(currentBranchId({ ...me, memberships: [] })).toBe('b0');
  });

  it('varsayılan hedef', () => {
    expect(homePathFor(me)).toBe('/panel');
    expect(homePathFor({ ...me, memberships: [{ ...me.memberships[0]!, role: 'courier' }] })).toBe('/kurye');
    expect(homePathFor({ ...me, memberships: [], isPlatformAdmin: true })).toBe('/admin');
  });

  it('TOTP kurulumu gereken platform yöneticisi', () => {
    const admin: Me = { ...me, tenant: null, memberships: [], isPlatformAdmin: true, totpRequired: true, totpEnabled: false };
    expect(needsTotpEnrollment(admin)).toBe(true);
    expect(needsTotpEnrollment({ ...admin, totpEnabled: true })).toBe(false);
    expect(needsTotpEnrollment({ ...admin, totpRequired: false })).toBe(false);
    expect(needsTotpEnrollment({ ...admin, totpRequired: undefined })).toBe(false);
    // İşletme kullanıcısında TOTP isteğe bağlı
    expect(needsTotpEnrollment(me)).toBe(false);
    expect(needsTotpEnrollment(null)).toBe(false);
  });
});
