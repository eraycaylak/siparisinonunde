// wrangler.jsonc → wrangler.generated.jsonc: workers.dev adresini derleme değişkenine (NEXT_PUBLIC_SITE_URL) ve
// çalışma değişkenine (APP_BASE_URL) yazar. Kullanım: node scripts/prepare-config.mjs https://siparisinonunde-dev.<alt>.workers.dev
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/.test(url)) {
  console.error(`Geçersiz adres: "${url}" (https://… bekleniyor)`);
  process.exit(1);
}

// JSONC → JSON: dize içindekilere dokunmadan satır ve blok yorumlarını, sondaki virgülleri siler.
export function stripJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const config = JSON.parse(stripJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')));
config.vars = { ...config.vars, APP_BASE_URL: url };
for (const c of config.containers ?? []) c.image_vars = { ...c.image_vars, NEXT_PUBLIC_SITE_URL: url };
writeFileSync(join(root, 'wrangler.generated.jsonc'), `// scripts/prepare-config.mjs üretir; elle düzenlemeyin.\n${JSON.stringify(config, null, 2)}\n`);
console.log(`wrangler.generated.jsonc yazıldı (${url})`);
