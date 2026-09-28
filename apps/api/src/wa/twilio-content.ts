// Twilio Content API katalogu (16 §2.3): etkileşimli mesajlar için SABİT, sınırlı bir içerik kaynağı kümesi.
//
// Twilio serbest etkileşimli gövde almaz; `twilio/quick-reply` ve `twilio/list-picker` içerik kaynağı ister. Her mesaj
// için kaynak üretmek (binlerce kaynak) yerine, değişkenlerin başlık ve kimlik alanlarında da çalışmasından
// yararlanılır: buton sayısı / satır sayısı başına TEK kaynak üretilir, metinler ContentVariables ile doldurulur.
// Twilio belgesi: quick-reply ve list-picker, gelen mesaja yanıt olarak (24 saatlik oturum) WhatsApp onayı GEREKTİRMEZ.
//
// Kaynak kimliği (HX…) `wa_content_templates` tablosunda saklanır (süreçler arası tekillik: UNIQUE). Süreç içi bellek
// önbelleği ve uçuştaki istek haritası aynı kaynağın iki kez üretilmesini engeller. Tabloda yoksa önce Twilio'daki
// liste taranır (elle ya da eski dağıtımda üretilmiş kaynak sahiplenilir), sonra üretilir.

import { LIMITS, clip } from './cloud-body';
import { WaSendError } from './errors';
import { isGraphApiError } from './graph-admin';
import { TWILIO_CONTENT_BASE, twilioCall, type TwilioTarget } from './twilio-api';
import type { WaInteractiveMessage } from './types';

/** Katalog adlarının öneki; Twilio hesabındaki diğer içeriklerden ayırır. */
export const CONTENT_PREFIX = 'yg';
export const CONTENT_LANGUAGE = 'tr';
/** WhatsApp liste mesajında en çok satır. */
export const MAX_LIST_ITEMS = 10;

export type ContentKind = 'interactive' | 'template';

export interface TwilioContentStore {
  /** friendly_name → ContentSid (yoksa null) */
  get(friendlyName: string): Promise<string | null>;
  /** Kaydeder; başka bir süreç aynı adı önce yazdıysa GEÇERLİ olan (mevcut) kimliği döner. */
  put(friendlyName: string, contentSid: string, kind: ContentKind): Promise<string>;
  /** Kaydı siler (Twilio kaynağı silinip aynı adla yeniden üretildiyse eski kimlik bayatlar). */
  forget(friendlyName: string): Promise<void>;
}

/** Depo yokken (test, simülatör) yalnız bellek: süreç yeniden başlayınca Twilio listesinden sahiplenilir. */
function memoryStore(): TwilioContentStore {
  const map = new Map<string, string>();
  return {
    get: async (name) => map.get(name) ?? null,
    put: async (name, sid) => {
      const existing = map.get(name);
      if (existing) return existing;
      map.set(name, sid);
      return sid;
    },
    forget: async (name) => {
      map.delete(name);
    },
  };
}

let store: TwilioContentStore = memoryStore();
const sidCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
/**
 * Bulunamayan şablon adları → yeniden aranabileceği an (ms). Şablon yokken her gönderim Twilio listesini baştan
 * sayfalamasın diye kısa süre hatırlanır; admin "Şablonları gönder" (cacheContentSid) kaydı hemen siler.
 */
const missingUntil = new Map<string, number>();
export const MISSING_CONTENT_TTL_MS = 5 * 60_000;

/** Uygulama açılışında çağrılır (app.ts, worker.ts): kalıcı depo. */
export function setTwilioContentStore(s: TwilioContentStore | null): void {
  store = s ?? memoryStore();
  sidCache.clear();
  inFlight.clear();
  missingUntil.clear();
}

/** Test yardımcısı: bellek önbelleğini boşaltır. */
export function resetTwilioContentCache(): void {
  sidCache.clear();
  inFlight.clear();
  missingUntil.clear();
}

// ---------------------------------------------------------------------------
// Katalog tanımları

export type ContentTypes = Record<string, unknown>;

export interface ContentDefinition {
  friendlyName: string;
  types: ContentTypes;
  variables: Record<string, string>;
}

const v = (n: number) => `{{${n}}}`;

/** n hızlı yanıt butonu: {{1}} gövde; buton i için başlık {{2+2i}}, kimlik {{3+2i}}. */
export function quickReplyDefinition(n: number): ContentDefinition {
  const actions = Array.from({ length: n }, (_, i) => ({ type: 'QUICK_REPLY', title: v(2 + 2 * i), id: v(3 + 2 * i) }));
  const variables: Record<string, string> = { '1': 'Mesaj metni' };
  for (let i = 0; i < n; i++) {
    variables[String(2 + 2 * i)] = `Buton ${i + 1}`;
    variables[String(3 + 2 * i)] = `buton_${i + 1}`;
  }
  return { friendlyName: `${CONTENT_PREFIX}_qr${n}`, types: { 'twilio/quick-reply': { body: v(1), actions } }, variables };
}

/**
 * n satırlı liste: {{1}} gövde, {{2}} düğme yazısı. Açıklamalı ve açıklamasız iki aile vardır; Twilio'da boş değişken
 * bırakmamak için satırların hepsinde açıklama ya vardır ya yoktur.
 */
export function listPickerDefinition(n: number, withDescription: boolean): ContentDefinition {
  const step = withDescription ? 3 : 2;
  const items = Array.from({ length: n }, (_, i) => ({
    item: v(3 + step * i),
    id: v(4 + step * i),
    ...(withDescription ? { description: v(5 + step * i) } : {}),
  }));
  const variables: Record<string, string> = { '1': 'Mesaj metni', '2': 'Seç' };
  for (let i = 0; i < n; i++) {
    variables[String(3 + step * i)] = `Satır ${i + 1}`;
    variables[String(4 + step * i)] = `satir_${i + 1}`;
    if (withDescription) variables[String(5 + step * i)] = `Açıklama ${i + 1}`;
  }
  return {
    friendlyName: `${CONTENT_PREFIX}_list${withDescription ? 'd' : ''}${n}`,
    types: { 'twilio/list-picker': { body: v(1), button: v(2), items } },
    variables,
  };
}

// ---------------------------------------------------------------------------
// Etkileşimli mesaj → içerik kaynağı + değişkenler

/** Başlık ve alt bilgi Twilio'da yoktur: gövdenin ilk/son satırına yazılır (16 §2.3). */
export function foldHeaderFooter(msg: Pick<WaInteractiveMessage, 'body' | 'header' | 'footer'>): string {
  const parts: string[] = [];
  if (msg.header) parts.push(`*${clip(msg.header, LIMITS.headerFooter)}*`);
  parts.push(msg.body);
  if (msg.footer) parts.push(clip(msg.footer, LIMITS.headerFooter));
  return clip(parts.join('\n'), LIMITS.body);
}

export interface InteractivePlan {
  definition: ContentDefinition;
  variables: Record<string, string>;
}

/**
 * Etkileşimli mesajı Twilio içeriğine çevirir. `buttons` ve `list` içerik kaynağı kullanır; `cta_url` ve
 * `location_request` düz metne indirgenir (16 §2.3) ve `null` döner — çağıran metin olarak gönderir.
 */
export function planInteractive(msg: WaInteractiveMessage): InteractivePlan | null {
  const body = foldHeaderFooter(msg);
  switch (msg.kind) {
    case 'buttons': {
      const buttons = (msg.buttons ?? []).slice(0, LIMITS.maxButtons);
      if (!buttons.length) throw new WaSendError('invalid_message', 'Butonlu mesajda buton yok.', { retryable: false });
      const variables: Record<string, string> = { '1': body };
      buttons.forEach((b, i) => {
        variables[String(2 + 2 * i)] = clip(b.title, LIMITS.buttonTitle);
        variables[String(3 + 2 * i)] = b.id.slice(0, 256);
      });
      return { definition: quickReplyDefinition(buttons.length), variables };
    }
    case 'list': {
      if (!msg.list) throw new WaSendError('invalid_message', 'Liste mesajında satır yok.', { retryable: false });
      // Bölümler düzleştirilir: bölüm başlığı satır açıklamasının başına eklenir (Twilio'da bölüm yok)
      const rows: { id: string; title: string; description?: string }[] = [];
      for (const s of msg.list.sections) {
        for (const r of s.rows) {
          if (rows.length >= MAX_LIST_ITEMS) break;
          const desc = [s.title, r.description].filter(Boolean).join(' · ');
          rows.push({ id: r.id, title: r.title, ...(desc ? { description: desc } : {}) });
        }
      }
      if (!rows.length) throw new WaSendError('invalid_message', 'Liste mesajında satır yok.', { retryable: false });
      const withDescription = rows.some((r) => !!r.description);
      const step = withDescription ? 3 : 2;
      const variables: Record<string, string> = { '1': body, '2': clip(msg.list.buttonTitle, LIMITS.listButton) };
      rows.forEach((r, i) => {
        variables[String(3 + step * i)] = clip(r.title, LIMITS.listRowTitle);
        variables[String(4 + step * i)] = r.id.slice(0, 200);
        // Açıklamalı ailede her satırın açıklaması dolu olmalı: boşsa başlık tekrar edilmez, tire konur
        if (withDescription) variables[String(5 + step * i)] = clip(r.description || '—', LIMITS.listRowDescription);
      });
      return { definition: listPickerDefinition(rows.length, withDescription), variables };
    }
    case 'cta_url':
    case 'location_request':
      return null;
  }
}

/** İndirgenen etkileşimli mesajın düz metin karşılığı (16 §2.3). */
export function interactiveFallbackText(msg: WaInteractiveMessage): string {
  const body = foldHeaderFooter(msg);
  if (msg.kind === 'cta_url' && msg.url) return clip(`${body}\n${msg.url.label}: ${msg.url.href}`, 1600);
  if (msg.kind === 'location_request') return clip(`${body}\n\nKonumunuzu göndermek için ataç (📎) › Konum'u kullanabilirsiniz.`, 1600);
  return clip(body, 1600);
}

// ---------------------------------------------------------------------------
// Kaynak üretimi ve önbellek

interface ContentListResponse {
  contents?: { sid?: string; friendly_name?: string }[];
  meta?: { next_page_url?: string | null };
}

/** Twilio'daki içerik kaynağını adıyla arar (en çok 5 sayfa × 100). */
async function findContentByName(t: TwilioTarget, friendlyName: string): Promise<string | null> {
  let url: string | null = `${TWILIO_CONTENT_BASE}/Content?PageSize=100`;
  for (let page = 0; page < 5 && url; page++) {
    const res: ContentListResponse = await twilioCall<ContentListResponse>(t, 'GET', url);
    const hit = (res.contents ?? []).find((c) => c.friendly_name === friendlyName && c.sid);
    if (hit?.sid) return hit.sid;
    url = res.meta?.next_page_url ?? null;
  }
  return null;
}

export async function createContent(t: TwilioTarget, def: ContentDefinition): Promise<string> {
  const res = await twilioCall<{ sid?: string }>(t, 'POST', `${TWILIO_CONTENT_BASE}/Content`, {
    json: { friendly_name: def.friendlyName, language: CONTENT_LANGUAGE, variables: def.variables, types: def.types },
  });
  if (!res.sid) throw new WaSendError('no_content_sid', 'Twilio içerik kaynağı kimliği dönmedi', { retryable: false });
  return res.sid;
}

/**
 * friendly_name → ContentSid: bellek → tablo → Twilio listesi → (üret). Aynı süreçte eşzamanlı çağrılar tek istek olur.
 * `def` verilmezse üretim yapılmaz: yalnız arama (şablonlar; onları admin "Şablonları gönder" adımı üretir).
 */
async function resolveContentSid(
  t: TwilioTarget,
  friendlyName: string,
  def: ContentDefinition | null,
  kind: ContentKind,
): Promise<string | null> {
  const name = friendlyName;
  const cached = sidCache.get(name);
  if (cached) return cached;
  if (!def && (missingUntil.get(name) ?? 0) > Date.now()) return null;
  // Aynı anda gelen ikinci çağrı aynı isteği bekler; bulunamadıysa boş dizge yerine null döner
  const running = inFlight.get(name);
  if (running) return running.then((v) => v || null);

  const task = (async () => {
    const stored = await store.get(name);
    if (stored) return stored;
    const found = await findContentByName(t, name);
    if (found) return store.put(name, found, kind);
    if (!def) return '';
    const created = await createContent(t, def);
    return store.put(name, created, kind);
  })()
    .then((sid) => {
      if (sid) {
        sidCache.set(name, sid);
        missingUntil.delete(name);
      } else {
        missingUntil.set(name, Date.now() + MISSING_CONTENT_TTL_MS);
      }
      return sid;
    })
    .finally(() => {
      inFlight.delete(name);
    });
  inFlight.set(name, task);
  const sid = await task;
  return sid || null;
}

/** Katalog kaynağı: yoksa üretir. */
export async function ensureContentSid(t: TwilioTarget, def: ContentDefinition, kind: ContentKind = 'interactive'): Promise<string> {
  const sid = await resolveContentSid(t, def.friendlyName, def, kind);
  if (!sid) throw new WaSendError('no_content_sid', 'Twilio içerik kaynağı kimliği dönmedi', { retryable: false });
  return sid;
}

/** Var olan kaynağı adıyla arar (üretmez); bulunamazsa null. Şablonlar için. */
export async function lookupContentSid(t: TwilioTarget, friendlyName: string): Promise<string | null> {
  return resolveContentSid(t, friendlyName, null, 'template');
}

/** Gönderim yolunda içerik üretimi: sağlayıcı hatasını WaSendError'a çevirir (geçici hata yeniden denenir). */
export async function contentSidForSend(t: TwilioTarget, def: ContentDefinition): Promise<string> {
  try {
    return await ensureContentSid(t, def);
  } catch (err) {
    if (err instanceof WaSendError) throw err;
    if (isGraphApiError(err)) {
      throw new WaSendError(err.code, `Twilio içerik kaynağı hazırlanamadı: ${err.message}`, { httpStatus: err.httpStatus });
    }
    throw err;
  }
}

/** Test ve admin: bir kaynağı önbelleğe elle koyar (üretimden sonra). */
export function cacheContentSid(friendlyName: string, sid: string): void {
  sidCache.set(friendlyName, sid);
  missingUntil.delete(friendlyName);
}

/**
 * Bayat kimliği unutur (bellek + kalıcı depo): Twilio kaynağı bulamadığında çağrılır. Sonraki gönderim adı Twilio
 * listesinde yeniden arar; kaynak silinip aynı adla yeniden üretildiyse yeni kimliği bulur.
 */
export async function forgetContentSid(friendlyName: string): Promise<void> {
  sidCache.delete(friendlyName);
  await store.forget(friendlyName);
}
