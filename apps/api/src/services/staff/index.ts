// Personel ve kurye yönetimi (04 §7.11, P-23/P-24): üyelik ekleme, rol, parola sıfırlama, devre dışı,
// kaldırma ve kurye giriş bağlantısı (courier_login_links, 15 dk tek kullanımlık).

import { normalizePhone, zonedTimeToUtc, localDateString, type TenantRole } from '@siparis/core';
import type { CourierDto, StaffCreate, StaffDto, StaffPatch } from '@siparis/core/settings/contracts';
import { branches, courierLoginLinks, memberships, orders, sessions, users, type Database } from '@siparis/db';
import { and, asc, count, eq, gt, gte, inArray, isNull, ne } from 'drizzle-orm';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { randomToken, sha256Hex } from '../../lib/tokens';
import { COURIER_LINK_TTL_MS } from '../auth/sessions';
import { isoOrNull, validationError } from '../settings/common';

type UserRow = typeof users.$inferSelect;
type MembershipRow = typeof memberships.$inferSelect;

export interface StaffActor {
  tenantId: string;
  userId: string;
  role: TenantRole;
}

async function sharedAccountIds(db: Database, tenantId: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(inArray(memberships.userId, userIds), ne(memberships.tenantId, tenantId)));
  const out = new Set(rows.map((r) => r.userId));
  const admins = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, userIds), eq(users.isPlatformAdmin, true)));
  for (const a of admins) out.add(a.id);
  return out;
}

function toStaffDto(m: MembershipRow, u: UserRow, actorUserId: string, shared: boolean): StaffDto {
  return {
    userId: u.id,
    name: u.name,
    email: u.email ?? null,
    phone: u.phone ?? null,
    role: m.role,
    branchId: m.branchId ?? null,
    disabled: m.disabledAt != null || u.disabledAt != null,
    lastLoginAt: isoOrNull(u.lastLoginAt),
    createdAt: m.createdAt.toISOString(),
    isSelf: u.id === actorUserId,
    sharedAccount: shared,
  };
}

export async function listStaff(db: Database, actor: StaffActor): Promise<StaffDto[]> {
  const rows = await db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, actor.tenantId))
    .orderBy(asc(memberships.createdAt));
  const shared = await sharedAccountIds(
    db,
    actor.tenantId,
    rows.map((r) => r.u.id),
  );
  const order: Record<TenantRole, number> = { owner: 0, manager: 1, cashier: 2, kitchen: 3, courier: 4 };
  return rows
    .map((r) => toStaffDto(r.m, r.u, actor.userId, shared.has(r.u.id)))
    .sort((a, b) => order[a.role] - order[b.role] || a.createdAt.localeCompare(b.createdAt));
}

async function loadMember(db: Database, tenantId: string, userId: string): Promise<{ m: MembershipRow; u: UserRow }> {
  const [row] = await db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
  if (!row) throw notFound('Personel bulunamadı.');
  return row;
}

async function assertBranchOfTenant(db: Database, tenantId: string, branchId: string | null | undefined): Promise<void> {
  if (!branchId) return;
  const [b] = await db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)));
  if (!b) throw validationError('Şube bulunamadı.', 'branchId');
}

async function activeOwnerCount(db: Database, tenantId: string, exceptUserId?: string): Promise<number> {
  const conds = [eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner'), isNull(memberships.disabledAt)];
  if (exceptUserId) conds.push(ne(memberships.userId, exceptUserId));
  const [r] = await db.select({ n: count() }).from(memberships).where(and(...conds));
  return Number(r?.n ?? 0);
}

async function dropTenantSessions(db: Database, tenantId: string, userId: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.tenantId, tenantId)));
}

export interface CreateStaffResult {
  staff: StaffDto;
  existingUser: boolean;
}

export async function createStaff(tx: Database, actor: StaffActor, body: StaffCreate): Promise<CreateStaffResult> {
  const email = body.email ? body.email.trim().toLowerCase() : null;
  let phone: string | null = null;
  if (body.phone) {
    phone = normalizePhone(body.phone);
    if (!phone) throw validationError('Geçerli bir telefon numarası girin.', 'phone');
  }
  if (!email && !phone) throw validationError('E-posta ya da telefon girin.', 'email');
  await assertBranchOfTenant(tx, actor.tenantId, body.branchId);

  const byEmail = email ? (await tx.select().from(users).where(eq(users.email, email)))[0] : undefined;
  const byPhone = phone ? (await tx.select().from(users).where(eq(users.phone, phone)))[0] : undefined;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    throw conflict('account_mismatch', 'Bu e-posta ve telefon farklı hesaplara ait. Yalnız birini girin.');
  }
  let user = byEmail ?? byPhone;
  const existingUser = Boolean(user);
  if (user) {
    if (user.disabledAt) throw conflict('user_disabled', 'Bu hesap kapatılmış; eklenemez.');
    // Platform yönetim hesabı hiçbir işletmeye personel/kurye olarak bağlanamaz
    if (user.isPlatformAdmin) throw conflict('account_not_allowed', 'Bu hesap personel olarak eklenemez.');
    const [m] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, actor.tenantId), eq(memberships.userId, user.id)));
    if (m) {
      throw conflict(
        'already_member',
        m.disabledAt ? 'Bu kişi zaten personel listesinde (devre dışı). Listeden yeniden etkinleştirin.' : 'Bu kişi zaten personel listesinde.',
      );
    }
  } else {
    if (body.role !== 'courier' && !body.password) throw validationError('Parola en az 8 karakter olmalı.', 'password');
    const [created] = await tx
      .insert(users)
      .values({ email, phone, name: body.name, passwordHash: body.password ? await hashPassword(body.password) : null })
      .returning();
    user = created!;
  }
  const [m] = await tx
    .insert(memberships)
    .values({ tenantId: actor.tenantId, userId: user.id, role: body.role, branchId: body.branchId ?? null })
    .returning();
  const shared = (await sharedAccountIds(tx, actor.tenantId, [user.id])).has(user.id);
  return { staff: toStaffDto(m!, user, actor.userId, shared), existingUser };
}

export async function patchStaff(tx: Database, actor: StaffActor, userId: string, body: StaffPatch): Promise<{ staff: StaffDto; changes: string[] }> {
  const { m, u } = await loadMember(tx, actor.tenantId, userId);
  const isSelf = userId === actor.userId;
  if (m.role === 'owner' && actor.role !== 'owner') throw forbidden('İşletme sahibinin bilgilerini yalnız sahip değiştirebilir.');
  const changes: string[] = [];
  const mPatch: Partial<typeof memberships.$inferInsert> = {};
  const uPatch: Partial<typeof users.$inferInsert> = {};

  if (body.role !== undefined && body.role !== m.role) {
    if (isSelf) throw conflict('self_change', 'Kendi rolünüzü değiştiremezsiniz.');
    if (body.role === 'owner' && actor.role !== 'owner') throw forbidden('Sahip rolünü yalnız işletme sahibi verebilir.');
    if (m.role === 'owner' && (await activeOwnerCount(tx, actor.tenantId, userId)) === 0) {
      throw conflict('last_owner', 'İşletmenin en az bir sahibi olmalı.');
    }
    mPatch.role = body.role;
    changes.push('role');
  }
  if (body.branchId !== undefined) {
    await assertBranchOfTenant(tx, actor.tenantId, body.branchId);
    mPatch.branchId = body.branchId;
    changes.push('branchId');
  }
  if (body.disabled !== undefined && body.disabled !== (m.disabledAt != null)) {
    if (isSelf) throw conflict('self_change', 'Kendi hesabınızı devre dışı bırakamazsınız.');
    if (body.disabled && m.role === 'owner' && (await activeOwnerCount(tx, actor.tenantId, userId)) === 0) {
      throw conflict('last_owner', 'İşletmenin en az bir sahibi olmalı.');
    }
    mPatch.disabledAt = body.disabled ? new Date() : null;
    changes.push(body.disabled ? 'disabled' : 'enabled');
  }

  const touchesAccount = body.name !== undefined || body.password !== undefined;
  if (touchesAccount) {
    const shared = (await sharedAccountIds(tx, actor.tenantId, [userId])).has(userId);
    if (shared && !isSelf) {
      throw conflict('shared_account', 'Bu kişi başka işletmelerde de kayıtlı; adını ve parolasını yalnız kendisi değiştirebilir.');
    }
    if (body.name !== undefined && body.name !== u.name) {
      uPatch.name = body.name;
      changes.push('name');
    }
    if (body.password !== undefined) {
      uPatch.passwordHash = await hashPassword(body.password);
      changes.push('password');
    }
  }

  if (Object.keys(mPatch).length) {
    await tx.update(memberships).set(mPatch).where(eq(memberships.id, m.id));
  }
  if (Object.keys(uPatch).length) await tx.update(users).set(uPatch).where(eq(users.id, userId));
  // Rol değişince, devre dışı kalınca ya da parola sıfırlanınca açık oturumlar kapanır
  if (mPatch.disabledAt || mPatch.role) await dropTenantSessions(tx, actor.tenantId, userId);
  if (uPatch.passwordHash && !isSelf) await tx.delete(sessions).where(eq(sessions.userId, userId));

  const { m: m2, u: u2 } = await loadMember(tx, actor.tenantId, userId);
  const shared = (await sharedAccountIds(tx, actor.tenantId, [userId])).has(userId);
  return { staff: toStaffDto(m2, u2, actor.userId, shared), changes };
}

export async function removeStaff(tx: Database, actor: StaffActor, userId: string): Promise<{ role: TenantRole; name: string }> {
  const { m, u } = await loadMember(tx, actor.tenantId, userId);
  if (userId === actor.userId) throw conflict('self_change', 'Kendinizi personel listesinden çıkaramazsınız.');
  if (m.role === 'owner') {
    if (actor.role !== 'owner') throw forbidden('İşletme sahibini yalnız sahip kaldırabilir.');
    if ((await activeOwnerCount(tx, actor.tenantId, userId)) === 0) throw conflict('last_owner', 'Son işletme sahibi kaldırılamaz.');
  }
  await tx.delete(memberships).where(eq(memberships.id, m.id));
  await dropTenantSessions(tx, actor.tenantId, userId);
  await tx.delete(courierLoginLinks).where(and(eq(courierLoginLinks.tenantId, actor.tenantId), eq(courierLoginLinks.userId, userId)));
  return { role: m.role, name: u.name };
}

// ---------------------------------------------------------------------------
// Kuryeler

async function assertCourier(db: Database, tenantId: string, userId: string): Promise<{ m: MembershipRow; u: UserRow }> {
  const row = await loadMember(db, tenantId, userId).catch(() => null);
  if (!row || row.m.role !== 'courier') throw notFound('Kurye bulunamadı.');
  return row;
}

/**
 * Magic link (parolasız kurye oturumu) verilebilir mi: platform yöneticisine hiçbir koşulda verilmez; parolası olan
 * hesaba yalnız her yerde kurye ise verilir. Böylece bir işletme, başka yerde sahip/personel olan birinin (parolalı)
 * hesabına parola ve TOTP olmadan oturum açamaz. Parolasız hesabın bağlantıdan başka giriş yolu yoktur; oturum
 * zaten bağlantının işletmesine ve kurye rolüne bağlıdır (switch-tenant kapalı). Üretimde ve kullanımda (exchange)
 * ayrı ayrı kontrol edilir.
 */
export async function courierLinkAllowed(db: Database, userId: string): Promise<boolean> {
  const [u] = await db.select({ isPlatformAdmin: users.isPlatformAdmin, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u || u.isPlatformAdmin) return false;
  if (!u.passwordHash) return true;
  const [other] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), ne(memberships.role, 'courier')))
    .limit(1);
  return !other;
}

export async function createCourierLoginLink(
  tx: Database,
  actor: StaffActor,
  userId: string,
  appBaseUrl: string,
  now = new Date(),
): Promise<{ url: string; expiresAt: Date; linkId: string }> {
  const { m, u } = await assertCourier(tx, actor.tenantId, userId);
  if (m.disabledAt || u.disabledAt) throw new AppError(409, 'courier_disabled', 'Kurye devre dışı; önce etkinleştirin.');
  if (!(await courierLinkAllowed(tx, userId))) {
    throw conflict(
      'courier_link_not_allowed',
      'Bu kişinin başka bir işletmede personel hesabı var; giriş bağlantısı gönderilemez. Kendi e-posta/telefon ve parolasıyla giriş yapmalı.',
    );
  }
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + COURIER_LINK_TTL_MS);
  const [link] = await tx
    .insert(courierLoginLinks)
    .values({ tenantId: actor.tenantId, userId, tokenHash: sha256Hex(token), expiresAt, createdByUserId: actor.userId })
    .returning({ id: courierLoginLinks.id });
  const base = appBaseUrl.replace(/\/+$/, '');
  return { url: `${base}/kurye/giris?t=${encodeURIComponent(token)}`, expiresAt, linkId: link!.id };
}

export async function logoutCourier(tx: Database, actor: StaffActor, userId: string): Promise<number> {
  await assertCourier(tx, actor.tenantId, userId);
  const deleted = await tx
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.tenantId, actor.tenantId)))
    .returning({ id: sessions.id });
  return deleted.length;
}

const ACTIVE_COURIER_STATUSES = ['accepted', 'preparing', 'ready', 'on_the_way'] as const;

export async function listCouriers(db: Database, tenantId: string, now = new Date()): Promise<CourierDto[]> {
  const rows = await db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'courier')))
    .orderBy(asc(users.name));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.u.id);
  const active = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.courierUserId, ids), inArray(orders.status, [...ACTIVE_COURIER_STATUSES])))
    .orderBy(asc(orders.placedAt));
  const dayStart = zonedTimeToUtc(localDateString(now), '00:00');
  const delivered = await db
    .select({ userId: orders.courierUserId, n: count() })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), inArray(orders.courierUserId, ids), eq(orders.status, 'delivered'), gte(orders.deliveredAt, dayStart)))
    .groupBy(orders.courierUserId);
  const live = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(inArray(sessions.userId, ids), eq(sessions.tenantId, tenantId), eq(sessions.kind, 'courier'), gt(sessions.expiresAt, now)));
  const liveSet = new Set(live.map((l) => l.userId));
  const deliveredMap = new Map(delivered.map((d) => [d.userId, Number(d.n)]));
  return rows.map(({ m, u }) => ({
    userId: u.id,
    name: u.name,
    phone: u.phone ?? null,
    disabled: m.disabledAt != null || u.disabledAt != null,
    lastLoginAt: isoOrNull(u.lastLoginAt),
    activeSession: liveSet.has(u.id),
    deliveredToday: deliveredMap.get(u.id) ?? 0,
    activeOrders: active
      .filter((o) => o.courierUserId === u.id)
      .map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        neighborhood: o.neighborhood ?? null,
        customerName: o.customerName ?? null,
        totalKurus: o.totalKurus,
        paymentMethod: o.paymentMethod,
        placedAt: o.placedAt.toISOString(),
      })),
  }));
}

