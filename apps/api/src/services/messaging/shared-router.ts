// Ortak numara yönlendiricisi (00 §12a madde 8, geçiş: madde 11; 14 §8.1). Ortak numaradaki işletmeler platformun
// tek numarasını kullanır; gelen her mesaj için hangi dükkana gideceğine burada karar verilir, sonra o dükkanın kendi
// konuşma motoru (engine.ts handleInboundMessage, dükkanın 'shared' wa_accounts satırı) aynen çalışır — tenant
// yalıtımı korunur.
//
// DİZİN YOK (00 §12a madde 11, O2 — 20.10.2026): Yemek Gelsin yalnız yazılım satar; ortak numaradaki dükkan listesi,
// son dükkanlar düğmeleri, "dükkanlar / liste / değiştir" komutları ve dükkan adı eşleşmesi KALDIRILDI. Platform
// mesajı müşteriye başka bir dükkanın adını ya da dükkan sayısını hiçbir zaman göstermez. Müşteri bir dükkana yalnız
// o dükkanın kendi QR'ı / bağlantısı (#KOD), Akış B kodu, sipariş butonu, alıntı ya da son 24 saatteki sohbeti ile
// ulaşır.
//
// Karar sırası (tek mesaj):
//   -) request_welcome (sohbet ilk kez açıldı) → sessiz: QR'ın ön-dolu #KOD mesajı hemen ardından dükkanı seçer
//   0) "DUR"/"BAŞLAT" → yanıtlanan (alıntılanan) dükkan mesajının dükkanı; alıntı yoksa kişiye en son yazan dükkan;
//      o da yoksa güncel dükkan; hiçbiri yoksa dükkansız bilgi (P08). Güncel dükkan değişmez.
//   1) buton yanıtı: shop:<id> (güncel dükkana devam düğmesi, P07) → yalnız kişinin KENDİ son dükkanlarından biriyse
//      o dükkan (eski bir liste mesajındaki başka dükkan satırı dizin olarak kullanılamaz); sipariş kimlikli butonlar
//      (review:/wait:/cancel:/keep:/order:) ya da yanıtlanan mesaj (context) → o dükkan. Eski liste düğmeleri
//      (shops:list, shops:page:*, shops:m:*) artık hiçbir şey listelemez.
//   2) Akış B sipariş kodu → kodun işletmesi (bekleyen kodlar tüm işletmelerde tekil)
//   3) yalnız açık "#KOD" → dükkan seçilir (kendi numaralı / kapalı dükkana kibar bilgi). '#'siz yalın sözcük kod
//      sayılmaz (ad araması olurdu: kodlar slug'ın ilk sözcüğüdür, "döner" → DONER). Kod zaten etkin güncel dükkanınsa
//      seçim sayılmaz (olağan sıra ve soğumalar geçerli: takip sayfasının "#KOD"lu mesajındaki "yetkili", iptal ve SSS
//      işlenir). "#1047" gibi harfsiz belirteç sipariş numarasıdır.
//   4) alıntılanan (yanıtlanan) dükkan mesajı → o dükkan
//   5) son 24 saatte konuşulan (güncel) dükkan → devam
//   6) listesiz NÖTR yanıt (P09: "Sipariş vermek için işletmenin QR kodunu okutun…"); 60 sn içinde yinelenmez ama müşteri
//      SESSİZ BIRAKILMAZ: tek satırlık hatırlatma gider (P06, 60 sn'de en çok 1)
// Platform mesajları hiçbir dükkanın sohbetine girmez (shared_wa_messages, platform düzeyi; 30 gün).
// Tekrar teslim (aynı wamid) ilk kararı hangi tarafa verildiyse (dükkan sohbeti ya da platform kaydı) orada yakalanır.
//
// MÜŞTERİ YANITSIZ KALMAZ (14 §8.1, 02 §6.2a; Eray'ın canlı geri bildirimi 06.10.2026 "illa #KOD yazmamızı bekliyor"):
// müşterinin GERÇEK mesajı hiçbir kuralda tam sessizlikle karşılanmaz. Bilerek sessiz kalınan tek yerler kendi
// trafiğimiz ve döngü koruması: giden mesajın echo'su, durum geri bildirimi (status), tekrar teslim (aynı wamid),
// anahtarsız gönderici ve `request_welcome` (QR'ın ön-dolu #KOD mesajı hemen ardından gelir ve dükkanı seçer).
// Dükkan motoru (engine.ts) yanıt üretmediğinde yönlendirici bunu ÖĞRENİR (`ensureShopReplied`: giden mesaj sayılır)
// ve yedek bir yol gösterme yazar (P07). Spam koruması soğumalarla kurulur, sessizlikle değil.

import {
  SHARED_BUTTON_IDS,
  SHARED_PLATFORM_TEXTS,
  extractHashCodes,
  formatPhone,
  sharedContinueText,
  sharedOwnNumberText,
  sharedUnavailableText,
  toWaMeDigits,
  type MessageStatus,
} from '@siparis/core';
import {
  conversations,
  customers,
  messages,
  orders,
  sharedWaMessages,
  sharedWaRoutes,
  tenants,
  waAccounts,
  waWebhookEvents,
  type Database,
  type SharedWaMessagePayload,
} from '@siparis/db';
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { enqueueJob } from '../../lib/jobs';
import { clip, LIMITS } from '../../wa/cloud-body';
import { isMessagingLimitCode, isWaSendError, WaSendError, waErrorSummary } from '../../wa/errors';
import { getWaProvider, platformAccountRef, type WaAccountRow } from '../../wa/registry';
import { acquireNumberSlot } from '../../wa/throttle';
import type { NormalizedWaEvent, WaRecipient, WaSender } from '../../wa/types';
import { tenantUnavailable } from './context';
import { humanModeActive } from './customers';
import { applyStatus, handleInboundMessage, inboundRecord, type EngineDeps, type InboundResult, type ProcessEventsSummary } from './engine';
import { specBody, specKind, type OutboundSpec } from './outbound';
import type { SendContext, SendOutcome } from './send';
import { recipientOf, sendSpec, specRequestBody } from './send';
import { alertSharedAccountError } from './shared-health';
import { selectableSharedShops, sharedAccountOf, tenantByWaCode, tenantSelectableReason, tenantWaAccount } from './shared';
import { isOptIn, isOptOut, matchOrderCode } from './text';
import { alertWabaMessagingLimit } from './waba-quota';

/** Güncel dükkanla kodsuz devam süresi (son yönlendirmeden). */
export const SHARED_ROUTE_ACTIVE_MS = 24 * 60 * 60_000;
/** Kendiliğinden (kodsuz, dükkansız mesaja) gönderilen nötr yanıtın (P09) aynı kişiye en sık aralığı. */
export const SHARED_NEUTRAL_COOLDOWN_MS = 60_000;
/**
 * Nötr yanıt penceresi içindeki kısa hatırlatma (P06) ve dükkansız "DUR"/"BAŞLAT" bilgisi (P08) en sık aralığı.
 * ÜST SINIR: nötr yanıt + hatırlatma ile aynı kişiye dakikada en çok 2 platform mesajı gider (saniyede 10 mesaj yazan
 * birine 10 yanıt yazmak hem maliyet hem Meta kalite derecesi kaybıdır). Sessizlik değil, SADELEŞTİRME uygulanır.
 */
export const SHARED_HINT_COOLDOWN_MS = 60_000;
/**
 * Yedek yol gösterme (P07) penceresi: dükkan bu süre içinde müşteriye bir şey yazdıysa müşteri "yanıtsız" sayılmaz ve
 * platform araya GİRMEZ; aynı yol gösterme de bu sıklıktan daha sık gönderilmez (üst sınır: saatte 1 platform mesajı).
 * Neden 1 saat: motorun kendi sınırları (mesaj patlaması 2 dk, yardım yanıtı saatte 4 — `engine.ts`) bu pencerenin
 * ALTINDA kalır, yani platform motorun "şimdilik yeter" kararını hiçbir zaman çürütmez (02 §6.2 sessizlik yasağı).
 * Platform yalnız dükkan sohbeti SAATLERDİR hiç yanıt üretmediğinde (motor sürümü eski ya da bir yol gözden kaçmış)
 * devreye girer.
 */
export const SHARED_FALLBACK_QUIET_MS = 60 * 60_000;
/** Kişinin son dükkanları (yalnız kendi geçmişi: "DUR" hedefi ve güncel dükkana devam düğmesi; listelenmez). */
export const SHARED_RECENT_MAX = 5;
/** Akış B kodu aramasında geriye bakış (gün). */
const ORDER_CODE_LOOKBACK_DAYS = 7;

type InboundEvent = Extract<NormalizedWaEvent, { type: 'message' }>;
export type SharedRouteRow = typeof sharedWaRoutes.$inferSelect;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_SHOP = new RegExp(`^shop:(${UUID})$`, 'i');
/** Kaldırılan dükkan listesinin düğmeleri (O2): eski mesajlardan gelebilir, artık hiçbir şey listelemez. */
const RE_LEGACY_LIST = /^shops:/;
/** Sipariş kimliği taşıyan buton kimlikleri (14 §8): review:, review_reason:, wait:, cancel:, keep:, order: */
const RE_ORDER_BUTTON = new RegExp(`^(?:review|review_reason|wait|cancel|keep|order):(${UUID})(?::|$)`, 'i');

// ---------------------------------------------------------------------------
// Webhook alımı (14 §6.5): ham olay + iş (aynı transaction), hemen 200 — işletmeye özel webhook ile aynı kural

export async function ingestSharedWebhookPayload(db: Database, payload: unknown): Promise<{ webhookEventId: string; jobId: string | null }> {
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(waWebhookEvents)
      .values({ provider: 'shared', waAccountId: null, tenantId: null, payload: payload as object })
      .returning({ id: waWebhookEvents.id });
    const jobId = await enqueueJob(tx, {
      queue: 'wa-inbound',
      type: 'wa.process_inbound',
      payload: { webhookEventId: ev!.id },
      dedupeKey: `wa_in:${ev!.id}`,
      maxAttempts: 8,
    });
    return { webhookEventId: ev!.id, jobId };
  });
}

/** Ortak webhook olaylarını işler (wa.process_inbound; olay satırı provider='shared', hesap yok). */
export async function processSharedEvents(deps: EngineDeps, events: NormalizedWaEvent[], opts: { now?: Date } = {}): Promise<ProcessEventsSummary> {
  const summary: ProcessEventsSummary = { messages: 0, duplicates: 0, statuses: 0, echoes: 0 };
  for (const ev of events) {
    const now = opts.now ?? new Date();
    if (ev.type === 'message') {
      const r = await routeSharedMessage(deps, ev, now);
      if (r.status === 'processed') summary.messages++;
      else if (r.status === 'duplicate') summary.duplicates++;
    } else if (ev.type === 'status') {
      if (await applySharedStatus(deps, ev)) summary.statuses++;
    }
    // Echo: ortak numara yalnız API ile kullanılır (işletme telefonu yok) — yok sayılır
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Yönlendirme durumu

async function lockKey(tx: Database, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`wa_shared:${key}`}, 0))`);
}

/** Kişinin yönlendirme kaydı (BSUID önce, sonra telefon); yoksa açılır. Eksik anahtar tamamlanır. */
export async function upsertSharedRoute(tx: Database, from: WaSender | WaRecipient): Promise<SharedRouteRow> {
  const bsuid = from.bsuid ?? null;
  const phone = from.phone ?? null;
  const byBsuid = bsuid ? (await tx.select().from(sharedWaRoutes).where(eq(sharedWaRoutes.waBsuid, bsuid)))[0] : undefined;
  const byPhone = phone && !byBsuid ? (await tx.select().from(sharedWaRoutes).where(eq(sharedWaRoutes.phoneE164, phone)))[0] : undefined;
  const hit = byBsuid ?? byPhone;
  if (hit) {
    const patch: Partial<typeof sharedWaRoutes.$inferInsert> = {};
    if (bsuid && !hit.waBsuid) patch.waBsuid = bsuid;
    if (phone && !hit.phoneE164) {
      const [other] = await tx.select({ id: sharedWaRoutes.id }).from(sharedWaRoutes).where(eq(sharedWaRoutes.phoneE164, phone));
      if (!other) patch.phoneE164 = phone;
    }
    if (!Object.keys(patch).length) return hit;
    const [u] = await tx.update(sharedWaRoutes).set(patch).where(eq(sharedWaRoutes.id, hit.id)).returning();
    return u!;
  }
  const [created] = await tx.insert(sharedWaRoutes).values({ waBsuid: bsuid, phoneE164: phone }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = bsuid
    ? await tx.select().from(sharedWaRoutes).where(eq(sharedWaRoutes.waBsuid, bsuid))
    : await tx.select().from(sharedWaRoutes).where(eq(sharedWaRoutes.phoneE164, phone!));
  return again!;
}

/** Kişinin yönlendirme kaydı (yalnız okuma; dev simülatörü ve testler). */
export async function findSharedRoute(db: Database, who: { bsuid?: string | null; phone?: string | null }): Promise<SharedRouteRow | null> {
  if (who.bsuid) {
    const [r] = await db.select().from(sharedWaRoutes).where(eq(sharedWaRoutes.waBsuid, who.bsuid));
    if (r) return r;
  }
  if (who.phone) {
    const [r] = await db.select().from(sharedWaRoutes).where(eq(sharedWaRoutes.phoneE164, who.phone));
    if (r) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hedef çözümleme yardımcıları

async function accountById(db: Database, id: string): Promise<WaAccountRow | null> {
  const [a] = await db.select().from(waAccounts).where(eq(waAccounts.id, id));
  return a ?? null;
}

/** Yanıtlanan mesaj (context.id) ortak numarada bir dükkanın mesajıysa o dükkanın hesabı. */
async function accountOfWamid(db: Database, wamid: string | undefined): Promise<WaAccountRow | null> {
  if (!wamid) return null;
  const [row] = await db
    .select({ acc: waAccounts })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(waAccounts, eq(waAccounts.id, conversations.waAccountId))
    .where(and(eq(messages.wamid, wamid), eq(waAccounts.provider, 'shared')))
    .limit(1);
  return row?.acc ?? null;
}

/** Buton kimliğindeki sipariş → işletmenin ortak numara hesabı. */
async function accountOfOrder(db: Database, orderId: string): Promise<WaAccountRow | null> {
  const [o] = await db.select({ tenantId: orders.tenantId }).from(orders).where(eq(orders.id, orderId));
  return o ? sharedAccountOf(db, o.tenantId) : null;
}

/** Akış B kodu → işletmenin ortak numara hesabı (önce bekleyen kod; kodlar tüm işletmelerde tekil). */
async function accountOfOrderCode(db: Database, code: string, now: Date): Promise<WaAccountRow | null> {
  const rows = (await db.execute<{ tenant_id: string }>(sql`
    select v.tenant_id
      from order_verification_codes v
      join tenants t on t.id = v.tenant_id
     where v.code = ${code}
       and t.wa_mode = 'shared'
       and v.created_at > ${now.toISOString()}::timestamptz - make_interval(days => ${ORDER_CODE_LOOKBACK_DAYS})
     order by (v.used_at is null and v.expires_at > ${now.toISOString()}::timestamptz) desc, v.created_at desc
     limit 1`)) as unknown as { tenant_id: string }[];
  return rows[0] ? sharedAccountOf(db, rows[0].tenant_id) : null;
}

/**
 * Kişiye ortak numaradan en son mesaj gönderen dükkan (güncel ve son dükkanlar arasında; dükkan mesajı gönderilince
 * rememberSharedTenant dükkanı son dükkanlara ekler). "DUR" gibi alıntısız komutlar sohbetteki son mesaja tepkidir.
 */
async function lastSenderAccount(db: Database, route: SharedRouteRow, from: WaSender): Promise<WaAccountRow | null> {
  const tenantIds = [...new Set([route.currentTenantId, ...route.recentTenantIds].filter((x): x is string => Boolean(x)))];
  const who = [from.phone ? eq(customers.phoneE164, from.phone) : undefined, from.bsuid ? eq(customers.waBsuid, from.bsuid) : undefined].filter(
    (x): x is NonNullable<typeof x> => Boolean(x),
  );
  if (!tenantIds.length || !who.length) return null;
  const [row] = await db
    .select({ acc: waAccounts })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .innerJoin(waAccounts, eq(waAccounts.id, conversations.waAccountId))
    .where(
      and(
        inArray(conversations.tenantId, tenantIds),
        inArray(customers.tenantId, tenantIds),
        or(...who),
        eq(waAccounts.provider, 'shared'),
        ne(waAccounts.status, 'disconnected'),
        eq(messages.direction, 'out'),
        isNotNull(messages.wamid),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.acc ?? null;
}

/** Güncel dükkan (son yönlendirme `maxAgeMs` içinde ve hesabı ortak numarada). */
async function currentAccount(db: Database, route: SharedRouteRow, now: Date, maxAgeMs: number): Promise<WaAccountRow | null> {
  if (!route.currentTenantId || !route.lastRoutedAt) return null;
  if (now.getTime() - route.lastRoutedAt.getTime() > maxAgeMs) return null;
  return sharedAccountOf(db, route.currentTenantId);
}

// ---------------------------------------------------------------------------
// Platform düzeyi yanıtlar (yol gösterme; hiçbiri başka dükkan adı ya da dükkan sayısı taşımaz)

export interface PlatformReply {
  code: string;
  spec: OutboundSpec;
}

function textReply(code: string, text: string): PlatformReply {
  return { code, spec: { type: 'text', text } };
}

/**
 * Kişiye daha önce gönderilen aynı kodlu platform yanıtının zamanı (soğuma ölçüsü). Yeni kolon/migration GEREKMEZ:
 * platform mesajları zaten `shared_wa_messages` outbox'ında duruyor (route + createdAt indeksli, 30 gün).
 */
async function lastPlatformReplyAt(db: Database, routeId: string, code: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sharedWaMessages.createdAt })
    .from(sharedWaMessages)
    .where(
      and(
        eq(sharedWaMessages.routeId, routeId),
        eq(sharedWaMessages.direction, 'out'),
        sql`${sharedWaMessages.payload} ->> 'code' = ${code}`,
      ),
    )
    .orderBy(desc(sharedWaMessages.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * P07 · Dükkan motoru bu mesaja otomatik yanıt üretmedi: müşteri yanıtsız kalmasın. Güncel dükkana devam düğmesi
 * seçimi ZORLAR (`picker_select` → `selected` → motor soğuma beklemeden durum kartı / kapalı bilgisi / karşılama
 * gönderir). "Diğer dükkanlar" düğmesi yoktur (O2).
 */
export async function shopContinueReply(db: Database, route: SharedRouteRow, shopName: string): Promise<PlatformReply> {
  const [current] = route.currentTenantId ? await selectableSharedShops(db, { tenantIds: [route.currentTenantId] }) : [];
  if (!current) return textReply('P07', sharedContinueText({ isletme: shopName, buton: false }));
  return {
    code: 'P07',
    spec: {
      type: 'interactive',
      interactive: {
        kind: 'buttons',
        body: sharedContinueText({ isletme: current.name, buton: true }),
        footer: SHARED_PLATFORM_TEXTS.footer,
        buttons: [{ id: SHARED_BUTTON_IDS.shop(current.tenantId), title: clip(current.name, LIMITS.buttonTitle) }],
      },
    },
  };
}

/** #KOD'u yazılan ama ortak numarada seçilemeyen dükkan için bilgi (kendi numarası ya da şu an sipariş almıyor). */
async function unavailableShopReply(db: Database, t: NonNullable<Awaited<ReturnType<typeof tenantByWaCode>>>): Promise<PlatformReply> {
  if (t.waMode === 'own') {
    const acc = await tenantWaAccount(db, t.id);
    const usable = acc && acc.provider !== 'shared' && acc.status === 'connected' && acc.displayPhone && t.webLiveAt && t.orderingEnabled;
    return textReply(
      'P03',
      sharedOwnNumberText({
        isletme: t.name,
        tel: usable ? formatPhone(acc.displayPhone!) : null,
        link: usable ? `https://wa.me/${toWaMeDigits(acc.displayPhone!)}` : null,
      }),
    );
  }
  return textReply('P04', sharedUnavailableText({ isletme: t.name }));
}

/**
 * P09 / P06 · Kodsuz ve güncel dükkanı olmayan mesaj: LİSTESİZ tek nötr yanıt (00 §12a madde 11, O2). İlk yanıt
 * (P09) kişi başı 60 sn'de en çok 1; pencere içindeki sonraki mesaja tek satırlık hatırlatma (P06, 60 sn'de en çok 1),
 * sonra sessiz. `intro`: bulunamayan Akış B kodu ya da #KOD notu (yazım hatasında müşteri sebebi öğrenir).
 * Bulunamayan Akış B kodunda (`codeNotFound`) yanıt yalnız o nottur: müşteri siparişi zaten web'de verdi; ardına
 * "siparişi QR'dan verebilirsiniz" eklemek çelişkili yön gösterirdi.
 */
async function neutralDecision(db: Database, route: SharedRouteRow, now: Date, intro: string | null, rule: string): Promise<SharedDecision> {
  const join = (text: string) => (intro === SHARED_PLATFORM_TEXTS.codeNotFound ? intro : intro ? `${intro} ${text}` : text);
  if (route.lastPickerAt && now.getTime() - route.lastPickerAt.getTime() < SHARED_NEUTRAL_COOLDOWN_MS) {
    const hintAt = await lastPlatformReplyAt(db, route.id, 'P06');
    if (hintAt && now.getTime() - hintAt.getTime() < SHARED_HINT_COOLDOWN_MS) return { kind: 'silent', rule: `${rule}_cooldown` };
    return { kind: 'platform', replies: [textReply('P06', join(SHARED_PLATFORM_TEXTS.neutralRepeat))], rule: `${rule}_hint` };
  }
  return { kind: 'platform', replies: [textReply('P09', join(SHARED_PLATFORM_TEXTS.neutral))], rule, auto: true };
}

// ---------------------------------------------------------------------------
// Karar

export type SharedDecision =
  /** keepCurrent: güncel dükkan değişmez (ör. başka dükkanın mesajına "DUR") */
  | { kind: 'tenant'; account: WaAccountRow; selected: boolean; rule: string; keepCurrent?: boolean; repeatCode?: boolean }
  /** auto: kendiliğinden gönderilen nötr yanıt (P09) — `last_picker_at` soğumasını işaretler */
  | { kind: 'platform'; replies: PlatformReply[]; rule: string; auto?: boolean }
  | { kind: 'silent'; rule: string };

const toTenant = (account: WaAccountRow, selected: boolean, rule: string): SharedDecision => ({ kind: 'tenant', account, selected, rule });

async function decide(db: Database, route: SharedRouteRow, ev: InboundEvent, now: Date): Promise<SharedDecision> {
  const m = ev.message;
  const text = m.kind === 'text' ? m.text : '';

  // -) Sohbet ilk kez açıldı (request_welcome): QR'dan gelen müşterinin ön-dolu #KOD mesajı hemen ardından gelir ve
  // dükkanı seçer; burada yanıt göndermek fazladan mesaj olur ve soğuma sonraki kodsuz mesajı sadeleştirir.
  if (m.kind === 'request_welcome') return { kind: 'silent', rule: 'request_welcome' };

  // 0) Opt-out / opt-in: alıntılanan dükkan mesajının dükkanı → kişiye en son yazan dükkan → güncel dükkan (süre sınırı
  // yok). Başka dükkanın mesajına verilen "DUR" etkin siparişin dükkanını (güncel) değiştirmez.
  if (m.kind === 'text' && (isOptOut(text) || isOptIn(text))) {
    const target =
      (await accountOfWamid(db, ev.contextWamid)) ??
      (await lastSenderAccount(db, route, ev.from)) ??
      (await currentAccount(db, route, now, Number.POSITIVE_INFINITY));
    if (target) return { kind: 'tenant', account: target, selected: false, rule: 'opt_command', keepCurrent: true };
    // Dükkan yok: eskiden tam sessizlik vardı. "DUR" yazan kişiye kayıt bulunmadığını söylemek ticari ileti değildir;
    // yalın bilgi gider (60 sn'de en çok 1).
    const optAt = await lastPlatformReplyAt(db, route.id, 'P08');
    if (optAt && now.getTime() - optAt.getTime() < SHARED_HINT_COOLDOWN_MS) return { kind: 'silent', rule: 'opt_command_no_shop_cooldown' };
    return { kind: 'platform', replies: [textReply('P08', SHARED_PLATFORM_TEXTS.optNoShop)], rule: 'opt_command_no_shop' };
  }

  // 1) Buton / liste yanıtları
  if (m.kind === 'button_reply' || m.kind === 'list_reply') {
    const shop = RE_SHOP.exec(m.id);
    if (shop) {
      // Güncel dükkana devam düğmesi (P07). Kaldırılan listenin eski satırları da bu kimliği taşır: yalnız kişinin
      // KENDİ son dükkanlarından biriyse işlenir, aksi hâlde dizin olarak kullanılamaz (nötr yanıt, ad sızmaz).
      const tenantId = shop[1]!.toLowerCase();
      if (route.currentTenantId === tenantId || route.recentTenantIds.includes(tenantId)) {
        const [s] = await selectableSharedShops(db, { tenantIds: [tenantId] });
        const acc = s ? await accountById(db, s.accountId) : null;
        if (acc) return toTenant(acc, true, 'picker_select');
        const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
        if (t) return { kind: 'platform', replies: [await unavailableShopReply(db, t)], rule: 'picker_unavailable' };
      }
      return neutralDecision(db, route, now, null, 'list_closed');
    }
    // Kaldırılan dükkan listesinin eski düğmeleri (shops:list / shops:page:* / shops:m:*): liste GÖNDERİLMEZ.
    // Dükkan motoruna da gitmez (bilinmeyen düğmeye motor bilerek sessiz kalır, müşteri yanıtsız kalırdı).
    if (RE_LEGACY_LIST.test(m.id)) return neutralDecision(db, route, now, null, 'list_closed');
    const orderBtn = RE_ORDER_BUTTON.exec(m.id);
    const byOrder = orderBtn ? await accountOfOrder(db, orderBtn[1]!.toLowerCase()) : null;
    if (byOrder) return toTenant(byOrder, false, 'order_button');
    const byCtx = await accountOfWamid(db, ev.contextWamid);
    if (byCtx) return toTenant(byCtx, false, 'reply_context');
  }

  // 2) Akış B sipariş kodu (kod tüm işletmelerde tekil; bulunamazsa sıradaki kurallar)
  let codeNotFound = false;
  if (m.kind === 'text') {
    const oc = matchOrderCode(text);
    if (oc) {
      const acc = await accountOfOrderCode(db, oc, now);
      if (acc) return toTenant(acc, false, 'order_code');
      codeNotFound = true;
    }
  }

  // 3) Dükkan kodu: YALNIZ açık "#KOD" (QR'ın ve paylaşılan bağlantının ön-dolu metni, basılı kartlardaki "#KOD yazın"
  // talimatı). '#'siz yalın sözcük kod SAYILMAZ (00 §12a madde 11 "dükkan adıyla arama yoktur"): kodlar slug'ın ilk
  // sözcüğünden türediği için (waCodeBase: 'doner-salonu' → DONER) "döner", "pide" gibi genel bir sözcüğe karşılık
  // platform bir işletme seçmiş ya da P03/P04 ile müşterinin hiç gelmediği bir işletmenin adını yazmış olurdu.
  const active = await currentAccount(db, route, now, SHARED_ROUTE_ACTIVE_MS);
  let shopCodeNotFound = false;
  if (m.kind === 'text') {
    const codes = extractHashCodes(text);
    for (const code of codes) {
      const t = await tenantByWaCode(db, code);
      if (!t) continue;
      if (!tenantSelectableReason(t)) {
        const [s] = await selectableSharedShops(db, { tenantIds: [t.id] });
        const acc = s ? await accountById(db, s.accountId) : null;
        // Etkin güncel dükkanın kodu (takip sayfası, fiş, vitrin bağlantısı hep #KOD taşır) yeni seçim değildir
        // Yine de müşteri kodu AÇIKÇA gönderdi (QR'ı yeniden okuttu): uzun soğuma yerine yanıt verilir (repeatCode)
        if (acc && active?.tenantId === acc.tenantId) return { kind: 'tenant', account: acc, selected: false, rule: 'shop_code_current', repeatCode: true };
        if (acc) return toTenant(acc, true, 'shop_code');
      }
      return { kind: 'platform', replies: [await unavailableShopReply(db, t)], rule: 'shop_code_unavailable' };
    }
    // Buraya düşmek: yazılan "#KOD"ların hiçbiri dükkan değil (yazım hatası). Nötr yanıta not düşülür — "#DENEM"
    // yazan müşteri eskiden sebebini hiç öğrenmiyordu.
    if (codes.length) shopCodeNotFound = true;
  }

  // 4) Yanıtlanan dükkan mesajı (alıntı)
  if (m.kind !== 'button_reply' && m.kind !== 'list_reply') {
    const byCtx = await accountOfWamid(db, ev.contextWamid);
    if (byCtx) return toTenant(byCtx, false, 'reply_context');
  }

  // 5) Son 24 saatte konuşulan dükkan
  if (active) return toTenant(active, false, 'current');

  // 6) Listesiz nötr yanıt (kendiliğinden; aynı kişiye 60 sn'de en çok 1 + pencere içinde 1 kısa hatırlatma)
  const intro = codeNotFound ? SHARED_PLATFORM_TEXTS.codeNotFound : shopCodeNotFound ? SHARED_PLATFORM_TEXTS.shopCodeNotFound : null;
  return neutralDecision(db, route, now, intro, 'neutral');
}

// ---------------------------------------------------------------------------
// Gelen mesaj

export interface SharedInboundResult {
  status: 'processed' | 'duplicate' | 'ignored';
  decision?: SharedDecision['kind'];
  rule?: string;
  tenantId?: string;
  conversationId?: string;
}

export async function routeSharedMessage(deps: EngineDeps, ev: InboundEvent, now: Date = new Date()): Promise<SharedInboundResult> {
  const key = ev.from.bsuid ?? ev.from.phone;
  if (!key) return { status: 'ignored' };
  const outcome = await deps.db.transaction(async (tx) => {
    await lockKey(tx, key);
    // Tekrar teslim: ilk karar dükkana (messages) ya da platforma (shared_wa_messages) verilmiş olabilir; arada müşteri
    // dükkan seçtiyse eski mesaj bu kez o dükkana gitmesin (kişi kilidi altında: eşzamanlı teslim de yakalanır)
    const [dupT] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.wamid, ev.wamid)).limit(1);
    const [dupP] = dupT
      ? [dupT]
      : await tx
          .select({ id: sharedWaMessages.id })
          .from(sharedWaMessages)
          .where(and(eq(sharedWaMessages.wamid, ev.wamid), eq(sharedWaMessages.direction, 'in')))
          .limit(1);
    if (dupP) return { decision: null, duplicate: true as const };
    const route = await upsertSharedRoute(tx, ev.from);
    const decision = await decide(tx, route, ev, now);
    if (decision.kind === 'tenant') {
      const tenantId = decision.account.tenantId;
      const keep = decision.keepCurrent && !!route.currentTenantId && route.currentTenantId !== tenantId;
      await tx
        .update(sharedWaRoutes)
        .set(
          keep
            ? { lastInboundAt: now, updatedAt: now }
            : {
                currentTenantId: tenantId,
                recentTenantIds: [tenantId, ...route.recentTenantIds.filter((id) => id !== tenantId)].slice(0, SHARED_RECENT_MAX),
                lastRoutedAt: now,
                lastInboundAt: now,
                updatedAt: now,
              },
        )
        .where(eq(sharedWaRoutes.id, route.id));
      await tx.update(waAccounts).set({ lastWebhookAt: now }).where(eq(waAccounts.id, decision.account.id));
      return { decision, duplicate: false as const };
    }
    // Platform düzeyi: gelen mesaj kaydı (wamid tekil → tekrar teslimde yanıt yinelenmez) + yanıtlar (outbox)
    const rec = inboundRecord(ev);
    const [inserted] = await tx
      .insert(sharedWaMessages)
      .values({ routeId: route.id, direction: 'in', wamid: ev.wamid, kind: rec.kind, body: rec.body, payload: rec.payload, createdAt: now })
      .onConflictDoNothing({ target: sharedWaMessages.wamid })
      .returning({ id: sharedWaMessages.id });
    if (!inserted) return { decision: null, duplicate: true as const };
    await tx
      .update(sharedWaRoutes)
      // Soğuma (`last_picker_at`; kolon adı eski dükkan seçiciden kalır) YALNIZ kendiliğinden gönderilen nötr yanıtı
      // (decision.auto, P09) kısıtlar (denetim H15 / iş 3.2). Eskiden her platform yanıtı işaretliyordu: müşteri "#KOD"
      // yazıp "bu dükkan ortak numarada değil" bilgisini aldıktan sonra 60 sn boyunca TÜM kodsuz mesajları yutuluyordu.
      .set({ lastInboundAt: now, ...(decision.kind === 'platform' && decision.auto === true ? { lastPickerAt: now } : {}), updatedAt: now })
      .where(eq(sharedWaRoutes.id, route.id));
    if (decision.kind === 'platform') {
      let seq = 0;
      for (const r of decision.replies) {
        seq += 1;
        await queueSharedOutbound(tx, { routeId: route.id, to: ev.from, code: r.code, spec: r.spec, now: new Date(now.getTime() + seq) });
      }
    }
    return { decision, duplicate: false as const };
  });

  if (outcome.duplicate) return { status: 'duplicate' };
  const d = outcome.decision;
  if (d.kind !== 'tenant') {
    deps.log.info({ rule: d.rule }, 'ortak numara: platform yanıtı');
    return { status: 'processed', decision: d.kind, rule: d.rule };
  }
  const r: EngineReply = await handleInboundMessage(deps, d.account, ev, now, { selected: d.selected, repeatCode: d.repeatCode === true });
  if (r.status === 'processed' && r.conversationId && r.replied !== true) {
    await ensureShopReplied(deps, { ev, now, rule: d.rule, tenantId: d.account.tenantId, conversationId: r.conversationId, key });
  }
  return {
    status: r.status,
    decision: 'tenant',
    rule: d.rule,
    tenantId: d.account.tenantId,
    ...(r.conversationId ? { conversationId: r.conversationId } : {}),
  };
}

/**
 * Motorun yanıtı (`engine.ts` `InboundResult`). `replied` motorun bu mesaj için müşteriye yanıt ürettiğini söyleyen
 * SÖZLEŞMEDİR (14 §8.1). Alanı taşımayan bir motor sürümünde (`undefined`) yönlendirici ölçüyü kendisi yapar: dükkanın
 * giden mesaj outbox'ına (`messages`) bakar — yani varsayıma düşmez.
 */
type EngineReply = InboundResult & { replied?: boolean };

/**
 * Yedek yanıtın uygulandığı kararlar: müşterinin mesajı SESSİZCE dükkan motoruna gitti (açık bir seçim ya da komut
 * değil). Seçim kararlarında (`shop_code`, `picker_select`, `order_code`…) motor `selected` ile her zaman yanıt üretir;
 * `shop_code_current` (QR'ı yeniden okutma) 60 sn çift dokunma korumasına güvenir. Buton/liste yanıtları hariçtir:
 * butonlar BİZİM mesajımızdan gelir, bağlam motorda tamdır (ör. "Vazgeçtim" bilerek sessizdir).
 */
const SHARED_FALLBACK_RULES: ReadonlySet<string> = new Set(['current', 'reply_context']);

/**
 * Dükkan motoru (engine.ts) bu mesaja yanıt üretmediyse müşteri yanıtsız kalmasın: platform kısa bir yol gösterme
 * yazar (P07). "Yanıt üretti mi" ölçüsü ÖNCE motorun sözleşmesidir (`InboundResult.replied`, 14 §8.1); alan yoksa
 * yönlendirici motorun giden mesaj outbox'ına (`messages`) bakar — hiçbir durumda varsayım yapmaz. Üç kapı
 * sessizliğin KASITLI olduğu durumları korur:
 *   1. Motor bu mesaja yanıt yazdı (giden mesaj `now`dan sonra) ya da dükkan son 1 saatte yazdı → müşteri yanıtsız
 *      değil; platformun araya girmesi gürültü olur.
 *   2. Motorun BİLEREK sessiz kaldığı yollar (02 §6.2 "bilerek sessiz kalan yollar", 14 §8.1): opt-out, insan modu
 *      (personel yanıtlayacak), `bot_enabled = false`, kara liste / askı (bu müşteriye "menüyü aç" demek yanlış) ve
 *      Akış B kodu (kod bulunamadı yanıtı ve kaba kuvvet susturması motorun alanıdır).
 *   3. Aynı yol gösterme saatte en çok 1 kez (sonsuz tekrar yok).
 */
async function ensureShopReplied(
  deps: EngineDeps,
  input: { ev: InboundEvent; now: Date; rule: string; tenantId: string; conversationId: string; key: string },
): Promise<void> {
  const { ev, now, conversationId, tenantId } = input;
  if (!SHARED_FALLBACK_RULES.has(input.rule)) return;
  const m = ev.message;
  if (m.kind === 'button_reply' || m.kind === 'list_reply' || m.kind === 'request_welcome') return;
  if (m.kind === 'text' && matchOrderCode(m.text)) return;
  const db = deps.db;

  // 1) Dükkandan giden son mesaj: `now` ve sonrası = motor bu mesaja yanıt verdi; pencere içindeyse müşteri yanıtsız değil
  const [out] = await db
    .select({ at: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId), eq(messages.direction, 'out')))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (out && now.getTime() - out.at.getTime() < SHARED_FALLBACK_QUIET_MS) return;

  // 2) Kasıtlı sessizlik (opt-out / insan modu / bot kapalı / kara liste / askı): platform da susar
  const [st] = await db
    .select({ tenant: tenants, blocked: customers.isBlocked, mode: conversations.mode, humanUntil: conversations.humanUntil, optedOut: conversations.optedOut })
    .from(conversations)
    .innerJoin(tenants, eq(tenants.id, conversations.tenantId))
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
  if (!st || st.optedOut || st.blocked || !st.tenant.botEnabled || tenantUnavailable(st.tenant) || humanModeActive(st, now)) return;

  await db.transaction(async (tx) => {
    await lockKey(tx, input.key);
    const route = await upsertSharedRoute(tx, ev.from);
    const at = await lastPlatformReplyAt(tx, route.id, 'P07');
    if (at && now.getTime() - at.getTime() < SHARED_FALLBACK_QUIET_MS) return;
    const reply = await shopContinueReply(tx, route, st.tenant.name);
    await queueSharedOutbound(tx, { routeId: route.id, to: ev.from, code: reply.code, spec: reply.spec, now: new Date(now.getTime() + 1) });
    deps.log.info({ rule: input.rule, tenantId }, 'ortak numara: dükkan yanıt üretmedi, platform yol gösterdi');
  });
}

/**
 * Kişiyi (etkin oturumunu bozmadan) bir dükkana bağlar: etkin (24 sa) güncel dükkanı yoksa bu dükkan güncel olur,
 * etkin başka dükkan varsa dükkan yalnız son dükkanlara (ikinci sıraya) eklenir. Kullanım: ortak numaradan dükkanın
 * mesajı gittiğinde (`wa.send` başarısı; ör. telefon siparişinin durum şablonu — müşteri yanıtlayınca doğru dükkana
 * gider) ve dev simülatöründe dükkan hesabıyla yazıldığında (müşteri o dükkanın QR'ından gelmiş sayılır).
 */
export async function rememberSharedTenant(db: Database, to: WaRecipient, tenantId: string, now: Date = new Date()): Promise<void> {
  const key = to.bsuid ?? to.phone;
  if (!key) return;
  await db.transaction(async (tx) => {
    await lockKey(tx, key);
    const route = await upsertSharedRoute(tx, to);
    const active = !!route.currentTenantId && !!route.lastRoutedAt && now.getTime() - route.lastRoutedAt.getTime() <= SHARED_ROUTE_ACTIVE_MS;
    const rest = route.recentTenantIds.filter((id) => id !== tenantId);
    if (active && route.currentTenantId !== tenantId) {
      if (route.recentTenantIds.includes(tenantId)) return;
      const recent = [rest[0], tenantId, ...rest.slice(1)].filter((x): x is string => Boolean(x)).slice(0, SHARED_RECENT_MAX);
      await tx.update(sharedWaRoutes).set({ recentTenantIds: recent, updatedAt: now }).where(eq(sharedWaRoutes.id, route.id));
      return;
    }
    await tx
      .update(sharedWaRoutes)
      .set({ currentTenantId: tenantId, recentTenantIds: [tenantId, ...rest].slice(0, SHARED_RECENT_MAX), lastRoutedAt: now, updatedAt: now })
      .where(eq(sharedWaRoutes.id, route.id));
  });
}

// ---------------------------------------------------------------------------
// Platform düzeyi giden mesaj (outbox: shared_wa_messages + `wa.send_shared`)

export async function queueSharedOutbound(
  tx: Database,
  input: { routeId: string; to: WaSender | WaRecipient; code: string; spec: OutboundSpec; now?: Date; id?: string; data?: Record<string, unknown> },
): Promise<string> {
  const to: WaRecipient = { ...(input.to.phone ? { phone: input.to.phone } : {}), ...(input.to.bsuid ? { bsuid: input.to.bsuid } : {}) };
  const payload: SharedWaMessagePayload = { ...input.data, code: input.code, spec: input.spec as unknown as Record<string, unknown>, to };
  const [msg] = await tx
    .insert(sharedWaMessages)
    .values({
      ...(input.id ? { id: input.id } : {}),
      routeId: input.routeId,
      direction: 'out',
      kind: specKind(input.spec),
      body: specBody(input.spec),
      payload,
      status: 'queued',
      ...(input.now ? { createdAt: input.now } : {}),
    })
    .returning({ id: sharedWaMessages.id });
  await enqueueJob(tx, {
    queue: 'wa-outbound',
    type: 'wa.send_shared',
    payload: { messageId: msg!.id },
    dedupeKey: `wa_send_shared:${msg!.id}`,
    maxAttempts: 6,
  });
  return msg!.id;
}

async function markSharedFailed(db: Database, id: string, payload: SharedWaMessagePayload, code: string, message: string): Promise<void> {
  await db
    .update(sharedWaMessages)
    .set({ status: 'failed', errorCode: code.slice(0, 40), payload: { ...payload, error: { code, message: message.slice(0, 300) } }, updatedAt: new Date() })
    .where(eq(sharedWaMessages.id, id));
}

/** `wa.send_shared` işi: platform mesajını ortak numaradan gönderir. Geçici hatada (son deneme değilse) fırlatır. */
export async function performSharedSend(ctx: SendContext, messageId: string): Promise<SendOutcome> {
  const { db, config, log } = ctx;
  const [msg] = await db.select().from(sharedWaMessages).where(eq(sharedWaMessages.id, messageId));
  if (!msg || msg.direction !== 'out' || msg.status !== 'queued') return 'skipped';
  const payload = (msg.payload ?? {}) as SharedWaMessagePayload;
  const spec = payload.spec as unknown as OutboundSpec | undefined;
  const to = payload.to ? recipientOf({ waBsuid: payload.to.bsuid ?? null, phoneE164: payload.to.phone ?? null }) : null;
  if (!spec || !to) {
    await markSharedFailed(db, msg.id, payload, 'invalid_payload', 'Gönderim bilgisi eksik');
    return 'failed';
  }
  if (!(await acquireNumberSlot('platform:shared'))) throw new Error('Numara hız sınırı: gönderim ertelendi');
  try {
    const { wamid } = await sendSpec(getWaProvider(config.PLATFORM_WA_PROVIDER), platformAccountRef(config), to, spec);
    await db
      .update(sharedWaMessages)
      .set({ wamid, status: 'sent', errorCode: null, payload: { ...payload, request: specRequestBody(to, spec), error: null }, updatedAt: new Date() })
      .where(eq(sharedWaMessages.id, msg.id));
    return 'sent';
  } catch (err) {
    const e = isWaSendError(err) ? err : new WaSendError('unknown', String(err));
    log.warn({ code: e.code, action: e.action, messageId: msg.id }, 'ortak numara gönderim hatası');
    // Kimlik / hesap hatası PLATFORM arızasıdır (tüm dükkanlar susar): nöbetçiye kritik uyarı (denetim H8 / iş 3.4)
    alertSharedAccountError({ log, config }, e, config.PLATFORM_WA_PROVIDER);
    // 131048: ortak numaranın mesaj sınırı doldu/kısıtlandı — aynı şekilde PLATFORM arızası (açık soru 2)
    if (isMessagingLimitCode(e.code)) alertWabaMessagingLimit({ log, config }, { code: e.code, shared: true, provider: config.PLATFORM_WA_PROVIDER });
    if (e.action === 'retry' && !ctx.lastAttempt) throw err;
    await markSharedFailed(db, msg.id, payload, e.code, waErrorSummary(e));
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Durum olayları

const STATUS_RANK: Record<MessageStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** Ortak webhook'taki durum: dükkan mesajıysa o dükkanın hesabıyla (monoton), platform mesajıysa shared_wa_messages. */
export async function applySharedStatus(deps: EngineDeps, ev: Extract<NormalizedWaEvent, { type: 'status' }>): Promise<boolean> {
  const [hit] = await deps.db
    .select({ accountId: conversations.waAccountId })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(messages.wamid, ev.wamid))
    .limit(1);
  if (hit) {
    const acc = await accountById(deps.db, hit.accountId);
    return acc ? applyStatus(deps, acc, ev) : false;
  }
  const [row] = await deps.db.select().from(sharedWaMessages).where(eq(sharedWaMessages.wamid, ev.wamid));
  if (!row) return false;
  const cur = row.status ?? 'queued';
  if (STATUS_RANK[cur] >= STATUS_RANK[ev.status]) return false;
  if (ev.status === 'failed' && (cur === 'delivered' || cur === 'read')) return false;
  await deps.db
    .update(sharedWaMessages)
    .set({ status: ev.status, errorCode: ev.errorCode ?? row.errorCode, updatedAt: new Date() })
    .where(eq(sharedWaMessages.id, row.id));
  return true;
}
