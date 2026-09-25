// migrations/*.sql dosyalarını ad sırasıyla uygular; uygulananlar `_migrations` tablosunda tutulur.
// Dilim aralıkları (14 §2): temel 0000–0099, menü 0100–0199, sipariş 0200–0299, whatsapp 0300–0399,
// işletme-ayarları 0400–0499, admin 0500–0599, kimlik güvenliği 0600–0699, bildirimler 0700–0799,
// saklama 0800–0899.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function listMigrationFiles(dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = await readdir(dir);
  return files.filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
}

/** Bekleyen migration'ları uygular. `target` bağlantı adresi ya da açık bir postgres-js istemcisi. */
export async function runMigrations(
  target: string | postgres.Sql,
  opts: { dir?: string; log?: (msg: string) => void } = {},
): Promise<MigrationResult> {
  const sql = typeof target === 'string' ? postgres(target, { max: 1, onnotice: () => {} }) : target;
  const log = opts.log ?? (() => {});
  const dir = opts.dir ?? MIGRATIONS_DIR;
  try {
    await sql`create table if not exists _migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;
    // Aynı anda iki süreç migrate etmesin
    await sql`select pg_advisory_lock(727274001)`;
    try {
      const done = new Map<string, string>(
        (await sql<{ name: string; checksum: string }[]>`select name, checksum from _migrations`).map((r) => [r.name, r.checksum]),
      );
      const result: MigrationResult = { applied: [], skipped: [] };
      for (const file of await listMigrationFiles(dir)) {
        const content = await readFile(join(dir, file), 'utf8');
        const checksum = createHash('sha256').update(content).digest('hex');
        const prev = done.get(file);
        if (prev) {
          if (prev !== checksum) log(`UYARI: ${file} uygulandıktan sonra değişmiş (yeniden uygulanmaz).`);
          result.skipped.push(file);
          continue;
        }
        const statements = content
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean);
        await sql.begin(async (tx) => {
          for (const stmt of statements) await tx.unsafe(stmt).simple();
          await tx`insert into _migrations (name, checksum) values (${file}, ${checksum})`;
        });
        log(`uygulandı: ${file}`);
        result.applied.push(file);
      }
      return result;
    } finally {
      await sql`select pg_advisory_unlock(727274001)`;
    }
  } finally {
    if (typeof target === 'string') await sql.end({ timeout: 5 });
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL tanımlı değil (.env).');
    process.exit(1);
  }
  const res = await runMigrations(url, { log: (m) => console.log(m) });
  console.log(`Migration tamam: ${res.applied.length} yeni, ${res.skipped.length} zaten uygulanmış.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
