// Yalnız dev/test: public şemayı düşürür ve migration'ları yeniden uygular.

import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { runMigrations } from './migrate';

/**
 * Sıfırlanabilir veritabanı adları: `*_dev`, `*_test` ve paralel geliştirme/e2e kopyaları
 * (`*_dev_s3`, `*_test_s2`, `*_e2e_test`). Başka adlar yalnız ALLOW_DB_RESET=1 ile.
 */
export const RESETTABLE_DB_NAME = /_(dev|test)(_s\d+)?$/;

export function isResettableDbName(dbName: string): boolean {
  return RESETTABLE_DB_NAME.test(dbName);
}

/** Güvenlik: yalnız adı kalıba uyan ya da ALLOW_DB_RESET=1 olan veritabanları; üretimde asla. */
export function assertResettable(url: string): void {
  if (process.env.NODE_ENV === 'production') throw new Error('Üretimde veritabanı sıfırlanamaz.');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!isResettableDbName(dbName) && process.env.ALLOW_DB_RESET !== '1') {
    throw new Error(`"${dbName}" sıfırlanamaz (yalnız *_dev, *_test, *_dev_sN, *_test_sN, *_e2e_test ya da ALLOW_DB_RESET=1).`);
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
