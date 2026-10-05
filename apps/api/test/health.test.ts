// Sağlık uçları (apps/api/src/routes/health.ts): `/health` süreç + veritabanı, `/health/worker` kuyruk gecikmesi
// (`ok`) + son yedeğin yaşı ve disk/bellek baskısı (`degraded` + `warnings`).
// Kuyruk gecikmesi testi jobs.test.ts'te; burada yedek yaşı, kaynak alanları ve eşik davranışı sınanır.
//
// BU DOSYANIN ASIL ÇİVİSİ (denetim 2026-10-05 bulgu A): eşik aşımı **503 ÜRETMEZ**. Duman testi bu uca 200 bekler ve
// kırmızısı `wrangler rollback` tetikler (.github/workflows/deploy-dev-cloudflare.yml) — yani eşikler `ok`'i
// düşürürse sağlam bir dağıtım yalnızca yedek biraz eski diye geri alınır. Aşağıdaki "eşikten eski yedek → 200 +
// degraded" ve "disk eşiği aşıldı → 200 + degraded" vakaları o regresyonu bir daha olmaması için kilitler.
//
// Durum dosyasının biçimi UYDURULMAZ: yazan taraf deploy/cloudflare/entrypoint.sh `backup_state_write`
// (`lastSuccessUnix` / `consecutiveFailures` / `lastResult`), yol değişkeni `BACKUP_STATE_FILE`.
// Disk ve bellek eşikleri uç testlerinde BİLEREK kapatılır (0): gerçek makinenin dolu diski testi yanlış uyarıya
// düşürmesin. O eşiklerin mantığı resourceWarnings birim testlerinde (ölçüm enjekte edilerek) sınanır.
//
// İKİNCİ ÇİVİ (denetim 2026-10-05 bulgu A-2): ayrıntılı ölçümler (yedek yaşı, disk, bellek) kimlik doğrulamasız
// yanıtta BULUNMAZ; yalnız `HEALTH_METRICS_TOKEN` başlığını taşıyan istek görür. `workerHealth()` bu yüzden
// belirteci VARSAYILAN OLARAK gönderir (ölçüm vakaları ayrıntıya bakıyor); `{ token: null }` ise herkese açık
// yanıtı sorar. "Sade alanlar her zaman açık" ve "ayrıntı belirteçsiz yok" vakaları aşağıdaki son blokta.

import { jobs } from '@siparis/db';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_STATE_FILE_DEFAULT,
  HEALTH_ALERT_COOLDOWN_MS,
  HEALTH_LIMIT_DEFAULTS,
  HEALTH_METRICS_HEADER,
  HEALTH_METRICS_TOKEN_MIN_LEN,
  HEALTH_WARNINGS,
  WORKER_MAX_LAG_SEC,
  backupAgeSecFrom,
  dueWarnings,
  healthLimits,
  healthWarningAlert,
  metricsAllowed,
  resetHealthWarningCooldown,
  resourceWarnings,
  type HealthResources,
  type HealthWarning,
} from '../src/routes/health';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
let statusFile: string;
/** Testin dokunduğu ortam değişkenleri (api testleri tek süreçte sırayla koşar: sonunda eski değerler geri konur). */
const TOUCHED = [
  'BACKUP_STATE_FILE',
  'BACKUP_STATUS_FILE',
  'HEALTH_MAX_BACKUP_AGE_SEC',
  'HEALTH_MIN_DISK_FREE_PCT',
  'HEALTH_MAX_MEM_USED_PCT',
  'HEALTH_DISK_PATH',
  'HEALTH_METRICS_TOKEN',
  'ALERT_WEBHOOK_URL',
] as const;
const saved: Record<string, string | undefined> = {};

/** Ölçüm temeli: hiçbir eşiği aşmayan, "her şey bilinir" durumu. */
const healthy: HealthResources = { lastBackupAgeSec: 60, diskFreePct: 50, diskFreeMb: 5000, memUsedPct: 20, memRssMb: 180 };

/** Eşiğin (24) üstünde, gerçekçi uzunlukta test belirteci. */
const METRICS_TOKEN = 'a3f9'.repeat(10);

/**
 * `/health/worker` yoklaması. Varsayılan olarak DOĞRU belirteci gönderir (ayrıntı alanları görünür).
 * `{ token: null }` → başlık hiç gönderilmez (herkese açık yanıt), `{ token: '...' }` → verilen değer.
 */
async function workerHealth(opts: { token?: string | null } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = opts.token === undefined ? METRICS_TOKEN : opts.token;
  const res = await ctx.request({
    method: 'GET',
    url: '/api/v1/health/worker',
    ...(token === null ? {} : { headers: { [HEALTH_METRICS_HEADER]: token } }),
  });
  return { status: res.statusCode, body: res.json() };
}

/** Belirteçsiz yanıtta HER ZAMAN bulunan alanlar (dış izleme + dağıtım duman testi sözleşmesi). */
const PUBLIC_FIELDS = ['db', 'degraded', 'jobLagSec', 'maxLagSec', 'ok', 'stuckJobs', 'time', 'warnings'] as const;
/** Yalnız belirteçle eklenen alanlar. */
const METRIC_FIELDS = [
  'diskFreeMb',
  'diskFreePct',
  'lastBackupAgeSec',
  'maxBackupAgeSec',
  'maxMemUsedPct',
  'memRssMb',
  'memUsedPct',
  'minDiskFreePct',
] as const;

beforeAll(async () => {
  for (const k of TOUCHED) saved[k] = process.env[k];
  ctx = await createTestContext();
  await ctx.db.delete(jobs);
  statusFile = join(mkdtempSync(join(tmpdir(), 'siparis-yedek-')), 'yedek-durum.json');
  process.env.BACKUP_STATE_FILE = statusFile;
  process.env.HEALTH_MIN_DISK_FREE_PCT = '0';
  process.env.HEALTH_MAX_MEM_USED_PCT = '0';
  process.env.HEALTH_METRICS_TOKEN = METRICS_TOKEN;
  // Uyarı kanalı KAPALI: uç testleri dışarıya POST atmasın (uyarı mantığı jobs-alert.test.ts'te sınanır)
  delete process.env.ALERT_WEBHOOK_URL;
});

afterAll(async () => {
  await ctx.close();
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// Uyarı dizgini süreç belleğindedir: bir vakanın soğuması sonrakine miras kalmasın
beforeEach(() => resetHealthWarningCooldown());

describe('backupAgeSecFrom', () => {
  const now = 1_759_600_000_000; // ms
  /** deploy/cloudflare/entrypoint.sh `backup_state_write` çıktısının birebir biçimi (tek satır, atomik yazılır). */
  const state = (o: Record<string, unknown>) =>
    JSON.stringify({ lastSuccessUnix: 0, lastAttemptUnix: 1_759_600_000, consecutiveFailures: 0, lastResult: 'ok', note: 'yuklendi', epoch: '3', ...o }) + '\n';

  it('yazan tarafın gerçek alanından (lastSuccessUnix) yaşı saniye olarak çıkarır', () => {
    expect(backupAgeSecFrom(state({ lastSuccessUnix: 1_759_599_700 }), now)).toBe(300);
    expect(backupAgeSecFrom(state({ lastSuccessUnix: 1_759_600_000 }), now)).toBe(0);
  });

  it('hata turu yaşı büyütür: dosya tazelenir ama lastSuccessUnix eski kalır', () => {
    const failing = state({ lastSuccessUnix: 1_759_598_000, lastAttemptUnix: 1_759_600_000, consecutiveFailures: 7, lastResult: 'hata', note: 'yedek-hatasi' });
    expect(backupAgeSecFrom(failing, now)).toBe(2000);
  });

  it('hiç başarılı tur yok (taze açılış: lastSuccessUnix 0, lastResult "bos") → null, uyarı üretmez', () => {
    expect(backupAgeSecFrom(state({ lastSuccessUnix: 0, lastResult: 'bos', note: 'taze-acilis-veri-yok' }), now)).toBeNull();
  });

  it('eski/VPS biçimi `ts` de okunur (geriye dönük)', () => {
    expect(backupAgeSecFrom('{"ts":1759599700}', now)).toBe(300);
    expect(backupAgeSecFrom('{"ts":1759600000,"ok":true}\n', now)).toBe(0);
  });

  it('ileri tarihli değer (saat sapması) 0\'a kırpılır — negatif yaş raporlanmaz', () => {
    expect(backupAgeSecFrom(state({ lastSuccessUnix: 1_759_603_600 }), now)).toBe(0);
    expect(backupAgeSecFrom('{"ts":1759603600}', now)).toBe(0);
  });

  it('bozuk JSON, eksik ya da geçersiz alan → null (bilinmiyor, uyarı üretmez)', () => {
    expect(backupAgeSecFrom('', now)).toBeNull();
    expect(backupAgeSecFrom('yedek yazıldı', now)).toBeNull();
    expect(backupAgeSecFrom('{"ts":}', now)).toBeNull();
    expect(backupAgeSecFrom('{}', now)).toBeNull();
    expect(backupAgeSecFrom('null', now)).toBeNull();
    expect(backupAgeSecFrom('{"lastSuccessUnix":"1759599700"}', now)).toBeNull();
    expect(backupAgeSecFrom('{"ts":"1759599700"}', now)).toBeNull();
    expect(backupAgeSecFrom('{"ts":0}', now)).toBeNull();
    expect(backupAgeSecFrom('{"ts":-5}', now)).toBeNull();
  });
});

describe('healthLimits', () => {
  it('ortam boşsa varsayılanlar', () => {
    expect(healthLimits({})).toEqual(HEALTH_LIMIT_DEFAULTS);
    expect(healthLimits({ HEALTH_MAX_BACKUP_AGE_SEC: '   ' })).toEqual(HEALTH_LIMIT_DEFAULTS);
  });

  it('ortam değişkeni eşiği ezer; 0 = eşik kapalı', () => {
    expect(healthLimits({ HEALTH_MAX_BACKUP_AGE_SEC: '1800', HEALTH_MIN_DISK_FREE_PCT: '15', HEALTH_MAX_MEM_USED_PCT: '0' })).toEqual({
      maxBackupAgeSec: 1800,
      minDiskFreePct: 15,
      maxMemUsedPct: 0,
    });
  });

  it('geçersiz değer (metin, negatif) varsayılana düşer — eşik sessizce kapanmaz', () => {
    expect(healthLimits({ HEALTH_MAX_BACKUP_AGE_SEC: 'yarim saat', HEALTH_MIN_DISK_FREE_PCT: '-5' })).toMatchObject({
      maxBackupAgeSec: HEALTH_LIMIT_DEFAULTS.maxBackupAgeSec,
      minDiskFreePct: HEALTH_LIMIT_DEFAULTS.minDiskFreePct,
    });
  });
});

describe('resourceWarnings', () => {
  const limits = HEALTH_LIMIT_DEFAULTS;

  it('eşiklerin içindeki ölçüm hiç uyarı üretmez', () => {
    expect(resourceWarnings(healthy, limits)).toEqual([]);
  });

  it('bilinmeyen (null) ölçüm uyarı üretmez: ilk yedek turundan önce / disksiz geliştirme makinesi', () => {
    expect(resourceWarnings({ lastBackupAgeSec: null, diskFreePct: null, diskFreeMb: null, memUsedPct: null, memRssMb: 90 }, limits)).toEqual([]);
  });

  it('her eşik kendi kodunu üretir', () => {
    expect(resourceWarnings({ ...healthy, lastBackupAgeSec: limits.maxBackupAgeSec + 1 }, limits)).toEqual(['backup_stale']);
    expect(resourceWarnings({ ...healthy, diskFreePct: limits.minDiskFreePct - 1 }, limits)).toEqual(['disk_low']);
    expect(resourceWarnings({ ...healthy, memUsedPct: limits.maxMemUsedPct + 1 }, limits)).toEqual(['memory_high']);
  });

  it('birden çok eşik birlikte aşılırsa hepsi raporlanır', () => {
    const kritik: HealthResources = { lastBackupAgeSec: 99_999, diskFreePct: 1, diskFreeMb: 10, memUsedPct: 99, memRssMb: 900 };
    expect(resourceWarnings(kritik, limits).sort()).toEqual([...HEALTH_WARNINGS].sort());
  });

  it('eşiğin tam üstündeki değer (sınır) uyarı üretmez', () => {
    expect(resourceWarnings({ ...healthy, lastBackupAgeSec: limits.maxBackupAgeSec }, limits)).toEqual([]);
    expect(resourceWarnings({ ...healthy, diskFreePct: limits.minDiskFreePct }, limits)).toEqual([]);
    expect(resourceWarnings({ ...healthy, memUsedPct: limits.maxMemUsedPct }, limits)).toEqual([]);
  });

  it('eşik 0 ise (kapalı) kritik ölçüm bile uyarı üretmez', () => {
    const off = { maxBackupAgeSec: 0, minDiskFreePct: 0, maxMemUsedPct: 0 };
    expect(resourceWarnings({ lastBackupAgeSec: 99_999, diskFreePct: 0, diskFreeMb: 0, memUsedPct: 100, memRssMb: 900 }, off)).toEqual([]);
  });
});

describe('healthWarningAlert', () => {
  const limits = HEALTH_LIMIT_DEFAULTS;

  it('yedek uyarısı critical ve ölçüm + eşik taşır (kişisel veri yok)', () => {
    const girdi = healthWarningAlert('backup_stale', { ...healthy, lastBackupAgeSec: 11_000 }, limits);
    expect(girdi).toMatchObject({ kind: 'backup_stale', severity: 'critical', dedupeKey: 'backup_stale', cooldownMs: HEALTH_ALERT_COOLDOWN_MS });
    expect(girdi.data).toEqual({ lastBackupAgeSec: 11_000, maxBackupAgeSec: limits.maxBackupAgeSec });
    expect(girdi.message).toContain('11000 sn');
    expect(girdi.message).toContain('docs/17 §2.2');
  });

  it('disk uyarısı warning (zaman tanır), bellek uyarısı critical (OOM)', () => {
    expect(healthWarningAlert('disk_low', { ...healthy, diskFreePct: 4, diskFreeMb: 120 }, limits)).toMatchObject({
      kind: 'disk_low',
      severity: 'warning',
      data: { diskFreePct: 4, diskFreeMb: 120, minDiskFreePct: limits.minDiskFreePct },
    });
    expect(healthWarningAlert('memory_high', { ...healthy, memUsedPct: 98, memRssMb: 700 }, limits)).toMatchObject({
      kind: 'memory_high',
      severity: 'critical',
      data: { memUsedPct: 98, memRssMb: 700, maxMemUsedPct: limits.maxMemUsedPct },
    });
  });

  it('her uyarı kodunun gövdesi vardır (yeni kod eklenince bu test onu zorlar)', () => {
    for (const code of HEALTH_WARNINGS) {
      const girdi = healthWarningAlert(code, healthy, limits);
      expect(girdi.kind).toBe(code);
      expect(girdi.message.length).toBeGreaterThan(20);
    }
  });
});

// Bu blok YALNIZ birinci dizgin katmanını sınar (log satırı + `alert()` çağrısı). Webhook gönderimi `sendAlert`'in
// kendi soğumasına da tabidir ve o düzelmeyle sıfırlanmaz: "soğuma beklenmez" aşağıda bu katman için doğrudur,
// webhook için değil (health.ts `HEALTH_ALERT_COOLDOWN_MS` açıklaması).
describe('dueWarnings (uyarı dizgini)', () => {
  const soguma = 30 * 60_000;

  it('ilk görülen uyarı hemen gönderilir', () => {
    const seen = new Map<string, number>();
    expect(dueWarnings(['backup_stale'], seen, 1_000, soguma)).toEqual(['backup_stale']);
  });

  it('soğuma içinde aynı uyarı tekrar gönderilmez (dakikada bir yoklama log selini yapmaz)', () => {
    const seen = new Map<string, number>();
    dueWarnings(['backup_stale'], seen, 0, soguma);
    expect(dueWarnings(['backup_stale'], seen, 60_000, soguma)).toEqual([]);
    expect(dueWarnings(['backup_stale'], seen, soguma - 1, soguma)).toEqual([]);
  });

  it('soğuma dolunca yeniden gönderilir (düzelmeyen arıza sessizleşmez)', () => {
    const seen = new Map<string, number>();
    dueWarnings(['backup_stale'], seen, 0, soguma);
    expect(dueWarnings(['backup_stale'], seen, soguma, soguma)).toEqual(['backup_stale']);
  });

  it('düzelen uyarı hafızadan silinir: tekrarlarsa soğuma beklenmez', () => {
    const seen = new Map<string, number>();
    dueWarnings(['backup_stale'], seen, 0, soguma);
    expect(dueWarnings([], seen, 1_000, soguma)).toEqual([]);
    expect(seen.size).toBe(0);
    expect(dueWarnings(['backup_stale'], seen, 2_000, soguma)).toEqual(['backup_stale']);
  });

  it('kodlar birbirinin soğumasını yemez', () => {
    const seen = new Map<string, number>();
    expect(dueWarnings(['backup_stale'], seen, 0, soguma)).toEqual(['backup_stale']);
    expect(dueWarnings(['backup_stale', 'disk_low'], seen, 1_000, soguma)).toEqual(['disk_low']);
  });

  it('soğuma 0 ise her tur gönderilir', () => {
    const seen = new Map<string, number>();
    const kodlar: HealthWarning[] = ['memory_high'];
    expect(dueWarnings(kodlar, seen, 0, 0)).toEqual(kodlar);
    expect(dueWarnings(kodlar, seen, 1, 0)).toEqual(kodlar);
  });
});

describe('metricsAllowed (ayrıntılı ölçüm belirteci)', () => {
  const token = METRICS_TOKEN;

  it('belirteç TANIMSIZ ya da boşsa hiç kimse ayrıntı görmez (açık varsayılan olmasın)', () => {
    expect(metricsAllowed(undefined, undefined)).toBe(false);
    expect(metricsAllowed(token, undefined)).toBe(false);
    expect(metricsAllowed(token, '')).toBe(false);
    expect(metricsAllowed(token, '    ')).toBe(false);
  });

  it(`belirteç ${HEALTH_METRICS_TOKEN_MIN_LEN} karakterden kısaysa KURULMAMIŞ sayılır (kaba kuvvete açık koruma, koruma değildir)`, () => {
    const kisa = 'k'.repeat(HEALTH_METRICS_TOKEN_MIN_LEN - 1);
    expect(metricsAllowed(kisa, kisa)).toBe(false);
    const tamSinir = 's'.repeat(HEALTH_METRICS_TOKEN_MIN_LEN);
    expect(metricsAllowed(tamSinir, tamSinir)).toBe(true);
  });

  it('yalnız birebir doğru belirteç geçer', () => {
    expect(metricsAllowed(token, token)).toBe(true);
    expect(metricsAllowed(`  ${token}  `, token)).toBe(true);
    expect(metricsAllowed(token.toUpperCase(), token)).toBe(false);
    expect(metricsAllowed(`${token}x`, token)).toBe(false);
    expect(metricsAllowed(token.slice(0, -1), token)).toBe(false);
    expect(metricsAllowed('', token)).toBe(false);
    expect(metricsAllowed(undefined, token)).toBe(false);
  });

  it('başlık iki kez gönderilmişse (dizi) ilk değer sorulur — dizi yüzünden çökmez', () => {
    expect(metricsAllowed([token, 'yanlis'], token)).toBe(true);
    expect(metricsAllowed(['yanlis', token], token)).toBe(false);
    expect(metricsAllowed([], token)).toBe(false);
  });
});

describe('GET /api/v1/health', () => {
  it('alanları ve anlamları değişmedi (dağıtım duman testi bunlara bakıyor)', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json() as object).sort()).toEqual(['db', 'ok', 'time', 'uptimeSec', 'version']);
    expect(res.json()).toMatchObject({ ok: true, db: 'up' });
  });

  it('yedek eskise iki uç da 200 kalır: 503 dağıtımı geri aldırır, worker ucu degraded ile haber verir', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 10 * 86_400},"lastResult":"ok"}\n`);
    process.env.HEALTH_MAX_BACKUP_AGE_SEC = '60';
    try {
      expect((await ctx.request({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
      const { status, body } = await workerHealth();
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ ok: true, degraded: true, warnings: ['backup_stale'] });
    } finally {
      delete process.env.HEALTH_MAX_BACKUP_AGE_SEC;
      await rm(statusFile, { force: true });
    }
  });
});

describe('GET /api/v1/health/worker — yedek ve kaynak görünürlüğü', () => {
  it('durum dosyası yoksa lastBackupAgeSec null, degraded false ve 200', async () => {
    await rm(statusFile, { force: true });
    const { status, body } = await workerHealth();
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      degraded: false,
      warnings: [],
      db: 'up',
      jobLagSec: 0,
      stuckJobs: 0,
      maxLagSec: WORKER_MAX_LAG_SEC,
      lastBackupAgeSec: null,
    });
    expect(body.maxBackupAgeSec).toBe(HEALTH_LIMIT_DEFAULTS.maxBackupAgeSec);
  });

  it('belirteçle: kaynak alanları ölçülür (disk bilinmiyorsa null, bellek her zaman sayı)', async () => {
    const { body } = await workerHealth();
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_FIELDS, ...METRIC_FIELDS].sort());
    expect(typeof body.memRssMb).toBe('number');
    expect(body.memRssMb as number).toBeGreaterThan(0);
    expect(typeof body.memUsedPct).toBe('number');
    expect(body.diskFreePct === null || typeof body.diskFreePct === 'number').toBe(true);
  });

  it('taze yedek: yaş raporlanır, 200, degraded yok', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 30},"lastResult":"ok","note":"yuklendi"}\n`);
    const { status, body } = await workerHealth();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, degraded: false, warnings: [] });
    expect(body.lastBackupAgeSec as number).toBeGreaterThanOrEqual(29);
    expect(body.lastBackupAgeSec as number).toBeLessThan(120);
  });

  it('eşikten eski yedek: ok:true + 200 + degraded (503 YOK — duman testi sağlam dağıtımı geri aldırmaz)', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 3 * 3600},"consecutiveFailures":9,"lastResult":"hata"}\n`);
    const { status, body } = await workerHealth();
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true, degraded: true, warnings: ['backup_stale'], db: 'up', jobLagSec: 0, stuckJobs: 0 });
    expect(body.lastBackupAgeSec as number).toBeGreaterThan(HEALTH_LIMIT_DEFAULTS.maxBackupAgeSec);
  });

  it('eşik ortamdan gevşetilince (0 = kapalı) aynı eski yedek degraded bile olmaz', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 3 * 3600}}\n`);
    process.env.HEALTH_MAX_BACKUP_AGE_SEC = '0';
    try {
      const { status, body } = await workerHealth();
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, degraded: false, warnings: [], maxBackupAgeSec: 0 });
      expect(body.lastBackupAgeSec as number).toBeGreaterThan(3000);
    } finally {
      delete process.env.HEALTH_MAX_BACKUP_AGE_SEC;
    }
  });

  it('bozuk durum dosyası uyarı üretmez: yaş bilinmiyor (null) sayılır', async () => {
    await writeFile(statusFile, 'yedek yazildi\n');
    const { status, body } = await workerHealth();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, degraded: false, lastBackupAgeSec: null });
  });

  it('disk eşiği aşılırsa 200 + degraded: izlenen yolda boş alan oranı eşiğin altında', async () => {
    // Gerçek bir yol ölçülür; eşik %100 verilince ölçülen oran kaçınılmaz olarak altında kalır (dolu/boş fark etmez).
    await rm(statusFile, { force: true });
    process.env.HEALTH_DISK_PATH = tmpdir();
    process.env.HEALTH_MIN_DISK_FREE_PCT = '101';
    try {
      const { status, body } = await workerHealth();
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ ok: true, degraded: true, warnings: ['disk_low'], db: 'up', minDiskFreePct: 101 });
      expect(body.diskFreePct as number).toBeLessThanOrEqual(100);
      expect(body.diskFreeMb as number).toBeGreaterThanOrEqual(0);
    } finally {
      process.env.HEALTH_MIN_DISK_FREE_PCT = '0';
      delete process.env.HEALTH_DISK_PATH;
    }
  });

  it('olmayan disk yolu uyarı üretmez: ölçüm null kalır', async () => {
    process.env.HEALTH_DISK_PATH = join(tmpdir(), 'siparis-olmayan-yol-9f3a1c');
    process.env.HEALTH_MIN_DISK_FREE_PCT = '90';
    try {
      const { status, body } = await workerHealth();
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, degraded: false, diskFreePct: null, diskFreeMb: null });
    } finally {
      process.env.HEALTH_MIN_DISK_FREE_PCT = '0';
      delete process.env.HEALTH_DISK_PATH;
    }
  });

  it('varsayılan durum dosyası yolu yazan tarafla aynıdır (entrypoint.sh BACKUP_STATE_FILE, /tmp altında)', () => {
    expect(BACKUP_STATE_FILE_DEFAULT).toBe('/tmp/yedek-durum.json');
    expect(BACKUP_STATE_FILE_DEFAULT.startsWith('/tmp/')).toBe(true);
  });

  it('eski ad BACKUP_STATUS_FILE da okunur (yazan taraf BACKUP_STATE_FILE kullanır)', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 45}}\n`);
    delete process.env.BACKUP_STATE_FILE;
    process.env.BACKUP_STATUS_FILE = statusFile;
    try {
      const { status, body } = await workerHealth();
      expect(status).toBe(200);
      expect(body.lastBackupAgeSec as number).toBeGreaterThanOrEqual(44);
    } finally {
      delete process.env.BACKUP_STATUS_FILE;
      process.env.BACKUP_STATE_FILE = statusFile;
    }
  });
});

describe('GET /api/v1/health/worker — ayrıntılı ölçüm belirteci (denetim 2026-10-05 bulgu A-2)', () => {
  it('belirteçsiz yanıt YALNIZ sade alanları taşır: disk, bellek ve yedek yaşı yoktur', async () => {
    const { status, body } = await workerHealth({ token: null });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_FIELDS].sort());
    for (const alan of METRIC_FIELDS) {
      expect(alan in body, `${alan} belirteçsiz yanıta sızdı`).toBe(false);
    }
    // Sözleşme: dış izleme ve dağıtımın duman testi bu alanlara bakıyor (docs/15 §10, §12)
    expect(body).toMatchObject({ ok: true, degraded: false, warnings: [], db: 'up', jobLagSec: 0, stuckJobs: 0, maxLagSec: WORKER_MAX_LAG_SEC });
    expect(typeof body.time).toBe('string');
  });

  it('yanlış ya da boş belirteç ayrıntı açmaz; uç yine 200 döner (sağlık ucu kırmızı yanmaz)', async () => {
    for (const token of ['', 'yanlis-belirtec', `${METRICS_TOKEN}x`, METRICS_TOKEN.slice(0, -1)]) {
      const { status, body } = await workerHealth({ token });
      expect(status, JSON.stringify(body)).toBe(200);
      expect('diskFreePct' in body, `yanlış belirteç ayrıntı açtı: ${token}`).toBe(false);
      expect(body.ok).toBe(true);
    }
  });

  it('eşik aşımı belirteçsiz de HABER VERİR: degraded + warnings açık kalır, sayılar gizlidir', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 3 * 3600},"lastResult":"hata"}\n`);
    const { status, body } = await workerHealth({ token: null });
    expect(status, JSON.stringify(body)).toBe(200);
    // Arızanın SINIFI açık (Worker'ın yedek gözcüsü kararını buradan verir: deploy/cloudflare/src/alert.ts)
    expect(body).toMatchObject({ ok: true, degraded: true, warnings: ['backup_stale'] });
    // MİKTARI ve ANI gizli: zamanlama bilgisi sızmaz
    expect('lastBackupAgeSec' in body).toBe(false);
    expect('maxBackupAgeSec' in body).toBe(false);
  });

  it('ortamda belirteç YOKSA doğru başlıkla bile ayrıntı gelmez (gizlemek varsayılandır)', async () => {
    await rm(statusFile, { force: true });
    delete process.env.HEALTH_METRICS_TOKEN;
    try {
      const { status, body } = await workerHealth();
      expect(status, JSON.stringify(body)).toBe(200);
      expect(Object.keys(body).sort()).toEqual([...PUBLIC_FIELDS].sort());
    } finally {
      process.env.HEALTH_METRICS_TOKEN = METRICS_TOKEN;
    }
  });

  it('kısa belirteç kurulmamış sayılır: ayrıntı gelmez (uç 200 kalır)', async () => {
    const kisa = 'k'.repeat(HEALTH_METRICS_TOKEN_MIN_LEN - 1);
    process.env.HEALTH_METRICS_TOKEN = kisa;
    try {
      const { status, body } = await workerHealth({ token: kisa });
      expect(status, JSON.stringify(body)).toBe(200);
      expect('memUsedPct' in body).toBe(false);
    } finally {
      process.env.HEALTH_METRICS_TOKEN = METRICS_TOKEN;
    }
  });

  it('sade `/api/v1/health` belirteçten etkilenmez (alanları değişmedi)', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/health', headers: { [HEALTH_METRICS_HEADER]: METRICS_TOKEN } });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json<object>()).sort()).toEqual(['db', 'ok', 'time', 'uptimeSec', 'version']);
  });
});
