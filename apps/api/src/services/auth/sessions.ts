// Oturumlar (14 §5, 00 §4): rastgele 32 bayt token → çerez `sid`; DB'de SHA-256.

import type { SessionKind, TenantRole } from '@siparis/core';
import { memberships, sessions, users, type Database } from '@siparis/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Config } from '../../config';
import { randomToken, sha256Hex } from '../../lib/tokens';
import type { AuthContext } from '../../types';

export const SESSION_COOKIE = 'sid';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Kanonik süreler (00 §4). */
export const SESSION_TTL = {
  user: 30 * DAY,
  courier: 12 * HOUR,
  platform: 8 * HOUR,
  impersonation: 30 * MIN,
} as const;
/** Platform oturumu hareketsizlik kilidi. */
export const PLATFORM_IDLE_MS = 30 * MIN;
/** Kurye magic link geçerliliği. */
export const COURIER_LINK_TTL_MS = 15 * MIN;
/** last_seen_at en fazla bu sıklıkla güncellenir. */
const LAST_SEEN_THROTTLE_MS = MIN;

export interface CreateSessionInput {
  userId: string;
  kind: SessionKind;
  tenantId: string | null;
  ttlMs: number;
  ip?: string | null;
  userAgent?: string | null;
  readOnly?: boolean;
  impersonatorUserId?: string | null;
  impersonationReason?: string | null;
}

export async function createSession(db: Database, input: CreateSessionInput) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + input.ttlMs);
  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: sha256Hex(token),
      kind: input.kind,
      tenantId: input.tenantId,
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      readOnly: input.readOnly ?? false,
      impersonatorUserId: input.impersonatorUserId ?? null,
      impersonationReason: input.impersonationReason ?? null,
    })
    .returning();
  return { token, session: row! };
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
}

export async function destroySessionByToken(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
}

/** Çerezdeki token'dan AuthContext çözer; süresi dolmuş/kilitlenmiş oturum null döner (ve silinir). */
export async function resolveSession(db: Database, token: string): Promise<AuthContext | null> {
  if (!token || token.length > 200) return null;
  const now = new Date();
  const [row] = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, now), isNull(users.disabledAt)));
  if (!row) return null;
  const { s, u } = row;

  // Platform yöneticisi: 30 dk hareketsizlikte kilit (impersonation hariç kendi süresiyle)
  if (u.isPlatformAdmin && s.kind === 'user' && now.getTime() - s.lastSeenAt.getTime() > PLATFORM_IDLE_MS) {
    await db.delete(sessions).where(eq(sessions.id, s.id));
    return null;
  }
  if (now.getTime() - s.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.id));
  }

  let tenantId: string | null = null;
  let role: TenantRole | null = null;
  let branchId: string | null = null;
  if (s.tenantId) {
    if (s.kind === 'impersonation') {
      // Destek görünümü: sahip gözüyle, varsayılan salt-okunur (00 §4)
      tenantId = s.tenantId;
      role = 'owner';
    } else {
      const [m] = await db
        .select({ role: memberships.role, branchId: memberships.branchId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, s.tenantId), eq(memberships.userId, u.id), isNull(memberships.disabledAt)));
      if (m && (s.kind !== 'courier' || m.role === 'courier')) {
        tenantId = s.tenantId;
        role = m.role;
        branchId = m.branchId;
      }
    }
  }

  // Platform yetkisi yalnız kişisel (ve ondan açılan destek) oturumunda taşınır; kurye oturumu hiçbir koşulda
  // platform yöneticisi sayılmaz (magic link ile parola/TOTP olmadan yönetim yetkisi alınamaz).
  const platformAdmin = u.isPlatformAdmin && s.kind !== 'courier';

  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      isPlatformAdmin: platformAdmin,
      platformRole: platformAdmin ? u.platformRole : null,
    },
    session: {
      id: s.id,
      kind: s.kind,
      expiresAt: s.expiresAt,
      readOnly: s.readOnly,
      impersonatorUserId: s.impersonatorUserId,
      tenantId: s.tenantId,
    },
    tenantId,
    role,
    branchId,
    isPlatformAdmin: platformAdmin,
    readOnly: s.readOnly,
  };
}
