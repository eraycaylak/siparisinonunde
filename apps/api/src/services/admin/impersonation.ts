// Destek erişimi (impersonation; 00 §4, 05 A-09).
//
// Çerez stratejisi: temel dilimin authPlugin'i yalnız `sid` çerezini okur ve admin ile panel aynı kökende
// (/api rewrite) çalışır. Bu yüzden oturum DEĞİŞTİRİLİR: impersonation başlarken admin oturum token'ı
// HttpOnly `sid_admin` çerezine (yalnız /api/v1/admin/impersonation yolunda gönderilir) taşınır ve `sid`
// salt-okunur impersonation oturumunu taşır. POST /admin/impersonation/end impersonation oturumunu siler,
// `sid`i admin oturumuna geri yükler ve `sid_admin`i temizler. Süre dolarsa oturum sunucuda kapanır
// (resolveSession süresi geçmiş oturumu tanımaz); admin kabuğu dönüşte end'i çağırıp oturumu geri yükler.

import type { FastifyReply } from 'fastify';
import type { Config } from '../../config';

export const ADMIN_STASH_COOKIE = 'sid_admin';
export const ADMIN_STASH_PATH = '/api/v1/admin/impersonation';

export function setAdminStashCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date): void {
  reply.setCookie(ADMIN_STASH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: ADMIN_STASH_PATH,
    expires: expiresAt,
  });
}

export function clearAdminStashCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(ADMIN_STASH_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: ADMIN_STASH_PATH });
}
