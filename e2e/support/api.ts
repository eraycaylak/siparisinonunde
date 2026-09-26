// API düzeyinde test yardımcıları: geliştirici uçları (/api/v1/dev/*), storefront siparişi, panel oturumu.
// Senaryo kurulumunu hızlandırmak için kullanılır; asıl davranış arayüzden doğrulanır.

import { randomBytes, randomUUID } from 'node:crypto';
import { expect, request as pwRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { DEMO, WEB_URL } from './env';

// ---------------------------------------------------------------------------
// Benzersiz test verisi

let seq = 0;
/** Geçerli ve her çağrıda farklı bir TR cep numarası: 0532 xxx xx xx. */
export function uniquePhone(): string {
  seq += 1;
  const n = (Date.now() % 1_000_000) * 10 + (seq % 10);
  const d = String(n).padStart(7, '0').slice(-7);
  return `0532 ${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)}`;
}

/** "Ayşe E2E 4821" gibi benzersiz müşteri adı. */
export function uniqueName(first = 'Deneme'): string {
  return `${first} E2E ${randomBytes(2).readUInt16BE(0) % 10000}`;
}

/** +90532… biçimi (dev SMS kutusu filtreleri E.164 bekler). */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `+90${digits.slice(-10)}`;
}

/** Hız sınırı IP başınadır (14 §5); API ile kurulan siparişler ayrı sahte istemci IP'sinden gelir. */
export function fakeClientIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]! || 1}`;
}

async function json<T>(res: APIResponse, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Oturum çerezi kendine ait yeni bir API bağlamı (tarayıcıdan bağımsız). */
export async function newApiContext(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: WEB_URL });
}

// ---------------------------------------------------------------------------
// Geliştirici uçları (DEV_TOOLS=1)

export interface DevAccount {
  id: string;
  slug: string;
  tenantName: string;
  displayPhone: string | null;
  status: string;
}

export async function demoWaAccount(api: APIRequestContext, slug: string = DEMO.slug): Promise<DevAccount> {
  const { items } = await json<{ items: DevAccount[] }>(await api.get('/api/v1/dev/wa/accounts'), 'dev/wa/accounts');
  const acc = items.find((a) => a.slug === slug);
  if (!acc) throw new Error(`${slug} için mock WhatsApp hesabı yok`);
  return acc;
}

/** Müşteri gibi WhatsApp mesajı gönderir; ?sync=1 ile hemen işlenir. */
export async function sendCustomerText(api: APIRequestContext, input: { waAccountId: string; phone: string; name?: string; text: string }) {
  return json<{ ok: boolean }>(
    await api.post('/api/v1/dev/wa/inbound?sync=1', {
      data: { waAccountId: input.waAccountId, from: { phone: input.phone, name: input.name ?? null }, message: { type: 'text', text: input.text } },
    }),
    'dev/wa/inbound',
  );
}

export interface ThreadMessage {
  id: string;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  /** Bot mesajlarında 03 §9 M-kodu (M01, M05, M06c …) */
  code: string | null;
  orderId: string | null;
  status: string | null;
  cta?: { label: string; url: string } | null;
  buttons?: { id: string; title: string }[];
}

export async function waThread(api: APIRequestContext, waAccountId: string, phone: string): Promise<ThreadMessage[]> {
  const res = await json<{ messages: ThreadMessage[] }>(
    await api.get('/api/v1/dev/wa/thread', { params: { waAccountId, phone } }),
    'dev/wa/thread',
  );
  return res.messages;
}

export interface SharedThreadMessage extends ThreadMessage {
  /** Mesajın dükkanı (platform düzeyi dükkan seçici mesajında null) */
  tenantName: string | null;
  platform: boolean;
  brand?: string;
}

export interface SharedThread {
  messages: SharedThreadMessage[];
  route: { currentTenantId: string | null; currentTenantName: string | null; recentTenantIds: string[] } | null;
}

/** Müşterinin ortak numaradaki tek sohbeti (tüm dükkanlar + dükkan seçici; 00 §12a madde 8). */
export async function sharedThread(api: APIRequestContext, phone: string): Promise<SharedThread> {
  return json<SharedThread>(await api.get('/api/v1/dev/wa/thread', { params: { shared: '1', phone } }), 'dev/wa/thread (ortak)');
}

/** Vadesi gelmiş WhatsApp/bildirim işlerini çalıştırır (worker'ı beklemeden). */
export async function flushJobs(api: APIRequestContext): Promise<number> {
  const res = await json<{ processed: number }>(await api.post('/api/v1/dev/jobs/flush'), 'dev/jobs/flush');
  return res.processed;
}

export interface SmsItem {
  to: string;
  body: string;
  purpose: string;
  createdAt: string;
}

export async function smsInbox(api: APIRequestContext, phone: string): Promise<SmsItem[]> {
  const res = await json<{ items: SmsItem[] }>(await api.get('/api/v1/dev/sms', { params: { to: toE164(phone), limit: 20 } }), 'dev/sms');
  return res.items;
}

/** Mock SMS kutusundaki son 6 haneli OTP kodu. */
export async function latestOtp(api: APIRequestContext, phone: string): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const items = await smsInbox(api, phone);
        const otp = items.find((s) => s.purpose === 'otp');
        code = otp?.body.match(/\b(\d{6})\b/)?.[1] ?? null;
        return code;
      },
      { message: 'OTP SMS bekleniyor', timeout: 20_000 },
    )
    .not.toBeNull();
  return code!;
}

// ---------------------------------------------------------------------------
// Storefront

interface StoreOption {
  id: string;
  name: string;
}
interface StoreProduct {
  id: string;
  name: string;
  priceKurus: number;
  optionGroups: { id: string; name: string; minSelect: number; options: StoreOption[] }[];
}
interface StoreView {
  branch: { id: string; orderingState: string };
  categories: { name: string; products: StoreProduct[] }[];
}

export async function storefront(api: APIRequestContext, slug: string = DEMO.slug): Promise<StoreView> {
  return json<StoreView>(await api.get(`/api/v1/store/${slug}`), `store/${slug}`);
}

export interface CreatedOrder {
  orderId: string;
  number: number;
  status: string;
  trackingUrl: string;
  verification: { required: boolean; method?: 'wa_code' | 'sms_otp'; waLink?: string; code?: string; smsAvailable: boolean };
}

/** trackingUrl → /t/<token> yolu. */
export function trackingPath(order: { trackingUrl: string }): string {
  return new URL(order.trackingUrl, WEB_URL).pathname;
}

export interface WebOrderInput {
  slug?: string;
  customerName: string;
  customerPhone: string;
  /** Ürün adları; zorunlu seçenek gruplarında ilk seçenek seçilir. */
  products: string[];
  fulfillment: 'delivery' | 'pickup';
  neighborhood?: string;
}

/** Akış B siparişi (işletme sitesi, çerezsiz) → `awaiting_customer`. */
export async function createWebOrder(api: APIRequestContext, input: WebOrderInput): Promise<CreatedOrder> {
  const slug = input.slug ?? DEMO.slug;
  const store = await storefront(api, slug);
  const all = store.categories.flatMap((c) => c.products);
  const items = input.products.map((name) => {
    const p = all.find((x) => x.name === name);
    if (!p) throw new Error(`Ürün bulunamadı: ${name}`);
    const optionIds = p.optionGroups.filter((g) => g.minSelect > 0).map((g) => g.options[0]!.id);
    return { productId: p.id, quantity: 1, optionIds };
  });
  const delivery = input.fulfillment === 'delivery';
  const res = await api.post(`/api/v1/store/${slug}/orders`, {
    headers: { 'x-forwarded-for': fakeClientIp() },
    data: {
      items,
      fulfillmentType: input.fulfillment,
      ...(delivery ? { neighborhood: input.neighborhood ?? 'Medrese', addressLine: 'Lise Caddesi No: 7 Daire 2' } : {}),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      paymentMethod: delivery ? 'cash_on_delivery' : 'pay_at_counter',
      wantsCutlery: false,
      acceptPreInfo: true,
      idempotencyKey: randomUUID(),
    },
  });
  return json<CreatedOrder>(res, 'store orders');
}

export interface TrackView {
  order: { id: string; number: number; status: string; statusLabel: string };
}

export async function trackOrder(api: APIRequestContext, order: { trackingUrl: string }): Promise<TrackView> {
  const token = trackingPath(order).split('/t/')[1]!;
  return json<TrackView>(await api.get(`/api/v1/store/track/${token}`), 'store/track');
}

/**
 * Akış B siparişini müşteri WhatsApp mesajıyla doğrular ("Sipariş kodu: XXXXXX") ve `new` olmasını bekler.
 */
export async function verifyByWhatsappCode(
  api: APIRequestContext,
  order: CreatedOrder,
  customer: { phone: string; name: string },
): Promise<void> {
  expect(order.verification.method, 'WhatsApp kodu beklenir').toBe('wa_code');
  const acc = await demoWaAccount(api);
  await sendCustomerText(api, { waAccountId: acc.id, phone: customer.phone, name: customer.name, text: `Sipariş kodu: ${order.verification.code}` });
  await expect.poll(async () => (await trackOrder(api, order)).order.status, { message: 'sipariş new olmalı' }).toBe('new');
}

// ---------------------------------------------------------------------------
// Panel

/** API bağlamında panel girişi (çerez bağlamda kalır). */
export async function apiLogin(api: APIRequestContext, login: string, password: string): Promise<void> {
  await json(await api.post('/api/v1/auth/login', { data: { login, password }, headers: { 'x-forwarded-for': fakeClientIp() } }), 'auth/login');
}

export interface MeView {
  tenant: { id: string; slug: string; defaultBranchId: string | null } | null;
  branchId: string | null;
  readOnly: boolean;
}

export async function me(api: APIRequestContext): Promise<MeView> {
  return json<MeView>(await api.get('/api/v1/auth/me'), 'auth/me');
}

export async function branchIdOf(api: APIRequestContext): Promise<string> {
  const m = await me(api);
  const id = m.branchId ?? m.tenant?.defaultBranchId;
  if (!id) throw new Error('Şube kimliği bulunamadı');
  return id;
}

export async function acceptOrder(api: APIRequestContext, orderId: string, etaMinutes = 20): Promise<void> {
  await json(await api.post(`/api/v1/panel/orders/${orderId}/accept`, { data: { etaMinutes } }), 'panel accept');
}
