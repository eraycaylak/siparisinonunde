// Canlı ortam .env'i (scripts/vps/env-merge.mjs) uygulamanın gerçek açılış denetiminden geçer mi (00 §12a madde 10;
// 15 §14): her secret birleşiminde loadConfig (üretimde productionConfigErrors) hata vermemeli. Ortam, docker-compose.yml
// api servisindeki gibi kurulur: env_file (.env) + environment (NODE_ENV, DATABASE_URL, APP_BASE_URL, DEV_TOOLS,
// ADMIN_TOTP_REQUIRED …).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mergeEnv, parseDotenv } from '../../../scripts/vps/env-merge.mjs';
import { loadConfig, platformDisplayPhone, productionConfigErrors, configSchema } from '../src/config';

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

describe('canlı ortam .env → API yapılandırması', () => {
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
      } else {
        // Canlı ortamda mock iken geliştirme numarası gösterilmez
        expect(platformDisplayPhone(config)).toBeNull();
      }
      if (expected.sms === 'netgsm') expect(config.NETGSM_PASSWORD).toBe(NETGSM.NETGSM_PASSWORD);
    });
  }
});
