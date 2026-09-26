// Uçtan uca test ortamı sabitleri (playwright.config.ts, globalSetup ve testler ortak kullanır).
// Portlar ve veritabanı geliştirme ortamından ayrıdır: API 4200, web 3200, DB siparis_e2e_test.

import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Depo kökü (bu dosya e2e/support altında). */
export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const API_PORT = Number(process.env.E2E_API_PORT ?? 4200);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3200);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://siparis:siparis@localhost:5432/siparis_e2e_test';

/** Yalnız e2e için sabit gizli değerler (üretimde asla kullanılmaz). */
export const E2E_SECRETS = {
  SESSION_SECRET: 'e2e-only-session-secret-0123456789abcdef',
  TRACKING_SECRET: 'e2e-only-tracking-secret',
  // 32 bayt (0x07 ile dolu) base64 — AES-256-GCM anahtarı
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
} as const;

/** API ve worker süreçlerinin ortamı (14 §3). */
export function apiEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: E2E_DATABASE_URL,
    TEST_DATABASE_URL: '',
    APP_BASE_URL: WEB_URL,
    API_PORT: String(API_PORT),
    ...E2E_SECRETS,
    WA_DEFAULT_PROVIDER: 'mock',
    WA_APP_SECRET: '',
    WA_VERIFY_TOKEN: 'e2e-verify',
    PLATFORM_WA_PROVIDER: 'mock',
    SMS_PROVIDER: 'mock',
    UPLOAD_DIR: join(tmpdir(), 'siparis-e2e-uploads'),
    ANTHROPIC_API_KEY: '',
    DEV_TOOLS: '1',
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  };
}

/** Web (next dev) sürecinin ortamı. NODE_ENV'i Next kendisi belirler. */
export function webEnv(): Record<string, string> {
  return {
    API_INTERNAL_URL: API_URL,
    NEXT_DIST_DIR: '.next-e2e',
    DEV_TOOLS: '1',
    NEXT_PUBLIC_DEV_TOOLS: '1',
    APP_BASE_URL: WEB_URL,
    NEXT_PUBLIC_SITE_URL: WEB_URL,
    // Alt alan adı yönlendirmesi kapalı: localhost'ta /s/{slug} kullanılır
    NEXT_PUBLIC_ROOT_DOMAIN: '',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

/** Önceden kurulu Chromium (14 §1: /opt/pw-browsers). Değişken tanımlıysa ona dokunulmaz. */
export function ensureBrowsersPath(): void {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  }
}

/** Seed'deki demo verisi (packages/db/src/seed.ts DEMO ile aynı). */
export const DEMO = {
  slug: 'bozok-pide',
  tenantName: 'Bozok Pide Salonu',
  // Ortak numara (00 §12a madde 8): demo işletmeler platform numarasını kullanır (seed DEMO.waDisplayPhone)
  waDisplayPhone: '+905550000000',
  /** Dükkan kodu (QR'daki #KOD) */
  waCode: 'BOZOK',
  owner: { email: 'demo@siparisinonunde.local', password: 'demo1234' },
  admin: { email: 'admin@siparisinonunde.local', password: 'admin1234' },
  courier: { name: 'Burak Kurye' },
} as const;

/** İkinci demo işletme (seed): aynı ortak numarada, kodu DONER. */
export const DONER = {
  slug: 'camlik-doner',
  tenantName: 'Çamlık Döner',
  waCode: 'DONER',
  owner: { email: 'doner@siparisinonunde.local', password: 'doner1234' },
} as const;

/** Simülatördeki ortak numara seçeneği (components/whatsapp/simulator.tsx). */
export const SHARED_NUMBER_LABEL = 'Siparişin Önünde · ortak numara';
