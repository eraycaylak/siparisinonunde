// Webhook alımı (02 §7.2): ham olay wa_webhook_events + `wa.process_inbound` işi (aynı transaction) +
// wa_accounts.last_webhook_at. İşleme worker'da (wa-inbound kuyruğu); dev simülatörü aynı hattı kullanır.
// Ortak numara olayları (provider 'shared', hesapsız) shared-router.ts yönlendiricisine gider.
// Olaydaki phone_number_id hesabın numarasıyla uyuşmuyorsa O OLAY İŞLENMEZ: yük "eşleşmedi" (orphan) işaretlenir ve
// kritik uyarı gider (tenant yalıtımı; denetim H16 / iş 3.3). Aynı yükteki uyuşan olaylar işlenmeye devam eder.

import { waAccounts, waWebhookEvents, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';
import { alert } from '../../lib/alert';
import { enqueueJob } from '../../lib/jobs';
import { getWaProvider, providerForAccount, type WaAccountRow } from '../../wa/registry';
import { processWaEvents, type EngineDeps, type ProcessEventsSummary } from './engine';
import { processSharedEvents } from './shared-router';

export interface IngestResult {
  webhookEventId: string;
  jobId: string | null;
}

/** `wa_webhook_events.error`: olay bu hesabın numarasına ait değil; işlenmedi (admin DLQ/teşhis için sabit metin). */
export const ORPHAN_PHONE_MISMATCH = 'phone_number_id_mismatch';
/** Aynı yükte hem bu hesabın hem başka numaranın olayı vardı: yabancı olaylar atıldı, bu hesabınkiler işlendi. */
export const ORPHAN_PHONE_MISMATCH_PARTIAL = 'phone_number_id_mismatch_partial';

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
  // Ortak numara (00 §12a madde 8): hesap yok; yönlendirici her mesaj için dükkanı seçer
  if (row.provider === 'shared' && !row.waAccountId) {
    try {
      const summary = await processSharedEvents(deps, getWaProvider(deps.config.PLATFORM_WA_PROVIDER).parseWebhook(row.payload), opts);
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
  const [account] = row.waAccountId ? await deps.db.select().from(waAccounts).where(eq(waAccounts.id, row.waAccountId)) : [];
  if (!account) {
    await deps.db.update(waWebhookEvents).set({ processedAt: new Date(), error: 'account_not_found' }).where(eq(waWebhookEvents.id, row.id));
    return null;
  }
  const events = providerForAccount(account, deps.config).parseWebhook(row.payload);
  // phone_number_id uyuşmazlığı: olay bu hesabın numarasına ait DEĞİL (sağlayıcıda yanlış webhook adresi, numara
  // taşınması, belirteç sızıntısı ya da kasıtlı enjeksiyon). Eskiden yalnız log.warn vardı ve olay yine o tenant'ın
  // bağlamında işleniyordu: başka bir işletmenin müşterisi bu işletmenin sohbetine düşebilirdi (denetim H16 / iş 3.3,
  // CLAUDE.md kural 2 tenant yalıtımı). Artık yabancı olay İŞLENMEZ ve kritik uyarı gider.
  // Ayıklama olay BAŞINA yapılır, yük başına değil: tek webhook POST'u birden çok entry/changes taşıyabilir
  // (Cloud API yükü numara başına bir `metadata.phone_number_id` içerir, bkz. wa/parse.ts). Yükün tamamını atmak
  // yabancı olayla aynı POST'a düşen GERÇEK müşteri mesajını da kaybettirirdi (CLAUDE.md kural 3 "sipariş kaçmaz").
  // Ham yük silinmez (saklama süresine kadar durur): doğru hesap bulunursa elle yeniden işlenebilir.
  const foreign = account.phoneNumberId ? events.filter((e) => e.phoneNumberId && e.phoneNumberId !== account.phoneNumberId) : [];
  const own = foreign.length ? events.filter((e) => !foreign.includes(e)) : events;
  if (foreign.length) {
    deps.log.error(
      { webhookEventId, accountId: account.id, tenantId: account.tenantId, provider: account.provider, foreign: foreign.length, total: events.length },
      'webhook phone_number_id hesapla eşleşmiyor: yabancı olaylar işlenmedi (eşleşmedi)',
    );
    alert(
      { log: deps.log, config: deps.config },
      {
        kind: 'wa_webhook_phone_mismatch',
        severity: 'critical',
        // Numara kimlikleri kişisel veri değil ama gizli yapılandırmadır: uyarıya YAZILMAZ, log satırında da yok
        message: own.length
          ? 'WhatsApp webhook yükünde başka bir numaraya ait olaylar vardı: tenant yalıtımı için atıldı, hesabın kendi olayları işlendi.'
          : 'WhatsApp webhook olayı başka bir numaraya ait: tenant yalıtımı için işlenmedi (eşleşmedi olarak işaretlendi).',
        data: { webhookEventId, accountId: account.id, provider: account.provider, foreign: foreign.length, total: events.length },
        dedupeKey: `wa_webhook_phone_mismatch:${account.id}`,
      },
    );
    if (!own.length) {
      await deps.db.update(waWebhookEvents).set({ processedAt: new Date(), error: ORPHAN_PHONE_MISMATCH }).where(eq(waWebhookEvents.id, row.id));
      return null;
    }
  }
  try {
    const summary = await processWaEvents(deps, account, own, opts);
    await deps.db
      .update(waWebhookEvents)
      .set({ processedAt: new Date(), error: foreign.length ? ORPHAN_PHONE_MISMATCH_PARTIAL : null })
      .where(eq(waWebhookEvents.id, row.id));
    return summary;
  } catch (err) {
    await deps.db
      .update(waWebhookEvents)
      .set({ error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      .where(eq(waWebhookEvents.id, row.id));
    throw err;
  }
}
