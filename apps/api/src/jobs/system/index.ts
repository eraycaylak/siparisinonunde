// Temel bakım işleri: saklama süreleri (14 §7.2 cron.retention, 08 §2.8) ve süresi dolan "tükendi" temizliği.
// Her saklama adımı sonucunu `retention_runs` tablosuna yazar (08 §2.8 "Kabul kriterleri"; imha tutanağı, ≥ 3 yıl).

import { maskPhone } from '@siparis/core';
import { retentionRuns, type Database } from '@siparis/db';
import { sql, type SQL } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { registerCron, registerJobHandler } from '../../lib/jobs';
import {
  CUSTOMER_INACTIVE_MONTHS,
  eraseInactiveCustomer,
  inactiveCustomerIds,
  tenantsWithInactiveCustomers,
} from '../../services/customers/index';

/** Faz 1 saklama süreleri (gün). */
export const RETENTION_DAYS = {
  branchEvents: 7,
  waWebhookEvents: 30,
  otpVerifications: 30,
  /** SMS gönderim kaydı: süre dolunca telefon maskelenir; durum, amaç ve kota/maliyet alanları kalır (08 §2.8 satır 19) */
  smsMessages: 90,
  finishedJobs: 30,
  storefrontLinkTokens: 30,
  courierLoginLinks: 7,
  /** Gelen konum ve medya mesajlarının koordinat/adres/medya kimliği (08 §2.8 retention.locations, retention.media) */
  locationsMedia: 30,
  /** Sipariş notu ve ürün notu: final durumdan (teslim, ret, iptal) itibaren (08 §2.8 satır 1 retention.order_notes, §2.7) */
  orderNotes: 30,
} as const;

/** Ay cinsinden saklama süreleri (08 §2.8). */
export const RETENTION_MONTHS = {
  /** WhatsApp mesaj içeriği: metin silinir; wamid, yön, zaman ve durum kalır (satır 4 retention.wa_messages) */
  waMessages: 6,
  /** Sipariş onayındaki IP ve tarayıcı bilgisi, son müşterinin belge kabulündeki IP/tarayıcı: 1 yıl (satır 10 benzeri) */
  confirmationIp: 12,
  /** Pazarlama sitesi talepleri: son temastan (updated_at) 12 ay (satır 15 retention.leads) */
  leads: 12,
  /** Panel güvenlik ve audit_log kayıtları: 2 yıl (satır 13 retention.audit) */
  auditLog: 24,
  /** Hareketsiz müşteri: son sipariş ya da son gelen mesajdan 24 ay (satır 6 retention.customer_inactive) */
  customerInactive: CUSTOMER_INACTIVE_MONTHS,
} as const;

/** WhatsApp mesaj içeriği (ay): metin silinir; wamid, yön, zaman ve durum kalır (08 §2.8 satır 4 retention.wa_messages). */
export const RETENTION_WA_MESSAGE_MONTHS = RETENTION_MONTHS.waMessages;

/** İçeriği silinen mesajın panelde görünen metni. */
export const RETENTION_REDACTED_BODY = 'Mesaj içeriği saklama süresi dolduğu için silindi.';

/** Koşu özetinin `retention_runs.job_name` değeri (admin sağlık göstergesi bunu okur). */
export const RETENTION_RUN_SUMMARY = 'cron.retention';

/** Mesaj yükünde metin ya da kişisel veri taşıyan anahtarlar (gelen: yanıt başlığı, profil, ham gövde; giden: gönderim tanımı ve yedekleri). */
const WA_MESSAGE_TEXT_KEYS = ['title', 'profileName', 'username', 'referral', 'raw', 'spec', 'templateFallback', 'smsFallback'] as const;

/** Konum/medya mesajından silinen yük anahtarları. */
const LOCATION_MEDIA_KEYS = sql.raw(`array['lat', 'lng', 'address', 'name', 'mediaId', 'raw']`);

const FINAL_STATUSES = sql.raw(`('delivered', 'rejected', 'cancelled')`);

/** SMS maskeleme partisi. */
const SMS_MASK_BATCH = 1000;
/** Hareketsiz müşteri sayfası (tenant başına, koşu içinde sayfa sayfa hepsi işlenir). */
const INACTIVE_CUSTOMER_PAGE = 200;

export interface RetentionStepResult {
  jobName: string;
  tenantId: string | null;
  affected: number;
  error: string | null;
}

/** Hata metni: kişisel veri taşımasın diye uzun rakam dizileri (telefon vb.) maskelenir, kısaltılır. */
function safeError(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.replace(/\+?\d[\d\s-]{6,}\d/g, '***').slice(0, 500);
}

/** Veri değiştiren sorgunun (… returning) etkilediği satır sayısı; satırlar belleğe alınmaz. */
async function affectedRows(db: Database, q: SQL): Promise<number> {
  const [r] = (await db.execute<{ n: number }>(sql`with t as (${q}) select count(*)::int as n from t`)) as unknown as { n: number }[];
  return Number(r?.n ?? 0);
}

/** SMS gönderim kayıtlarında 90 günü geçen telefonları maskeler (maskPhone; maskeli değer '*' içerir → idempotent). */
async function maskOldSmsPhones(db: Database): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = (await db.execute<{ id: string; to_phone: string }>(sql`
      select id, to_phone from sms_messages
       where created_at < now() - make_interval(days => ${RETENTION_DAYS.smsMessages})
         and strpos(to_phone, '*') = 0
       order by id
       limit ${SMS_MASK_BATCH}`)) as unknown as { id: string; to_phone: string }[];
    if (!rows.length) break;
    const values = sql.join(
      rows.map((r) => sql`(${r.id}::uuid, ${maskPhone(r.to_phone) || '****'})`),
      sql`, `,
    );
    const n = await affectedRows(
      db,
      sql`update sms_messages s set to_phone = v.masked
            from (values ${values}) as v(id, masked)
           where s.id = v.id and strpos(s.to_phone, '*') = 0
          returning s.id`,
    );
    total += n;
    if (rows.length < SMS_MASK_BATCH || n === 0) break;
  }
  return total;
}

/** Tenant'ın hareketsiz müşterilerini sayfa sayfa anonimleştirir (elle KVKK silmesiyle aynı anlam). */
async function eraseInactiveCustomersOfTenant(db: Database, tenantId: string): Promise<number> {
  let erased = 0;
  let after: string | null = null;
  for (;;) {
    const ids = await inactiveCustomerIds(db, tenantId, { afterId: after, limit: INACTIVE_CUSTOMER_PAGE });
    for (const id of ids) {
      if ((await eraseInactiveCustomer(db, tenantId, id, RETENTION_MONTHS.customerInactive)) === 'erased') erased++;
    }
    if (ids.length < INACTIVE_CUSTOMER_PAGE) break;
    after = ids[ids.length - 1]!;
  }
  return erased;
}

/**
 * 08 §2.8 saklama adımlarını sırayla çalıştırır. Her adım idempotenttir ve sonucunu `retention_runs`'a yazar (tenant
 * bazlı adımda tenant başına bir satır). Bir adımın hatası diğerlerini durdurmaz; en sonda koşu özeti yazılır.
 */
export async function runRetention(db: Database, log: FastifyBaseLogger): Promise<RetentionStepResult[]> {
  const r = RETENTION_DAYS;
  const m = RETENTION_MONTHS;
  const results: RetentionStepResult[] = [];
  const runStartedAt = new Date();

  const record = async (jobName: string, tenantId: string | null, fn: () => Promise<number>): Promise<RetentionStepResult> => {
    const startedAt = new Date();
    let affected = 0;
    let error: string | null = null;
    try {
      affected = await fn();
    } catch (err) {
      error = safeError(err);
      log.error({ err, jobName, tenantId }, 'saklama adımı başarısız');
    }
    const finishedAt = new Date();
    await db.insert(retentionRuns).values({
      jobName,
      tenantId,
      affectedCount: affected,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      error,
    });
    const res = { jobName, tenantId, affected, error };
    results.push(res);
    return res;
  };
  const step = (jobName: string, q: SQL) => record(jobName, null, () => affectedRows(db, q));

  // Satır 19 ve teknik kayıtlar (retention.technical)
  await step('retention.technical.branch_events', sql`delete from branch_events where created_at < now() - make_interval(days => ${r.branchEvents}) returning seq`);
  await step('retention.technical.wa_webhook_events', sql`delete from wa_webhook_events where received_at < now() - make_interval(days => ${r.waWebhookEvents}) returning id`);
  await step('retention.technical.otp_verifications', sql`delete from otp_verifications where created_at < now() - make_interval(days => ${r.otpVerifications}) returning id`);
  // SMS gönderim kaydı silinmez: telefon maskelenir; durum, amaç, sağlayıcı ve kota alanı (maliyet raporu) kalır
  await record('retention.technical.sms_messages', null, () => maskOldSmsPhones(db));
  await step(
    'retention.technical.jobs',
    sql`delete from jobs where status in ('done', 'cancelled') and finished_at < now() - make_interval(days => ${r.finishedJobs}) returning id`,
  );
  await step(
    'retention.technical.storefront_link_tokens',
    sql`delete from storefront_link_tokens where expires_at < now() - make_interval(days => ${r.storefrontLinkTokens}) returning id`,
  );
  await step(
    'retention.technical.courier_login_links',
    sql`delete from courier_login_links where expires_at < now() - make_interval(days => ${r.courierLoginLinks}) returning id`,
  );
  await step('retention.technical.sessions', sql`delete from sessions where expires_at < now() returning id`);

  // Satır 3: konum mesajı satırı (sohbet geçmişi) kalır; koordinat, adres ve ham webhook gövdesi silinir
  await step(
    'retention.locations',
    sql`update messages
           set payload = payload - ${LOCATION_MEDIA_KEYS}::text[],
               body = 'Konum paylaşıldı'
         where kind = 'location'
           and created_at < now() - make_interval(days => ${r.locationsMedia})
           and payload ?| ${LOCATION_MEDIA_KEYS}::text[]
       returning id`,
  );
  // Satır 2: ses, fotoğraf ve (sistem mesajı olarak kaydedilen) belge/video/çıkartma → medya kimliği ve ham gövde silinir
  await step(
    'retention.media',
    sql`update messages
           set payload = payload - ${LOCATION_MEDIA_KEYS}::text[]
         where (kind in ('image', 'audio') or (kind = 'system' and payload ? 'mediaType'))
           and created_at < now() - make_interval(days => ${r.locationsMedia})
           and payload ?| ${LOCATION_MEDIA_KEYS}::text[]
       returning id`,
  );

  // Satır 1: sipariş notu (serbest metin, sağlık bilgisi içerebilir) final durumdan 30 gün sonra kalıcı olarak boşaltılır
  await step(
    'retention.order_notes',
    sql`update orders
           set note = null
         where note is not null
           and status in ${FINAL_STATUSES}
           and coalesce(delivered_at, rejected_at, cancelled_at, updated_at) < now() - make_interval(days => ${r.orderNotes})
       returning id`,
  );
  await step(
    'retention.order_notes.items',
    sql`update order_items oi
           set note = null
          from orders o
         where o.id = oi.order_id
           and oi.note is not null
           and o.status in ${FINAL_STATUSES}
           and coalesce(o.delivered_at, o.rejected_at, o.cancelled_at, o.updated_at) < now() - make_interval(days => ${r.orderNotes})
       returning oi.id`,
  );

  // Satır 4: WhatsApp mesaj içeriği 6 ay sonra metin ve metin taşıyan yük alanlarıyla silinir; sohbet önizlemesi de
  const textKeys = sql.raw(`array[${WA_MESSAGE_TEXT_KEYS.map((k) => `'${k}'`).join(', ')}]`);
  await step(
    'retention.wa_messages',
    sql`update messages
           set body = ${RETENTION_REDACTED_BODY},
               payload = case when payload is null then null else payload - ${textKeys}::text[] end
         where created_at < now() - make_interval(months => ${m.waMessages})
           and ((body is not null and body <> ${RETENTION_REDACTED_BODY}) or payload ?| ${textKeys}::text[])
       returning id`,
  );
  await step(
    'retention.wa_messages.previews',
    sql`update conversations
           set last_message_preview = null
         where last_message_preview is not null
           and last_message_at < now() - make_interval(months => ${m.waMessages})
       returning id`,
  );

  // Satır 6: hareketsiz müşteri → elle KVKK silmesiyle aynı anonimleştirme (tenant başına bir tutanak satırı)
  let tenantIds: string[] = [];
  let listError: unknown = null;
  try {
    tenantIds = await tenantsWithInactiveCustomers(db, m.customerInactive);
  } catch (err) {
    listError = err;
  }
  if (listError || !tenantIds.length) {
    await record('retention.customer_inactive', null, async () => {
      if (listError) throw listError;
      return 0;
    });
  }
  for (const tenantId of tenantIds) {
    await record('retention.customer_inactive', tenantId, () => eraseInactiveCustomersOfTenant(db, tenantId));
  }

  // Satır 10 benzeri: sipariş onayındaki ve son müşterinin belge kabulündeki IP/tarayıcı 1 yıl sonra boşaltılır; kayıt kalır
  await step(
    'retention.access_logs.orders',
    sql`update orders
           set confirmation_ip = null, confirmation_user_agent = null
         where (confirmation_ip is not null or confirmation_user_agent is not null)
           and created_at < now() - make_interval(months => ${m.confirmationIp})
       returning id`,
  );
  await step(
    'retention.access_logs.legal_acceptances',
    sql`update legal_acceptances
           set ip = null, user_agent = null
         where order_id is not null and user_id is null
           and (ip is not null or user_agent is not null)
           and accepted_at < now() - make_interval(months => ${m.confirmationIp})
       returning id`,
  );

  // Satır 13: panel güvenlik ve denetim kayıtları 2 yıl
  await step('retention.audit', sql`delete from audit_log where created_at < now() - make_interval(months => ${m.auditLog}) returning id`);
  // Satır 15: pazarlama sitesi talepleri son temastan (updated_at) 12 ay sonra
  await step(
    'retention.leads',
    sql`delete from leads where greatest(created_at, updated_at) < now() - make_interval(months => ${m.leads}) returning id`,
  );

  // Koşu özeti (admin sağlık göstergesi: son koşu 48 saatten eskiyse ya da hatalıysa alarm)
  const failed = results.filter((x) => x.error);
  const runFinishedAt = new Date();
  await db.insert(retentionRuns).values({
    jobName: RETENTION_RUN_SUMMARY,
    tenantId: null,
    affectedCount: results.reduce((s, x) => s + x.affected, 0),
    startedAt: runStartedAt,
    finishedAt: runFinishedAt,
    durationMs: Math.max(0, runFinishedAt.getTime() - runStartedAt.getTime()),
    error: failed.length ? `${failed.length} adım başarısız: ${[...new Set(failed.map((x) => x.jobName))].join(', ')}`.slice(0, 500) : null,
  });
  return results;
}

export function registerSystemJobs(): void {
  registerJobHandler('cron.retention', async (_payload, { db, log }) => {
    const results = await runRetention(db, log);
    const counts: Record<string, number> = {};
    for (const x of results) counts[x.jobName] = (counts[x.jobName] ?? 0) + x.affected;
    const failed = [...new Set(results.filter((x) => x.error).map((x) => x.jobName))];
    log.info({ counts, failed }, 'saklama temizliği tamamlandı');
    // Hatalı adım varsa iş yeniden denenir (adımlar idempotent), denemeler biterse admin DLQ'da görünür
    if (failed.length) throw new Error(`Saklama adımları başarısız: ${failed.join(', ')}`);
  });
  registerCron({ name: 'retention', type: 'cron.retention', schedule: { dailyAt: '03:00' } });

  registerJobHandler('cron.sold_out_reset', async (_payload, { db }) => {
    await db.execute(sql`update products set sold_out_until = null where sold_out_until is not null and sold_out_until <= now()`);
  });
  registerCron({ name: 'sold_out_reset', type: 'cron.sold_out_reset', schedule: { everyMinutes: 15 } });
}
