// Şube olay günlüğü (branch_events) — SSE'nin kaynağı (00 §10 "sipariş kaçmaz").

import type { BranchEventType } from '@siparis/core';
import type { Database } from '@siparis/db';
import { sql } from 'drizzle-orm';

export interface AppendBranchEventInput {
  tenantId: string;
  branchId: string;
  type: BranchEventType | (string & {});
  payload?: Record<string, unknown>;
}

export interface BranchEventRow {
  seq: number;
  tenantId: string;
  branchId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Olay ekler ve seq döner. Şube başına transaction düzeyinde advisory lock alınır: aynı şubenin olayları
 * commit sırasıyla artan seq alır (SSE Last-Event-ID tekrar oynatmasında atlama olmaz).
 * NOTIFY 'branch_events' tetikleyiciyle COMMIT'te gider. İş verisiyle aynı transaction'da çağrılmalı.
 */
export async function appendBranchEvent(tx: Database, input: AppendBranchEventInput): Promise<number> {
  const rows = await tx.execute<{ seq: string | number }>(sql`
    with l as (select pg_advisory_xact_lock(hashtextextended('branch_events:' || ${input.branchId}::text, 0)))
    insert into branch_events (tenant_id, branch_id, type, payload)
    select ${input.tenantId}::uuid, ${input.branchId}::uuid, ${input.type}, ${JSON.stringify(input.payload ?? {})}::jsonb
      from l
    returning seq`);
  const seq = (rows as unknown as { seq: string | number }[])[0]?.seq;
  return Number(seq);
}

type RawRow = {
  seq: string | number;
  tenant_id: string;
  branch_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
};

function mapRow(r: RawRow): BranchEventRow {
  return {
    seq: Number(r.seq),
    tenantId: r.tenant_id,
    branchId: r.branch_id,
    type: r.type,
    payload: r.payload ?? {},
    createdAt: new Date(r.created_at),
  };
}

/** `afterSeq`'ten sonraki olaylar (seq sırasıyla). */
export async function listBranchEventsAfter(
  db: Database,
  opts: { tenantId: string; branchId: string; afterSeq: number; limit?: number },
): Promise<BranchEventRow[]> {
  const rows = await db.execute<RawRow>(sql`
    select seq, tenant_id, branch_id, type, payload, created_at
      from branch_events
     where branch_id = ${opts.branchId} and tenant_id = ${opts.tenantId} and seq > ${opts.afterSeq}
     order by seq
     limit ${opts.limit ?? 500}`);
  return (rows as unknown as RawRow[]).map(mapRow);
}

/** Şubenin son seq değeri (olay yoksa 0). */
export async function latestBranchSeq(db: Database, branchId: string): Promise<number> {
  const rows = await db.execute<{ seq: string | number | null }>(
    sql`select max(seq) as seq from branch_events where branch_id = ${branchId}`,
  );
  return Number((rows as unknown as { seq: string | number | null }[])[0]?.seq ?? 0);
}

/** `afterSeq`'ten sonra kaç olay var (tekrar oynatma sınırı için). */
export async function countBranchEventsAfter(db: Database, branchId: string, afterSeq: number): Promise<number> {
  const rows = await db.execute<{ n: string | number }>(
    sql`select count(*) as n from branch_events where branch_id = ${branchId} and seq > ${afterSeq}`,
  );
  return Number((rows as unknown as { n: string | number }[])[0]?.n ?? 0);
}
