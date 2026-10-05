// Sağlık uçları (apps/api/src/routes/health.ts): `/health` süreç + veritabanı, `/health/worker` kuyruk gecikmesi +
// son yedeğin yaşı + disk/bellek baskısı (denetim 2026-10-04 madde 1.5, H23).
// Kuyruk gecikmesi testi jobs.test.ts'te; burada yedek yaşı, kaynak alanları ve eşik davranışı sınanır.
// Durum dosyasının biçimi UYDURULMAZ: yazan taraf deploy/cloudflare/entrypoint.sh `backup_state_write`
// (`lastSuccessUnix` / `consecutiveFailures` / `lastResult`), yol değişkeni `BACKUP_STATE_FILE`.
// Disk ve bellek eşikleri uç testlerinde BİLEREK kapatılır (0): gerçek makinenin dolu diski testi yanlış kırmızıya
// düşürmesin. O eşiklerin mantığı resourcesWithinLimits birim testlerinde (ölçüm enjekte edilerek) sınanır.

import { jobs } from '@siparis/db';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BACKUP_STATE_FILE_DEFAULT,
  HEALTH_LIMIT_DEFAULTS,
  WORKER_MAX_LAG_SEC,
  backupAgeSecFrom,
  healthLimits,
  resourcesWithinLimits,
  type HealthResources,
} from '../src/routes/health';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
let statusFile: string;
/** Testin dokunduğu ortam değişkenleri (api testleri tek süreçte sırayla koşar: sonunda eski değerler geri konur). */
const TOUCHED = ['BACKUP_STATE_FILE', 'BACKUP_STATUS_FILE', 'HEALTH_MAX_BACKUP_AGE_SEC', 'HEALTH_MIN_DISK_FREE_PCT', 'HEALTH_MAX_MEM_USED_PCT', 'HEALTH_DISK_PATH'] as const;
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
});

afterAll(async () => {
  await ctx.close();
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

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

  it('hiç başarılı tur yok (taze açılış: lastSuccessUnix 0, lastResult "bos") → null, alarm üretmez', () => {
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

  it('bozuk JSON, eksik ya da geçersiz alan → null (bilinmiyor, alarm üretmez)', () => {
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

describe('resourcesWithinLimits', () => {
  const limits = HEALTH_LIMIT_DEFAULTS;

  it('eşiklerin içindeki ölçüm sağlıklıdır', () => {
    expect(resourcesWithinLimits(healthy, limits)).toBe(true);
  });

  it('bilinmeyen (null) ölçüm alarm üretmez: ilk yedek turundan önce / disksiz geliştirme makinesi', () => {
    expect(resourcesWithinLimits({ lastBackupAgeSec: null, diskFreePct: null, diskFreeMb: null, memUsedPct: null, memRssMb: 90 }, limits)).toBe(true);
  });

  it('yedek çok eski, disk ya da bellek kritikse alarm', () => {
    expect(resourcesWithinLimits({ ...healthy, lastBackupAgeSec: limits.maxBackupAgeSec + 1 }, limits)).toBe(false);
    expect(resourcesWithinLimits({ ...healthy, diskFreePct: limits.minDiskFreePct - 1 }, limits)).toBe(false);
    expect(resourcesWithinLimits({ ...healthy, memUsedPct: limits.maxMemUsedPct + 1 }, limits)).toBe(false);
  });

  it('eşiğin tam üstündeki değer (sınır) alarm üretmez', () => {
    expect(resourcesWithinLimits({ ...healthy, lastBackupAgeSec: limits.maxBackupAgeSec }, limits)).toBe(true);
    expect(resourcesWithinLimits({ ...healthy, diskFreePct: limits.minDiskFreePct }, limits)).toBe(true);
    expect(resourcesWithinLimits({ ...healthy, memUsedPct: limits.maxMemUsedPct }, limits)).toBe(true);
  });

  it('eşik 0 ise (kapalı) kritik ölçüm bile alarm üretmez', () => {
    const off = { maxBackupAgeSec: 0, minDiskFreePct: 0, maxMemUsedPct: 0 };
    expect(resourcesWithinLimits({ lastBackupAgeSec: 99_999, diskFreePct: 0, diskFreeMb: 0, memUsedPct: 100, memRssMb: 900 }, off)).toBe(true);
  });
});

describe('GET /api/v1/health', () => {
  it('alanları ve anlamları değişmedi (dağıtım duman testi bunlara bakıyor)', async () => {
    const res = await ctx.request({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json() as object).sort()).toEqual(['db', 'ok', 'time', 'uptimeSec', 'version']);
    expect(res.json()).toMatchObject({ ok: true, db: 'up' });
  });

  it('yedek eskise bile 200 kalır: bu uç container healthcheck\'i ve uyanık tutma cron\'udur', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 10 * 86_400},"lastResult":"ok"}\n`);
    process.env.HEALTH_MAX_BACKUP_AGE_SEC = '60';
    try {
      expect((await ctx.request({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
      expect((await workerHealth()).status).toBe(503); // aynı anda worker ucu kırmızı
    } finally {
      delete process.env.HEALTH_MAX_BACKUP_AGE_SEC;
      await rm(statusFile, { force: true });
    }
  });
});

describe('GET /api/v1/health/worker — yedek ve kaynak görünürlüğü', () => {
  it('durum dosyası yoksa lastBackupAgeSec null ve 200 (503 verilmez)', async () => {
    await rm(statusFile, { force: true });
    const { status, body } = await workerHealth();
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true, db: 'up', jobLagSec: 0, stuckJobs: 0, maxLagSec: WORKER_MAX_LAG_SEC, lastBackupAgeSec: null });
    expect(body.maxBackupAgeSec).toBe(HEALTH_LIMIT_DEFAULTS.maxBackupAgeSec);
  });

  it('kaynak alanları her yanıtta ölçülür (disk bilinmiyorsa null, bellek her zaman sayı)', async () => {
    const { body } = await workerHealth();
    expect(Object.keys(body).sort()).toEqual(
      [
        'db',
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
      ].sort(),
    );
    expect(typeof body.memRssMb).toBe('number');
    expect(body.memRssMb as number).toBeGreaterThan(0);
    expect(typeof body.memUsedPct).toBe('number');
    expect(body.diskFreePct === null || typeof body.diskFreePct === 'number').toBe(true);
  });

  it('taze yedek: yaş raporlanır, 200', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 30},"lastResult":"ok","note":"yuklendi"}\n`);
    const { status, body } = await workerHealth();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lastBackupAgeSec as number).toBeGreaterThanOrEqual(29);
    expect(body.lastBackupAgeSec as number).toBeLessThan(120);
  });

  it('eşikten eski yedek: ok:false + 503 (dış izleme yakalar), kuyruk alanları bozulmaz', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 3 * 3600},"consecutiveFailures":9,"lastResult":"hata"}\n`);
    const { status, body } = await workerHealth();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, db: 'up', jobLagSec: 0, stuckJobs: 0 });
    expect(body.lastBackupAgeSec as number).toBeGreaterThan(HEALTH_LIMIT_DEFAULTS.maxBackupAgeSec);
  });

  it('eşik ortamdan gevşetilince (0 = kapalı) aynı eski yedek 200 döner', async () => {
    await writeFile(statusFile, `{"lastSuccessUnix":${Math.floor(Date.now() / 1000) - 3 * 3600}}\n`);
    process.env.HEALTH_MAX_BACKUP_AGE_SEC = '0';
    try {
      const { status, body } = await workerHealth();
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, maxBackupAgeSec: 0 });
      expect(body.lastBackupAgeSec as number).toBeGreaterThan(3000);
    } finally {
      delete process.env.HEALTH_MAX_BACKUP_AGE_SEC;
    }
  });

  it('bozuk durum dosyası 503 üretmez: yaş bilinmiyor (null) sayılır', async () => {
    await writeFile(statusFile, 'yedek yazildi\n');
    const { status, body } = await workerHealth();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, lastBackupAgeSec: null });
  });

  it('disk eşiği aşılırsa 503: izlenen yolda boş alan oranı eşiğin altında', async () => {
    // Gerçek bir yol ölçülür; eşik %100 verilince ölçülen oran kaçınılmaz olarak altında kalır (dolu/boş fark etmez).
    await rm(statusFile, { force: true });
    process.env.HEALTH_DISK_PATH = tmpdir();
    process.env.HEALTH_MIN_DISK_FREE_PCT = '101';
    try {
      const { status, body } = await workerHealth();
      expect(status, JSON.stringify(body)).toBe(503);
      expect(body).toMatchObject({ ok: false, db: 'up', minDiskFreePct: 101 });
      expect(body.diskFreePct as number).toBeLessThanOrEqual(100);
      expect(body.diskFreeMb as number).toBeGreaterThanOrEqual(0);
    } finally {
      process.env.HEALTH_MIN_DISK_FREE_PCT = '0';
      delete process.env.HEALTH_DISK_PATH;
    }
  });

  it('olmayan disk yolu 503 üretmez: ölçüm null kalır', async () => {
    process.env.HEALTH_DISK_PATH = join(tmpdir(), 'siparis-olmayan-yol-9f3a1c');
    process.env.HEALTH_MIN_DISK_FREE_PCT = '90';
    try {
      const { status, body } = await workerHealth();
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, diskFreePct: null, diskFreeMb: null });
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
