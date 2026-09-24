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

export const loginRequestSchema = z.object({
  /** E-posta ya da telefon. */
  login: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
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
