// Şema sapma testi (denetim 2026-10-04, FAZ 4.7 · bulgu "3 indekste şema↔DB sapması + sapmayı yakalayan test yok").
//
// NASIL ÇALIŞIR: migration'ları TAZE ve AYRI bir veritabanına (varsayılan: siparis_drift_test) uygular, sonra o
// veritabanını okuyup Drizzle şemasıyla (src/schema/*) karşılaştırır. Paylaşılan `siparis_test` veritabanına
// DOKUNULMAZ: api testleri aynı anda koşabilir (`CREATE DATABASE` + sonunda `DROP DATABASE`).
//
// Aynı zamanda "taze kurulum çalışır mı" testidir: ad sırasına göre uygulanan migration'lar boş bir veritabanında
// hata vermeden tamamlanmalı ve sonuç üretimdeki şemayla aynı olmalı.
//
// ÇALIŞTIRMA: `ALLOW_DB_RESET=1 pnpm test`. YERELDE PostgreSQL erişilemezse test ATLANIR ve uyarı basar.
// CI'DA ATLAMAK YOK: `CI` ortam değişkeni doluysa (GitHub Actions her zaman `CI=true` verir) kurulum hatası
// testi KIRMIZI yakar — aksi hâlde "veritabanı açılamadı" hâli sessizce yeşil geçer ve kapı fail-open olur
// (CLAUDE.md kural 4). Elle zorlamak/kapatmak için `DB_DRIFT_STRICT=1` / `DB_DRIFT_STRICT=0`.

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listMigrationFiles, runMigrations } from '../src/migrate';
import { isResettableDbName } from '../src/reset';
import { diffSchemas, expectedSnapshot, introspect, type DbSnapshot } from './drift-helpers';

const BASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://siparis:siparis@localhost:5432/siparis_test';
/** Yalnız bu test kullanır; her koşuda düşürülüp yeniden kurulur. Adı `_test` ile biter (reset.ts güvenlik kalıbı). */
const DRIFT_DB = process.env.DRIFT_DB_NAME ?? 'siparis_drift_test';
/**
 * Katı kip: kurulum hatası atlanmaz, kırmızı yanar. CI'da VARSAYILAN AÇIK (fail-closed); yerelde kapalı.
 * `DB_DRIFT_STRICT=0` CI'da bile kapatır (acil durum kaçış kapısı), `=1` yerelde açar.
 */
const STRICT =
  process.env.DB_DRIFT_STRICT === '1' ||
  (process.env.DB_DRIFT_STRICT !== '0' && (process.env.CI ?? '') !== '');

function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

const DRIFT_URL = withDbName(BASE_URL, DRIFT_DB);

let snapshot: DbSnapshot | null = null;
let appliedCount = 0;
/** Yalnız "PostgreSQL'e ulaşılamadı / veritabanı oluşturulamadı" halinde dolar; sapma değildir. */
let setupError: string | null = null;

async function withAdmin<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(BASE_URL, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function dropDriftDb(sql: postgres.Sql): Promise<void> {
  try {
    await sql.unsafe(`drop database if exists "${DRIFT_DB}" with (force)`).simple();
  } catch {
    // PostgreSQL < 13: WITH (FORCE) yok
    await sql.unsafe(`drop database if exists "${DRIFT_DB}"`).simple();
  }
}

beforeAll(async () => {
  // Güvenlik: adı yanlış yazılmış bir veritabanını (ör. gerçek `siparis`) ASLA düşürmeyelim.
  if (!isResettableDbName(DRIFT_DB)) throw new Error(`DRIFT_DB_NAME "${DRIFT_DB}" güvenli değil: adı *_test ile bitmeli.`);
  if (new URL(BASE_URL).pathname.replace(/^\//, '') === DRIFT_DB) {
    throw new Error(`DRIFT_DB_NAME "${DRIFT_DB}" temel test veritabanıyla aynı; ayrı bir ad gerekir.`);
  }

  try {
    await withAdmin(async (sql) => {
      await dropDriftDb(sql);
      try {
        await sql.unsafe(`create database "${DRIFT_DB}" template template0`).simple();
      } catch {
        // Yerel ayar/encoding uyuşmazlığında template0 reddedilebilir; varsayılan şablonla devam.
        await sql.unsafe(`create database "${DRIFT_DB}"`).simple();
      }
    });
  } catch (err) {
    setupError = err instanceof Error ? err.message : String(err);
    return;
  }

  // Buradan sonrası gerçek bir hata: taze veritabanına migration uygulanamıyorsa test KIRMIZI yanmalı.
  const result = await runMigrations(DRIFT_URL);
  appliedCount = result.applied.length;

  const sql = postgres(DRIFT_URL, { max: 1, onnotice: () => {} });
  try {
    snapshot = await introspect(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}, 180_000);

afterAll(async () => {
  if (setupError !== null) return;
  try {
    await withAdmin(dropDriftDb);
  } catch {
    // Temizlik başarısızlığı testi kırmızı yapmasın; sonraki koşu baştaki DROP ile zaten toparlar.
  }
}, 60_000);

describe('şema sapması (ham SQL migration ↔ Drizzle şeması)', () => {
  it('taze veritabanına bütün migration dosyaları uygulanır', (ctx) => {
    if (setupError !== null) {
      const msg = `PostgreSQL'e ulaşılamadı, şema sapma testi atlandı: ${setupError}`;
      if (STRICT) expect.fail(msg);
      console.warn(`UYARI: ${msg}`);
      ctx.skip();
      return;
    }
    expect(appliedCount, 'taze veritabanına uygulanan migration sayısı').toBeGreaterThan(0);
  });

  it('migration dosyalarının hepsi uygulandı (atlanan yok)', async (ctx) => {
    if (setupError !== null) {
      if (STRICT) expect.fail(`PostgreSQL'e ulaşılamadı: ${setupError}`);
      ctx.skip();
      return;
    }
    const files = await listMigrationFiles();
    expect(appliedCount, `${files.length} migration dosyasının hepsi uygulanmalı`).toBe(files.length);
  });

  it('tablo, kolon, tip, NOT NULL, varsayılan, indeks, CHECK ve yabancı anahtarlar şemayla birebir', (ctx) => {
    if (setupError !== null) {
      if (STRICT) expect.fail(`PostgreSQL'e ulaşılamadı: ${setupError}`);
      ctx.skip();
      return;
    }
    expect(snapshot, 'veritabanı iç gözlemi').not.toBeNull();
    const diffs = diffSchemas(expectedSnapshot(), snapshot as DbSnapshot);
    const report = diffs.map((d, i) => `${i + 1}. ${d}`).join('\n');
    expect(
      report,
      [
        `Ham SQL migration'lar ile Drizzle şeması arasında ${diffs.length} sapma var.`,
        'Düzeltme yolu: şemayı DEĞİL, yeni bir migration dosyası ekleyerek veritabanını yakınsat',
        '(uygulanmış dosyanın içeriği değiştirilmez — migrate.ts onu yeniden uygulamaz, yalnız uyarır;',
        'örnek: migrations/0003_jobs_dedupe_key_full_unique.sql).',
        '',
        report,
      ].join('\n'),
    ).toBe('');
  });
});
