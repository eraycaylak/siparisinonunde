// "Bugün tükendi" bitişi: şubenin çalışma saatine göre bir sonraki iş gününün ilk açılışı
// (core menu/sold-out.ts). Ürünler tenant düzeyinde olduğundan kullanıcının şubesi, yoksa varsayılan şube esas alınır.

import { endOfLocalDay } from '@siparis/core';
import { soldOutUntilNextBusinessDay } from '@siparis/core/menu/sold-out';
import { branches, type Database } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { defaultBranchId } from '../../plugins/auth';
import { scheduleInputFor } from '../settings/branch';

export async function soldOutUntilFor(db: Database, tenantId: string, branchId: string | null | undefined, now: Date = new Date()): Promise<Date> {
  const id = branchId ?? (await defaultBranchId(db, tenantId));
  if (!id) return endOfLocalDay(now);
  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId)));
  if (!branch) return endOfLocalDay(now);
  return soldOutUntilNextBusinessDay(await scheduleInputFor(db, branch, now), now);
}
