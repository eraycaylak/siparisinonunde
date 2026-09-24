// Temel bakım işleri: saklama süreleri (14 §7.2 cron.retention) ve süresi dolan "tükendi" temizliği.

import { sql } from 'drizzle-orm';
import { registerCron, registerJobHandler } from '../../lib/jobs';

/** Faz 1 saklama süreleri (gün). */
export const RETENTION_DAYS = {
  branchEvents: 7,
  waWebhookEvents: 30,
  otpVerifications: 30,
  smsMessages: 90,
  finishedJobs: 30,
  storefrontLinkTokens: 30,
  courierLoginLinks: 7,
} as const;

export function registerSystemJobs(): void {
  registerJobHandler('cron.retention', async (_payload, { db, log }) => {
    const r = RETENTION_DAYS;
    const counts: Record<string, number> = {};
    const run = async (name: string, q: ReturnType<typeof sql>) => {
      const rows = await db.execute(q);
      counts[name] = (rows as unknown as unknown[]).length;
    };
    await run('branch_events', sql`delete from branch_events where created_at < now() - make_interval(days => ${r.branchEvents}) returning seq`);
    await run('wa_webhook_events', sql`delete from wa_webhook_events where received_at < now() - make_interval(days => ${r.waWebhookEvents}) returning id`);
    await run('otp_verifications', sql`delete from otp_verifications where created_at < now() - make_interval(days => ${r.otpVerifications}) returning id`);
    await run('sms_messages', sql`delete from sms_messages where created_at < now() - make_interval(days => ${r.smsMessages}) returning id`);
    await run(
      'jobs',
      sql`delete from jobs where status in ('done', 'cancelled') and finished_at < now() - make_interval(days => ${r.finishedJobs}) returning id`,
    );
    await run(
      'storefront_link_tokens',
      sql`delete from storefront_link_tokens where expires_at < now() - make_interval(days => ${r.storefrontLinkTokens}) returning id`,
    );
    await run(
      'courier_login_links',
      sql`delete from courier_login_links where expires_at < now() - make_interval(days => ${r.courierLoginLinks}) returning id`,
    );
    await run('sessions', sql`delete from sessions where expires_at < now() returning id`);
    log.info({ counts }, 'saklama temizliği tamamlandı');
  });
  registerCron({ name: 'retention', type: 'cron.retention', schedule: { dailyAt: '03:00' } });

  registerJobHandler('cron.sold_out_reset', async (_payload, { db }) => {
    await db.execute(sql`update products set sold_out_until = null where sold_out_until is not null and sold_out_until <= now()`);
  });
  registerCron({ name: 'sold_out_reset', type: 'cron.sold_out_reset', schedule: { everyMinutes: 15 } });
}
