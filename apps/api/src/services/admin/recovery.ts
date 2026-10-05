// İşletme hesabı kurtarma: parola sıfırlama (denetim H29).
//
// Canlı ortamda parolasını unutan işletme sahibinin HİÇBİR kurtarma yolu yoktu: self-servis sıfırlama akışı yok
// (e-posta kanalı da yok, denetim madde 23), admin panelinde aksiyon yok, container'da kabuk yok. Tek çıkış
// yolu buydu: platform yöneticisi parolayı sıfırlar, yeni parola yalnız admin ekranında BİR KEZ görünür.
//
// Güvenlik sınırları:
//   - Parola SUNUCUDA üretilir. Admin'in yazdığı bir parola kabul edilmez (tahmin edilebilir "1234" parolaları,
//     parolanın istek gövdesinde/loglarda dolaşması ve "admin zaten biliyor" durumu bu şekilde engellenir).
//   - Üretilen parola denetim kaydına, loga ve bildirime YAZILMAZ; yalnız HTTP yanıtında döner (05 §A.1 #8).
//   - Platform yönetim hesabının parolası bu yoldan sıfırlanamaz: aksi halde destek/yönetim yetkisi işletme
//     ekranından ele geçirilebilirdi (operatör yolu 15 §5 `create-admin.ts`).
//   - Kullanıcının TÜM oturumları kapanır (başka işletmedeki üyelikleri dahil): parola değiştiyse eski oturum
//     ayakta kalmamalı.

import { memberships, sessions, users, type Database } from '@siparis/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { conflict, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { adminAudit, type AdminActor } from './util';
import { supportAccessNotice } from './support-access';

/**
 * Telefonda okunabilen alfabe: birbirine benzeyen karakterler (0/O, 1/l/I, 5/S, 2/Z) yok. Türkçe harf yok
 * (klavye/büyük-küçük harf kazaları). 4'erli gruplar tire ile ayrılır.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';
/** Grup sayısı × grup uzunluğu = 12 karakter → parola alt sınırının (8) üstünde. */
const GROUPS = 3;
const GROUP_LEN = 4;

/** Kriptografik rastgele, tek seferlik kurtarma parolası (ör. `H7KM-3PQX-VD48`). */
export function generateRecoveryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let out = '';
    for (let i = 0; i < GROUP_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(out);
  }
  return groups.join('-');
}

export interface ResetPasswordInput {
  tenantId: string;
  userId: string;
  reason: string;
  now?: Date;
}

export interface ResetPasswordResult {
  /** Tek seferlik: yalnız HTTP yanıtına konur. */
  password: string;
  userName: string;
  sessionsEnded: number;
  otherTenantCount: number;
  at: Date;
}

/**
 * İşletme üyesinin parolasını sıfırlar. Tek transaction: parola, oturum kapatma, bildirim ve denetim kaydı
 * birlikte yazılır — denetim kaydı yazılamazsa parola da değişmez.
 */
export async function resetMemberPassword(tx: Database, actor: AdminActor, input: ResetPasswordInput): Promise<ResetPasswordResult> {
  const now = input.now ?? new Date();

  const [row] = await tx
    .select({
      userId: users.id,
      name: users.name,
      isPlatformAdmin: users.isPlatformAdmin,
      userDisabledAt: users.disabledAt,
      role: memberships.role,
      membershipDisabledAt: memberships.disabledAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.userId)));
  if (!row) throw notFound('Kullanıcı bu işletmede bulunamadı.');
  if (row.isPlatformAdmin) {
    throw conflict('platform_account', 'Platform yönetim hesabının parolası buradan sıfırlanamaz.');
  }
  if (row.userDisabledAt) throw conflict('user_disabled', 'Kapatılmış hesabın parolası sıfırlanamaz.');

  const password = generateRecoveryPassword();
  const passwordHash = await hashPassword(password);
  await tx.update(users).set({ passwordHash }).where(eq(users.id, input.userId));

  // Parola değişti: kullanıcının her yerdeki oturumu kapanır (başka işletmedeki üyelikleri dahil)
  const dropped = await tx.delete(sessions).where(eq(sessions.userId, input.userId)).returning({ id: sessions.id });

  const others = await tx
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(and(eq(memberships.userId, input.userId), ne(memberships.tenantId, input.tenantId), isNull(memberships.disabledAt)));

  // İşletme haberdar olsun: sıfırlanan hesap giremese de diğer sahipler/yöneticiler panelde görür
  const owners = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.role, 'owner'), isNull(memberships.disabledAt)));
  await supportAccessNotice(tx, {
    tenantId: input.tenantId,
    kind: 'password_reset',
    recipientUserIds: owners.map((o) => o.userId),
    supportAgentName: actor.name,
    data: { targetUserName: row.name, targetRole: row.role },
    now,
  });

  // Gerekçe denetim kaydına yazılır; ÜRETİLEN PAROLA YAZILMAZ
  await adminAudit(tx, actor, {
    tenantId: input.tenantId,
    action: 'admin.user_password_reset',
    entityType: 'user',
    entityId: input.userId,
    data: {
      reason: input.reason,
      targetRole: row.role,
      membershipDisabled: row.membershipDisabledAt != null,
      sessionsEnded: dropped.length,
      otherTenantCount: others.length,
    },
  });

  return {
    password,
    userName: row.name,
    sessionsEnded: dropped.length,
    otherTenantCount: others.length,
    at: now,
  };
}
