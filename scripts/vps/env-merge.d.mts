// scripts/vps/env-merge.mjs tür bildirimleri (apps/api/test/production-env.test.ts gerçek loadConfig ile doğrular).

export declare const DEFAULT_DOMAIN: string;
export declare const BACKUP_DIR: string;
export declare const GENERATED_KEYS: readonly string[];
export declare const SENSITIVE_KEYS: readonly string[];

export declare function parseDotenv(text: string): Map<string, string>;
export declare function formatValue(key: string, value: string): string;
export declare function serializeEnv(values: Map<string, string>, extras: Map<string, string>): string;
export declare function normalizeE164(raw: string | null | undefined): string | null;
export declare function isMetaId(v: string | null | undefined): boolean;
export declare function generateVapidKeys(): { publicKey: string; privateKey: string };

export interface Generators {
  POSTGRES_PASSWORD: () => string;
  SESSION_SECRET: () => string;
  TRACKING_SECRET: () => string;
  ENCRYPTION_KEY: () => string;
  WA_VERIFY_TOKEN: () => string;
  PLATFORM_WA_WEBHOOK_TOKEN: () => string;
  vapid: () => { publicKey: string; privateKey: string };
}
export declare const DEFAULT_GENERATORS: Generators;

export interface MergeResult {
  ok: boolean;
  text: string | null;
  values: Map<string, string>;
  errors: string[];
  warnings: string[];
  generated: string[];
  kept: string[];
  whatsapp: 'd360' | 'cloud' | 'mock';
  sms: 'netgsm' | 'mock';
  sensitive: string[];
}

export declare function mergeEnv(input: {
  current: Map<string, string> | Record<string, string>;
  secrets: Record<string, string | undefined>;
  generators?: Generators;
}): MergeResult;
