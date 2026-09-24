// Veritabanı istemcisi: postgres-js + drizzle.

import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema/index';

export type Schema = typeof schema;
/** Hem veritabanı hem transaction nesnesini kapsar (yardımcı fonksiyonların `tx` parametresi). */
export type Database = PgDatabase<PostgresJsQueryResultHKT, Schema>;
export type Sql = postgres.Sql;

export interface DbHandle {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
  /** Uygulama adı (pg_stat_activity) */
  applicationName?: string;
  debug?: boolean;
}

export function createDb(url: string, opts: CreateDbOptions = {}): DbHandle {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    connection: { application_name: opts.applicationName ?? 'siparis' },
  });
  const db = drizzle(sql, { schema, logger: opts.debug ?? false }) as unknown as Database;
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}

export { schema };
