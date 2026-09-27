// Ortak numara "WhatsApp kurulumu"nun (15 §6.2a) iki sağlayıcıda (cloud: Meta Graph, d360: 360dialog) ortak yardımcıları:
// yapılandırma alt kümesi, ortam değişkeni → GitHub secret adı, maskeleme, ön koşullar ve Türkçe etiket tabloları.

import { WA_PROVIDER_LABELS } from '@siparis/core';
import type { AdminWaSetupTone } from '@siparis/core/admin/contracts';
import type { Config } from '../../config';
import { conflict } from '../../lib/errors';

export type WaSetupConfig = Pick<
  Config,
  | 'APP_BASE_URL'
  | 'NODE_ENV'
  | 'DEPLOY_ENV'
  | 'PLATFORM_WA_PROVIDER'
  | 'PLATFORM_WA_API_KEY'
  | 'PLATFORM_WA_PHONE_NUMBER_ID'
  | 'PLATFORM_WA_WABA_ID'
  | 'PLATFORM_WA_DISPLAY_PHONE'
  | 'PLATFORM_WA_WEBHOOK_TOKEN'
  | 'WA_APP_SECRET'
  | 'WA_VERIFY_TOKEN'
>;

type Provider = WaSetupConfig['PLATFORM_WA_PROVIDER'];

/** Ortam değişkeni → canlı ortamdaki (Cloudflare) GitHub secret'ı, sağlayıcıya göre (15 §13, §6.2, §6.2b). */
const LIVE_SECRET: Record<'cloud' | 'd360', Record<string, string>> = {
  cloud: {
    PLATFORM_WA_API_KEY: 'META_WA_TOKEN',
    PLATFORM_WA_PHONE_NUMBER_ID: 'META_WA_PHONE_NUMBER_ID',
    PLATFORM_WA_WABA_ID: 'META_WA_WABA_ID',
    WA_APP_SECRET: 'META_APP_SECRET',
    PLATFORM_WA_DISPLAY_PHONE: 'WA_PHONE',
  },
  d360: {
    PLATFORM_WA_API_KEY: 'D360_API_KEY',
    PLATFORM_WA_DISPLAY_PHONE: 'WA_PHONE',
  },
};

/** "PLATFORM_WA_API_KEY (canlı ortam: GitHub secret D360_API_KEY)"; mock'ta varsayılan yol (360dialog) adları. */
export function envName(name: string, provider: Provider): string {
  const s = LIVE_SECRET[provider === 'cloud' ? 'cloud' : 'd360'][name];
  return s ? `${name} (canlı ortam: GitHub secret ${s})` : name;
}

export function tail(v: string | undefined | null): string | null {
  return v ? `••••${v.slice(-4)}` : null;
}

export const baseUrl = (c: Pick<Config, 'APP_BASE_URL'>) => c.APP_BASE_URL.replace(/\/+$/, '');
export const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** Ortak webhook yolu öneki: <APP_BASE_URL>/api/v1/webhooks/wa/shared/ */
export const sharedWebhookPrefix = (c: Pick<Config, 'APP_BASE_URL'>) => `${baseUrl(c)}/api/v1/webhooks/wa/shared/`;

/** Maskeli ortak webhook adresi (…/shared/••••abcd); belirteç yoksa null. */
export function maskedSharedWebhook(c: Pick<Config, 'APP_BASE_URL' | 'PLATFORM_WA_WEBHOOK_TOKEN'>): string | null {
  const token = c.PLATFORM_WA_WEBHOOK_TOKEN;
  return token ? `${sharedWebhookPrefix(c)}••••${token.slice(-4)}` : null;
}

export function requireHttpsBase(c: Pick<Config, 'APP_BASE_URL'>, why: string): void {
  if (!baseUrl(c).startsWith('https://')) throw conflict('wa_setup_base_url', `APP_BASE_URL https ile başlamıyor (${baseUrl(c)}): ${why}.`);
}

/** Taklit sağlayıcıda gerçek bir sağlayıcıya çağrı yapılmaz (409 wa_setup_mock). */
export function requireRealProvider(c: Pick<WaSetupConfig, 'PLATFORM_WA_PROVIDER'>): void {
  if (c.PLATFORM_WA_PROVIDER !== 'mock') return;
  throw conflict(
    'wa_setup_mock',
    `Sağlayıcı ${WA_PROVIDER_LABELS.mock.toLocaleLowerCase('tr')} (mock): gerçek WhatsApp bağlı değil. Varsayılan yol 360dialog: GitHub secret'ları ` +
      "D360_API_KEY ve WA_PHONE'u ekleyip Actions › \"Canlı ortam (Cloudflare)\" › Run workflow (docs/15 §6.2). Meta doğrudan yol: META_* secret'ları (docs/15 §6.2b).",
  );
}

/** Meta'nın hız sınırı kodları (Graph ve 360dialog'un ilettiği Meta hataları). */
export const RATE_LIMIT_CODES = new Set(['4', '17', '32', '613', '80004', '80007', '80008', '130429']);

export type ToneMap = Record<string, [string, AdminWaSetupTone]>;

export const NAME_STATUS: ToneMap = {
  APPROVED: ['Onaylandı', 'ok'],
  AVAILABLE_WITHOUT_REVIEW: ['İncelemesiz kullanılabilir', 'ok'],
  PENDING_REVIEW: ['Meta incelemesinde', 'warn'],
  DECLINED: ['Reddedildi', 'bad'],
  EXPIRED: ['Süresi doldu', 'bad'],
  NONE: ['Yok', 'warn'],
};

export const QUALITY: ToneMap = {
  GREEN: ['Yüksek (yeşil)', 'ok'],
  YELLOW: ['Orta (sarı)', 'warn'],
  RED: ['Düşük (kırmızı)', 'bad'],
  UNKNOWN: ['Henüz ölçülmedi', 'info'],
  NA: ['Henüz ölçülmedi', 'info'],
};

export function toneLabel(map: ToneMap, v: string | null, fallbackTone: AdminWaSetupTone = 'warn'): [string, AdminWaSetupTone] {
  if (!v) return ['Bilinmiyor', 'info'];
  return map[v] ?? [v, fallbackTone];
}

export const str = (v: unknown) => (v == null || v === '' ? null : String(v));
