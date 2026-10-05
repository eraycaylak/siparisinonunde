// Şema sapma denetimi yardımcıları (denetim 2026-10-04, FAZ 4.7).
//
// NE YAPAR: ham SQL migration'ların GERÇEKTEN kurduğu veritabanını okur (iç gözlem) ve Drizzle şemasından
// (src/schema/*) beklenen tablo/kolon/tip/NOT NULL/varsayılan/indeks/kısıt tanımlarıyla karşılaştırır.
// Burada `it`/`expect` yoktur; yalnız okuma, çıkarım ve Türkçe fark listesi. Testi test/schema-drift.test.ts kurar.
// Tip ve varsayılan (DEFAULT) normalizasyonu ayrı dosyada: test/drift-value.ts.
//
// NEDEN: 0003_jobs_dedupe_key_full_unique.sql'in başına gelen (şemada tam unique, veritabanında kısmi unique) sessiz
// ayrışmayı makine yakalasın. Denetim bulgusu: "3 indekste şema↔DB sapması + sapmayı yakalayan test/CI yok".
//
// BİLEREK KARŞILAŞTIRILMAYANLAR (yanlış kırmızı üretirdi, ayrıntı docs/14 §2):
//   - Kısıt ADLARI: el yazması migration'lar `push_subscriptions_tenant_id_fk` derken Drizzle'ın otomatik adı
//     `push_subscriptions_tenant_id_tenants_id_fk`. Ad farkı davranışı değiştirmez → yabancı anahtarlar ADLA değil
//     KOLON→HEDEF+ON DELETE üçlüsüyle karşılaştırılır.
//   - CHECK gövdeleri: Drizzle `${t.kolon} in ('a')` üretir, PostgreSQL `((kolon)::text = 'a'::text)` döndürür;
//     metin karşılaştırması anlamsız. Yalnız `<tablo>.<kısıt adı>` karşılaştırılır (iki yanda da elle yazılıyor).
//     Tabloyla NİTELENİR, çünkü PostgreSQL aynı kısıt adını iki tabloda kabul eder: düz ad listesi küme hâline
//     gelirken ikizleri yutar ve bir tablodan düşmüş CHECK sapma sayılmaz (fail-open).
//   - Kısmi indeks YÜKLEMİNİN metni: aynı sebeple yalnız VARLIĞI karşılaştırılır (tam↔kısmi karışması bu kadarıyla
//     yakalanır; 0003'teki hata tam olarak budur).
//   - Tetikleyiciler ve fonksiyonlar: Drizzle şemasında karşılığı yok.

import { is, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import * as schema from '../src/schema/index';
import { defaultDiff, normalizeSqlType } from './drift-value';

const dialect = new PgDialect();

/** migrate.ts'in kendi kayıt tablosu; Drizzle şemasında yoktur, karşılaştırmadan düşülür. */
export const BOOKKEEPING_TABLES: ReadonlySet<string> = new Set(['_migrations']);

// ───────────────────────────────────────────────── veritabanı tarafı ─────────────────────────────────────────────

export interface DbColumn {
  table: string;
  name: string;
  /** format_type çıktısı, normalize edilmiş */
  type: string;
  notNull: boolean;
  defaultExpr: string | null;
}

export interface DbIndex {
  table: string;
  name: string;
  unique: boolean;
  primary: boolean;
  /** pg_get_indexdef ile anahtar başına çözülmüş kolon adı ya da ifade */
  keys: string[];
  hasWhere: boolean;
}

export interface DbForeignKey {
  table: string;
  columns: string[];
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string;
}

export interface DbSnapshot {
  tables: string[];
  columns: DbColumn[];
  indexes: DbIndex[];
  /** `<tablo>.<kısıt adı>` biçiminde; `_migrations` gibi kayıt tabloları düşülmüştür. */
  checkNames: string[];
  foreignKeys: DbForeignKey[];
}

const FK_ACTION: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

/** `public` şemasındaki tabloları, kolonları, indeksleri ve kısıtları okur. */
export async function introspect(sql: postgres.Sql): Promise<DbSnapshot> {
  const tableRows = await sql<{ table_name: string }[]>`
    select c.relname::text as table_name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by 1`;

  const columnRows = await sql<
    { table_name: string; column_name: string; data_type: string; not_null: boolean; default_expr: string | null }[]
  >`
    select c.relname::text as table_name,
           a.attname::text as column_name,
           format_type(a.atttypid, a.atttypmod) as data_type,
           a.attnotnull as not_null,
           pg_get_expr(d.adbin, d.adrelid) as default_expr
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname, a.attnum`;

  const indexRows = await sql<
    { table_name: string; index_name: string; is_unique: boolean; is_primary: boolean; has_where: boolean; keys: string[] }[]
  >`
    select c.relname::text as table_name,
           i.relname::text as index_name,
           ix.indisunique as is_unique,
           ix.indisprimary as is_primary,
           (ix.indpred is not null) as has_where,
           (select coalesce(array_agg(pg_get_indexdef(ix.indexrelid, k, true) order by k), '{}'::text[])
              from generate_series(1, ix.indnkeyatts::int) as k) as keys
      from pg_index ix
      join pg_class i on i.oid = ix.indexrelid
      join pg_class c on c.oid = ix.indrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname, i.relname`;

  const checkRows = await sql<{ table_name: string; check_name: string }[]>`
    select c.relname::text as table_name,
           con.conname::text as check_name
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and con.contype = 'c'
     order by 1, 2`;

  const fkRows = await sql<
    { table_name: string; columns: string[]; foreign_table: string; foreign_columns: string[]; on_delete: string }[]
  >`
    select c.relname::text as table_name,
           (select coalesce(array_agg(a.attname::text order by k.ord), '{}'::text[])
              from unnest(con.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
           fc.relname::text as foreign_table,
           (select coalesce(array_agg(a.attname::text order by k.ord), '{}'::text[])
              from unnest(con.confkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as foreign_columns,
           con.confdeltype::text as on_delete
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_class fc on fc.oid = con.confrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and con.contype = 'f'
     order by 1, 2`;

  const keep = (t: string) => !BOOKKEEPING_TABLES.has(t);
  return {
    tables: tableRows.map((r) => r.table_name).filter(keep),
    columns: columnRows
      .filter((r) => keep(r.table_name))
      .map((r) => ({
        table: r.table_name,
        name: r.column_name,
        type: normalizeSqlType(r.data_type),
        notNull: r.not_null,
        defaultExpr: r.default_expr,
      })),
    indexes: indexRows
      .filter((r) => keep(r.table_name))
      .map((r) => ({
        table: r.table_name,
        name: r.index_name,
        unique: r.is_unique,
        primary: r.is_primary,
        keys: r.keys,
        hasWhere: r.has_where,
      })),
    checkNames: checkRows.filter((r) => keep(r.table_name)).map((r) => `${r.table_name}.${r.check_name}`),
    foreignKeys: fkRows
      .filter((r) => keep(r.table_name))
      .map((r) => ({
        table: r.table_name,
        columns: r.columns,
        foreignTable: r.foreign_table,
        foreignColumns: r.foreign_columns,
        onDelete: FK_ACTION[r.on_delete] ?? r.on_delete,
      })),
  };
}

// ────────────────────────────────────────────────── Drizzle tarafı ───────────────────────────────────────────────

export type ExpectedDefault =
  | { kind: 'none' }
  /** serial/bigserial: veritabanında nextval(...) beklenir */
  | { kind: 'serial' }
  /** $defaultFn: değer uygulamada üretilir, veritabanında DEFAULT yoktur */
  | { kind: 'runtime' }
  | { kind: 'value'; value: unknown }
  | { kind: 'sql'; text: string; dynamic: boolean };

export interface ExpectedColumn {
  table: string;
  name: string;
  type: string;
  notNull: boolean;
  def: ExpectedDefault;
}

export interface ExpectedIndex {
  table: string;
  name: string;
  unique: boolean;
  primary: boolean;
  /** null: indeks SQL ifadesi içeriyor, kolon listesi karşılaştırılmaz */
  keys: string[] | null;
  hasWhere: boolean;
}

export interface ExpectedSnapshot {
  tables: string[];
  columns: ExpectedColumn[];
  indexes: ExpectedIndex[];
  checkNames: string[];
  foreignKeys: DbForeignKey[];
}

/** Şema modülündeki tüm pgTable nesneleri (test/schema.test.ts ile aynı süzgeç). */
export function drizzleTables(): PgTable[] {
  return Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => v instanceof PgTable);
}

export function expectedSnapshot(): ExpectedSnapshot {
  const snap: ExpectedSnapshot = { tables: [], columns: [], indexes: [], checkNames: [], foreignKeys: [] };
  for (const table of drizzleTables()) {
    const cfg = getTableConfig(table);
    snap.tables.push(cfg.name);

    for (const c of cfg.columns) {
      snap.columns.push({
        table: cfg.name,
        name: c.name,
        type: normalizeSqlType(c.getSQLType()),
        // Birincil anahtar kolonu veritabanında zorunlu olarak NOT NULL'dır.
        notNull: c.notNull || c.primary,
        def: expectedDefault(c),
      });
    }

    for (const ix of cfg.indexes) {
      const name = ix.config.name;
      if (name === undefined) continue; // adsız indeks (bu depoda yok): adla eşleştirilemez
      snap.indexes.push({
        table: cfg.name,
        name,
        unique: ix.config.unique,
        primary: false,
        keys: indexKeyNames(ix.config.columns),
        hasWhere: ix.config.where !== undefined,
      });
    }
    for (const uc of cfg.uniqueConstraints) {
      const name = uc.getName();
      if (name === undefined) continue;
      snap.indexes.push({
        table: cfg.name,
        name,
        unique: true,
        primary: false,
        keys: uc.columns.map((c) => c.name),
        hasWhere: false,
      });
    }
    if (cfg.primaryKeys.length > 0) {
      for (const pkey of cfg.primaryKeys) {
        snap.indexes.push({
          table: cfg.name,
          name: pkey.getName(),
          unique: true,
          primary: true,
          keys: pkey.columns.map((c) => c.name),
          hasWhere: false,
        });
      }
    } else {
      const pkCols = cfg.columns.filter((c) => c.primary).map((c) => c.name);
      // Tek kolonluk PRIMARY KEY: adı PostgreSQL verir (<tablo>_pkey).
      if (pkCols.length > 0) {
        snap.indexes.push({ table: cfg.name, name: `${cfg.name}_pkey`, unique: true, primary: true, keys: pkCols, hasWhere: false });
      }
    }

    for (const chk of cfg.checks) snap.checkNames.push(`${cfg.name}.${chk.name}`);

    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      snap.foreignKeys.push({
        table: cfg.name,
        columns: ref.columns.map((c) => c.name),
        foreignTable: getTableConfig(ref.foreignTable).name,
        foreignColumns: ref.foreignColumns.map((c) => c.name),
        onDelete: fk.onDelete ?? 'no action',
      });
    }
  }
  snap.tables.sort();
  snap.checkNames.sort();
  return snap;
}

function expectedDefault(c: {
  columnType: string;
  hasDefault: boolean;
  default: unknown;
  defaultFn: unknown;
}): ExpectedDefault {
  if (c.columnType.includes('Serial')) return { kind: 'serial' };
  if (c.defaultFn !== undefined) return { kind: 'runtime' };
  if (!c.hasDefault) return { kind: 'none' };
  const d = c.default;
  if (is(d, SQL)) {
    const q = dialect.sqlToQuery(d);
    return { kind: 'sql', text: q.sql, dynamic: q.params.length > 0 };
  }
  if (d === undefined) return { kind: 'none' };
  return { kind: 'value', value: d };
}

function indexKeyNames(columns: readonly unknown[]): string[] | null {
  const names: string[] = [];
  for (const col of columns) {
    const name = (col as { name?: unknown }).name;
    if (typeof name !== 'string' || name.length === 0) return null;
    names.push(name);
  }
  return names;
}

// ──────────────────────────────────────────────────── fark raporu ────────────────────────────────────────────────

const fkKey = (fk: DbForeignKey) =>
  `${fk.table}(${fk.columns.join(',')}) → ${fk.foreignTable}(${fk.foreignColumns.join(',')})`;

const colKey = (table: string, name: string) => `${table}.${name}`;
const ixKey = (table: string, name: string) => `${table}.${name}`;

function missingExtra(label: string, expected: readonly string[], actual: readonly string[]): string[] {
  const exp = new Set(expected);
  const act = new Set(actual);
  const out: string[] = [];
  for (const n of [...exp].sort()) if (!act.has(n)) out.push(`${label} veritabanında EKSİK (şemada var): ${n}`);
  for (const n of [...act].sort()) if (!exp.has(n)) out.push(`${label} veritabanında FAZLA (şemada yok): ${n}`);
  return out;
}

/** Tüm sapmaları Türkçe satırlar olarak döner; boş dizi = sapma yok. */
export function diffSchemas(expected: ExpectedSnapshot, actual: DbSnapshot): string[] {
  const diffs: string[] = [...missingExtra('TABLO', expected.tables, actual.tables)];

  const actualTables = new Set(actual.tables);
  const actualCols = new Map(actual.columns.map((c) => [colKey(c.table, c.name), c]));
  const expectedColKeys = new Set(expected.columns.map((c) => colKey(c.table, c.name)));

  for (const col of expected.columns) {
    if (!actualTables.has(col.table)) continue; // tablo eksikliği yukarıda rapor edildi
    const got = actualCols.get(colKey(col.table, col.name));
    if (got === undefined) {
      diffs.push(`KOLON veritabanında EKSİK (şemada var): ${col.table}.${col.name} ${col.type}`);
      continue;
    }
    if (got.type !== col.type) diffs.push(`${col.table}.${col.name}: tip farklı — şema "${col.type}", veritabanı "${got.type}"`);
    if (got.notNull !== col.notNull) {
      diffs.push(
        `${col.table}.${col.name}: NOT NULL farklı — şema ${col.notNull ? 'NOT NULL' : 'nullable'}, veritabanı ${got.notNull ? 'NOT NULL' : 'nullable'}`,
      );
    }
    const defDiff = defaultDiff(col, got.defaultExpr);
    if (defDiff !== null) diffs.push(defDiff);
  }
  for (const got of actual.columns) {
    if (!expectedColKeys.has(colKey(got.table, got.name)) && expected.tables.includes(got.table)) {
      diffs.push(`KOLON veritabanında FAZLA (şemada yok): ${got.table}.${got.name} ${got.type}`);
    }
  }

  const actualIx = new Map(actual.indexes.map((i) => [ixKey(i.table, i.name), i]));
  const expectedIxKeys = new Set(expected.indexes.map((i) => ixKey(i.table, i.name)));
  for (const ix of expected.indexes) {
    if (!actualTables.has(ix.table)) continue;
    const got = actualIx.get(ixKey(ix.table, ix.name));
    if (got === undefined) {
      diffs.push(`İNDEKS veritabanında EKSİK (şemada var): ${ix.name} (${ix.table}${ix.keys === null ? '' : `: ${ix.keys.join(', ')}`})`);
      continue;
    }
    if (got.unique !== ix.unique) {
      diffs.push(`${ix.name}: tekillik farklı — şema ${ix.unique ? 'UNIQUE' : 'normal'}, veritabanı ${got.unique ? 'UNIQUE' : 'normal'}`);
    }
    if (got.hasWhere !== ix.hasWhere) {
      diffs.push(
        `${ix.name}: kısmi indeks farkı — şema ${ix.hasWhere ? 'WHERE yüklemli' : 'tam (WHERE yok)'}, veritabanı ${got.hasWhere ? 'WHERE yüklemli' : 'tam (WHERE yok)'}`,
      );
    }
    if (ix.keys !== null) {
      const same = ix.keys.length === got.keys.length && ix.keys.every((k, i) => k === got.keys[i]);
      if (!same) diffs.push(`${ix.name}: kolon listesi farklı — şema [${ix.keys.join(', ')}], veritabanı [${got.keys.join(', ')}]`);
    }
  }
  for (const got of actual.indexes) {
    if (!expectedIxKeys.has(ixKey(got.table, got.name)) && expected.tables.includes(got.table)) {
      diffs.push(`İNDEKS veritabanında FAZLA (şemada yok): ${got.name} (${got.table}: ${got.keys.join(', ')})`);
    }
  }

  diffs.push(...missingExtra('CHECK kısıtı', expected.checkNames, actual.checkNames));

  const actualFk = new Map(actual.foreignKeys.map((f) => [fkKey(f), f]));
  const expectedFkKeys = new Set(expected.foreignKeys.map(fkKey));
  for (const fk of expected.foreignKeys) {
    if (!actualTables.has(fk.table)) continue;
    const got = actualFk.get(fkKey(fk));
    if (got === undefined) {
      diffs.push(`YABANCI ANAHTAR veritabanında EKSİK (şemada var): ${fkKey(fk)} on delete ${fk.onDelete}`);
      continue;
    }
    if (got.onDelete !== fk.onDelete) {
      diffs.push(`${fkKey(fk)}: ON DELETE farklı — şema "${fk.onDelete}", veritabanı "${got.onDelete}"`);
    }
  }
  for (const got of actual.foreignKeys) {
    if (!expectedFkKeys.has(fkKey(got)) && expected.tables.includes(got.table)) {
      diffs.push(`YABANCI ANAHTAR veritabanında FAZLA (şemada yok): ${fkKey(got)} on delete ${got.onDelete}`);
    }
  }

  return diffs;
}

export { defaultDiff, normalizeSqlType };
