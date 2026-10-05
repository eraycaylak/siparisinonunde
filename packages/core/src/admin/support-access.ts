// Platformun işletme hesabına dokunduğu iki aksiyonun sözleşmeleri: destek erişimi (impersonation) bildirimleri ve
// işletme kullanıcısının parolasının sıfırlanması. İkisi aynı dosyada çünkü ikisi de aynı `notifications` akışına
// (işletmenin gördüğü "destek erişimi" listesi) yazar ve aynı şeffaflık kuralına tabidir.
// İçe aktarma: `@siparis/core/admin/support-access`.

import { z } from 'zod';
import { adminReasonSchema } from './contracts';

const id = z.uuid();
const iso = z.string();
const isoOrNull = z.string().nullable();
const int = z.number().int();

// ---------------------------------------------------------------------------
// Destek erişimi bildirimleri — işletmenin kendi gözüyle (00 §4 "işletmeye bildirim", 04 §1198 destek bandı,
// 08 §2 madde 4 DPA). İşletme oturumuyla okunur; platform rolü gerekmez.

/** İşletmeye görünen kayıt türleri (`notifications.kind` → bu küme). */
export const SUPPORT_ACCESS_NOTICE_KINDS = ['started', 'ended', 'password_reset'] as const;
export type SupportAccessNoticeKind = (typeof SUPPORT_ACCESS_NOTICE_KINDS)[number];

export const supportAccessNoticeSchema = z.object({
  id,
  kind: z.enum(SUPPORT_ACCESS_NOTICE_KINDS),
  at: iso,
  /** Erişen destek görevlisinin adı (kayıt eskiyse null). Gerekçe işletmeye gösterilmez. */
  supportAgentName: z.string().nullable(),
  /** `started` kayıtlarında oturumun planlanan bitişi. */
  expiresAt: isoOrNull,
});
export type SupportAccessNotice = z.infer<typeof supportAccessNoticeSchema>;

export const supportAccessNoticesResponseSchema = z.object({
  /** Şu an açık destek oturumları (canlı gerçek: `sessions` tablosu). */
  active: z.array(
    z.object({
      sessionId: id,
      supportAgentName: z.string().nullable(),
      startedAt: iso,
      expiresAt: iso,
    }),
  ),
  /** Son kayıtlar, en yeni önce. */
  notices: z.array(supportAccessNoticeSchema),
});
export type SupportAccessNoticesResponse = z.infer<typeof supportAccessNoticesResponseSchema>;

// ---------------------------------------------------------------------------
// Parola sıfırlama (A-04 üyeler sekmesi; denetim H29)
//
// Parolasını unutan işletme sahibinin tek kurtarma yolu: platform yöneticisi yeni bir parola ÜRETİR, parola
// yalnız yanıtta bir kez görünür (loga, denetim kaydına ve e-postaya YAZILMAZ) ve kullanıcının tüm oturumları
// kapanır. Kendi parolasını yazmak/seçmek admin'e bırakılmaz: yanıtta dönen değer sunucuda üretilir.

export const adminPasswordResetRequestSchema = z.object({
  /** Gerekçe zorunlu (05 §A.1 #6); denetim kaydına yazılır. */
  reason: adminReasonSchema,
});
export type AdminPasswordResetRequest = z.input<typeof adminPasswordResetRequestSchema>;

export const adminPasswordResetResponseSchema = z.object({
  ok: z.literal(true),
  userId: id,
  userName: z.string(),
  /** TEK SEFERLİK: yalnız bu yanıtta döner, hiçbir yere kaydedilmez. */
  password: z.string(),
  /** Kapatılan oturum sayısı. */
  sessionsEnded: int,
  /** Kullanıcı başka kaç işletmede üye (parola o işletmelerde de değişti). */
  otherTenantCount: int,
  at: iso,
});
export type AdminPasswordResetResponse = z.infer<typeof adminPasswordResetResponseSchema>;
