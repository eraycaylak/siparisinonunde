// Ortam değişkenleri (14 §3), Zod ile doğrulanır.

import { resolve } from 'node:path';
import { z } from 'zod';

const bool01 = z
  .union([z.string(), z.boolean(), z.undefined()])
  .transform((v) => v === true || v === '1' || v === 'true');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL zorunlu'),
  TEST_DATABASE_URL: optionalString,
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_PORT: z.coerce.number().int().default(3000),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET en az 16 karakter'),
  TRACKING_SECRET: z.string().min(8, 'TRACKING_SECRET en az 8 karakter'),
  ENCRYPTION_KEY: z.string().refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'ENCRYPTION_KEY 32 bayt base64 olmalı'),
  WA_DEFAULT_PROVIDER: z.enum(['mock', 'cloud', 'd360']).default('mock'),
  WA_APP_SECRET: optionalString,
  WA_VERIFY_TOKEN: z.string().default('dev-verify'),
  PLATFORM_WA_PROVIDER: z.enum(['mock', 'cloud', 'd360']).default('mock'),
  PLATFORM_WA_API_KEY: optionalString,
  SMS_PROVIDER: z.enum(['mock', 'netgsm']).default('mock'),
  NETGSM_USERCODE: optionalString,
  NETGSM_PASSWORD: optionalString,
  NETGSM_HEADER: optionalString,
  UPLOAD_DIR: z.string().default('./uploads'),
  ANTHROPIC_API_KEY: optionalString,
  DEV_TOOLS: bool01.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof configSchema> & {
  /** Çerezde Secure bayrağı (üretim ya da https kök adres) */
  cookieSecure: boolean;
  /** Mutlak yükleme dizini */
  uploadDirAbs: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Geçersiz yapılandırma: ${msg}`);
  }
  const c = parsed.data;
  return {
    ...c,
    cookieSecure: c.NODE_ENV === 'production' || c.APP_BASE_URL.startsWith('https://'),
    uploadDirAbs: resolve(process.cwd(), c.UPLOAD_DIR),
  };
}
