// Kimlik uç noktaları (14 §6.1): signup, login (+ TOTP ikinci adım), logout, me, switch-tenant, courier exchange,
// iki adımlı doğrulama yönetimi (/auth/totp/*; 00 §12a madde 7).

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
  totpDisableRequestSchema,
  totpEnableRequestSchema,
  totpRecoveryCodesResponseSchema,
  totpRegenerateRequestSchema,
  totpSetupResponseSchema,
  totpStatusResponseSchema,
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
import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { audit, auditActor } from '../lib/audit';
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
import {
  assertPersonalSession,
  consumeRecoveryCode,
  decryptTotpSecret,
  encryptTotpSecret,
  enforceTotpRateLimit,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  isTotpEnabled,
  isTotpRequired,
  matchTotpStep,
  totpKeyUri,
  totpQrSvg,
  verifySecondFactor,
  verifyTotpLogin,
  type UserRow,
} from '../services/auth/totp';
import { courierLinkAllowed } from '../services/staff/index';

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

const INVALID_TOTP_MESSAGE = 'Doğrulama kodu hatalı ya da süresi dolmuş.';

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const loginLimiter = createRateLimiter(RATE_LIMITS.login);
  const signupLimiter = createRateLimiter(RATE_LIMITS.signup);
  // İkinci adım denemeleri (giriş + /totp/*) kullanıcı başına ortak sınır
  const totpLimiter = createRateLimiter(RATE_LIMITS.totpPerUser);

  /** Kişisel oturumun güncel kullanıcı satırı. */
  async function loadUser(userId: string): Promise<UserRow> {
    const [u] = await app.db.select().from(users).where(eq(users.id, userId));
    if (!u || u.disabledAt) throw unauthorized();
    return u;
  }

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
        throw new AppError(400, 'validation_error', 'Geçerli bir cep telefonu girin.', { issues: [{ path: '/phone', field: 'phone', message: 'Geçerli bir cep telefonu girin.', code: 'invalid_phone' }], fields: { phone: 'Geçerli bir cep telefonu girin.' } });
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

  // POST /auth/login — e-posta ya da telefon + parola; TOTP açıksa ikinci adım (totp ya da recoveryCode)
  app.post(
    '/login',
    { schema: { body: loginRequestSchema, response: { 200: loginResponseSchema } } },
    async (request, reply) => {
      enforceRateLimit(loginLimiter, `login:${clientIp(request)}`);
      const { login, password, totp, recoveryCode } = request.body;
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
      // Platform yöneticisi hiçbir koşulda kurye oturumu almaz (TOTP atlanamaz)
      const courierOnly = !user.isPlatformAdmin && ms.length > 0 && ms.every((m) => m.role === 'courier');

      // İkinci adım (parola doğrulandıktan sonra; başarısızsa oturum açılmaz). Yalnız kurye olan hesaplar TOTP kullanmaz.
      if (isTotpEnabled(user) && !courierOnly) {
        if (!totp && !recoveryCode) {
          throw new AppError(401, 'totp_required', 'Doğrulama uygulamanızdaki 6 haneli kodu girin.');
        }
        enforceTotpRateLimit(totpLimiter, user.id);
        let ok: boolean;
        let remaining: number | null = null;
        if (totp) {
          ok = await verifyTotpLogin(app.db, app.config, user, totp);
        } else {
          remaining = await consumeRecoveryCode(app.db, user.id, recoveryCode!);
          ok = remaining !== null;
        }
        const method = totp ? 'totp' : 'recovery_code';
        if (!ok) {
          await audit(app.db, {
            actorUserId: user.id,
            action: 'auth.totp_login_failed',
            entityType: 'user',
            entityId: user.id,
            data: { method },
            ip: clientIp(request),
          });
          throw new AppError(401, 'invalid_totp', method === 'totp' ? INVALID_TOTP_MESSAGE : 'Kurtarma kodu hatalı ya da daha önce kullanılmış.');
        }
        if (method === 'recovery_code') {
          await audit(app.db, {
            actorUserId: user.id,
            action: 'auth.totp_recovery_code_used',
            entityType: 'user',
            entityId: user.id,
            data: { recoveryCodesRemaining: remaining },
            ip: clientIp(request),
          });
        }
      }

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
    return buildMe(app.db, request.auth!, app.config);
  });

  // POST /auth/switch-tenant — çok üyelikli kullanıcı
  app.post(
    '/switch-tenant',
    { preHandler: requireAuth(), schema: { body: switchTenantRequestSchema, response: { 200: meResponseSchema } } },
    async (request) => {
      const auth = request.auth!;
      if (auth.session.kind === 'impersonation') throw forbidden('Destek görünümünde işletme değiştirilemez.');
      // Kurye oturumu açıldığı işletmeye bağlıdır (magic link başka işletmenin verisine geçiş sağlamaz)
      if (auth.session.kind === 'courier') throw forbidden('Kurye oturumunda işletme değiştirilemez.');
      const [m] = await app.db
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.tenantId, request.body.tenantId), eq(memberships.userId, auth.user.id), isNull(memberships.disabledAt)));
      if (!m) throw notFound('İşletme bulunamadı.');
      await app.db.update(sessions).set({ tenantId: request.body.tenantId }).where(eq(sessions.id, auth.session.id));
      const refreshed = await resolveSession(app.db, request.cookies[SESSION_COOKIE]!);
      if (!refreshed) throw unauthorized();
      return buildMe(app.db, refreshed, app.config);
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
      if (!m || m.role !== 'courier' || !user || user.disabledAt || !(await courierLinkAllowed(app.db, user.id))) {
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
      return buildMe(app.db, auth, app.config);
    },
  );

  // ---------------------------------------------------------------------------
  // İki adımlı doğrulama (TOTP) yönetimi — yalnız kişisel oturum; destek görünümü, kurye ve cihaz oturumu 403.

  // GET /auth/totp — durum
  app.get('/totp', { preHandler: requireAuth(), schema: { response: { 200: totpStatusResponseSchema } } }, async (request) => {
    const user = await loadUser(assertPersonalSession(request));
    const enabled = isTotpEnabled(user);
    return {
      enabled,
      enabledAt: enabled && user.totpEnabledAt ? user.totpEnabledAt.toISOString() : null,
      recoveryCodesRemaining: enabled ? user.totpRecoveryHashes.length : 0,
      required: isTotpRequired(user, app.config),
    };
  });

  // POST /auth/totp/setup — bekleyen sır + otpauth adresi + QR (SVG). Etkinleştirilene kadar girişi etkilemez.
  app.post('/totp/setup', { preHandler: requireAuth(), schema: { response: { 200: totpSetupResponseSchema } } }, async (request) => {
    const user = await loadUser(assertPersonalSession(request));
    if (isTotpEnabled(user)) {
      throw conflict('totp_already_enabled', 'İki adımlı doğrulama zaten açık. Yeni telefona geçmek için önce kapatın.');
    }
    const secret = generateTotpSecret();
    const otpauthUrl = totpKeyUri(user.email ?? user.phone ?? user.name, secret);
    const qrSvg = await totpQrSvg(otpauthUrl);
    await app.db.transaction(async (tx) => {
      await tx.update(users).set({ totpPendingSecretEnc: encryptTotpSecret(app.config, secret) }).where(eq(users.id, user.id));
      await audit(tx, { ...auditActor(request), action: 'auth.totp_setup_started', entityType: 'user', entityId: user.id });
    });
    return { secret, otpauthUrl, qrSvg };
  });

  // POST /auth/totp/enable {code} — bekleyen sırla ilk doğru kod: açar, kurtarma kodlarını BİR KEZ döner,
  // kullanıcının diğer oturumlarını kapatır.
  app.post(
    '/totp/enable',
    { preHandler: requireAuth(), schema: { body: totpEnableRequestSchema, response: { 200: totpRecoveryCodesResponseSchema } } },
    async (request) => {
      const auth = request.auth!;
      const user = await loadUser(assertPersonalSession(request));
      if (isTotpEnabled(user)) throw conflict('totp_already_enabled', 'İki adımlı doğrulama zaten açık.');
      const pendingEnc = user.totpPendingSecretEnc;
      const secret = decryptTotpSecret(app.config, pendingEnc);
      if (!pendingEnc || !secret) throw badRequest('Önce kurulumu başlatın.', undefined, 'totp_setup_required');
      enforceTotpRateLimit(totpLimiter, user.id);
      const step = matchTotpStep(secret, request.body.code);
      if (step === null) throw badRequest(INVALID_TOTP_MESSAGE, undefined, 'invalid_totp');

      const recoveryCodes = generateRecoveryCodes();
      await app.db.transaction(async (tx) => {
        const updated = await tx
          .update(users)
          .set({
            totpSecretEnc: pendingEnc,
            totpPendingSecretEnc: null,
            totpEnabledAt: new Date(),
            totpLastStep: step,
            totpRecoveryHashes: hashRecoveryCodes(recoveryCodes),
          })
          .where(and(eq(users.id, user.id), isNull(users.totpEnabledAt), eq(users.totpPendingSecretEnc, pendingEnc)))
          .returning({ id: users.id });
        if (!updated.length) throw conflict('conflict', 'Kurulum bu arada değişti. Sayfayı yenileyip tekrar deneyin.');
        const revoked = await tx
          .delete(sessions)
          .where(and(eq(sessions.userId, user.id), ne(sessions.id, auth.session.id)))
          .returning({ id: sessions.id });
        await audit(tx, {
          ...auditActor(request),
          action: 'auth.totp_enabled',
          entityType: 'user',
          entityId: user.id,
          data: { revokedSessions: revoked.length },
        });
      });
      return { recoveryCodes };
    },
  );

  // POST /auth/totp/disable {password, code} — zorunlu olduğu platform yöneticisinde 403.
  app.post(
    '/totp/disable',
    { preHandler: requireAuth(), schema: { body: totpDisableRequestSchema, response: { 200: okResponseSchema } } },
    async (request) => {
      const user = await loadUser(assertPersonalSession(request));
      if (!isTotpEnabled(user)) throw conflict('totp_not_enabled', 'İki adımlı doğrulama zaten kapalı.');
      if (isTotpRequired(user, app.config)) {
        throw forbidden('Platform yöneticilerinde iki adımlı doğrulama kapatılamaz.', 'totp_required_for_admin');
      }
      enforceTotpRateLimit(totpLimiter, user.id);
      if (!(await verifyPassword(request.body.password, user.passwordHash))) {
        throw badRequest('Parola hatalı.', undefined, 'invalid_password');
      }
      const check = await verifySecondFactor(app.db, app.config, user, request.body.code);
      if (!check.ok) throw badRequest(INVALID_TOTP_MESSAGE, undefined, 'invalid_totp');
      await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] })
          .where(eq(users.id, user.id));
        await audit(tx, { ...auditActor(request), action: 'auth.totp_disabled', entityType: 'user', entityId: user.id, data: { method: check.method } });
      });
      return { ok: true as const };
    },
  );

  // POST /auth/totp/recovery-codes {code} — yeni 8 kod (eskiler geçersiz); düz metin yalnız bu yanıtta.
  app.post(
    '/totp/recovery-codes',
    { preHandler: requireAuth(), schema: { body: totpRegenerateRequestSchema, response: { 200: totpRecoveryCodesResponseSchema } } },
    async (request) => {
      const user = await loadUser(assertPersonalSession(request));
      if (!isTotpEnabled(user)) throw conflict('totp_not_enabled', 'Önce iki adımlı doğrulamayı açın.');
      enforceTotpRateLimit(totpLimiter, user.id);
      const check = await verifySecondFactor(app.db, app.config, user, request.body.code);
      if (!check.ok) throw badRequest(INVALID_TOTP_MESSAGE, undefined, 'invalid_totp');
      const recoveryCodes = generateRecoveryCodes();
      await app.db.transaction(async (tx) => {
        await tx.update(users).set({ totpRecoveryHashes: hashRecoveryCodes(recoveryCodes) }).where(eq(users.id, user.id));
        await audit(tx, {
          ...auditActor(request),
          action: 'auth.totp_recovery_codes_regenerated',
          entityType: 'user',
          entityId: user.id,
          data: { method: check.method },
        });
      });
      return { recoveryCodes };
    },
  );
};

export default authRoutes;
