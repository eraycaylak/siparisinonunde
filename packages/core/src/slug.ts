// İşletme slug'ı (alt alan adı): ^[a-z0-9](-?[a-z0-9]){2,39}$

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Ayrılmış adlar (alt alan adı ve yol çakışması). */
export const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'panel', 'admin', 'kurye', 'dev', 'static', 'assets', 'uploads', 'mail', 'smtp',
  'help', 'destek', 'blog', 'hooks', 'status', 'docs', 'demo', 'test', 'bayi', 'yardim', 'siparisinonunde',
]);

export const SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9]){2,39}$/;

/** "Bozok Pide Salonu" → "bozok-pide-salonu" */
export function slugifyTr(input: string): string {
  const lower = input.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  let s = '';
  for (const ch of lower) s += TR_MAP[ch] ?? ch;
  s = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (s.length > 40) s = s.slice(0, 40).replace(/-+$/g, '');
  return s;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}
