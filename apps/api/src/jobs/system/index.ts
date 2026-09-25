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
  /** Gelen konum ve medya mesajlarının koordinat/adres/medya kimliği (08 §2.8 retention.locations, retention.media) */
  locationsMedia: 30,
  /** Sipariş notu ve ürün notu: final durumdan (teslim, ret, iptal) itibaren (08 §2.8 satır 1 retention.order_notes, §2.7) */
  orderNotes: 30,
} as const;

/** WhatsApp mesaj içeriği (ay): metin silinir; wamid, yön, zaman ve durum kalır (08 §2.8 satır 4 retention.wa_messages). */
export const RETENTION_WA_MESSAGE_MONTHS = 6;

/** İçeriği silinen mesajın panelde görünen metni. */
export const RETENTION_REDACTED_BODY = 'Mesaj içeriği saklama süresi dolduğu için silindi.';

/** Mesaj yükünde metin ya da kişisel veri taşıyan anahtarlar (gelen: yanıt başlığı, profil, ham gövde; giden: gönderim tanımı ve yedekleri). */
const WA_MESSAGE_TEXT_KEYS = ['title', 'profileName', 'username', 'referral', 'raw', 'spec', 'templateFallback', 'smsFallback'] as const;

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
    // Konum/medya: mesaj satırı (sohbet geçmişi) kalır; koordinat, adres, medya kimliği ve ham webhook gövdesi silinir
    await run(
      'message_locations_media',
      sql`update messages
             set payload = payload - 'lat' - 'lng' - 'address' - 'name' - 'mediaId' - 'raw',
                 body = case when kind = 'location' then 'Konum paylaşıldı' else body end
           where kind in ('location', 'image', 'audio')
             and created_at < now() - make_interval(days => ${r.locationsMedia})
             and payload ?| array['lat', 'lng', 'address', 'name', 'mediaId', 'raw']
         returning id`,
    );
    // Sipariş notu (serbest metin, sağlık bilgisi içerebilir): final durumdan 30 gün sonra kalıcı olarak boşaltılır
    await run(
      'order_notes',
      sql`update orders
             set note = null
           where note is not null
             and status in ('delivered', 'rejected', 'cancelled')
             and coalesce(delivered_at, rejected_at, cancelled_at, updated_at) < now() - make_interval(days => ${r.orderNotes})
         returning id`,
    );
    await run(
      'order_item_notes',
      sql`update order_items oi
             set note = null
            from orders o
           where o.id = oi.order_id
             and oi.note is not null
             and o.status in ('delivered', 'rejected', 'cancelled')
             and coalesce(o.delivered_at, o.rejected_at, o.cancelled_at, o.updated_at) < now() - make_interval(days => ${r.orderNotes})
         returning oi.id`,
    );
    // WhatsApp mesaj içeriği: 6 ay sonra metin ve metin taşıyan yük alanları silinir; sohbet önizlemesi de temizlenir
    const textKeys = sql.raw(`array[${WA_MESSAGE_TEXT_KEYS.map((k) => `'${k}'`).join(', ')}]`);
    await run(
      'wa_message_text',
      sql`update messages
             set body = ${RETENTION_REDACTED_BODY},
                 payload = case when payload is null then null else payload - ${textKeys}::text[] end
           where created_at < now() - make_interval(months => ${RETENTION_WA_MESSAGE_MONTHS})
             and ((body is not null and body <> ${RETENTION_REDACTED_BODY}) or payload ?| ${textKeys}::text[])
         returning id`,
    );
    await run(
      'conversation_previews',
      sql`update conversations
             set last_message_preview = null
           where last_message_preview is not null
             and last_message_at < now() - make_interval(months => ${RETENTION_WA_MESSAGE_MONTHS})
         returning id`,
    );
    log.info({ counts }, 'saklama temizliği tamamlandı');
  });
  registerCron({ name: 'retention', type: 'cron.retention', schedule: { dailyAt: '03:00' } });

  registerJobHandler('cron.sold_out_reset', async (_payload, { db }) => {
    await db.execute(sql`update products set sold_out_until = null where sold_out_until is not null and sold_out_until <= now()`);
  });
  registerCron({ name: 'sold_out_reset', type: 'cron.sold_out_reset', schedule: { everyMinutes: 15 } });
}
