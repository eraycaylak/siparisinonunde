// WhatsApp işleri (wa.process_inbound, wa.send) — dilim 3.
// Bu fonksiyon hem API hem worker sürecinde çağrılır (jobs/index.ts → registerAllJobs); kayıtlar ada göre tekildir.

import { registerJobHandler } from '../../lib/jobs';
import { processWebhookEvent } from '../../services/messaging/ingest';
import { performWaSend } from '../../services/messaging/send';

export function registerWaJobs(): void {
  // Ham webhook olayı → konuşma motoru (wa-inbound)
  registerJobHandler<{ webhookEventId: string }>('wa.process_inbound', async (payload, { db, config, log }) => {
    if (!payload.webhookEventId) return;
    await processWebhookEvent({ db, config, log }, payload.webhookEventId);
  });

  // Outbox → sağlayıcı (wa-outbound)
  registerJobHandler<{ messageId: string }>('wa.send', async (payload, { db, config, log, job }) => {
    if (!payload.messageId) return;
    await performWaSend({ db, config, log, lastAttempt: job.attempts >= job.maxAttempts }, payload.messageId);
  });
}
