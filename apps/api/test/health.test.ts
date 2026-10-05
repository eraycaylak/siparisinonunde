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
  HEALTH_WARNINGS,
  WORKER_MAX_LAG_SEC,
  backupAgeSecFrom,
  dueWarnings,
  healthLimits,
  healthWarningAlert,
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
  'ALERT_WEBHOOK_URL',
] as const;
const saved: Record<string, string | undefined> = {};

/** Ölçüm temeli: hiçbir eşiği aşmayan, "her şey bilinir" durumu. */
const healthy: HealthResources = { lastBackupAgeSec: 60, diskFreePct: 50, diskFreeMb: 5000, memUsedPct: 20, memRssMb: 180 };

async function workerHealth(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await ctx.request({ method: 'GET', url: '/api/v1/health/worker' });
  return { status: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  for (const k of TOUCHED) saved[k] = process.env[k];
  ctx = await createTestContext();
  await ctx.db.delete(jobs);
  statusFile = join(mkdtempSync(join(tmpdir(), 'siparis-yedek-')), 'yedek-durum.json');
  process.env.BACKUP_STATE_FILE = statusFile;
  process.env.HEALTH_MIN_DISK_FREE_PCT = '0';
  process.env.HEALTH_MAX_MEM_USED_PCT = '0';
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

  it('kaynak alanları her yanıtta ölçülür (disk bilinmiyorsa null, bellek her zaman sayı)', async () => {
    const { body } = await workerHealth();
    expect(Object.keys(body).sort()).toEqual(
      [
        'db',
        'degraded',
        'diskFreeMb',
        'diskFreePct',
        'jobLagSec',
        'lastBackupAgeSec',
        'maxBackupAgeSec',
        'maxLagSec',
        'maxMemUsedPct',
        'memRssMb',
        'memUsedPct',
        'minDiskFreePct',
        'ok',
        'stuckJobs',
        'time',
        'warnings',
      ].sort(),
    );
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
