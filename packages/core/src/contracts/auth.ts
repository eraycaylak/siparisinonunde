// Kimlik uç noktaları (14 §6.1).

import { z } from 'zod';
import {
  lifecycleStageSchema,
  planCodeSchema,
  platformRoleSchema,
  tenantRoleSchema,
} from '../enums';
import { idSchema, isoDateTimeSchema } from './common';

export const userDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPlatformAdmin: z.boolean(),
  platformRole: platformRoleSchema.nullable(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const tenantDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  lifecycleStage: lifecycleStageSchema,
  planCode: planCodeSchema,
  trialEndsAt: isoDateTimeSchema.nullable(),
  orderingEnabled: z.boolean(),
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  defaultBranchId: idSchema.nullable(),
});
export type TenantDto = z.infer<typeof tenantDtoSchema>;

export const membershipDtoSchema = z.object({
  tenantId: idSchema,
  tenantName: z.string(),
  tenantSlug: z.string(),
  role: tenantRoleSchema,
  branchId: idSchema.nullable(),
});
export type MembershipDto = z.infer<typeof membershipDtoSchema>;

export const signupRequestSchema = z.object({
  businessName: z.string().trim().min(2).max(80),
  ownerName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(20),
  email: z.email().trim().max(254),
  password: z.string().min(8).max(200),
  city: z.string().trim().min(2).max(40).optional(),
  acceptTerms: z.literal(true),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const signupResponseSchema = z.object({
  user: userDtoSchema,
  tenant: tenantDtoSchema,
});
export type SignupResponse = z.infer<typeof signupResponseSchema>;

/** Doğrulama uygulamasındaki 6 haneli TOTP kodu. */
export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, '6 haneli kodu yazın.');

/** Tek kullanımlık kurtarma kodu ("ABCD-EFGH"; küçük harf, boşluk ve tire serbest). */
export const recoveryCodeSchema = z.string().trim().min(8).max(20);

/** İkinci adım kodu: 6 haneli TOTP ya da kurtarma kodu (kapatma ve kod yenilemede). */
export const secondFactorCodeSchema = z.string().trim().min(6).max(20);

export const loginRequestSchema = z.object({
  /** E-posta ya da telefon. */
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
  /** İki adımlı doğrulama açıksa (API önce `totp_required` döner). */
  totp: totpCodeSchema.optional(),
  /** Telefon yoksa: tek kullanımlık kurtarma kodu (totp yerine). */
  recoveryCode: recoveryCodeSchema.optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  user: userDtoSchema,
  memberships: z.array(membershipDtoSchema),
  isPlatformAdmin: z.boolean(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const meResponseSchema = z.object({
  user: userDtoSchema,
  tenant: tenantDtoSchema.nullable(),
  role: tenantRoleSchema.nullable(),
  branchId: idSchema.nullable(),
  memberships: z.array(membershipDtoSchema),
  isPlatformAdmin: z.boolean(),
  /** Kullanıcının iki adımlı doğrulaması (TOTP) açık mı. */
  totpEnabled: z.boolean(),
  /** Yalnız platform yöneticisinde: TOTP zorunlu mu (ADMIN_TOTP_REQUIRED). Zorunlu ve kapalıysa admin uçları 403 `totp_enrollment_required`. */
  totpRequired: z.boolean().optional(),
  readOnly: z.boolean(),
  impersonating: z
    .object({
      tenantId: idSchema,
      impersonatorUserId: idSchema,
      expiresAt: isoDateTimeSchema,
    })
    .nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const switchTenantRequestSchema = z.object({ tenantId: idSchema });
export type SwitchTenantRequest = z.infer<typeof switchTenantRequestSchema>;

export const courierExchangeRequestSchema = z.object({ token: z.string().min(16).max(200) });
export type CourierExchangeRequest = z.infer<typeof courierExchangeRequestSchema>;

// ---------------------------------------------------------------------------
// İki adımlı doğrulama (TOTP; 00 §12a madde 7). Yalnız kişisel oturum (kind 'user'); destek görünümü, kurye ve
// cihaz oturumları kullanamaz.

/** GET /auth/totp */
export const totpStatusResponseSchema = z.object({
  enabled: z.boolean(),
  enabledAt: isoDateTimeSchema.nullable(),
  /** Kullanılmamış kurtarma kodu sayısı */
  recoveryCodesRemaining: z.number().int().min(0),
  /** Platform yöneticisi ve ADMIN_TOTP_REQUIRED açık: kapatılamaz */
  required: z.boolean(),
});
export type TotpStatusResponse = z.infer<typeof totpStatusResponseSchema>;

/** POST /auth/totp/setup — bekleyen sır üretir (etkinleştirilene kadar girişte kullanılmaz). */
export const totpSetupResponseSchema = z.object({
  /** Base32 sır (elle girmek için) */
  secret: z.string(),
  /** otpauth://totp/… adresi */
  otpauthUrl: z.string(),
  /** Aynı adresin QR kodu (SVG metni; istemci data: URL ile <img> içinde gösterir) */
  qrSvg: z.string(),
});
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;

/** POST /auth/totp/enable */
export const totpEnableRequestSchema = z.object({ code: totpCodeSchema });
export type TotpEnableRequest = z.infer<typeof totpEnableRequestSchema>;

/** Yeni kurtarma kodları: yalnız bu yanıtta düz metin görünür. */
export const totpRecoveryCodesResponseSchema = z.object({ recoveryCodes: z.array(z.string()) });
export type TotpRecoveryCodesResponse = z.infer<typeof totpRecoveryCodesResponseSchema>;

/** POST /auth/totp/disable */
export const totpDisableRequestSchema = z.object({
  password: z.string().min(1).max(200),
  code: secondFactorCodeSchema,
});
export type TotpDisableRequest = z.infer<typeof totpDisableRequestSchema>;

/** POST /auth/totp/recovery-codes */
export const totpRegenerateRequestSchema = z.object({ code: secondFactorCodeSchema });
export type TotpRegenerateRequest = z.infer<typeof totpRegenerateRequestSchema>;
