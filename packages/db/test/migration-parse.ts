// Migration SQL ayrıştırıcısı ve dilim aralıkları (denetim 2026-10-04, FAZ 4.7).
// Burada test yok; testi test/migration-order.test.ts kurar. Veritabanı gerekmez: dosyalar metin olarak okunur.
//
// AYRIŞTIRMANIN SINIRI (bilerek): dolar-kotalı gövdeler ($$ … $$) ve dizge sabitleri atılır, yani PL/pgSQL içinde
// `EXECUTE format('… ON %I …')` ile kurulan dinamik DDL görülmez. 0002'nin updated_at tetikleyici döngüsü böyledir;
// dinamik DDL'i doğru ayrıştırmak ancak SQL'i çalıştırmakla mümkündür, onu test/schema-drift.test.ts yapar.

/** docs/14 §2 dilim aralıkları. Yeni dilim eklenirse buraya da yazılır. */
export const SLICES: readonly { readonly name: string; readonly from: number; readonly to: number }[] = [
  { name: 'temel', from: 0, to: 99 },
  { name: 'menü', from: 100, to: 199 },
  { name: 'sipariş', from: 200, to: 299 },
  { name: 'whatsapp', from: 300, to: 399 },
  { name: 'işletme-ayarları', from: 400, to: 499 },
  { name: 'admin', from: 500, to: 599 },
  { name: 'kimlik güvenliği', from: 600, to: 699 },
  { name: 'bildirimler', from: 700, to: 799 },
  { name: 'saklama', from: 800, to: 899 },
  { name: 'ortak numara', from: 900, to: 999 },
];

/** Tablo adı sanılmaması gereken anahtar sözcükler (ör. `CREATE TRIGGER x BEFORE UPDATE ON y`). */
const SQL_KEYWORDS: ReadonlySet<string> = new Set([
  'on', 'set', 'only', 'if', 'not', 'exists', 'table', 'index', 'trigger', 'from', 'where', 'select', 'values',
  'into', 'as', 'and', 'or', 'all', 'distinct', 'unique', 'concurrently', 'constraint', 'column', 'default',
]);

const IDENT = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)';
const QUALIFIED = `(${IDENT}(?:\\s*\\.\\s*${IDENT})?)`;

/**
 * Yorumları, dizge sabitlerini ve dolar-kotalı gövdeleri boşlukla değiştirir; çift tırnaklı tanımlayıcılar kalır.
 * Böylece yorumdaki ya da PL/pgSQL gövdesindeki "ALTER TABLE" metni DDL sanılmaz.
 */
export function stripSqlNoise(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      out += " '' ";
      continue;
    }
    if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      if (end === -1) break;
      out += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag !== null) {
        const marker = tag[0];
        const end = sql.indexOf(marker, i + marker.length);
        i = end === -1 ? sql.length : end + marker.length;
        out += ' ';
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function tableName(raw: string): string | null {
  const parts = raw.split('.').map((p) => p.trim().replace(/^"|"$/g, ''));
  const name = parts[parts.length - 1];
  if (name === undefined || name === '' || name.includes('%')) return null;
  const lower = name.toLowerCase();
  return SQL_KEYWORDS.has(lower) ? null : lower;
}

function collect(sql: string, pattern: RegExp): string[] {
  const names: string[] = [];
  for (const m of sql.matchAll(pattern)) {
    const name = tableName(m[1] ?? '');
    if (name !== null && !names.includes(name)) names.push(name);
  }
  return names;
}

export interface MigrationTables {
  /** Bu dosyanın oluşturduğu tablolar */
  created: string[];
  /** Bu dosyanın var olmasını BEKLEDİĞİ tablolar */
  touched: string[];
}

/** Bir migration dosyasının oluşturduğu ve dokunduğu tabloları çıkarır. */
export function parseMigrationTables(rawSql: string): MigrationTables {
  const sql = stripSqlNoise(rawSql);
  const created = collect(sql, new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED}`, 'gi'));
  const touched = [
    ...collect(sql, new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QUALIFIED}`, 'gi')),
    ...collect(sql, new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${QUALIFIED}`, 'gi')),
    ...collect(
      sql,
      new RegExp(
        `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s+ON\\s+${QUALIFIED}`,
        'gi',
      ),
    ),
    // CREATE/DROP TRIGGER <ad> [BEFORE UPDATE] ON <tablo>  (`[^;]*?` ile cümle sınırını geçmez)
    ...collect(
      sql,
      new RegExp(
        `\\b(?:CREATE|DROP)\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}[^;]*?\\bON\\s+${QUALIFIED}`,
        'gi',
      ),
    ),
    ...collect(sql, new RegExp(`\\bREFERENCES\\s+${QUALIFIED}`, 'gi')),
    ...collect(sql, new RegExp(`\\bINSERT\\s+INTO\\s+${QUALIFIED}`, 'gi')),
    // Takma adlı biçim de sayılır: `UPDATE "t" v SET …` / `UPDATE t AS v SET …` (depoda var: 0900 satır 88).
    // Takma ad OLMADAN da eşleşir: regex `SET`i takma ad sanıp geri adım atar.
    ...collect(sql, new RegExp(`\\bUPDATE\\s+(?:ONLY\\s+)?${QUALIFIED}(?:\\s+AS)?(?:\\s+${IDENT})?\\s+SET\\b`, 'gi')),
    ...collect(sql, new RegExp(`\\bDELETE\\s+FROM\\s+(?:ONLY\\s+)?${QUALIFIED}`, 'gi')),
  ];
  return { created, touched: [...new Set(touched)] };
}
