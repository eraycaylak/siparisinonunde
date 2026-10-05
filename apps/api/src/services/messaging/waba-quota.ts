// Ortak numaranın 24 saatlik WABA kotası (denetim 2026-10-04 · açık soru 2 · iş 4.10).
//
// Sorun: kodda yalnız SANİYE başına kota vardı (`wa/throttle.ts` NUMBER_RATE_PER_SEC = 20). Meta'nın ikinci ve
// pilotta çok daha yakın olan sınırı 24 SAATLİK iş-kaynaklı konuşma tavanıdır (yeni portföy 250 tekil kullanıcı,
// docs/02 §7.6 ve §9.4). Ortak numarada tavan PORTFÖY düzeyindedir: TÜM kiracılar tek WABA kotasını paylaşır, yani
// tavan platform genelinde tükenince HİÇBİR dükkanın durum mesajı gitmez — ve bunu gören bir ölçü, uyarı ya da
// kiracı payı yoktu.
//
// Ölçü YENİ TABLO AÇMADAN `messages` + `notifications` kayıtlarından türetilir; hangi kaynağın neden sayıldığı
// (ve `shared_wa_messages`'ın neden sayılmadığı) docs/02 §7.6a tablosundadır, burada tekrar edilmez.
//
// Tekillik: Meta tavanı ALICI başına sayar, dükkan başına değil. Kimlik `coalesce(phone_e164, bsuid)` ile
// tekilleştirilir (ortak numarada BSUID tüm dükkanlarda aynıdır: tek portföy). Sonuç: kiracı paylarının TOPLAMI
// toplam sayıdan büyük olabilir — aynı kişi iki dükkanla konuşursa Meta bir konuşma sayar, pay tablosunda iki satır
// görünür. Tavan karşılaştırması her zaman `total` ile yapılır.
//
// BİLİNEN SINIR (belgelenmiştir, gizlenmemiştir): türetilen sayaç yalnız GÖNDERİLEBİLMİŞ mesajları görür. Tavan
// dolduğunda sağlayıcı gönderimi reddeder, satır 'failed' olur ve sayaç TAM TAVANDA düşük okur. Bu yüzden ölçü
// ÖNCÜ göstergedir (%70 / %90 uyarıları) ve tavanın gerçeği sağlayıcı hatasıdır: Meta 131048 (`isMessagingLimitCode`,
// `wa/errors.ts`) görüldüğünde ACİL uyarı gider.

import { WA_PLATFORM_PROVIDERS, type OrderStatus } from '@siparis/core';
import { type Database } from '@siparis/db';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { alert, type AlertContext } from '../../lib/alert';
import { WINDOW_MS } from './customers';
import type { OutboundPayload } from './outbound';

/** Kayan pencere: Meta'nın iş-kaynaklı konuşma tavanı 24 saatliktir (docs/02 §9.4). */
export const WABA_QUOTA_WINDOW_MS = WINDOW_MS;

/**
 * Yeni portföyün iş-kaynaklı konuşma tavanı (docs/02 §9.4: 250 → 2.000 → 10.000 → 100.000 → sınırsız).
 * Varsayılan EN KÖTÜ durumdur: numara yeni açıldığında gerçek tavan budur. Basamak yükselince `WABA_CONVERSATION_CAP`
 * ile geçilir; sağlayıcı basamağı okunabiliyorsa (Twilio `properties.messaging_limit`) o değer önceliklidir.
 */
export const WABA_CONVERSATION_CAP_DEFAULT = 250;

/** Uyarı eşikleri (tavanın oranı). */
export const WABA_QUOTA_WARN_RATIO = 0.7;
export const WABA_QUOTA_CRITICAL_RATIO = 0.9;

/** Aynı kota uyarısının yinelenme aralığı (alert varsayılanı 10 dk; kota için gereksiz sık). */
export const WABA_QUOTA_ALERT_COOLDOWN_MS = 60 * 60_000;
/** Tavan DOLDUĞUNDA soğuma kısadır: bu acil durumun nöbetçiye ulaşması gecikmemeli. */
export const WABA_QUOTA_EXHAUSTED_COOLDOWN_MS = 15 * 60_000;

/** Kalite derecesi okuması bu aralıkla yapılır (ölçüm cron'u 5 dk'da bir koşar; sağlayıcıya her turda gidilmez). */
export const WABA_QUALITY_READ_INTERVAL_MS = 60 * 60_000;

/** Ölçüm bu süreden eskiyse gönderim kapısı KULLANILMAZ (fail-open: mesaj akmaya devam eder). */
export const WABA_GAUGE_TTL_MS = 15 * 60_000;

/** Kritik durum mesajları: sipariş onayı / ret / iptal. `order-notify.ts` SMS yedeği de aynı kümeyi kullanır. */
export const CRITICAL_ORDER_EVENTS: ReadonlySet<OrderStatus> = new Set(['accepted', 'rejected', 'cancelled']);

/** Kiracı payı satırı (uyarı bağlamı; kişisel veri YOK — işletme adı ve sayı). */
export interface WabaQuotaTenantShare {
  tenantId: string;
  name: string;
  conversations: number;
}

export type WabaQuotaLevel = 'ok' | 'warn' | 'critical' | 'exhausted';

export interface WabaQuotaUsage {
  /** Son 24 saatte açılmış TEKİL iş-kaynaklı konuşma sayısı (platform geneli). */
  total: number;
  cap: number;
  /** total / cap (cap 0 ise 0). */
  ratio: number;
  level: WabaQuotaLevel;
  /** Tavana kalan (negatif olmaz). */
  remaining: number;
  /** En çok konuşma açan işletmeler (en çok 5); payların toplamı `total`'dan büyük olabilir (bkz. dosya başı). */
  tenants: WabaQuotaTenantShare[];
  measuredAt: Date;
}

export interface WabaQuotaDeps {
  db: Database;
  config: WabaQuotaConfig;
  log: FastifyBaseLogger;
}

/**
 * Kota yapılandırması. `lib/alert.ts` ile aynı yaklaşım: alanlar `apps/api/src/config.ts`'e eklenene kadar
 * (bkz. raporda DIŞ BAĞIMLILIK) ortamdan okunur; eklendiğinde `Config` aynı adları taşıdığı için burada
 * değişiklik gerekmez (`Config` yapısal olarak bu arayüze atanabilir).
 */
export interface WabaQuotaConfig {
  PLATFORM_WA_PROVIDER?: string | undefined;
  /** Meta/BSP'den bilinen güncel basamak (tekil kullanıcı / 24 saat). Verilmezse 250. */
  WABA_CONVERSATION_CAP?: string | undefined;
  /** '1' | 'true' → tavana yaklaşıldığında ÖNEMSİZ durum mesajları düşürülür. Varsayılan KAPALI. */
  WABA_SHED_NONCRITICAL?: string | undefined;
  ALERT_WEBHOOK_URL?: string | undefined;
  ALERT_MIN_SEVERITY?: string | undefined;
  NODE_ENV?: string | undefined;
  DEPLOY_ENV?: string | undefined;
}

function truthy(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Tavan ve kapı ayarını çözer. Geçersiz tavan (0, negatif, sayı değil) yok sayılır: yanlış yapılandırma kotayı
 * sınırsız göstermesin.
 */
export function resolveQuotaConfig(
  config?: WabaQuotaConfig,
  env: Record<string, string | undefined> = process.env,
): { cap: number; shedEnabled: boolean } {
  const raw = (config?.WABA_CONVERSATION_CAP ?? env.WABA_CONVERSATION_CAP ?? '').trim();
  const parsed = Number.parseInt(raw, 10);
  const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : WABA_CONVERSATION_CAP_DEFAULT;
  return { cap, shedEnabled: truthy(config?.WABA_SHED_NONCRITICAL ?? env.WABA_SHED_NONCRITICAL) };
}

/**
 * Sağlayıcının bildirdiği basamak metnini sayıya çevirir ("TIER_1K" → 1000, "250" → 250, "10k" → 10000).
 * Tanınmayan metin null döner (uydurma yapılmaz; Cloud'da `throughput.level` STANDARD/HIGH gelir ve basamak DEĞİLDİR).
 */
export function parseMessagingLimit(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim().toUpperCase().replace(/^TIER[_-]?/, '');
  if (!s) return null;
  const m = /^(\d+(?:[.,]\d+)?)\s*([KM])?$/.exec(s);
  if (!m) return null;
  const n = Number.parseFloat(m[1]!.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = m[2] === 'K' ? 1_000 : m[2] === 'M' ? 1_000_000 : 1;
  return Math.round(n * mult);
}

export function quotaLevel(total: number, cap: number): WabaQuotaLevel {
  if (cap <= 0) return 'ok';
  if (total >= cap) return 'exhausted';
  const r = total / cap;
  if (r >= WABA_QUOTA_CRITICAL_RATIO) return 'critical';
  if (r >= WABA_QUOTA_WARN_RATIO) return 'warn';
  return 'ok';
}

/**
 * Kritik mesajlara ayrılan son dilim: tavanın %10'u (en az 10 konuşma). Bu dilime girildiğinde ÖNEMSİZ durum
 * mesajları yeni konuşma açmaz; kalan yer sipariş onayı / ret / iptal için saklanır.
 */
export function criticalReserve(cap: number): number {
  return Math.max(10, Math.round(cap * 0.1));
}

type QuotaRow = {
  total: number | string | null;
  tenant_id: string | null;
  name: string | null;
  n: number | string | null;
} & Record<string, unknown>;

/**
 * Platform geneli 24 saatlik iş-kaynaklı konuşma sayısını ÖLÇER (uyarı göndermez, sağlayıcıya gitmez).
 * Sağlayıcıdan bağımsızdır: simülatör kapısı `detectWabaQuotaPressure` içindedir (ölçüm testlerde doğrudan çağrılır).
 */
export async function measureWabaQuota(db: Database, opts: { now?: Date; cap?: number; windowMs?: number } = {}): Promise<WabaQuotaUsage> {
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? WABA_CONVERSATION_CAP_DEFAULT;
  const windowMs = opts.windowMs ?? WABA_QUOTA_WINDOW_MS;
  const nowIso = now.toISOString();
  const sinceIso = new Date(now.getTime() - windowMs).toISOString();
  // Pencere `interval` olarak metinden çözülür: `sayı * interval` operatör çözümlemesi sürücünün bağladığı
  // parametre tipine göre değişebilir, `'86400 seconds'::interval` her sürümde tek anlamlıdır.
  const windowInterval = `${Math.round(windowMs / 1000)} seconds`;

  const rows = (await db.execute<QuotaRow>(sql`
    with bi as (
      -- (1) Dükkan sohbetleri: ortak numaradan giden ve gönderilmiş mesajlar; iş-kaynaklı olanlar
      select m.tenant_id as tenant_id,
             coalesce(c.phone_e164, 'bsuid:' || c.wa_bsuid) as who
        from messages m
        join conversations cv on cv.id = m.conversation_id
        join wa_accounts a on a.id = cv.wa_account_id
        join customers c on c.id = cv.customer_id
       where m.direction = 'out'
         and m.status in ('sent', 'delivered', 'read')
         and m.created_at >= ${sinceIso}::timestamptz
         and m.created_at <= ${nowIso}::timestamptz
         and a.provider = 'shared'
         and coalesce(c.phone_e164, c.wa_bsuid) is not null
         -- Meta'nın tanımı: mesajdan önceki 24 saatte GELEN mesaj yoksa bu mesaj yeni konuşma açar.
         -- messages_conversation_created_idx (conversation_id, created_at) bu alt sorgu için yeterlidir.
         and not exists (
               select 1
                 from messages i
                where i.conversation_id = m.conversation_id
                  and i.direction = 'in'
                  and i.created_at <= m.created_at
                  and i.created_at > m.created_at - ${windowInterval}::interval)
      union all
      -- (2) İşletme sahibine giden platform uyarıları: AYNI numara, her biri iş-kaynaklı konuşma
      select n.tenant_id as tenant_id,
             'user:' || n.recipient_user_id as who
        from notifications n
       where n.channel = 'platform_wa'
         and n.status = 'sent'
         and n.recipient_user_id is not null
         and coalesce(n.sent_at, n.created_at) >= ${sinceIso}::timestamptz
         and coalesce(n.sent_at, n.created_at) <= ${nowIso}::timestamptz
    ),
    per as (select tenant_id, count(distinct who)::int as n from bi group by tenant_id),
    tot as (select count(distinct who)::int as n from bi)
    select (select n from tot) as total, p.tenant_id, t.name, p.n
      from per p
      join tenants t on t.id = p.tenant_id
     order by p.n desc, t.name asc
     limit 5`)) as unknown as QuotaRow[];

  const total = Number(rows[0]?.total ?? 0) || 0;
  const tenants: WabaQuotaTenantShare[] = rows
    .filter((r) => r.tenant_id)
    .map((r) => ({ tenantId: r.tenant_id!, name: r.name ?? '(adsız)', conversations: Number(r.n ?? 0) || 0 }));
  return {
    total,
    cap,
    ratio: cap > 0 ? total / cap : 0,
    level: quotaLevel(total, cap),
    remaining: Math.max(0, cap - total),
    tenants,
    measuredAt: now,
  };
}

// ---------------------------------------------------------------------------
// Süreç içi gösterge (gönderim kapısı her mesajda veritabanına gitmesin)

export interface WabaQuotaGauge {
  total: number;
  cap: number;
  level: WabaQuotaLevel;
  measuredAt: Date;
}

/**
 * Son ölçüm. Süreç belleğindedir ve bu BİLİNÇLİDİR: tek container tek worker (00 §12a madde 10) ve göstergenin
 * kaybı yalnız "kapı kapalı kalır, mesaj akar" demektir (fail-open).
 */
let gauge: WabaQuotaGauge | null = null;

export function setQuotaGauge(usage: Pick<WabaQuotaUsage, 'total' | 'cap' | 'level' | 'measuredAt'>): void {
  gauge = { total: usage.total, cap: usage.cap, level: usage.level, measuredAt: usage.measuredAt };
}

export function getQuotaGauge(): WabaQuotaGauge | null {
  return gauge;
}

/** Testler ve uzun süreli süreçler için göstergeyi boşaltır. */
export function resetQuotaGauge(): void {
  gauge = null;
}

// ---------------------------------------------------------------------------
// Gönderim kapısı (madde 4): tavana yaklaşıldığında kritik mesajlara yer saklanır

export interface ShedDecisionInput {
  gauge: WabaQuotaGauge | null;
  now: Date;
  /** Gönderim ortak numaradan mı yapılıyor (kota yalnız orada paylaşılır). */
  shared: boolean;
  /** Bu mesaj YENİ bir iş-kaynaklı konuşma açar mı (24 saat penceresi kapalı). */
  opensConversation: boolean;
  /** Kritik mesaj mı (sipariş onayı / ret / iptal). */
  critical: boolean;
  /** `WABA_SHED_NONCRITICAL` açık mı. */
  shedEnabled: boolean;
  /** Göstergenin tazelik sınırı. */
  ttlMs?: number;
}

/**
 * Önemsiz durum mesajı DÜŞÜRÜLSÜN mü? Yeni paralel bir öncelik sistemi kurulmaz: karar var olan mesaj bütçesi
 * işaretlerinden (`OutboundPayload.statusMessage`, `orderEvent`) ve `CRITICAL_ORDER_EVENTS` kümesinden okunur.
 *
 * Her koşul fail-open'dır — şüphede mesaj GİDER:
 *  - ayar kapalıysa (varsayılan), ortak numara değilse, pencere açıksa (mesaj zaten tavana sayılmaz),
 *    mesaj kritikse ya da ölçüm bayatsa → düşürme YOK.
 *  - yalnız tavanın son diliminde (`criticalReserve`) ve yalnız önemsiz mesajda düşürme olur.
 *
 * Bu karar SAF olduğu için son kapı burada değildir: alıcının son 24 saatte zaten sayılıp sayılmadığı
 * `recipientAlreadyBilled` ile sorulur (bedava mesaj düşürülmez) — çağrı sırası `send.ts` içindedir.
 */
export function shouldShedNonCritical(i: ShedDecisionInput): boolean {
  if (!i.shedEnabled || !i.shared || !i.opensConversation || i.critical) return false;
  const g = i.gauge;
  if (!g || g.cap <= 0) return false;
  const ttl = i.ttlMs ?? WABA_GAUGE_TTL_MS;
  if (i.now.getTime() - g.measuredAt.getTime() > ttl) return false;
  return g.total >= g.cap - criticalReserve(g.cap);
}

/**
 * Bu alıcıya son 24 saatte ZATEN gönderilebilmiş bir mesaj var mı?
 *
 * Tavan TEKİL ALICI sayar (docs/02 §7.6 "pencere dışı tekil kullanıcı"; ölçüde `count(distinct who)`): aynı kişiye
 * ikinci kez yazmak tavana BİR ŞEY EKLEMEZ. Bu yüzden zaten yazdığımız bir kişiye giden önemsiz durum mesajını
 * düşürmek kotadan hiçbir yer kazandırmaz, yalnız müşteriyi sessiz bırakır: sipariş onayı (kritik, her koşulda
 * gider) alıcıyı tavanda zaten saydırdığı için ardından gelen hazırlanıyor/hazır/yolda/teslim mesajları
 * BEDAVADIR. Kapı bu yüzden ölçüyle aynı mantığı kullanır.
 *
 * Kapsam bilerek SOHBETTİR: `messages_conversation_created_idx` (conversation_id, created_at) ile tek atlamada
 * çözülür ve kapı gönderim yolundadır. Kalan dar boşluk: aynı telefon BAŞKA bir dükkanın sohbetinde sayılmışsa
 * burada görülmez ve mesaj gereksiz düşürülebilir — sapma yalnız o çapraz-dükkan durumunda kalır, siparişin
 * kendi akışında kalmaz.
 *
 * 'failed' / 'queued' satırlar sayılmaz: gönderilemeyen mesaj tavandan yer tüketmemiştir (ölçüyle aynı süzgeç).
 */
export async function recipientAlreadyBilled(
  db: Database,
  conversationId: string,
  now: Date,
  windowMs: number = WABA_QUOTA_WINDOW_MS,
): Promise<boolean> {
  const sinceIso = new Date(now.getTime() - windowMs).toISOString();
  const rows = (await db.execute<{ one: number }>(sql`
    select 1 as one
      from messages
     where conversation_id = ${conversationId}
       and direction = 'out'
       and status in ('sent', 'delivered', 'read')
       and created_at >= ${sinceIso}::timestamptz
     limit 1`)) as unknown as { one: number }[];
  return rows.length > 0;
}

/** Giden mesaj kritik mi (bütçe altyapısının işaretlerinden). */
export function isCriticalOutbound(p: Pick<OutboundPayload, 'orderEvent' | 'statusMessage'> | null | undefined): boolean {
  // Durum mesajı DEĞİLSE (karşılama, bot yanıtı, personelin yazdığı mesaj) hiçbir koşulda düşürülmez
  if (!p?.statusMessage) return true;
  const ev = p.orderEvent;
  return !!ev && CRITICAL_ORDER_EVENTS.has(ev as OrderStatus);
}

// ---------------------------------------------------------------------------
// Uyarılar

/** Kota baskısı uyarısı (madde 2 + 3): eşiğe yaklaşma, tavan dolması ve kiracı payı. */
export function alertWabaQuota(ctx: AlertContext, u: WabaQuotaUsage): boolean {
  if (u.level === 'ok') return false;
  const pct = Math.round(u.ratio * 100);
  const top = u.tenants[0];
  // Tek işletme tavanın yarısından çoğunu tüketiyorsa uyarıda ADIYLA görünür (madde 3)
  const hog = top && u.total > 0 && top.conversations * 2 >= u.total ? top : null;
  const share = hog ? ` En çok ${hog.name}: ${hog.conversations} konuşma.` : '';
  const message =
    u.level === 'exhausted'
      ? `ACİL — ortak WhatsApp numarasının 24 saatlik konuşma tavanı DOLDU (${u.total}/${u.cap}). Yeni müşteriye hiçbir dükkanın durum mesajı gitmiyor.${share}`
      : `Ortak WhatsApp numarasının 24 saatlik konuşma kotası %${pct} (${u.total}/${u.cap}); tavana ${u.remaining} konuşma kaldı.${share}`;
  alert(ctx, {
    kind: 'waba_conversation_quota',
    severity: u.level === 'warn' ? 'warning' : 'critical',
    message,
    data: {
      total: u.total,
      cap: u.cap,
      percent: pct,
      remaining: u.remaining,
      level: u.level,
      // İşletme adı kişisel veri değildir (ticari ad); müşteri telefonu/adı uyarıya HİÇ girmez
      tenants: u.tenants.map((t) => `${t.name}=${t.conversations}`),
    },
    dedupeKey: `waba_conversation_quota:${u.level}`,
    cooldownMs: u.level === 'exhausted' ? WABA_QUOTA_EXHAUSTED_COOLDOWN_MS : WABA_QUOTA_ALERT_COOLDOWN_MS,
  });
  return true;
}

/**
 * Sağlayıcı "mesaj sınırı" hatası verdi (Meta 131048; Twilio'nun günlük sınırı da buna çevrilir, `wa/errors.ts`).
 * Türetilen sayaç tam tavanda düşük okuduğu için bu hata tavanın GERÇEĞİDİR → her zaman kritik.
 */
export function alertWabaMessagingLimit(ctx: AlertContext, input: { code: string; shared: boolean; provider?: string | undefined }): void {
  alert(ctx, {
    kind: 'waba_messaging_limit',
    severity: 'critical',
    message: input.shared
      ? `ACİL — ortak WhatsApp numarası mesaj sınırına takıldı (${input.code}). Tüm dükkanların yeni müşteriye giden mesajları durdu; Meta'da messaging limit ve kalite derecesine bakın.`
      : `İşletme WhatsApp numarası mesaj sınırına takıldı (${input.code}): o işletmenin mesajları durdu.`,
    data: { code: input.code, shared: input.shared, provider: input.provider ?? null },
    dedupeKey: `waba_messaging_limit:${input.shared ? 'shared' : 'tenant'}`,
    cooldownMs: WABA_QUOTA_EXHAUSTED_COOLDOWN_MS,
  });
}

// ---------------------------------------------------------------------------
// Kalite derecesi (madde 5)

/** Kalite derecesi okuması. `readable: false` → sağlayıcıda okunamadı (uydurulmaz). */
export interface WabaQualityReading {
  readable: boolean;
  qualityRating: string | null;
  /** Sağlayıcının bildirdiği ham basamak metni (Twilio `properties.messaging_limit`). */
  messagingLimitRaw: string | null;
  /** Metinden çözülen sayısal basamak; çözülemezse null. */
  messagingLimitCap: number | null;
  /** Sağlayıcı bağlantısı "hazır" mı (numara onayı dahil, `testConnection` ready). */
  ready: boolean;
  reason?: string;
}

/** Düşük kalite dereceleri (docs/02 §9.4: YELLOW uyarı, RED kampanya kilidi). */
const LOW_QUALITY = new Set(['YELLOW', 'RED', 'FLAGGED', 'RESTRICTED']);

/**
 * Sağlayıcıdan okunan kalite derecesini değerlendirir ve gerekiyorsa uyarı gönderir. Okuma `testConnection`
 * ile yapılır (çağıran verir): üç sağlayıcıda da aynı alanı döndüren TEK yol odur —
 *   - cloud: Graph `quality_rating` (+ `throughput.level`, bu BASAMAK DEĞİLDİR)
 *   - twilio: Senders `properties.quality_rating` + `properties.messaging_limit` → basamak OKUNUR
 *   - d360: `health_status` / `quality_rating`
 * Basamak yalnız Twilio'da okunabilir:
 *   - cloud: `messaging_limit_tier` alanı `PHONE_FIELDS` içinde değil (wa-setup.ts), istenmiyor;
 *   - d360: alan İSTENİYOR (`wa-setup-d360.ts` `messaging_limit_tier`) ama yalnız ekran etiketine gidiyor,
 *     `phone.throughputLevel` null bırakılıyor → buraya ulaşmıyor.
 * İkisinde de `messagingLimitCap` null kalır, yapılandırılan tavan (`WABA_CONVERSATION_CAP`) kullanılır ve
 * uydurma değer üretilmez. DIŞ BAĞIMLILIK: alanı `phone`a taşımak `services/admin/wa-setup*.ts`'in işidir.
 */
export function evaluateWabaQuality(ctx: AlertContext, r: WabaQualityReading, provider?: string): boolean {
  if (!r.readable) {
    ctx.log.info({ provider: provider ?? null, reason: r.reason ?? null }, 'WABA kalite derecesi okunamadı');
    return false;
  }
  const q = (r.qualityRating ?? '').toUpperCase();
  if (!LOW_QUALITY.has(q)) return false;
  alert(ctx, {
    kind: 'waba_quality_rating',
    severity: q === 'RED' ? 'critical' : 'warning',
    message:
      q === 'RED'
        ? `ACİL — ortak WhatsApp numarasının kalite derecesi KIRMIZI. Meta mesaj sınırını düşürebilir ya da numarayı kısıtlayabilir; müşteri şikâyetlerini ve engellemeleri inceleyin.`
        : `Ortak WhatsApp numarasının kalite derecesi düştü (${q}). İzinsiz/gereksiz mesaj gönderimini durdurun.`,
    data: { quality: q, provider: provider ?? null, messagingLimit: r.messagingLimitRaw, ready: r.ready },
    dedupeKey: `waba_quality_rating:${q}`,
    cooldownMs: WABA_QUOTA_ALERT_COOLDOWN_MS,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Cron girişi

export type WabaQuotaReason =
  /** Ortak numara kapalı (simülatör): ölçüm anlamsız. */
  | 'provider_mock'
  /** Ölçüldü (uyarı eşiğine göre `usage.level`). */
  | 'measured';

export interface WabaQuotaWatchResult {
  reason: WabaQuotaReason;
  usage: WabaQuotaUsage | null;
  /** Kota uyarısı ÜRETİLDİ mi (kanal kararı `alert()` içindedir). */
  alerted: boolean;
  /** Bu turda kalite okuması yapıldı mı. */
  qualityRead: boolean;
  quality: WabaQualityReading | null;
}

/** Son kalite okuması (süreç belleği; cron her turda sağlayıcıya gitmesin). */
let lastQualityAt = 0;
/**
 * Sağlayıcının en son bildirdiği basamak. Okuma saatte bir yapıldığı için SAKLANIR: saklanmasaydı tavan turlar
 * arasında sağlayıcı değeriyle yapılandırma değeri arasında salınır ve basamak yükseltilmiş bir numarada 12 turdan
 * 11'i yanlış (düşük) tavanla sahte uyarı üretirdi.
 */
let lastProviderCap: number | null = null;

export function resetQualityReadClock(): void {
  lastQualityAt = 0;
  lastProviderCap = null;
}

function isRealProvider(p: string | undefined): boolean {
  return !!p && p !== 'mock' && (WA_PLATFORM_PROVIDERS as readonly string[]).includes(p);
}

/**
 * Kota gözcüsü (`cron.waba_quota_watch`): ölçer, göstergeyi günceller, eşik uyarısı gönderir ve saatte bir
 * sağlayıcıdan kalite derecesini okur. Veritabanı hatası yukarı çıkar (cron işi yeniden denenir, DLQ gözcüsü görür);
 * kalite okuması hata verirse YUTULUR — ölçüm ve uyarı sağlayıcıya erişime bağlı değildir.
 */
export async function detectWabaQuotaPressure(
  deps: WabaQuotaDeps,
  opts: {
    now?: Date;
    /** Kalite okuyucusu (cron verir: `services/admin/wa-setup` testConnection). Verilmezse okuma yapılmaz. */
    readQuality?: () => Promise<WabaQualityReading>;
    /** Kalite okuma aralığını testte kısaltmak için. */
    qualityIntervalMs?: number;
  } = {},
): Promise<WabaQuotaWatchResult> {
  const { db, config, log } = deps;
  const now = opts.now ?? new Date();
  const base: WabaQuotaWatchResult = { reason: 'provider_mock', usage: null, alerted: false, qualityRead: false, quality: null };
  // Simülatörde ortak numara yoktur: gerçek bir WABA kotası da yoktur (shared-health ile aynı kapı)
  if (!isRealProvider(config.PLATFORM_WA_PROVIDER)) return base;

  const { cap: configuredCap } = resolveQuotaConfig(config);

  // Kalite okuması (madde 5): saatte bir, hata yutulur
  let quality: WabaQualityReading | null = null;
  const interval = opts.qualityIntervalMs ?? WABA_QUALITY_READ_INTERVAL_MS;
  const qualityRead = !!opts.readQuality && now.getTime() - lastQualityAt >= interval;
  if (qualityRead) {
    lastQualityAt = now.getTime();
    try {
      quality = await opts.readQuality!();
    } catch (err) {
      quality = { readable: false, qualityRating: null, messagingLimitRaw: null, messagingLimitCap: null, ready: false, reason: 'provider_error' };
      log.warn({ err, provider: config.PLATFORM_WA_PROVIDER }, 'WABA kalite derecesi okunamadı');
    }
    evaluateWabaQuality({ log, config }, quality, config.PLATFORM_WA_PROVIDER);
    // Okunamadıysa (hata ya da alan yok) ÖNCEKİ bilinen basamak korunur: tek başarısız okuma tavanı düşürmesin
    if (quality.messagingLimitCap != null) lastProviderCap = quality.messagingLimitCap;
  }

  // Sağlayıcı basamağı okunabildiyse O geçerlidir: yapılandırma eskimiş olabilir, sağlayıcı gerçeği söyler
  const cap = lastProviderCap ?? configuredCap;
  const usage = await measureWabaQuota(db, { now, cap });
  setQuotaGauge(usage);
  if (usage.level !== 'ok') {
    log.error(
      { total: usage.total, cap: usage.cap, level: usage.level, tenants: usage.tenants.map((t) => `${t.name}=${t.conversations}`) },
      'ortak numara 24 saatlik konuşma kotası eşiğe yaklaştı',
    );
  }
  const alerted = alertWabaQuota({ log, config }, usage);
  return { reason: 'measured', usage, alerted, qualityRead, quality };
}
