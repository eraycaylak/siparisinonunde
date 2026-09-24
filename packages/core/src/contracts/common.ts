// Ortak API şemaları (14 §6): hata biçimi, liste yanıtı, temel tipler.

import { z } from 'zod';

export const idSchema = z.uuid();
/** Integer kuruş. */
export const kurusSchema = z.number().int();
export const nonNegativeKurusSchema = z.number().int().min(0);
/** Yanıtlardaki tarihler ISO 8601 metin olarak gelir. */
export const isoDateTimeSchema = z.string();

/** Hata kodları (snake_case). Diğer dilimler kendi kodlarını ekleyebilir (metin olarak). */
export const ERROR_CODES = [
  'validation_error',
  'unauthorized',
  'forbidden',
  'tenant_required',
  'read_only_session',
  'not_found',
  'conflict',
  'version_conflict',
  'invalid_transition',
  'rejection_pending',
  'ordering_closed',
  'rate_limited',
  'invalid_credentials',
  'email_taken',
  'phone_taken',
  'signup_closed',
  'invalid_link',
  'payload_too_large',
  'unsupported_media_type',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().optional(),
  });
}
export interface ListResponse<T> {
  items: T[];
  nextCursor?: string;
}

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;

/** Sayfalama sorgusu. */
export const cursorQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
