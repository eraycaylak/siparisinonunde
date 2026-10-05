// Taslak sözleşme kapısı (denetim B2 · docs/08 §7.5 · FAZ 0.3): canlı dağıtımda yasal metin yayına hazır değilse
// sipariş oluşturma reddedilir. Veritabanı gerektirmez.
//
// Uçtan uca davranış (POST /store/:slug/orders):
//   - NODE_ENV=production + DEPLOY_ENV=production + (taslak sürüm | eksik künye | özeti olmayan sürüm) → 503
//     `ordering_unavailable`, hiçbir kayıt ve hiçbir `legal_acceptances` satırı yazılmaz
//   - geliştirme/test ve gizli staging (DEPLOY_ENV=dev) → kapı uygulanmaz, akışlar bozulmaz
//
// Bu dosya ayrıca İKİ SAPMA KAPISI içerir: kapının künye listesi apps/web/lib/site.ts ile, metin içerik özeti
// scripts/check-legal.ts ile aynı kalmalı (apps/api o iki dosyayı içe aktaramaz, bu yüzden kaynak metinden okunur).

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LEGAL_DOCUMENT_VERSION, isDraftLegalVersion } from '@siparis/core';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_LEGAL_ENTITY_ENVS,
  isLiveDeployment,
  legalGateAlertMessage,
  legalOrderingBlocked,
  legalOrderingGate,
  legalTextDigest,
  missingLegalEntityEnvs,
} from '../src/services/orders/legal-gate';

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const LIVE = { NODE_ENV: 'production', DEPLOY_ENV: 'production' };
const STAGING = { NODE_ENV: 'production', DEPLOY_ENV: 'dev' };
const LOCAL = { NODE_ENV: 'test', DEPLOY_ENV: 'production' };

/** Künyesi tam bir ortam (gerçek değer değil, yalnız "dolu" olması önemli). */
const FULL_ENTITY_ENV: Record<string, string> = Object.fromEntries(REQUIRED_LEGAL_ENTITY_ENVS.map((k) => [k, 'dolu']));

describe('künye zorunlu alanları', () => {
  it('apps/web/lib/site.ts ile aynı listede (sapma kapısı)', () => {
    // site.ts tek kaynaktır: `required: true` VE `fallback` tanımı OLMAYAN alanlar eksikse künye yayına hazır değildir.
    const src = read('apps/web/lib/site.ts');
    const block = /const LEGAL_ENTITY_FIELDS = \{([\s\S]*?)\n\} satisfies/.exec(src);
    expect(block, 'site.ts içinde LEGAL_ENTITY_FIELDS bloğu bulunamadı').toBeTruthy();
    const expected = block![1]!
      .split('\n')
      .filter((line) => /required: true/.test(line) && !/fallback:/.test(line))
      .map((line) => /env: '([^']+)'/.exec(line)?.[1])
      .filter((v): v is string => Boolean(v));
    expect(expected.length).toBeGreaterThan(0);
    expect([...REQUIRED_LEGAL_ENTITY_ENVS]).toEqual(expected);
  });

  it('boş, yalnız boşluk ve tanımsız değerler eksik sayılır; NEXT_PUBLIC_ öneki kabul edilir', () => {
    expect(missingLegalEntityEnvs({})).toEqual([...REQUIRED_LEGAL_ENTITY_ENVS]);
    expect(missingLegalEntityEnvs(FULL_ENTITY_ENV)).toEqual([]);
    expect(missingLegalEntityEnvs({ ...FULL_ENTITY_ENV, LEGAL_ENTITY_ADDRESS: '   ' })).toEqual(['LEGAL_ENTITY_ADDRESS']);
    const viaPublic = { ...FULL_ENTITY_ENV, LEGAL_ENTITY_TAX_NO: '', NEXT_PUBLIC_LEGAL_ENTITY_TAX_NO: 'dolu' };
    expect(missingLegalEntityEnvs(viaPublic)).toEqual([]);
  });
});

describe('yasal metin içerik özeti', () => {
  it('scripts/check-legal.ts PINNED_TEXT_DIGEST ile aynı (sapma kapısı)', () => {
    const src = read('scripts/check-legal.ts');
    const pinned = new RegExp(`'${LEGAL_DOCUMENT_VERSION}':\\s*'([0-9a-f]{64})'`).exec(src);
    expect(pinned, `check-legal.ts "${LEGAL_DOCUMENT_VERSION}" için özet sabitlememiş`).toBeTruthy();
    expect(legalTextDigest()).toBe(pinned![1]);
  });

  it('sabitlenmemiş sürümde null döner', () => {
    expect(legalTextDigest('2099-01-01')).toBeNull();
  });
});

describe('isLiveDeployment', () => {
  it('yalnız üretim derlemesi + üretim dağıtımı canlıdır', () => {
    expect(isLiveDeployment(LIVE)).toBe(true);
    expect(isLiveDeployment(STAGING)).toBe(false);
    expect(isLiveDeployment(LOCAL)).toBe(false);
    expect(isLiveDeployment({ NODE_ENV: 'development', DEPLOY_ENV: 'dev' })).toBe(false);
  });
});

describe('legalOrderingGate', () => {
  it('yürürlükteki sürüm taslak olduğu sürece canlı dağıtımda sipariş alınmaz', () => {
    const gate = legalOrderingGate(LIVE, FULL_ENTITY_ENV);
    // Sürüm yayına çevrildiğinde (08 §7.5) bu dal kendiliğinden tersine döner; test sabit bir tarihe çivilenmez.
    if (isDraftLegalVersion(LEGAL_DOCUMENT_VERSION)) {
      expect(gate.blocked).toBe(true);
      expect(gate.reasons.join(' ')).toContain('taslak');
    } else {
      expect(gate.blocked).toBe(false);
      expect(gate.reasons).toEqual([]);
    }
    expect(gate.live).toBe(true);
    expect(gate.version).toBe(LEGAL_DOCUMENT_VERSION);
  });

  it('eksik künye canlı dağıtımda kapıyı kapatır ve eksik değişken ADLARINI gerekçeye yazar', () => {
    const gate = legalOrderingGate(LIVE, {});
    expect(gate.blocked).toBe(true);
    expect(gate.reasons.some((r) => r.includes('LEGAL_ENTITY_NAME'))).toBe(true);
    expect(gate.reasons.some((r) => r.includes('6563'))).toBe(true);
  });

  it('gizli staging ve yerel ortamda gerekçeler durur ama kapı UYGULANMAZ', () => {
    for (const config of [STAGING, LOCAL]) {
      const gate = legalOrderingGate(config, {});
      expect(gate.blocked).toBe(false);
      expect(gate.live).toBe(false);
      expect(gate.reasons.length).toBeGreaterThan(0);
    }
  });

  it('açılış uyarısı metni kapının uygulanıp uygulanmadığını ayırt eder', () => {
    expect(legalGateAlertMessage(legalOrderingGate(LIVE, {}))).toContain('KAPALI');
    expect(legalGateAlertMessage(legalOrderingGate(STAGING, {}))).not.toContain('KAPALI');
  });
});

describe('legalOrderingBlocked', () => {
  it('müşteriye 503 + anlaşılır Türkçe; teknik ayrıntı ve gerekçe sızmaz', () => {
    const err = legalOrderingBlocked();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('ordering_unavailable');
    expect(err.message).toMatch(/sipariş alamıyoruz/i);
    expect(err.message).not.toMatch(/taslak|LEGAL_|digest|sürüm/i);
    expect(err.details).toBeUndefined();
  });
});
