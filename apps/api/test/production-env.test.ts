// Canlı ortamın container ortamı uygulamanın gerçek açılış denetiminden geçer mi (00 §12a madde 10): loadConfig (üretimde
// productionConfigErrors) hata vermemeli.
//   - Cloudflare (canlı ortam; 15 §13): Worker'ın container'a verdiği ortam (deploy/cloudflare/src/mode.ts containerEnv +
//     src/whatsapp-env.ts), WhatsApp mock ve gerçek kipte.
//   - İsteğe bağlı Türkiye VPS'i (15 §14): .env (scripts/vps/env-merge.mjs) docker-compose.yml api servisindeki gibi kurulur:
//     env_file (.env) + environment (NODE_ENV, DATABASE_URL, APP_BASE_URL, DEV_TOOLS, ADMIN_TOTP_REQUIRED …).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containerEnv } from '../../../deploy/cloudflare/src/mode';
import { whatsappContainerEnv } from '../../../deploy/cloudflare/src/whatsapp-env';
import { mergeEnv, parseDotenv } from '../../../scripts/vps/env-merge.mjs';
import { channelDelivers, devToolsAllowed, loadConfig, platformDisplayPhone, productionConfigErrors, productionConfigWarnings, configSchema } from '../src/config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const BASE = { CLOUDFLARE_API_TOKEN: 'cf-token-abcdefghijklmnopqrstuvwxyz0123' };
const META = {
  META_WA_TOKEN: 'EAAGmetaSystemUserToken0123456789',
  META_WA_PHONE_NUMBER_ID: '109876543210987',
  META_WA_WABA_ID: '203040506070809',
  META_APP_SECRET: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  WA_PHONE: '+90 532 123 45 67',
};
const NETGSM = { NETGSM_USERCODE: '8501234567', NETGSM_PASSWORD: "p@ss#word$1", NETGSM_HEADER: 'YEMEKGELSIN' };
/** 360dialog (varsayılan yol, 15 §6.2): yalnız API anahtarı ve numara */
const D360 = { D360_API_KEY: 'd360-api-anahtari-0123456789', WA_PHONE: '0532 123 45 67' };

/** docker-compose.yml x-api-base: env_file .env + environment üzerine yazar. */
function composeApiEnv(envText: string): Record<string, string> {
  const file = Object.fromEntries(parseDotenv(envText));
  return {
    ...file,
    NODE_ENV: 'production',
    DATABASE_URL: `postgres://${file.POSTGRES_USER ?? 'siparis'}:${file.POSTGRES_PASSWORD}@postgres:5432/${file.POSTGRES_DB ?? 'siparis'}`,
    APP_BASE_URL: `https://${file.DOMAIN}`,
    API_PORT: '4000',
    API_HOST: '0.0.0.0',
    UPLOAD_DIR: '/data/uploads',
    DEV_TOOLS: file.DEV_TOOLS ?? '0',
    ADMIN_TOTP_REQUIRED: 'true',
    // Uygulamanın okumadığı gizli değerler boşla ezilir (Cloudflare token'ı yalnız caddy'ye)
    CLOUDFLARE_API_TOKEN: '',
    BACKUP_PING_URL: '',
    BACKUP_REMOTE: '',
  };
}

/** docker-compose.yml'de bir üst düzey bloğun (x-api-base, services altındaki bir servis) satırları. */
function composeBlock(compose: string, header: RegExp): string {
  const lines = compose.split('\n');
  const start = lines.findIndex((l) => header.test(l));
  if (start === -1) throw new Error(`blok yok: ${header}`);
  const indent = ((lines[start] ?? '').match(/^ */) ?? [''])[0].length;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.trim().startsWith('#') && (line.match(/^ */) ?? [''])[0].length <= indent) break;
    out.push(line);
  }
  return out.join('\n');
}

/** Worker'ın secret'ları gibi üretilmiş değerler (deploy/cloudflare/scripts/secrets.mjs biçimleri). */
const CF_SECRETS = {
  APP_BASE_URL: 'https://yemekgelsin.net',
  APP_VERSION: '0123abcd',
  DATA_EPOCH: '3',
  SEED_MODE: 'admin',
  DEV_PASSWORD: 'yonetici-parolasi-123',
  SESSION_SECRET: 'Zk3n0bq9X1v8m2L7c4R6t5Y0u9I8o7P6a5S4d3F2g1H0j9K8l7Z6x5C4v3B2n1M0q9W8e7R6t5Y4u3I2o1P0aA',
  TRACKING_SECRET: 'Tq9w8E7r6T5y4U3i2O1p0A9s8D7f6G5h4J3k2L1z0X9',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  WA_VERIFY_TOKEN: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  PLATFORM_WA_WEBHOOK_TOKEN: '9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d5e4f3021',
  VAPID_PUBLIC_KEY: `B${'A'.repeat(86)}`,
  VAPID_PRIVATE_KEY: 'C'.repeat(43),
};

/** Container içindeki API süreci: Worker ortamı + entrypoint.sh'in eklediği DATABASE_URL, API_PORT, API_HOST. */
function cloudflareApiEnv(mode: 'domain' | 'staging', wa: Record<string, string | undefined>): Record<string, string> {
  return {
    ...containerEnv(mode, CF_SECRETS, whatsappContainerEnv(mode === 'staging' ? {} : wa).env),
    DATABASE_URL: 'postgres://siparis:siparis@127.0.0.1:5432/siparis',
    API_PORT: '4000',
    API_HOST: '0.0.0.0',
  };
}

describe('canlı ortam, Cloudflare container ortamı → API yapılandırması', () => {
  it('WhatsApp mock (META secret\'ları yok): üretimde açılır, 2FA zorunlu, geliştirici araçları kapalı, ortak numara gösterilmez', () => {
    const config = loadConfig(cloudflareApiEnv('domain', {}));
    expect(config.NODE_ENV).toBe('production');
    expect(config.DEPLOY_ENV).toBe('production');
    expect(config.DEV_TOOLS).toBe(false);
    expect(devToolsAllowed(config)).toBe(false);
    expect(config.ADMIN_TOTP_REQUIRED).toBe(true);
    expect(config.PUBLIC_LEADS_ENABLED).toBe(true);
    expect(config.PLATFORM_WA_PROVIDER).toBe('mock');
    expect(config.SMS_PROVIDER).toBe('mock');
    expect(config.pushEnabled).toBe(true);
    // Çalışan WhatsApp yok: vitrin, QR ve Akış B numara göstermez (geliştirme numarası +905550000000 canlıda görünmez)
    expect(platformDisplayPhone(config)).toBeNull();
    // Açılışta uyarı yazılır (başlatmayı engellemez)
    expect(productionConfigWarnings(config).join(' ')).toMatch(/PLATFORM_WA_PROVIDER=mock/);
    // Taklit kanallar canlıda hiçbir yere göndermez: alarm zinciri bunları "gitti" saymaz (jobs/order runAlarmStep)
    expect(channelDelivers(config, 'platform_wa')).toBe(false);
    expect(channelDelivers(config, 'sms')).toBe(false);
  });

  it('gerçek WhatsApp (META secret\'ları tam): üretimde açılır, ortak numara gösterilir, webhook imzası zorunlu', () => {
    const config = loadConfig(cloudflareApiEnv('domain', META));
    expect(config.DEPLOY_ENV).toBe('production');
    expect(config.DEV_TOOLS).toBe(false);
    expect(config.ADMIN_TOTP_REQUIRED).toBe(true);
    expect(config.PLATFORM_WA_PROVIDER).toBe('cloud');
    expect(config.WA_APP_SECRET).toBe(META.META_APP_SECRET);
    expect(platformDisplayPhone(config)).toBe('+905321234567');
    expect(channelDelivers(config, 'platform_wa')).toBe(true);
    expect(channelDelivers(config, 'sms')).toBe(false);
  });

  it('gerçek WhatsApp, 360dialog (D360_API_KEY + WA_PHONE): üretimde açılır; imza anahtarı gerekmez, webhook belirteci ve numara var', () => {
    const config = loadConfig(cloudflareApiEnv('domain', D360));
    expect(config.DEPLOY_ENV).toBe('production');
    expect(config.DEV_TOOLS).toBe(false);
    expect(config.PLATFORM_WA_PROVIDER).toBe('d360');
    expect(config.PLATFORM_WA_API_KEY).toBe(D360.D360_API_KEY);
    expect(config.PLATFORM_WA_PHONE_NUMBER_ID).toBeUndefined();
    expect(config.WA_APP_SECRET).toBeUndefined();
    expect(config.PLATFORM_WA_WEBHOOK_TOKEN).toBe(CF_SECRETS.PLATFORM_WA_WEBHOOK_TOKEN);
    expect(platformDisplayPhone(config)).toBe('+905321234567');
    expect(channelDelivers(config, 'platform_wa')).toBe(true);
    expect(productionConfigWarnings(config).join(' ')).not.toMatch(/PLATFORM_WA_PROVIDER=mock/);
    // İki yol birlikte: Worker gerçek numarayı açmaz (iş akışı zaten durdurur)
    const both = loadConfig(cloudflareApiEnv('domain', { ...META, ...D360 }));
    expect(both.PLATFORM_WA_PROVIDER).toBe('mock');
    expect(platformDisplayPhone(both)).toBeNull();
  });

  it('DEV_TOOLS=1 canlı ortamda açılışı durdurur (Worker hiçbir kipte vermemeli)', () => {
    expect(() => loadConfig({ ...cloudflareApiEnv('domain', {}), DEV_TOOLS: '1' })).toThrow(/DEV_TOOLS üretimde 0 olmalı/);
  });

  it('gizli staging (isteğe bağlı VPS yolu): DEPLOY_ENV=dev, simülatör açık, geliştirme numarası', () => {
    const config = loadConfig(cloudflareApiEnv('staging', META));
    expect(config.DEPLOY_ENV).toBe('dev');
    expect(config.PLATFORM_WA_PROVIDER).toBe('mock');
    expect(devToolsAllowed(config)).toBe(true);
    expect(config.ADMIN_TOTP_REQUIRED).toBe(false);
    expect(platformDisplayPhone(config)).toBe('+905550000000');
    // Simülatörlü staging'de mock simülatöre "teslim eder"
    expect(channelDelivers(config, 'platform_wa')).toBe(true);
  });
});

describe('isteğe bağlı Türkiye VPS\'i: .env → API yapılandırması', () => {
  it('compose ortamı varsayımı docker-compose.yml ile aynı', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('env_file: .env');
    expect(compose).toContain('NODE_ENV: production');
    expect(compose).toContain('DATABASE_URL: postgres://${POSTGRES_USER:-siparis}:${POSTGRES_PASSWORD:?');
    expect(compose).toContain('APP_BASE_URL: https://${DOMAIN:?');
    expect(compose).toContain('ADMIN_TOTP_REQUIRED: "true"');
    expect(compose).toContain('DEV_TOOLS: ${DEV_TOOLS:-0}');
  });

  it('Cloudflare token\'ı (DNS düzenleme yetkili) yalnız caddy\'ye verilir; api/worker/migrate ortamında boştur', () => {
    const compose = readFileSync(resolve(ROOT, 'docker-compose.yml'), 'utf8');
    const apiBase = composeBlock(compose, /^x-api-base: &api-base/);
    expect(apiBase).toContain('env_file: .env');
    for (const key of ['CLOUDFLARE_API_TOKEN', 'BACKUP_PING_URL', 'BACKUP_REMOTE']) expect(apiBase).toMatch(new RegExp(`^ {4}${key}: ""$`, 'm'));
    const caddy = composeBlock(compose, /^ {2}caddy:$/);
    expect(caddy).toMatch(/^ {6}CLOUDFLARE_API_TOKEN: \$\{CLOUDFLARE_API_TOKEN:\?/m);
    expect(caddy).not.toContain('env_file');
    // api, worker ve migrate x-api-base'i kullanır (kendi env_file'ları yok)
    for (const svc of ['migrate', 'api', 'worker']) {
      const block = composeBlock(compose, new RegExp(`^ {2}${svc}:$`));
      expect(block).toContain('<<: *api-base');
      expect(block).not.toContain('env_file');
    }

    const merged = mergeEnv({ current: new Map(), secrets: { ...BASE, BACKUP_PING_URL: 'https://izleme.example/ping/abc' } });
    expect(merged.values.get('CLOUDFLARE_API_TOKEN')).toBe(BASE.CLOUDFLARE_API_TOKEN);
    const env = composeApiEnv(merged.text!);
    expect(env.CLOUDFLARE_API_TOKEN).toBe('');
    expect(env.BACKUP_PING_URL).toBe('');
    expect(loadConfig(env).NODE_ENV).toBe('production');
  });

  const cases: [string, Record<string, string>, { wa: string; sms: string }][] = [
    ['yalnız Cloudflare (WhatsApp ve SMS mock)', BASE, { wa: 'mock', sms: 'mock' }],
    ['gerçek WhatsApp', { ...BASE, ...META }, { wa: 'cloud', sms: 'mock' }],
    ['gerçek WhatsApp (360dialog)', { ...BASE, ...D360 }, { wa: 'd360', sms: 'mock' }],
    ['Netgsm', { ...BASE, ...NETGSM }, { wa: 'mock', sms: 'netgsm' }],
    ['gerçek WhatsApp + Netgsm (WABA yok)', { ...BASE, ...META, META_WA_WABA_ID: '', ...NETGSM }, { wa: 'cloud', sms: 'netgsm' }],
  ];

  for (const [name, secrets, expected] of cases) {
    it(`${name}: loadConfig üretimde açılır, geliştirici araçları kapalı, yönetici 2FA zorunlu`, () => {
      const first = mergeEnv({ current: new Map(), secrets });
      expect(first.errors).toEqual([]);
      const second = mergeEnv({ current: parseDotenv(first.text!), secrets });
      expect(second.text).toBe(first.text);

      const env = composeApiEnv(first.text!);
      const parsed = configSchema.parse(env);
      expect(productionConfigErrors(parsed)).toEqual([]);
      const config = loadConfig(env);
      expect(config.NODE_ENV).toBe('production');
      expect(config.DEPLOY_ENV).toBe('production');
      expect(config.DEV_TOOLS).toBe(false);
      expect(config.ADMIN_TOTP_REQUIRED).toBe(true);
      expect(config.APP_BASE_URL).toBe('https://yemekgelsin.net');
      expect(config.pushEnabled).toBe(true);
      expect(config.PLATFORM_WA_PROVIDER).toBe(expected.wa);
      expect(config.SMS_PROVIDER).toBe(expected.sms);
      if (expected.wa === 'cloud') {
        expect(platformDisplayPhone(config)).toBe('+905321234567');
        expect(config.WA_APP_SECRET).toBe(META.META_APP_SECRET);
      } else if (expected.wa === 'd360') {
        expect(platformDisplayPhone(config)).toBe('+905321234567');
        expect(config.PLATFORM_WA_API_KEY).toBe(D360.D360_API_KEY);
        expect(config.WA_APP_SECRET).toBeUndefined();
      } else {
        // Canlı ortamda mock iken geliştirme numarası gösterilmez
        expect(platformDisplayPhone(config)).toBeNull();
      }
      if (expected.sms === 'netgsm') expect(config.NETGSM_PASSWORD).toBe(NETGSM.NETGSM_PASSWORD);
    });
  }
});
