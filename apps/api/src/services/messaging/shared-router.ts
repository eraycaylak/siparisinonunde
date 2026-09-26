// Ortak numara yönlendiricisi (00 §12a madde 8; 14 §8.1). Tüm ortak numara işletmeleri platformun tek numarasını
// kullanır; gelen her mesaj için hangi dükkana gideceğine burada karar verilir, sonra o dükkanın kendi konuşma motoru
// (engine.ts handleInboundMessage, dükkanın 'shared' wa_accounts satırı) aynen çalışır — tenant yalıtımı korunur.
//
// Karar sırası (tek mesaj):
//   -) request_welcome (sohbet ilk kez açıldı) → sessiz: QR'ın ön-dolu #KOD mesajı hemen ardından dükkanı seçer
//   0) "DUR"/"BAŞLAT" → yanıtlanan (alıntılanan) dükkan mesajının dükkanı; alıntı yoksa kişiye en son yazan dükkan;
//      o da yoksa güncel dükkan (yoksa yanıt yok). Güncel dükkan değişmez.
//   1) buton/liste yanıtı: shop:<id> → o dükkan seçilir; shops:list / shops:page:<n> → dükkan listesi;
//      shops:m:<liste>:<n> → ad eşleşmesi listesinin sayfası; sipariş kimlikli butonlar
//      (review:/wait:/cancel:/keep:/order:) ya da yanıtlanan mesaj (context) → o dükkan
//   2) Akış B sipariş kodu → kodun işletmesi (bekleyen kodlar tüm işletmelerde tekil)
//   3) "#KOD" ya da (etkin dükkan yokken) mesajın tamamı bir dükkan kodu → dükkan seçilir (kendi numaralı / kapalı
//      dükkana kibar bilgi). Kod zaten etkin güncel dükkanınsa seçim sayılmaz (olağan sıra ve soğumalar geçerli: takip
//      sayfasının "#KOD"lu mesajındaki "yetkili", iptal ve SSS işlenir). "#1047" gibi harfsiz belirteç sipariş numarasıdır.
//   4) komutlar: "dükkanlar", "liste" → liste; "dükkan", "değiştir", "başka dükkan" → seçici
//   5) alıntılanan (yanıtlanan) dükkan mesajı → o dükkan
//   6) son 24 saatte konuşulan (güncel) dükkan → devam
//   7) dükkan adı eşleşmesi: tek → seçilir, birden çok → eşleşenlerin listesi
//   8) seçici: son dükkanlar varsa en çok 2'si + "Diğer dükkanlar" butonu, yoksa dükkan listesi (sayfalı)
// Seçici ve bilgi mesajları hiçbir dükkanın sohbetine girmez (shared_wa_messages, platform düzeyi; 30 gün).
// Tekrar teslim (aynı wamid) ilk kararı hangi tarafa verildiyse (dükkan sohbeti ya da platform kaydı) orada yakalanır.

import {
  SHARED_BUTTON_IDS,
  SHARED_PICKER_TEXTS,
  SHOP_LIST_COMMANDS,
  SHOP_PICKER_COMMANDS,
  extractHashCodes,
  formatPhone,
  normalizeWaCode,
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
  waAccounts,
  waWebhookEvents,
  type Database,
  type SharedWaMessagePayload,
} from '@siparis/db';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { enqueueJob } from '../../lib/jobs';
import { clip, LIMITS } from '../../wa/cloud-body';
import { isWaSendError, WaSendError, waErrorSummary } from '../../wa/errors';
import { getWaProvider, platformAccountRef, type WaAccountRow } from '../../wa/registry';
import { acquireNumberSlot } from '../../wa/throttle';
import type { NormalizedWaEvent, WaInteractiveMessage, WaRecipient, WaSender } from '../../wa/types';
import { applyStatus, handleInboundMessage, inboundRecord, type EngineDeps, type ProcessEventsSummary } from './engine';
import { specBody, specKind, type OutboundSpec } from './outbound';
import type { SendContext, SendOutcome } from './send';
import { recipientOf, sendSpec, specRequestBody } from './send';
import { matchShopsByName } from './shared-match';
import {
  selectableSharedShops,
  sharedAccountOf,
  tenantByWaCode,
  tenantSelectableReason,
  tenantWaAccount,
  type SharedShop,
} from './shared';
import { bareText, isOptIn, isOptOut, matchOrderCode } from './text';

/** Güncel dükkanla kodsuz devam süresi (son yönlendirmeden). */
export const SHARED_ROUTE_ACTIVE_MS = 24 * 60 * 60_000;
/** Kendiliğinden (kodsuz, dükkansız mesaja) gönderilen seçicinin aynı kişiye en sık aralığı. */
export const SHARED_PICKER_COOLDOWN_MS = 60_000;
/** Son dükkan listesi uzunluğu. */
export const SHARED_RECENT_MAX = 5;
/** WhatsApp liste mesajında en çok satır (tüm bölümler toplamı; teyit edilmeli: 10). */
export const SHARED_LIST_MAX_ROWS = 10;
/** Akış B kodu aramasında geriye bakış (gün). */
const ORDER_CODE_LOOKBACK_DAYS = 7;

type InboundEvent = Extract<NormalizedWaEvent, { type: 'message' }>;
export type SharedRouteRow = typeof sharedWaRoutes.$inferSelect;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_SHOP = new RegExp(`^shop:(${UUID})$`, 'i');
const RE_PAGE = /^shops:page:(\d{1,4})$/;
const RE_MATCH_PAGE = new RegExp(`^shops:m:(${UUID}):(\\d{1,4})$`, 'i');
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
// Dükkan seçici mesajları (platform düzeyi)

function rowTitle(name: string): string {
  return clip(name, LIMITS.listRowTitle);
}

function rowDescription(s: SharedShop): string {
  return [s.neighborhood ? `${s.neighborhood} Mah.` : null, s.district, s.city].filter(Boolean).join(', ');
}

/**
 * P02 · Dükkan listesi (≤ 10 satır; fazlası sayfalanır: 9 dükkan + "Diğer dükkanlar"). `pageId` sayfa satırının
 * kimliği: tüm liste için shops:page:<n>, ad eşleşmesi listesi için shops:m:<liste>:<n> (sayfa yine eşleşenlerden).
 */
export function shopListSpec(
  shops: readonly SharedShop[],
  page = 1,
  intro?: string | null,
  body: string = SHARED_PICKER_TEXTS.listBody,
  pageId: (n: number) => string = SHARED_BUTTON_IDS.page,
): OutboundSpec {
  const sorted = [...shops].sort(
    (a, b) => a.city.localeCompare(b.city, 'tr') || a.district.localeCompare(b.district, 'tr') || a.name.localeCompare(b.name, 'tr'),
  );
  const paged = sorted.length > SHARED_LIST_MAX_ROWS;
  const per = paged ? SHARED_LIST_MAX_ROWS - 1 : SHARED_LIST_MAX_ROWS;
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  const p = Math.min(Math.max(1, page), pages);
  const slice = sorted.slice((p - 1) * per, p * per);
  const sections: NonNullable<WaInteractiveMessage['list']>['sections'] = [];
  for (const s of slice) {
    const title = clip(`${s.district}, ${s.city}`, LIMITS.listRowTitle);
    let sec = sections.find((x) => x.title === title);
    if (!sec) {
      sec = { title, rows: [] };
      sections.push(sec);
    }
    sec.rows.push({ id: SHARED_BUTTON_IDS.shop(s.tenantId), title: rowTitle(s.name), description: clip(rowDescription(s), LIMITS.listRowDescription) });
  }
  if (paged) {
    const next = p < pages ? p + 1 : 1;
    sections.push({
      title: 'Sayfalar',
      rows: [
        {
          id: pageId(next),
          title: p < pages ? SHARED_PICKER_TEXTS.listNextPage : SHARED_PICKER_TEXTS.listFirstPage,
          description: `Sayfa ${next}/${pages}`,
        },
      ],
    });
  }
  const text = [intro, paged ? `${body} (Sayfa ${p}/${pages})` : body].filter(Boolean).join('\n');
  return {
    type: 'interactive',
    interactive: { kind: 'list', body: text, footer: SHARED_PICKER_TEXTS.footer, list: { buttonTitle: SHARED_PICKER_TEXTS.listButton, sections } },
  };
}

const titleKey = (t: string) => t.toLocaleLowerCase('tr-TR');
const allDistinct = (titles: readonly string[]) => new Set(titles.map(titleKey)).size === titles.length;

/**
 * Reply buton başlıkları: dükkan adı (≤ 20 karakter). WhatsApp aynı mesajda aynı başlıklı butonu reddeder: kırpılınca
 * aynılaşan adlar (ör. "Yozgat Pide Salonu Merkez" / "… Çamlık") dükkan koduyla, kod yoksa sıra numarasıyla ayrılır.
 */
export function shopButtonTitles(shops: readonly SharedShop[], reserved: readonly string[] = []): string[] {
  const max = LIMITS.buttonTitle;
  const tagged = (s: SharedShop, tag: string) => `${clip(s.name, max - tag.length - 1)} ${tag}`;
  const plain = shops.map((s) => clip(s.name, max));
  const clashes = (t: string, i: number) =>
    reserved.some((r) => titleKey(r) === titleKey(t)) || plain.some((x, j) => j !== i && titleKey(x) === titleKey(t));
  const byCode = plain.map((t, i) => (clashes(t, i) ? tagged(shops[i]!, shops[i]!.code ? `#${shops[i]!.code}` : String(i + 1)) : t));
  if (allDistinct([...byCode, ...reserved])) return byCode;
  return shops.map((s, i) => tagged(s, String(i + 1)));
}

/** P01 · Son dükkanlar: en çok 2 dükkan + (başka dükkan varsa) "Diğer dükkanlar". Başlıklar mesajda tekildir. */
export function recentShopsSpec(recent: readonly SharedShop[], hasOthers: boolean, intro?: string | null): OutboundSpec {
  const shops = recent.slice(0, 2);
  const titles = shopButtonTitles(shops, hasOthers ? [SHARED_PICKER_TEXTS.otherShops] : []);
  const buttons = shops.map((s, i) => ({ id: SHARED_BUTTON_IDS.shop(s.tenantId), title: titles[i]! }));
  if (hasOthers) buttons.push({ id: SHARED_BUTTON_IDS.list, title: SHARED_PICKER_TEXTS.otherShops });
  return {
    type: 'interactive',
    interactive: { kind: 'buttons', body: [intro, SHARED_PICKER_TEXTS.question].filter(Boolean).join('\n'), footer: SHARED_PICKER_TEXTS.footer, buttons },
  };
}

interface PlatformReply {
  code: string;
  spec: OutboundSpec;
  /** Platform mesajının kimliği önceden verilirse (ad eşleşmesi listesi: sayfa satırı bu kimliğe başvurur) */
  id?: string;
  /** Yüke eklenecek alanlar (ör. matchIds) */
  data?: Record<string, unknown>;
}

function textReply(code: string, text: string): PlatformReply {
  return { code, spec: { type: 'text', text } };
}

/** Seçici: son dükkanlar (butonlar) ya da tüm liste; seçilebilir dükkan yoksa bilgi. */
async function pickerReply(db: Database, route: SharedRouteRow, intro?: string | null): Promise<PlatformReply> {
  const all = await selectableSharedShops(db);
  if (!all.length) return textReply('P05', [intro, SHARED_PICKER_TEXTS.noShops].filter(Boolean).join('\n'));
  const byId = new Map(all.map((s) => [s.tenantId, s]));
  const recent = route.recentTenantIds.map((id) => byId.get(id)).filter((s): s is SharedShop => Boolean(s)).slice(0, 2);
  if (!recent.length) return { code: 'P02', spec: shopListSpec(all, 1, intro) };
  return { code: 'P01', spec: recentShopsSpec(recent, all.length > recent.length, intro) };
}

async function listReply(db: Database, page: number, intro?: string | null): Promise<PlatformReply> {
  const all = await selectableSharedShops(db);
  if (!all.length) return textReply('P05', SHARED_PICKER_TEXTS.noShops);
  return { code: 'P02', spec: shopListSpec(all, page, intro) };
}

/** Ad eşleşmesi listesi: eşleşenler bu platform mesajının yükünde (matchIds) saklanır; sayfa satırı ona başvurur. */
function matchListReply(shops: readonly SharedShop[], page: number, listId: string, keep: boolean): PlatformReply {
  const spec = shopListSpec(shops, page, null, SHARED_PICKER_TEXTS.matchesBody, (n) => SHARED_BUTTON_IDS.matchPage(listId, n));
  return keep ? { code: 'P02', spec, id: listId, data: { matchIds: shops.map((s) => s.tenantId) } } : { code: 'P02', spec };
}

/** Ad eşleşmesi listesinin n. sayfası (yalnız bu kişinin listesi; liste silinmiş ya da dükkanlar kalkmışsa tüm liste). */
async function matchPageReply(db: Database, route: SharedRouteRow, listId: string, page: number): Promise<PlatformReply> {
  const [row] = await db
    .select({ payload: sharedWaMessages.payload })
    .from(sharedWaMessages)
    .where(and(eq(sharedWaMessages.id, listId), eq(sharedWaMessages.routeId, route.id), eq(sharedWaMessages.direction, 'out')));
  const ids = Array.isArray(row?.payload?.matchIds) ? (row.payload.matchIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const shops = ids.length ? await selectableSharedShops(db, { tenantIds: ids }) : [];
  if (shops.length < 2) return listReply(db, 1);
  return matchListReply(shops, page, listId, false);
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

// ---------------------------------------------------------------------------
// Karar

export type SharedDecision =
  /** keepCurrent: güncel dükkan değişmez (ör. başka dükkanın mesajına "DUR") */
  | { kind: 'tenant'; account: WaAccountRow; selected: boolean; rule: string; keepCurrent?: boolean }
  | { kind: 'platform'; replies: PlatformReply[]; rule: string; auto?: boolean }
  | { kind: 'silent'; rule: string };

const toTenant = (account: WaAccountRow, selected: boolean, rule: string): SharedDecision => ({ kind: 'tenant', account, selected, rule });

async function decide(db: Database, route: SharedRouteRow, ev: InboundEvent, now: Date): Promise<SharedDecision> {
  const m = ev.message;
  const text = m.kind === 'text' ? m.text : '';
  const folded = text ? bareText(text) : '';

  // -) Sohbet ilk kez açıldı (request_welcome): QR'dan gelen müşterinin ön-dolu #KOD mesajı hemen ardından gelir ve
  // dükkanı seçer; burada seçici göndermek fazladan mesaj olur ve seçici soğuması sonraki kodsuz mesajı susturur.
  if (m.kind === 'request_welcome') return { kind: 'silent', rule: 'request_welcome' };

  // 0) Opt-out / opt-in: alıntılanan dükkan mesajının dükkanı → kişiye en son yazan dükkan → güncel dükkan (süre sınırı
  // yok). Başka dükkanın mesajına verilen "DUR" etkin siparişin dükkanını (güncel) değiştirmez.
  if (m.kind === 'text' && (isOptOut(text) || isOptIn(text))) {
    const target =
      (await accountOfWamid(db, ev.contextWamid)) ??
      (await lastSenderAccount(db, route, ev.from)) ??
      (await currentAccount(db, route, now, Number.POSITIVE_INFINITY));
    return target ? { kind: 'tenant', account: target, selected: false, rule: 'opt_command', keepCurrent: true } : { kind: 'silent', rule: 'opt_command_no_shop' };
  }

  // 1) Buton / liste yanıtları
  if (m.kind === 'button_reply' || m.kind === 'list_reply') {
    const shop = RE_SHOP.exec(m.id);
    if (shop) {
      const tenantId = shop[1]!.toLowerCase();
      const [s] = await selectableSharedShops(db, { tenantIds: [tenantId] });
      const acc = s ? await accountById(db, s.accountId) : null;
      if (acc) return toTenant(acc, true, 'picker_select');
      const [t] = (await db.execute<{ name: string }>(sql`select name from tenants where id = ${tenantId}`)) as unknown as { name: string }[];
      const intro = t ? sharedUnavailableText({ isletme: t.name }) : null;
      return { kind: 'platform', replies: [await pickerReply(db, route, intro)], rule: 'picker_unavailable' };
    }
    if (m.id === SHARED_BUTTON_IDS.list) return { kind: 'platform', replies: [await listReply(db, 1)], rule: 'list' };
    const page = RE_PAGE.exec(m.id);
    if (page) return { kind: 'platform', replies: [await listReply(db, Number(page[1]))], rule: 'list_page' };
    const matchPage = RE_MATCH_PAGE.exec(m.id);
    if (matchPage) {
      return { kind: 'platform', replies: [await matchPageReply(db, route, matchPage[1]!.toLowerCase(), Number(matchPage[2]))], rule: 'name_matches_page' };
    }
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

  // 3) Dükkan kodu: "#KOD" ya da mesajın tamamı bir kod. Yalın sözcük yalnız etkin dükkan yokken kod sayılır: etkin
  // oturumda "pide", "lahmacun" gibi bir sözcük başka dükkanın koduna denk gelse de müşteri dükkan değiştirmek istemez.
  const active = await currentAccount(db, route, now, SHARED_ROUTE_ACTIVE_MS);
  if (m.kind === 'text') {
    const codes = extractHashCodes(text);
    if (!codes.length && !active && folded && !folded.includes(' ')) {
      const whole = normalizeWaCode(folded);
      if (whole && /[A-Z]/.test(whole)) codes.push(whole);
    }
    for (const code of codes) {
      const t = await tenantByWaCode(db, code);
      if (!t) continue;
      if (!tenantSelectableReason(t)) {
        const [s] = await selectableSharedShops(db, { tenantIds: [t.id] });
        const acc = s ? await accountById(db, s.accountId) : null;
        // Etkin güncel dükkanın kodu (takip sayfası, fiş, vitrin bağlantısı hep #KOD taşır) yeni seçim değildir
        if (acc && active?.tenantId === acc.tenantId) return toTenant(acc, false, 'shop_code_current');
        if (acc) return toTenant(acc, true, 'shop_code');
      }
      return { kind: 'platform', replies: [await unavailableShopReply(db, t)], rule: 'shop_code_unavailable' };
    }
  }

  // 4) Komutlar
  if (m.kind === 'text' && SHOP_LIST_COMMANDS.has(folded)) return { kind: 'platform', replies: [await listReply(db, 1)], rule: 'list_command' };
  if (m.kind === 'text' && SHOP_PICKER_COMMANDS.has(folded)) return { kind: 'platform', replies: [await pickerReply(db, route)], rule: 'picker_command' };

  // 5) Yanıtlanan dükkan mesajı (alıntı)
  if (m.kind !== 'button_reply' && m.kind !== 'list_reply') {
    const byCtx = await accountOfWamid(db, ev.contextWamid);
    if (byCtx) return toTenant(byCtx, false, 'reply_context');
  }

  // 6) Son 24 saatte konuşulan dükkan
  if (active) return toTenant(active, false, 'current');

  // 7) Dükkan adı
  if (m.kind === 'text' && text.trim()) {
    const shops = await selectableSharedShops(db);
    const r = matchShopsByName(text, shops);
    const pick = r.strong.length ? r.strong : r.queryTokens <= 3 ? r.weak : [];
    if (pick.length === 1) {
      const acc = await accountById(db, pick[0]!.accountId);
      if (acc) return toTenant(acc, true, 'name_match');
    } else if (pick.length > 1) {
      return { kind: 'platform', replies: [matchListReply(pick, 1, randomUUID(), true)], rule: 'name_matches' };
    }
  }

  // 8) Dükkan seçici (kendiliğinden; aynı kişiye 60 sn'de en çok 1)
  if (route.lastPickerAt && now.getTime() - route.lastPickerAt.getTime() < SHARED_PICKER_COOLDOWN_MS) {
    return { kind: 'silent', rule: 'picker_cooldown' };
  }
  return { kind: 'platform', replies: [await pickerReply(db, route, codeNotFound ? SHARED_PICKER_TEXTS.codeNotFound : null)], rule: 'picker', auto: true };
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
      .set({ lastInboundAt: now, ...(decision.kind === 'platform' ? { lastPickerAt: now } : {}), updatedAt: now })
      .where(eq(sharedWaRoutes.id, route.id));
    if (decision.kind === 'platform') {
      let seq = 0;
      for (const r of decision.replies) {
        seq += 1;
        await queueSharedOutbound(tx, { routeId: route.id, to: ev.from, code: r.code, spec: r.spec, now: new Date(now.getTime() + seq), id: r.id, data: r.data });
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
  const r = await handleInboundMessage(deps, d.account, ev, now, { selected: d.selected });
  return {
    status: r.status,
    decision: 'tenant',
    rule: d.rule,
    tenantId: d.account.tenantId,
    ...(r.conversationId ? { conversationId: r.conversationId } : {}),
  };
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
