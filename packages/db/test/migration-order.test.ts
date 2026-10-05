// Göç sırası testi (denetim 2026-10-04, FAZ 4.7 · bulgu H27 "migration numaralandırması dilim-bazlı → taze DB ile
// üretim FARKLI SIRADA uyguluyor").
//
// SORUN: migrate.ts dosyaları AD SIRASINA göre uygular (`listMigrationFiles` → `sort()`). Dilim aralıkları
// (docs/14 §2: temel 0000–0099, menü 0100–0199, … ortak numara 0900–0999) numara çakışmasını önler ama SIRAYI
// tarihe değil aralığa bağlar. Üretim 0904'ü çoktan uygulamışken dalda açılan 0701 gibi bir dosya, taze kurulumda
// 0800'den ÖNCE koşar; üretimde ise en son koşar. İki veritabanı sessizce farklı semalara gidebilir.
//
// BU TESTİN ÇİTİ: her dosyanın DOKUNDUĞU tablo, kendisinden ÖNCE gelen (ya da kendi) bir dosyada oluşturulmuş
// olmalı. Böylece dosya adı sırası ile gerçek bağımlılık sırası ayrışırsa test kırmızı yanar: yeni dosyayı dilim
// aralığının içine koyarken "bağımlı olduğum tablo benden önceki bir numarada mı?" sorusu artık makineye sorulur.
// Veritabanı gerekmez: dosyalar metin olarak ayrıştırılır.
//
// AYRIŞTIRMANIN SINIRI (bilerek): dolar-kotalı gövdeler ($$ … $$) ve dizge sabitleri atılır, yani PL/pgSQL içinde
// `EXECUTE format('… ON %I …')` ile kurulan dinamik DDL görülmez. 0002'nin updated_at tetikleyici döngüsü böyledir;
// dinamik DDL'i doğru ayrıştırmak ancak SQL'i çalıştırmakla mümkündür, onu schema-drift.test.ts yapar.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listMigrationFiles, MIGRATIONS_DIR } from '../src/migrate';
import { parseMigrationTables, SLICES, type MigrationTables } from './migration-parse';

async function readAll(): Promise<{ file: string; tables: MigrationTables }[]> {
  const files = await listMigrationFiles();
  return Promise.all(
    files.map(async (file) => ({ file, tables: parseMigrationTables(await readFile(join(MIGRATIONS_DIR, file), 'utf8')) })),
  );
}

describe('göç sırası (dosya adı sırası ↔ gerçek bağımlılık)', () => {
  it('her dosya numarası tek ve bir dilim aralığının içinde', async () => {
    const files = await listMigrationFiles();
    const seen = new Map<number, string>();
    for (const file of files) {
      const num = Number(file.slice(0, 4));
      const prev = seen.get(num);
      expect(prev, `${num} numarası iki dosyada: ${prev} ve ${file}`).toBeUndefined();
      seen.set(num, file);
      const slice = SLICES.find((s) => num >= s.from && num <= s.to);
      expect(slice, `${file}: numara hiçbir dilim aralığında değil (docs/14 §2)`).toBeDefined();
    }
  });

  it('dokunulan her tablo daha önceki (ya da aynı) bir dosyada oluşturulmuş', async () => {
    const entries = await readAll();
    const createdBy = new Map<string, string>();
    const violations: string[] = [];
    for (const { file, tables } of entries) {
      for (const name of tables.created) {
        if (!createdBy.has(name)) createdBy.set(name, file);
      }
      for (const name of tables.touched) {
        const source = createdBy.get(name);
        if (source === undefined) {
          violations.push(
            `${file}: "${name}" tablosuna dokunuyor ama bu tablo kendisinden önceki hiçbir migration dosyasında ` +
              `oluşturulmamış. Ad sırası (migrate.ts) ile bağımlılık sırası ayrışmış: dosyayı, tabloyu oluşturan ` +
              `dosyadan SONRA gelen bir numaraya al (dilim aralığı docs/14 §2) ya da tabloyu bu dosyada oluştur.`,
          );
        }
      }
    }
    const report = violations.map((v, i) => `${i + 1}. ${v}`).join('\n');
    expect(report, `Göç sırası ihlali (${violations.length}):\n${report}`).toBe('');
  });

  it('en az bir tablo oluşturan dosya var (ayrıştırıcı sessizce boşa düşmüyor)', async () => {
    const entries = await readAll();
    const totalCreated = entries.reduce((n, e) => n + e.tables.created.length, 0);
    const totalTouched = entries.reduce((n, e) => n + e.tables.touched.length, 0);
    // Ayrıştırıcı kırılırsa her şey "ihlal yok" görünür; bu yüzden alt sınır konur.
    expect(totalCreated, 'CREATE TABLE sayısı').toBeGreaterThan(40);
    expect(totalTouched, 'dokunulan tablo sayısı').toBeGreaterThan(40);
  });
});

describe('SQL gürültü temizleyici', () => {
  it('yorumdaki ve dizgedeki DDL metnini DDL saymaz', () => {
    const sql = [
      "-- ALTER TABLE yorumda_tablo ADD COLUMN x int;",
      "/* CREATE TABLE blok_yorumda (x int); */",
      "SELECT 'CREATE TABLE dizgede (x int)';",
      'CREATE TABLE "gercek" ("x" int);',
    ].join('\n');
    const { created } = parseMigrationTables(sql);
    expect(created).toEqual(['gercek']);
  });

  it('dolar-kotalı gövdedeki dinamik DDL görülmez', () => {
    const sql = [
      'DO $$ BEGIN',
      "  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION f()', a, b);",
      '  ALTER TABLE govdedeki ADD COLUMN y int;',
      'END $$;',
      'ALTER TABLE "gorunen" ADD COLUMN z int;',
    ].join('\n');
    const { created, touched } = parseMigrationTables(sql);
    expect(created).toEqual([]);
    expect(touched).toEqual(['gorunen']);
  });

  it('tetikleyicinin hedef tablosunu bulur, ON/UPDATE sözcüklerini tablo adı sanmaz', () => {
    const sql = 'CREATE TRIGGER t_set BEFORE UPDATE ON tenant_onboarding FOR EACH ROW EXECUTE FUNCTION set_updated_at();';
    const { touched } = parseMigrationTables(sql);
    expect(touched).toEqual(['tenant_onboarding']);
    expect(touched).not.toContain('on');
    expect(touched).not.toContain('update');
  });

  it('DROP TRIGGER … ON <tablo> da bağımlılık sayılır', () => {
    const sql = 'DROP TRIGGER IF EXISTS branch_events_notify ON branch_events;';
    expect(parseMigrationTables(sql).touched).toEqual(['branch_events']);
  });

  it('takma adlı UPDATE de bağımlılık sayılır (0900 satır 88 bu biçimde)', () => {
    // Takma ad OLMADAN: `UPDATE t SET` — regex geri adım atıp yine eşleşmeli.
    expect(parseMigrationTables('UPDATE z_tablo SET a = 1;').touched).toEqual(['z_tablo']);
    // Takma adla: bu biçim eskiden HİÇ görülmüyordu → sıra ihlali sessizce kaçıyordu.
    expect(parseMigrationTables('UPDATE "order_verification_codes" v SET used_at = v.expires_at;').touched).toEqual([
      'order_verification_codes',
    ]);
    expect(parseMigrationTables('UPDATE y_tablo AS q SET a = 1;').touched).toEqual(['y_tablo']);
    expect(parseMigrationTables('UPDATE public."w_tablo" w SET a = 1;').touched).toEqual(['w_tablo']);
    expect(parseMigrationTables('DELETE FROM ONLY d_tablo d WHERE d.x = 1;').touched).toEqual(['d_tablo']);
  });

  it('şema nitelemesini ve çift tırnağı çözer', () => {
    const sql = 'ALTER TABLE "orders" ADD CONSTRAINT c FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");';
    expect(parseMigrationTables(sql).touched).toEqual(['orders', 'tenants']);
  });
});
