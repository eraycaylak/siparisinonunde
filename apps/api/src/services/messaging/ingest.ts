// Webhook alımı (02 §7.2): ham olay wa_webhook_events + `wa.process_inbound` işi (aynı transaction) +
// wa_accounts.last_webhook_at. İşleme worker'da (wa-inbound kuyruğu); dev simülatörü aynı hattı kullanır.

import { waAccounts, waWebhookEvents, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { enqueueJob } from '../../lib/jobs';
import { getWaProvider, type WaAccountRow } from '../../wa/registry';
import { processWaEvents, type EngineDeps, type ProcessEventsSummary } from './engine';

export interface IngestResult {
  webhookEventId: string;
  jobId: string | null;
}

export async function ingestWebhookPayload(db: Database, account: WaAccountRow, payload: unknown): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(waWebhookEvents)
      .values({ provider: account.provider, waAccountId: account.id, tenantId: account.tenantId, payload: payload as object })
      .returning({ id: waWebhookEvents.id });
    const jobId = await enqueueJob(tx, {
      queue: 'wa-inbound',
      type: 'wa.process_inbound',
      payload: { webhookEventId: ev!.id },
      dedupeKey: `wa_in:${ev!.id}`,
      tenantId: account.tenantId,
      maxAttempts: 8,
    });
    await tx.update(waAccounts).set({ lastWebhookAt: new Date() }).where(eq(waAccounts.id, account.id));
    return { webhookEventId: ev!.id, jobId };
  });
}

/** `wa.process_inbound` işleyicisi: ham olayı ayrıştırıp konuşma motoruna verir (idempotent: wamid tekil). */
export async function processWebhookEvent(deps: EngineDeps, webhookEventId: string, opts: { now?: Date } = {}): Promise<ProcessEventsSummary | null> {
  const [row] = await deps.db.select().from(waWebhookEvents).where(eq(waWebhookEvents.id, webhookEventId));
  if (!row || row.processedAt) return null;
  const [account] = row.waAccountId ? await deps.db.select().from(waAccounts).where(eq(waAccounts.id, row.waAccountId)) : [];
  if (!account) {
    await deps.db.update(waWebhookEvents).set({ processedAt: new Date(), error: 'account_not_found' }).where(eq(waWebhookEvents.id, row.id));
    return null;
  }
  const events = getWaProvider(account.provider).parseWebhook(row.payload);
  const mismatched = events.find((e) => e.phoneNumberId && account.phoneNumberId && e.phoneNumberId !== account.phoneNumberId);
  if (mismatched) deps.log.warn({ webhookEventId, accountId: account.id }, 'webhook phone_number_id hesapla eşleşmiyor');
  try {
    const summary = await processWaEvents(deps, account, events, opts);
    await deps.db.update(waWebhookEvents).set({ processedAt: new Date(), error: null }).where(eq(waWebhookEvents.id, row.id));
    return summary;
  } catch (err) {
    await deps.db
      .update(waWebhookEvents)
      .set({ error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      .where(eq(waWebhookEvents.id, row.id));
    throw err;
  }
}
