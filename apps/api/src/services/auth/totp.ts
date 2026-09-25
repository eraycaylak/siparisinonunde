// İki adımlı doğrulama (TOTP, RFC 6238; 00 §12a madde 7, 14 §5): sır üretimi, kod doğrulama (±1 adım,
// tekrar oynatma koruması), tek kullanımlık kurtarma kodları. Sırlar lib/encryption ile şifreli saklanır;
// sırlar ve kodlar hiçbir zaman loglanmaz ya da audit'e yazılmaz.

import { users, type Database } from '@siparis/db';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import type { Config } from '../../config';
import { createEncryptor, type Encryptor } from '../../lib/encryption';
import { AppError, forbidden, unauthorized } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limit';
import { ORDER_CODE_ALPHABET, sha256Hex } from '../../lib/tokens';

export type UserRow = typeof users.$inferSelect;

/** Doğrulama uygulamasında görünen hesap sağlayıcı adı. */
export const TOTP_ISSUER = 'Siparişin Önünde';
/** Zaman adımı (sn); uygulamaların varsayılanı. */
export const TOTP_STEP_SEC = 30;
/** Saat kayması toleransı: önceki ve sonraki adım da kabul edilir. */
const TOTP_WINDOW = 1;
/** 20 bayt (160 bit) sır — RFC 4226 önerisi; base32'de 32 karakter. */
const SECRET_BYTES = 20;
export const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 8;

const encryptors = new Map<string, Encryptor>();
function encryptor(config: Pick<Config, 'ENCRYPTION_KEY'>): Encryptor {
  let e = encryptors.get(config.ENCRYPTION_KEY);
  if (!e) {
    e = createEncryptor(config.ENCRYPTION_KEY);
    encryptors.set(config.ENCRYPTION_KEY, e);
  }
  return e;
}

export function encryptTotpSecret(config: Pick<Config, 'ENCRYPTION_KEY'>, secret: string): string {
  return encryptor(config).encrypt(secret);
}

/** Şifreli sırrı çözer; anahtar değişmiş ya da değer bozuksa null (kod doğrulanamaz). */
export function decryptTotpSecret(config: Pick<Config, 'ENCRYPTION_KEY'>, payload: string | null): string | null {
  if (!payload) return null;
  try {
    return encryptor(config).decrypt(payload);
  } catch {
    return null;
  }
}

export function isTotpEnabled(u: Pick<UserRow, 'totpEnabledAt' | 'totpSecretEnc'>): boolean {
  return Boolean(u.totpEnabledAt && u.totpSecretEnc);
}

/** Platform yöneticisi ve ADMIN_TOTP_REQUIRED açık: TOTP zorunlu (kapatılamaz, kurulmadan admin uçları kapalı). */
export function isTotpRequired(u: Pick<UserRow, 'isPlatformAdmin'>, config: Pick<Config, 'ADMIN_TOTP_REQUIRED'>): boolean {
  return u.isPlatformAdmin && config.ADMIN_TOTP_REQUIRED;
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret(SECRET_BYTES);
}

/** otpauth://totp/… adresi (etiket: e-posta, yoksa telefon). */
export function totpKeyUri(label: string, secret: string): string {
  return authenticator.keyuri(label, TOTP_ISSUER, secret);
}

/** QR kodu SVG metni (siyah-beyaz, sessiz bölge 4 modül). */
export function totpQrSvg(otpauthUrl: string): Promise<string> {
  return QRCode.toString(otpauthUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } });
}

/** Zaman adımı: floor(unix sn / 30). */
export function totpStepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

/** Kod ±1 adım içinde geçerliyse eşleşen adımı döner, değilse null. */
export function matchTotpStep(secret: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  let delta: number | null;
  try {
    delta = authenticator.clone({ window: TOTP_WINDOW, epoch: nowMs }).checkDelta(code, secret);
  } catch {
    return null;
  }
  return delta === null ? null : totpStepAt(nowMs) + delta;
}

/**
 * Adımı atomik olarak "kullanıldı" işaretler: yalnız son kabul edilen adımdan büyükse günceller.
 * Aynı kod (ya da daha eski adım) ikinci kez gelirse false — eşzamanlı iki istekte de yalnız biri geçer.
 */
async function claimTotpStep(db: Database, userId: string, step: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Etkin sırla kod doğrulama + tekrar oynatma koruması. */
export async function verifyTotpLogin(db: Database, config: Pick<Config, 'ENCRYPTION_KEY'>, user: UserRow, code: string): Promise<boolean> {
  if (!isTotpEnabled(user)) return false;
  const secret = decryptTotpSecret(config, user.totpSecretEnc);
  if (!secret) return false;
  const step = matchTotpStep(secret, code.trim());
  if (step === null) return false;
  return claimTotpStep(db, user.id, step);
}

// ---------------------------------------------------------------------------
// Kurtarma kodları: 8 adet "ABCD-EFGH" (karışmayan harf/rakam), yalnız SHA-256 özetleri saklanır.

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) raw += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...codes];
}

/** Büyük harfe çevirir, tire/boşluğu atar; biçim tutmazsa null. */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== RECOVERY_CODE_LENGTH) return null;
  for (const ch of raw) if (!ORDER_CODE_ALPHABET.includes(ch)) return null;
  return raw;
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(`totp-recovery:${normalizeRecoveryCode(code) ?? ''}`);
}

export function hashRecoveryCodes(codes: string[]): string[] {
  return codes.map(hashRecoveryCode);
}

/** Kurtarma kodunu tüketir (tek kullanım, atomik). Başarılıysa kalan kod sayısı, değilse null. */
export async function consumeRecoveryCode(db: Database, userId: string, code: string): Promise<number | null> {
  if (!normalizeRecoveryCode(code)) return null;
  const hash = hashRecoveryCode(code);
  const [row] = await db
    .update(users)
    .set({ totpRecoveryHashes: sql`array_remove(${users.totpRecoveryHashes}, ${hash}::text)` })
    .where(and(eq(users.id, userId), sql`${hash}::text = any(${users.totpRecoveryHashes})`))
    .returning({ remaining: sql<number>`cardinality(${users.totpRecoveryHashes})` });
  return row ? Number(row.remaining) : null;
}

export type SecondFactorMethod = 'totp' | 'recovery_code';

/**
 * İkinci adım: 6 haneliyse TOTP, değilse kurtarma kodu olarak denenir.
 * Kurtarma kodu başarılıysa tüketilir.
 */
export async function verifySecondFactor(
  db: Database,
  config: Pick<Config, 'ENCRYPTION_KEY'>,
  user: UserRow,
  code: string,
): Promise<{ ok: boolean; method: SecondFactorMethod; recoveryCodesRemaining?: number }> {
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) return { ok: await verifyTotpLogin(db, config, user, trimmed), method: 'totp' };
  if (!isTotpEnabled(user)) return { ok: false, method: 'recovery_code' };
  const remaining = await consumeRecoveryCode(db, user.id, trimmed);
  return remaining === null ? { ok: false, method: 'recovery_code' } : { ok: true, method: 'recovery_code', recoveryCodesRemaining: remaining };
}

// ---------------------------------------------------------------------------
// Yardımcılar (rotalar)

/** Kullanıcı başına ikinci adım denemesi sınırı (giriş + yönetim uçları ortak): aşılırsa 429. */
export function enforceTotpRateLimit(limiter: RateLimiter, userId: string): void {
  const r = limiter.take(`totp:${userId}`);
  if (!r.ok) {
    const minutes = Math.max(1, Math.ceil(r.retryAfterSec / 60));
    throw new AppError(429, 'rate_limited', `Çok fazla doğrulama kodu denemesi yapıldı. ${minutes} dakika sonra tekrar deneyin.`, {
      retryAfterSec: r.retryAfterSec,
    });
  }
}

/**
 * TOTP yönetimi yalnız kişisel oturumda (kind 'user'). Destek görünümünde (impersonation) oturumun kullanıcısı
 * yöneticinin kendisidir; kurye ve paylaşımlı cihaz oturumları TOTP kullanmaz.
 */
export function assertPersonalSession(request: FastifyRequest): string {
  const auth = request.auth;
  if (!auth) throw unauthorized();
  if (auth.session.kind === 'impersonation') throw forbidden('Destek görünümündeyken güvenlik ayarları değiştirilemez.');
  if (auth.session.kind !== 'user') throw forbidden('Bu oturum türünde iki adımlı doğrulama kullanılamaz.');
  return auth.user.id;
}
