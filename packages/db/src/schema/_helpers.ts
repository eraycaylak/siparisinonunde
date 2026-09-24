// Şema yardımcıları: standart kolonlar ve enum CHECK kısıtları (tek kaynak @siparis/core/enums).

import { sql, type SQL } from 'drizzle-orm';
import { check, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** timestamptz (UTC), JS Date. */
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const pk = () => uuid('id').primaryKey().defaultRandom();
export const createdAt = () => tstz('created_at').notNull().defaultNow();
export const updatedAt = () =>
  tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

function quoteList(values: readonly string[]): SQL {
  for (const v of values) {
    if (!/^[a-z0-9_.-]+$/i.test(v)) throw new Error(`Enum değeri beklenmeyen karakter içeriyor: ${v}`);
  }
  return sql.raw(values.map((v) => `'${v}'`).join(', '));
}

/** `kolon IN (...)` CHECK kısıtı (NULL değer kısıtı geçer). */
export function enumCheck(name: string, column: AnyPgColumn, values: readonly string[]) {
  return check(name, sql`${column} in (${quoteList(values)})`);
}
