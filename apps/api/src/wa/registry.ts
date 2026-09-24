// Sağlayıcı seçimi (wa_accounts.provider) ve hesap referansı (api anahtarı lib/encryption ile çözülür).

import type { WaProvider } from '@siparis/core';
import type { waAccounts } from '@siparis/db';
import type { Config } from '../config';
import { createEncryptor, type Encryptor } from '../lib/encryption';
import { createCloudProvider } from './providers/cloud';
import { createD360Provider } from './providers/d360';
import { createMockProvider } from './providers/mock';
import type { WaAccountRef, WhatsAppProvider } from './types';

export type WaAccountRow = typeof waAccounts.$inferSelect;

const providers: Record<WaProvider, WhatsAppProvider> = {
  mock: createMockProvider(),
  cloud: createCloudProvider(),
  d360: createD360Provider(),
};

export function getWaProvider(name: WaProvider): WhatsAppProvider {
  return providers[name] ?? providers.mock;
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

/** DB satırı → sağlayıcı referansı (şifreli anahtar çözülür; çözülemezse null). */
export function toAccountRef(row: WaAccountRow, config: Config): WaAccountRef {
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
