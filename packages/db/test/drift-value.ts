// Tip ve varsayılan (DEFAULT) karşılaştırması: Drizzle'ın kısa tip adlarını PostgreSQL'in `format_type` çıktısıyla,
// şemadaki varsayılan değerleri de `pg_get_expr` metniyle aynı dile çevirir. test/drift-helpers.ts kullanır.
//
// NEDEN NORMALİZASYON: iki yan aynı şeyi FARKLI yazar — `char(3)` ↔ `character(3)`, `bigserial` ↔ `bigint` +
// `nextval(...)`, `'TRY'` ↔ `'TRY'::bpchar`, `{received:…}` ↔ `'{"received":…}'::jsonb` (anahtar sırası bile
// değişebilir), `['a','b']` ↔ `'{a,b}'::text[]`. Ham metin karşılaştırması bu yüzden yanlış kırmızı üretir.

import type { ExpectedColumn, ExpectedDefault } from './drift-helpers';

// ──────────────────────────────────────────────── tip normalizasyonu ─────────────────────────────────────────────

/** Drizzle'ın kısa adları ile format_type çıktısını aynı dile çevirir. */
const TYPE_ALIASES: Record<string, string> = {
  bigserial: 'bigint',
  serial: 'integer',
  smallserial: 'smallint',
  int: 'integer',
  int2: 'smallint',
  int4: 'integer',
  int8: 'bigint',
  bool: 'boolean',
  float4: 'real',
  float8: 'double precision',
  decimal: 'numeric',
  bpchar: 'character',
  char: 'character',
  varchar: 'character varying',
  timestamptz: 'timestamp with time zone',
  timetz: 'time with time zone',
};

export function normalizeSqlType(raw: string): string {
  let s = raw.trim().toLowerCase();
  let suffix = '';
  while (s.endsWith('[]')) {
    suffix += '[]';
    s = s.slice(0, -2).trim();
  }
  const m = /^([a-z_ ]+?)\s*\(([^)]*)\)$/.exec(s);
  const base = m?.[1]?.trim() ?? s;
  const args = m?.[2]?.replace(/\s+/g, '') ?? '';
  return `${TYPE_ALIASES[base] ?? base}${args === '' ? '' : `(${args})`}${suffix}`;
}

// ───────────────────────────────────────────── varsayılan karşılaştırma ──────────────────────────────────────────

type Literal =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'expr'; text: string };

function isBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Sondaki `::tip` eklerini ve dış parantezleri söker. `nextval('x'::regclass)` gibi çağrılara dokunmaz. */
function stripCasts(expr: string): string {
  let s = expr.trim();
  for (;;) {
    const m = /::\s*(?:"[^"]+"|[a-z_][a-z0-9_ ]*)(?:\s*\[\s*\])*\s*$/i.exec(s);
    if (m === null) break;
    s = s.slice(0, m.index).trim();
  }
  while (s.startsWith('(') && s.endsWith(')') && isBalanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
  return s;
}

function parseLiteral(expr: string): Literal {
  const s = stripCasts(expr);
  if (/^'(?:[^']|'')*'$/.test(s)) return { kind: 'string', value: s.slice(1, -1).replace(/''/g, "'") };
  if (/^(true|false)$/i.test(s)) return { kind: 'bool', value: s.toLowerCase() === 'true' };
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return { kind: 'number', value: Number(s) };
  return { kind: 'expr', text: s.replace(/\s+/g, ' ').toLowerCase() };
}

function valueToLiteral(value: unknown, type: string): Literal {
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (Array.isArray(value) && type.endsWith('[]')) return { kind: 'string', value: `{${value.map(String).join(',')}}` };
  return { kind: 'string', value: JSON.stringify(value) ?? 'null' };
}

/** jsonb için anahtar sırasından bağımsız karşılaştırma. */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

function parsePgArray(text: string): string[] {
  const inner = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  if (inner.trim() === '') return [];
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string;
    if (quoted) {
      if (ch === '\\') cur += inner[++i] ?? '';
      else if (ch === '"') quoted = false;
      else cur += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function literalText(lit: Literal): string {
  return lit.kind === 'expr' ? lit.text : String(lit.value);
}

function literalEqual(a: Literal, b: Literal, type: string): boolean {
  const isJson = type === 'jsonb' || type === 'json';
  if (isJson && a.kind === 'string' && b.kind === 'string') {
    try {
      return canonicalJson(JSON.parse(a.value)) === canonicalJson(JSON.parse(b.value));
    } catch {
      return a.value === b.value;
    }
  }
  if (type.endsWith('[]') && a.kind === 'string' && b.kind === 'string') {
    const [x, y] = [parsePgArray(a.value), parsePgArray(b.value)];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (a.kind === 'number' || b.kind === 'number') return Number(literalText(a)) === Number(literalText(b));
  if (a.kind !== b.kind) return false;
  return literalText(a) === literalText(b);
}

function describeDefault(def: ExpectedDefault): string {
  switch (def.kind) {
    case 'sql':
      return def.text;
    case 'value':
      return typeof def.value === 'object' ? (JSON.stringify(def.value) ?? 'null') : String(def.value);
    default:
      return def.kind;
  }
}

/** Tek kolonun varsayılanını karşılaştırır; sapma varsa Türkçe satır, yoksa null döner. */
export function defaultDiff(col: ExpectedColumn, dbDefault: string | null): string | null {
  const at = `${col.table}.${col.name}`;
  const def = col.def;
  if (def.kind === 'serial') {
    if (dbDefault !== null && /^nextval\(/i.test(dbDefault.trim())) return null;
    return `${at}: şemada serial (nextval bekleniyor), veritabanında varsayılan ${dbDefault === null ? 'YOK' : `"${dbDefault}"`}`;
  }
  if (def.kind === 'none' || def.kind === 'runtime') {
    if (dbDefault === null) return null;
    const note = def.kind === 'runtime' ? ' ($defaultFn ile uygulamada üretilir)' : '';
    return `${at}: şemada varsayılan yok${note}, veritabanında "${dbDefault}" var`;
  }
  if (dbDefault === null) return `${at}: şemada varsayılan "${describeDefault(def)}", veritabanında YOK`;
  // Parametreli SQL varsayılanı (bu depoda yok): metin karşılaştırılamaz, varlığı yeterli sayılır.
  if (def.kind === 'sql' && def.dynamic) return null;
  const expected = def.kind === 'sql' ? parseLiteral(def.text) : valueToLiteral(def.value, col.type);
  const actual = parseLiteral(dbDefault);
  if (literalEqual(expected, actual, col.type)) return null;
  return `${at}: varsayılan farklı — şema "${literalText(expected)}", veritabanı "${literalText(actual)}"`;
}
