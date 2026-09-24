// Kimlik uç noktaları (14 §6.1): signup, login, logout, me, switch-tenant, courier exchange.

import {
  LEGAL_DOCUMENT_VERSION,
  courierExchangeRequestSchema,
  isValidSlug,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  normalizePhone,
  normalizeTrMobile,
  okResponseSchema,
  signupRequestSchema,
  signupResponseSchema,
  slugifyTr,
  switchTenantRequestSchema,
} from '@siparis/core';
import {
  branches,
  courierLoginLinks,
  legalAcceptances,
  memberships,
  openingHours,
  sessions,
  subscriptions,
  tenants,
  users,
  type Database,
} from '@siparis/db';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { audit } from '../lib/audit';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { isFlagEnabled } from '../lib/flags';
import { hashPassword, verifyPassword, verifyPasswordDummy } from '../lib/password';
import { RATE_LIMITS, clientIp, createRateLimiter, enforceRateLimit } from '../lib/rate-limit';
import { sha256Hex } from '../lib/tokens';
import { requireAuth } from '../plugins/auth';
import { buildMe, listMemberships, toTenantDto, toUserDto } from '../services/auth/dto';
import {
  SESSION_COOKIE,
  SESSION_TTL,
  clearSessionCookie,
  createSession,
  destroySessionByToken,
  resolveSession,
  setSessionCookie,
} from '../services/auth/sessions';

const TRIAL_DAYS = 14;

/** Benzersiz slug üretir (ayrılmış adlar hariç). */
async function uniqueSlug(db: Database, businessName: string): Promise<string> {
  let base = slugifyTr(businessName);
  if (base.length < 3) base = `${base || 'isletme'}-isletme`.replace(/^-/, '');
  if (!isValidSlug(base)) base = `${base}-isletme`.slice(0, 40);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 36)}-${i + 1}`;
    if (!isValidSlug(candidate)) continue;
    const [hit] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate));
    if (!hit) return candidate;
  }
  return `${base.slice(0, 30)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const loginLimiter = createRateLimiter(RATE_LIMITS.login);
  const signupLimiter = createRateLimiter(RATE_LIMITS.signup);

  // POST /auth/signup — işletme + şube + sahip + deneme aboneliği; oturum açar
  app.post(
    '/signup',
    { schema: { body: signupRequestSchema, response: { 201: signupResponseSchema } } },
    async (request, reply) => {
      enforceRateLimit(signupLimiter, `signup:${clientIp(request)}`);
      if (!(await isFlagEnabled(app.db, 'signup_open'))) {
        throw forbidden('Yeni kayıtlar geçici olarak kapalı.', 'signup_closed');
      }
      const body = request.body;
      const phone = normalizeTrMobile(body.phone);
      if (!phone) {
        throw new AppError(400, 'validation_error', 'Geçerli bir cep telefonu girin.', { issues: [{ path: 'phone', message: 'invalid_phone' }] });
      }
      const email = body.email.toLowerCase();

      const [emailHit] = await app.db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (emailHit) throw conflict('email_taken', 'Bu e-posta ile kayıtlı bir hesap var.');
      const [phoneHit] = await app.db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
      if (phoneHit) throw conflict('phone_taken', 'Bu telefon ile kayıtlı bir hesap var.');

      const passwordHash = await hashPassword(body.password);
      const slug = await uniqueSlug(app.db, body.businessName);
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86400000);
      const ip = clientIp(request);
      const userAgent = request.headers['user-agent'] ?? null;

      let result;
      try {
        result = await app.db.transaction(async (tx) => {
          const [tenant] = await tx
            .insert(tenants)
            .values({
              name: body.businessName,
              slug,
              phone,
              email,
              lifecycleStage: 'trial',
              planCode: 'pro',
              trialEndsAt,
            })
            .returning();
          const [branch] = await tx
            .insert(branches)
            .values({
              tenantId: tenant!.id,
              name: 'Merkez',
              phone,
              city: body.city ?? 'Yozgat',
              district: 'Merkez',
            })
            .returning();
          // Varsayılan saatler (işletme kurulumda düzenler)
          await tx
            .insert(openingHours)
            .values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId: tenant!.id, branchId: branch!.id, weekday, opensAt: '10:00', closesAt: '22:00' })));
          const [user] = await tx
            .insert(users)
            .values({ email, phone, name: body.ownerName, passwordHash, lastLoginAt: now })
            .returning();
          await tx.insert(memberships).values({ tenantId: tenant!.id, userId: user!.id, role: 'owner' });
          await tx.insert(subscriptions).values({ tenantId: tenant!.id, planCode: 'pro', status: 'trialing', trialEndsAt });
          await tx.insert(legalAcceptances).values(
            (['abonelik', 'kvkk_aydinlatma'] as const).map((document) => ({
              userId: user!.id,
              tenantId: tenant!.id,
              document,
              version: LEGAL_DOCUMENT_VERSION,
              ip,
              userAgent: userAgent?.slice(0, 300) ?? null,
            })),
          );
          await audit(tx, {
            tenantId: tenant!.id,
            actorUserId: user!.id,
            action: 'tenant.signup',
            entityType: 'tenant',
            entityId: tenant!.id,
            data: { slug, city: body.city ?? 'Yozgat' },
            ip,
          });
          return { tenant: tenant!, branch: branch!, user: user! };
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('conflict', 'Bu bilgilerle kayıtlı bir hesap var.');
        throw err;
      }

      const { token, session } = await createSession(app.db, {
        userId: result.user.id,
        kind: 'user',
        tenantId: result.tenant.id,
        ttlMs: SESSION_TTL.user,
        ip,
        userAgent,
      });
      setSessionCookie(reply, app.config, token, session.expiresAt);
      reply.status(201);
      return { user: toUserDto(result.user), tenant: toTenantDto(result.tenant, result.branch.id) };
    },
  );

  // POST /auth/login — e-posta ya da telefon + parola
  app.post(
    '/login',
    { schema: { body: loginRequestSchema, response: { 200: loginResponseSchema } } },
    async (request, reply) => {
      enforceRateLimit(loginLimiter, `login:${clientIp(request)}`);
      const { login, password } = request.body;
      const phone = normalizePhone(login);
      const email = login.includes('@') ? login.trim().toLowerCase() : null;
      const conds = [email ? eq(users.email, email) : undefined, phone ? eq(users.phone, phone) : undefined].filter(
        (c): c is NonNullable<typeof c> => c !== undefined,
      );
      const [user] = conds.length ? await app.db.select().from(users).where(or(...conds)).limit(1) : [];
      if (!user || user.disabledAt) {
        await verifyPasswordDummy(password);
        throw new AppError(401, 'invalid_credentials', 'E-posta/telefon ya da parola hatalı.');
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        throw new AppError(401, 'invalid_credentials', 'E-posta/telefon ya da parola hatalı.');
      }

      const ms = await listMemberships(app.db, user.id);
      const courierOnly = ms.length > 0 && ms.every((m) => m.role === 'courier');
      const kind = courierOnly ? 'courier' : 'user';
      const ttlMs = user.isPlatformAdmin ? SESSION_TTL.platform : courierOnly ? SESSION_TTL.courier : SESSION_TTL.user;
      const tenantId = (ms.find((m) => m.role !== 'courier') ?? ms[0])?.tenantId ?? null;

      // Eski oturum çerezi varsa kapat
      const old = request.cookies?.[SESSION_COOKIE];
      if (old) await destroySessionByToken(app.db, old);

      const { token, session } = await createSession(app.db, {
        userId: user.id,
        kind,
        tenantId,
        ttlMs,
        ip: clientIp(request),
        userAgent: request.headers['user-agent'] ?? null,
      });
      await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      setSessionCookie(reply, app.config, token, session.expiresAt);
      return { user: toUserDto(user), memberships: ms, isPlatformAdmin: user.isPlatformAdmin };
    },
  );

  // POST /auth/logout
  app.post('/logout', { schema: { response: { 200: okResponseSchema } } }, async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) await destroySessionByToken(app.db, token);
    clearSessionCookie(reply, app.config);
    return { ok: true as const };
  });

  // GET /auth/me
  app.get('/me', { preHandler: requireAuth(), schema: { response: { 200: meResponseSchema } } }, async (request) => {
    return buildMe(app.db, request.auth!);
  });

  // POST /auth/switch-tenant — çok üyelikli kullanıcı
  app.post(
    '/switch-tenant',
    { preHandler: requireAuth(), schema: { body: switchTenantRequestSchema, response: { 200: meResponseSchema } } },
    async (request) => {
      const auth = request.auth!;
      if (auth.session.kind === 'impersonation') throw forbidden('Destek görünümünde işletme değiştirilemez.');
      const [m] = await app.db
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.tenantId, request.body.tenantId), eq(memberships.userId, auth.user.id), isNull(memberships.disabledAt)));
      if (!m) throw notFound('İşletme bulunamadı.');
      if (auth.session.kind === 'courier' && m.role !== 'courier') throw forbidden();
      await app.db.update(sessions).set({ tenantId: request.body.tenantId }).where(eq(sessions.id, auth.session.id));
      const refreshed = await resolveSession(app.db, request.cookies[SESSION_COOKIE]!);
      if (!refreshed) throw unauthorized();
      return buildMe(app.db, refreshed);
    },
  );

  // POST /auth/courier/exchange — tek kullanımlık magic link → 12 saatlik kurye oturumu
  app.post(
    '/courier/exchange',
    { schema: { body: courierExchangeRequestSchema, response: { 200: meResponseSchema } } },
    async (request, reply) => {
      enforceRateLimit(loginLimiter, `courier:${clientIp(request)}`);
      const now = new Date();
      const [link] = await app.db
        .update(courierLoginLinks)
        .set({ usedAt: now })
        .where(
          and(eq(courierLoginLinks.tokenHash, sha256Hex(request.body.token)), isNull(courierLoginLinks.usedAt), gt(courierLoginLinks.expiresAt, now)),
        )
        .returning();
      if (!link) throw badRequest('Giriş bağlantısı geçersiz ya da süresi dolmuş. Yöneticinizden yeni bağlantı isteyin.', undefined, 'invalid_link');
      const [m] = await app.db
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.tenantId, link.tenantId), eq(memberships.userId, link.userId), isNull(memberships.disabledAt)));
      const [user] = await app.db.select().from(users).where(eq(users.id, link.userId));
      if (!m || m.role !== 'courier' || !user || user.disabledAt) {
        throw badRequest('Giriş bağlantısı geçersiz.', undefined, 'invalid_link');
      }
      const { token, session } = await createSession(app.db, {
        userId: link.userId,
        kind: 'courier',
        tenantId: link.tenantId,
        ttlMs: SESSION_TTL.courier,
        ip: clientIp(request),
        userAgent: request.headers['user-agent'] ?? null,
      });
      setSessionCookie(reply, app.config, token, session.expiresAt);
      const auth = await resolveSession(app.db, token);
      if (!auth) throw unauthorized();
      return buildMe(app.db, auth);
    },
  );
};

export default authRoutes;
