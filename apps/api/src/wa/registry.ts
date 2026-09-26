// Sağlayıcı seçimi (wa_accounts.provider) ve hesap referansı (api anahtarı lib/encryption ile çözülür).
// 'shared' (ortak numara, 00 §12a madde 8): işletme satırının kendi kimlik bilgisi yoktur; gönderim platform numarasının
// sağlayıcısı ve anahtarıyla (PLATFORM_WA_*) yapılır — platform uyarılarıyla aynı numara.

import type { WaOwnProvider } from '@siparis/core';
import type { waAccounts } from '@siparis/db';
import { platformDisplayPhone, type Config } from '../config';
import { createEncryptor, type Encryptor } from '../lib/encryption';
import { createCloudProvider } from './providers/cloud';
import { createD360Provider } from './providers/d360';
import { createMockProvider } from './providers/mock';
import type { WaAccountRef, WhatsAppProvider } from './types';

export type WaAccountRow = typeof waAccounts.$inferSelect;

const providers: Record<WaOwnProvider, WhatsAppProvider> = {
  mock: createMockProvider(),
  cloud: createCloudProvider(),
  d360: createD360Provider(),
};

/** Somut sağlayıcı (mock | cloud | d360). Ortak numara satırı için `providerForAccount` kullanılır. */
export function getWaProvider(name: WaOwnProvider): WhatsAppProvider {
  return providers[name] ?? providers.mock;
}

/** Hesap satırının gönderim sağlayıcısı: 'shared' → platform numarasının sağlayıcısı. */
export function providerForAccount(row: Pick<WaAccountRow, 'provider'>, config: Pick<Config, 'PLATFORM_WA_PROVIDER'>): WhatsAppProvider {
  return row.provider === 'shared' ? getWaProvider(config.PLATFORM_WA_PROVIDER) : getWaProvider(row.provider);
}

/** Numara başı hız sınırı anahtarı: ortak numarayı kullanan tüm işletmeler tek kovayı paylaşır. */
export function numberSlotKey(row: Pick<WaAccountRow, 'provider' | 'phoneNumberId' | 'id'>): string {
  return row.provider === 'shared' ? 'platform:shared' : (row.phoneNumberId ?? row.id);
}

const encryptors = new Map<string, Encryptor>();
export function encryptorFor(config: Config): Encryptor {
  let e = encryptors.get(config.ENCRYPTION_KEY);
  if (!e) {
    e = createEncryptor(config.ENCRYPTION_KEY);
    encryptors.set(config.ENCRYPTION_KEY, e);
  }
  return e;
}

/** Platform numarası (uyarılar ve ortak numara) için sağlayıcı referansı. */
export function platformAccountRef(config: Config, owner: { id?: string; tenantId?: string; branchId?: string } = {}): WaAccountRef {
  return {
    id: owner.id ?? 'platform',
    tenantId: owner.tenantId ?? 'platform',
    branchId: owner.branchId ?? 'platform',
    provider: config.PLATFORM_WA_PROVIDER,
    displayPhone: platformDisplayPhone(config),
    phoneNumberId: config.PLATFORM_WA_PHONE_NUMBER_ID ?? null,
    wabaId: null,
    apiKey: config.PLATFORM_WA_API_KEY ?? null,
  };
}

/** DB satırı → sağlayıcı referansı (şifreli anahtar çözülür; çözülemezse null). Ortak numarada platform bilgileri. */
export function toAccountRef(row: WaAccountRow, config: Config): WaAccountRef {
  if (row.provider === 'shared') return platformAccountRef(config, { id: row.id, tenantId: row.tenantId, branchId: row.branchId });
  let apiKey: string | null = null;
  if (row.apiKeyEnc) {
    try {
      apiKey = encryptorFor(config).decrypt(row.apiKeyEnc);
    } catch {
      apiKey = null;
    }
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    provider: row.provider,
    displayPhone: row.displayPhone,
    phoneNumberId: row.phoneNumberId,
    wabaId: row.wabaId,
    apiKey,
  };
}

/** Panelde gösterim: yalnız son 4 karakter. */
export function maskApiKey(plain: string | null): string | null {
  if (!plain) return null;
  const tail = plain.slice(-4);
  return `••••${tail}`;
}
