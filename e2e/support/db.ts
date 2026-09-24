// e2e veritabanı yardımcıları: veritabanını oluşturma, packages/db betikleriyle sıfırlama/migrate/seed
// ve test kurulumu için küçük SQL işlemleri. `postgres` sürücüsü packages/db'nin bağımlılığıdır; kökte
// bağımlılık eklememek için oradan yüklenir.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { E2E_DATABASE_URL, ROOT_DIR } from './env';

interface Sql {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  unsafe<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
  end(opts?: { timeout?: number }): Promise<void>;
}
type PostgresFactory = (url: string, opts?: Record<string, unknown>) => Sql;

const requireFromDb = createRequire(join(ROOT_DIR, 'packages/db/package.json'));
const postgres = requireFromDb('postgres') as PostgresFactory;

/** Kısa ömürlü bağlantıyla SQL çalıştırır. */
export async function withSql<T>(fn: (sql: Sql) => Promise<T>, url = E2E_DATABASE_URL): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Veritabanı yoksa oluşturur (bağlantı `postgres` bakım veritabanına yapılır). */
export async function ensureDatabase(url = E2E_DATABASE_URL): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`Geçersiz e2e veritabanı adı: ${dbName}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  await withSql(async (sql) => {
    const rows = await sql`select 1 from pg_database where datname = ${dbName}`;
    if (!rows.length) await sql.unsafe(`create database ${dbName}`);
  }, admin.toString());
}

/** packages/db betiğini e2e veritabanına karşı çalıştırır (reset | migrate | seed). */
export function runDbScript(script: 'reset' | 'migrate' | 'seed'): void {
  execFileSync('pnpm', ['--silent', '--filter', '@siparis/db', script], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, ALLOW_DB_RESET: '1', NODE_ENV: 'test' },
  });
}

/**
 * Demo şubesini saatten bağımsız açık tutar: her gün 00:00–23:59 (seed 10:00–23:30).
 * Duraklatma/yoğunluk ve özel günler temizlenir.
 */
export async function makeBranchAlwaysOpen(slug: string): Promise<void> {
  await withSql(async (sql) => {
    const branches = await sql<{ id: string }>`
      select b.id from branches b join tenants t on t.id = b.tenant_id where t.slug = ${slug}`;
    if (!branches.length) throw new Error(`"${slug}" şubesi bulunamadı (seed çalıştı mı?)`);
    for (const { id } of branches) {
      await sql`update opening_hours set opens_at = '00:00', closes_at = '23:59' where branch_id = ${id}`;
      await sql`delete from special_days where branch_id = ${id}`;
      await sql`update branches set paused_until = null, busy_extra_minutes = 0 where id = ${id}`;
    }
  });
}

/** İşletmenin WhatsApp hesaplarının durumunu değiştirir (panelde "bağlantıyı kes" uç noktası yok). */
export async function setWaAccountStatus(slug: string, status: 'connected' | 'disconnected' | 'error'): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      update wa_accounts set status = ${status}, last_error = ${status === 'error' ? 'e2e: kanal devre dışı' : null}, updated_at = now()
      where tenant_id = (select id from tenants where slug = ${slug})`;
  });
}
