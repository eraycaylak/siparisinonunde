// Yalnız dev/test: public şemayı düşürür ve migration'ları yeniden uygular.

import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { runMigrations } from './migrate';

/** Güvenlik: yalnız adı _dev/_test ile biten ya da ALLOW_DB_RESET=1 olan veritabanları. */
export function assertResettable(url: string): void {
  if (process.env.NODE_ENV === 'production') throw new Error('Üretimde veritabanı sıfırlanamaz.');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/(_dev|_test)$/.test(dbName) && process.env.ALLOW_DB_RESET !== '1') {
    throw new Error(`"${dbName}" sıfırlanamaz (yalnız *_dev / *_test ya da ALLOW_DB_RESET=1).`);
  }
}

/** Şemayı düşürüp boş şema oluşturur (migrate etmez). */
export async function dropSchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe('drop schema if exists public cascade');
  await sql.unsafe('create schema public');
  await sql.unsafe('grant all on schema public to public');
}

export async function resetDatabase(url: string, opts: { log?: (m: string) => void } = {}): Promise<void> {
  assertResettable(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await dropSchema(sql);
    await runMigrations(sql, { log: opts.log });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL tanımlı değil (.env).');
    process.exit(1);
  }
  await resetDatabase(url, { log: (m) => console.log(m) });
  console.log('Veritabanı sıfırlandı ve migration uygulandı.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
