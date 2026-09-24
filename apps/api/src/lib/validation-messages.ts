// Doğrulama hatalarının Türkçe karşılıkları (14 §6 "message: Türkçe açıklama").
// Şemada özel (Türkçe) mesaj verilmişse o korunur; Zod'un İngilizce varsayılanları alan türüne göre Türkçeleştirilir.

export const VALIDATION_ERROR_MESSAGE = 'Gönderilen bilgilerde hata var.';

/** Zod varsayılan (İngilizce) mesajı mı? Özel mesajlar (Türkçe) korunur. */
const ENGLISH_DEFAULT = /^(too small|too big|invalid|expected|required|unrecognized|string must|number must|array must|input not|bad )/i;

export interface IssueLike {
  code?: string;
  message?: string;
  path?: readonly PropertyKey[];
  [key: string]: unknown;
}

export interface TurkishIssue {
  /** JSON işaretçisi biçiminde alan yolu: "/customerPhone", "/items/0/quantity" ("/" = gövdenin kendisi) */
  path: string;
  /** Nokta ile ayrılmış alan adı: "items.0.quantity" ("" = gövde) */
  field: string;
  message: string;
  code: string;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return null;
}

/** Tek bir Zod issue'su için Türkçe alan mesajı. */
export function turkishIssueMessage(issue: IssueLike): string {
  const msg = typeof issue.message === 'string' ? issue.message.trim() : '';
  if (msg && !ENGLISH_DEFAULT.test(msg)) return msg;
  const origin = typeof issue.origin === 'string' ? issue.origin : undefined;
  switch (issue.code) {
    case 'invalid_type': {
      if (/received undefined|^required$/i.test(msg) || ('input' in issue && issue.input === undefined)) return 'Bu alan zorunlu.';
      const expected = String(issue.expected ?? '');
      if (expected === 'number' || expected === 'int') return 'Sayı olmalı.';
      if (expected === 'boolean') return 'Evet ya da hayır olmalı.';
      if (expected === 'array') return 'Liste olmalı.';
      if (expected === 'string') return 'Metin olmalı.';
      return 'Geçersiz biçim.';
    }
    case 'too_small': {
      const min = num(issue.minimum);
      if (origin === 'string') return min === null || min <= 1 ? 'Bu alan zorunlu.' : `Çok kısa: en az ${min} karakter olmalı.`;
      if (origin === 'array' || origin === 'set') return min === null || min <= 1 ? 'En az bir seçim yapın.' : `En az ${min} seçim yapın.`;
      if (origin === 'number' || origin === 'int' || origin === 'bigint') return min === null ? 'Değer çok küçük.' : `En az ${min} olmalı.`;
      if (origin === 'date') return 'Tarih çok erken.';
      return 'Değer çok kısa ya da küçük.';
    }
    case 'too_big': {
      const max = num(issue.maximum);
      if (origin === 'string') return max === null ? 'Çok uzun.' : `Çok uzun: en fazla ${max} karakter olabilir.`;
      if (origin === 'array' || origin === 'set') return max === null ? 'Çok fazla seçim.' : `En fazla ${max} seçim yapılabilir.`;
      if (origin === 'number' || origin === 'int' || origin === 'bigint') return max === null ? 'Değer çok büyük.' : `En fazla ${max} olabilir.`;
      if (origin === 'date') return 'Tarih çok ileri.';
      return 'Değer çok uzun ya da büyük.';
    }
    case 'invalid_format': {
      switch (issue.format) {
        case 'email':
          return 'Geçerli bir e-posta adresi yazın.';
        case 'url':
          return 'Geçerli bir bağlantı (URL) yazın.';
        case 'uuid':
        case 'guid':
          return 'Geçersiz kimlik.';
        case 'datetime':
        case 'date':
          return 'Geçerli bir tarih yazın.';
        case 'time':
          return 'Geçerli bir saat yazın (SS:DD).';
        default:
          return 'Geçersiz biçim.';
      }
    }
    case 'invalid_value': {
      const values = Array.isArray(issue.values) ? issue.values : [];
      if (values.length === 1 && values[0] === true) return 'Bu onay gerekli.';
      return 'Geçersiz seçim.';
    }
    case 'unrecognized_keys': {
      const keys = Array.isArray(issue.keys) ? issue.keys.map(String) : [];
      return keys.length ? `Tanınmayan alan: ${keys.join(', ')}.` : 'Tanınmayan alan.';
    }
    case 'not_multiple_of':
      return `${num(issue.divisor) ?? ''} katı olmalı.`.trim();
    case 'invalid_union':
    case 'invalid_key':
    case 'invalid_element':
    case 'custom':
    default:
      return 'Geçersiz değer.';
  }
}

/** Yol → JSON işaretçisi ve nokta biçimi. */
function paths(raw: readonly PropertyKey[] | string | undefined): { path: string; field: string } {
  if (typeof raw === 'string') {
    const parts = raw.replace(/^\//, '').split('/').filter(Boolean);
    return { path: `/${parts.join('/')}`, field: parts.join('.') };
  }
  const parts = (raw ?? []).map((p) => String(p));
  return { path: `/${parts.join('/')}`, field: parts.join('.') };
}

/** Zod issue'larını (ZodError.issues ya da fastify-type-provider-zod validation[]) Türkçe ayrıntıya çevirir. */
export function turkishIssues(
  issues: ReadonlyArray<IssueLike & { instancePath?: string; keyword?: string; params?: Record<string, unknown> }>,
): TurkishIssue[] {
  return issues.map((i) => {
    // fastify-type-provider-zod biçimi: { keyword: code, instancePath, message, params: {...issue} }
    const issue: IssueLike = i.instancePath !== undefined ? { ...(i.params ?? {}), code: i.keyword, message: i.message } : i;
    const { path, field } = paths(i.instancePath !== undefined ? i.instancePath : i.path);
    return { path, field, message: turkishIssueMessage(issue), code: String(issue.code ?? 'invalid') };
  });
}

/** 400 validation_error ayrıntısı: issues + alan → ilk mesaj eşlemi. */
export function validationDetails(issues: TurkishIssue[], context?: string): { issues: TurkishIssue[]; fields: Record<string, string>; context?: string } {
  const fields: Record<string, string> = {};
  for (const i of issues) if (!(i.field in fields)) fields[i.field] = i.message;
  return context ? { issues, fields, context } : { issues, fields };
}
