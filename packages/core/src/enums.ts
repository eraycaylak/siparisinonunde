// Kanonik enum'lar (00 §4, §5, §7; 14 §4). Değerler 00 ile birebir; etiketler Türkçe.
// Tek kaynak: DB CHECK kısıtları ve Zod şemaları buradan üretilir.

import { z } from 'zod';

/** Değer listesinden Zod enum şeması. */
function zEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values);
}

/** Etiket haritasından güvenli okuma. */
export function labelOf<T extends string>(labels: Record<T, string>, value: T | null | undefined): string {
  if (value == null) return '';
  return labels[value] ?? value;
}

// ---------------------------------------------------------------------------
// Sipariş durumu (00 §5)
export const ORDER_STATUSES = [
  'awaiting_customer',
  'new',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
  'delivered',
  'rejected',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const orderStatusSchema = zEnum(ORDER_STATUSES);
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_customer: 'Müşteri onayı bekleniyor',
  new: 'Yeni',
  accepted: 'Onaylandı',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  on_the_way: 'Yolda',
  delivered: 'Teslim edildi',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
};
/** Açık (final olmayan) durumlar. */
export const OPEN_ORDER_STATUSES = [
  'awaiting_customer',
  'new',
  'accepted',
  'preparing',
  'ready',
  'on_the_way',
] as const satisfies readonly OrderStatus[];
/** Final durumlar. */
export const FINAL_ORDER_STATUSES = ['delivered', 'rejected', 'cancelled'] as const satisfies readonly OrderStatus[];

// Ret sebebi (00 §5)
export const REJECTION_REASONS = [
  'closed',
  'out_of_zone',
  'item_unavailable',
  'too_busy',
  'duplicate',
  'suspected_fake',
  'other',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export const rejectionReasonSchema = zEnum(REJECTION_REASONS);
export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  closed: 'Kapalıyız',
  out_of_zone: 'Bölge dışı',
  item_unavailable: 'Ürün kalmadı',
  too_busy: 'Yoğunluk',
  duplicate: 'Mükerrer',
  suspected_fake: 'Şüpheli / sahte',
  other: 'Diğer',
};

// İptal sebebi (00 §5)
export const CANCEL_REASONS = [
  'customer_request',
  'customer_timeout',
  'tenant_no_response',
  'item_unavailable',
  'courier_issue',
  'duplicate',
  'suspected_fake',
  'payment_timeout',
  'other',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const cancelReasonSchema = zEnum(CANCEL_REASONS);
export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  customer_request: 'Müşteri isteği',
  customer_timeout: 'Müşteri onaylamadı (zaman aşımı)',
  tenant_no_response: 'İşletme yanıt vermedi',
  item_unavailable: 'Ürün kalmadı',
  courier_issue: 'Kurye sorunu',
  duplicate: 'Mükerrer',
  suspected_fake: 'Şüpheli / sahte',
  payment_timeout: 'Online ödeme tamamlanmadı',
  other: 'Diğer',
};
/** Panelde işletmenin seçebileceği iptal sebepleri (sistem sebepleri hariç; 07 §4.1 geçiş 12). */
export const TENANT_CANCEL_REASONS = [
  'item_unavailable',
  'courier_issue',
  'duplicate',
  'suspected_fake',
  'other',
] as const satisfies readonly CancelReason[];

export const CANCELLED_BY = ['customer', 'tenant', 'system'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];
export const cancelledBySchema = zEnum(CANCELLED_BY);
export const CANCELLED_BY_LABELS: Record<CancelledBy, string> = {
  customer: 'Müşteri',
  tenant: 'İşletme',
  system: 'Sistem',
};

// Doğrulama yöntemi (00 §5)
export const VERIFICATION_METHODS = ['wa_link', 'wa_code', 'wa_button', 'sms_otp', 'staff'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export const verificationMethodSchema = zEnum(VERIFICATION_METHODS);
export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  wa_link: 'WhatsApp bağlantısı',
  wa_code: 'WhatsApp sipariş kodu',
  wa_button: 'WhatsApp onay butonu',
  sms_otp: 'SMS kodu',
  staff: 'Personel',
};

// Test siparişi türü (00 §5)
export const TEST_KINDS = ['onboarding_test', 'canary'] as const;
export type TestKind = (typeof TEST_KINDS)[number];
export const testKindSchema = zEnum(TEST_KINDS);
export const TEST_KIND_LABELS: Record<TestKind, string> = {
  onboarding_test: 'Kurulum testi',
  canary: 'Sistem testi',
};

// Ödeme durumu ve yöntemi (00 §5)
export const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatusSchema = zEnum(PAYMENT_STATUSES);
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Ödenmedi',
  pending: 'Ödeme bekleniyor',
  paid: 'Ödendi',
  failed: 'Ödeme başarısız',
  refunded: 'İade edildi',
  partially_refunded: 'Kısmen iade edildi',
};

export const PAYMENT_METHODS = [
  'cash_on_delivery',
  'card_on_delivery',
  'meal_card_on_delivery',
  'online_card',
  'pay_at_counter',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodSchema = zEnum(PAYMENT_METHODS);
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_on_delivery: 'Kapıda nakit',
  card_on_delivery: 'Kapıda kredi/banka kartı',
  meal_card_on_delivery: 'Kapıda yemek kartı',
  online_card: 'Online kart',
  pay_at_counter: 'Kasada öde',
};
/** Faz 1'de açılabilen yöntemler (online_card Faz 2). */
export const PHASE1_PAYMENT_METHODS = [
  'cash_on_delivery',
  'card_on_delivery',
  'meal_card_on_delivery',
  'pay_at_counter',
] as const satisfies readonly PaymentMethod[];

// Yemek kartı markaları (07 §3.0)
export const MEAL_CARD_BRANDS = ['multinet', 'pluxee', 'edenred', 'setcard', 'metropol', 'other'] as const;
export type MealCardBrand = (typeof MEAL_CARD_BRANDS)[number];
export const mealCardBrandSchema = zEnum(MEAL_CARD_BRANDS);
export const MEAL_CARD_BRAND_LABELS: Record<MealCardBrand, string> = {
  multinet: 'Multinet',
  pluxee: 'Pluxee',
  edenred: 'Edenred (Ticket)',
  setcard: 'Setcard',
  metropol: 'Metropol',
  other: 'Diğer',
};

// Teslim türü (00 §5)
export const FULFILLMENT_TYPES = ['delivery', 'pickup', 'dine_in'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];
export const fulfillmentTypeSchema = zEnum(FULFILLMENT_TYPES);
export const FULFILLMENT_TYPE_LABELS: Record<FulfillmentType, string> = {
  delivery: 'Paket servis',
  pickup: 'Gel-al',
  dine_in: 'Masaya',
};

// Sipariş kanalı (00 §5)
export const ORDER_CHANNELS = ['wa_link', 'wa_ai', 'web', 'table_qr', 'wa_flow', 'wa_reorder', 'manual'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];
export const orderChannelSchema = zEnum(ORDER_CHANNELS);
export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = {
  wa_link: 'WhatsApp (menü linki)',
  wa_ai: 'WhatsApp (yazılı sipariş)',
  web: 'Web',
  table_qr: 'Masa QR',
  wa_flow: 'WhatsApp Flows',
  wa_reorder: 'WhatsApp (tekrar)',
  manual: 'Telefon / manuel',
};

// Şube sipariş durumu (00 §7)
export const ORDERING_STATES = ['open', 'busy', 'paused', 'closed'] as const;
export type OrderingState = (typeof ORDERING_STATES)[number];
export const orderingStateSchema = zEnum(ORDERING_STATES);
export const ORDERING_STATE_LABELS: Record<OrderingState, string> = {
  open: 'Açık',
  busy: 'Yoğun',
  paused: 'Sipariş alımı durduruldu',
  closed: 'Kapalı',
};

// İşletme yaşam döngüsü ve abonelik (00 §7)
export const LIFECYCLE_STAGES = [
  'lead',
  'onboarding',
  'pilot',
  'trial',
  'active',
  'past_due',
  'read_only',
  'suspended',
  'churned',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export const lifecycleStageSchema = zEnum(LIFECYCLE_STAGES);
export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  lead: 'Aday',
  onboarding: 'Kurulumda',
  pilot: 'Pilot',
  trial: 'Deneme',
  active: 'Aktif',
  past_due: 'Ödeme gecikti',
  read_only: 'Salt okunur',
  suspended: 'Askıda',
  churned: 'Ayrıldı',
};

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'read_only', 'suspended', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const subscriptionStatusSchema = zEnum(SUBSCRIPTION_STATUSES);
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Deneme',
  active: 'Aktif',
  past_due: 'Ödeme gecikti',
  read_only: 'Salt okunur',
  suspended: 'Askıda',
  cancelled: 'İptal edildi',
};

export const SUSPENSION_REASONS = ['payment', 'trial_ended', 'pilot_ended', 'policy', 'abuse', 'legal'] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];
export const suspensionReasonSchema = zEnum(SUSPENSION_REASONS);
export const SUSPENSION_REASON_LABELS: Record<SuspensionReason, string> = {
  payment: 'Ödeme alınamadı',
  trial_ended: 'Deneme bitti',
  pilot_ended: 'Pilot bitti',
  policy: 'Politika ihlali',
  abuse: 'Kötüye kullanım',
  legal: 'Hukuki',
};

// Paketler (00 §8)
export const PLAN_CODES = ['esnaf', 'pro', 'zincir'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
export const planCodeSchema = zEnum(PLAN_CODES);
export const PLAN_CODE_LABELS: Record<PlanCode, string> = {
  esnaf: 'Esnaf',
  pro: 'Pro',
  zincir: 'Zincir',
};

// Roller (00 §4)
export const TENANT_ROLES = ['owner', 'manager', 'cashier', 'kitchen', 'courier'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export const tenantRoleSchema = zEnum(TENANT_ROLES);
export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'İşletme sahibi',
  manager: 'Yönetici',
  cashier: 'Kasiyer',
  kitchen: 'Mutfak',
  courier: 'Kurye',
};

export const PLATFORM_ROLES = ['platform_owner', 'platform_admin', 'support_agent', 'finance', 'sales_rep'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export const platformRoleSchema = zEnum(PLATFORM_ROLES);
export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  platform_owner: 'Platform sahibi',
  platform_admin: 'Platform yöneticisi',
  support_agent: 'Destek',
  finance: 'Finans',
  sales_rep: 'Satış',
};

/** Faz 2. */
export const RESELLER_ROLES = ['reseller_admin', 'reseller_technician'] as const;
export type ResellerRole = (typeof RESELLER_ROLES)[number];
export const resellerRoleSchema = zEnum(RESELLER_ROLES);
export const RESELLER_ROLE_LABELS: Record<ResellerRole, string> = {
  reseller_admin: 'Bayi yöneticisi',
  reseller_technician: 'Kurulum teknisyeni',
};

// Kuyruklar (00 §5); 'integrations' Faz 2.
export const QUEUES = ['wa-inbound', 'wa-outbound', 'wa-media', 'notify', 'llm', 'print', 'images', 'cron', 'integrations'] as const;
export type Queue = (typeof QUEUES)[number];
export const queueSchema = zEnum(QUEUES);
export const QUEUE_LABELS: Record<Queue, string> = {
  'wa-inbound': 'WhatsApp gelen',
  'wa-outbound': 'WhatsApp giden',
  'wa-media': 'WhatsApp medya',
  notify: 'Bildirim',
  llm: 'Yapay zeka',
  print: 'Yazdırma',
  images: 'Görsel',
  cron: 'Zamanlanmış',
  integrations: 'Entegrasyon',
};

// Kill-switch'ler (00 §4). Tenant bazındaki ordering_enabled tenants tablosundadır.
export const KILL_SWITCHES = ['signup_open', 'wa_onboarding', 'campaigns_global', 'llm_parsing', 'sms_fallback'] as const;
export type KillSwitch = (typeof KILL_SWITCHES)[number];
export const killSwitchSchema = zEnum(KILL_SWITCHES);
export const KILL_SWITCH_LABELS: Record<KillSwitch, string> = {
  signup_open: 'Yeni kayıt açık',
  wa_onboarding: 'WhatsApp bağlama açık',
  campaigns_global: 'Kampanyalar açık',
  llm_parsing: 'Yapay zeka ile sipariş okuma açık',
  sms_fallback: 'SMS yedeği açık',
};

export const FEATURE_FLAG_KINDS = ['kill_switch', 'ops', 'release'] as const;
export type FeatureFlagKind = (typeof FEATURE_FLAG_KINDS)[number];
export const FEATURE_FLAG_KIND_LABELS: Record<FeatureFlagKind, string> = {
  kill_switch: 'Acil durdurma',
  ops: 'Operasyon',
  release: 'Sürüm',
};

// ---------------------------------------------------------------------------
// Faz 1 uygulama kodları (14 §4)

export const SESSION_KINDS = ['user', 'courier', 'impersonation'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const ORDER_EVENT_ACTOR_TYPES = ['customer', 'user', 'system'] as const;
export type OrderEventActorType = (typeof ORDER_EVENT_ACTOR_TYPES)[number];

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'Bekliyor',
  running: 'Çalışıyor',
  done: 'Tamamlandı',
  failed: 'Başarısız',
  cancelled: 'İptal edildi',
};

/** SSE olay türleri (14 §7.1). */
export const BRANCH_EVENT_TYPES = [
  'order.created',
  'order.updated',
  'order.alarm',
  'conversation.message',
  'conversation.updated',
  'branch.state',
  'ping',
] as const;
export type BranchEventType = (typeof BRANCH_EVENT_TYPES)[number];

export const DELIVERY_ZONE_KINDS = ['neighborhoods', 'polygon', 'radius'] as const;
export type DeliveryZoneKind = (typeof DELIVERY_ZONE_KINDS)[number];
export const deliveryZoneKindSchema = zEnum(DELIVERY_ZONE_KINDS);
export const DELIVERY_ZONE_KIND_LABELS: Record<DeliveryZoneKind, string> = {
  neighborhoods: 'Mahalle listesi',
  polygon: 'Haritada alan',
  radius: 'Yarıçap',
};

export const PRICE_CHANGE_KINDS = ['percent', 'fixed'] as const;
export type PriceChangeKind = (typeof PRICE_CHANGE_KINDS)[number];

export const REVIEW_RATINGS = ['good', 'ok', 'bad'] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];
export const reviewRatingSchema = zEnum(REVIEW_RATINGS);
export const REVIEW_RATING_LABELS: Record<ReviewRating, string> = {
  good: 'Harika',
  ok: 'İdare eder',
  bad: 'Beğenmedim',
};

export const CANCELLATION_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type CancellationRequestStatus = (typeof CANCELLATION_REQUEST_STATUSES)[number];
export const CANCELLATION_REQUEST_STATUS_LABELS: Record<CancellationRequestStatus, string> = {
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
};

export const LEGAL_DOCUMENTS = ['abonelik', 'kvkk_aydinlatma', 'mesafeli_satis', 'on_bilgilendirme'] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];
export const LEGAL_DOCUMENT_LABELS: Record<LegalDocument, string> = {
  abonelik: 'Abonelik sözleşmesi',
  kvkk_aydinlatma: 'KVKK aydınlatma metni',
  mesafeli_satis: 'Mesafeli satış sözleşmesi',
  on_bilgilendirme: 'Ön bilgilendirme formu',
};
/** Taslak yasal metin sürümü (hukuki inceleme bekliyor). */
export const LEGAL_DOCUMENT_VERSION = '2026-09-taslak';

// WhatsApp (14 §4, §8)
export const WA_PROVIDERS = ['mock', 'cloud', 'd360'] as const;
export type WaProvider = (typeof WA_PROVIDERS)[number];
export const waProviderSchema = zEnum(WA_PROVIDERS);
export const WA_PROVIDER_LABELS: Record<WaProvider, string> = {
  mock: 'Simülatör',
  cloud: 'Meta Cloud API',
  d360: '360dialog',
};

export const WA_ACCOUNT_STATUSES = ['connected', 'disconnected', 'error'] as const;
export type WaAccountStatus = (typeof WA_ACCOUNT_STATUSES)[number];
export const WA_ACCOUNT_STATUS_LABELS: Record<WaAccountStatus, string> = {
  connected: 'Bağlı',
  disconnected: 'Bağlı değil',
  error: 'Hata',
};

export const CONVERSATION_MODES = ['bot', 'human'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];
export const conversationModeSchema = zEnum(CONVERSATION_MODES);
export const CONVERSATION_MODE_LABELS: Record<ConversationMode, string> = {
  bot: 'Bot',
  human: 'Personel',
};

export const CONVERSATION_STATES = [
  'idle',
  'greeting',
  'menu_link_sent',
  'order_linking',
  'order_active',
  'ai_ordering',
  'awaiting_confirm',
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const MESSAGE_DIRECTIONS = ['in', 'out'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_KINDS = [
  'text',
  'interactive',
  'button_reply',
  'list_reply',
  'location',
  'image',
  'audio',
  'template',
  'system',
  'echo',
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_SENT_BY = ['bot', 'user', 'customer', 'business_phone'] as const;
export type MessageSentBy = (typeof MESSAGE_SENT_BY)[number];

// SMS ve bildirimler
export const SMS_PROVIDERS = ['mock', 'netgsm'] as const;
export type SmsProviderName = (typeof SMS_PROVIDERS)[number];

export const SMS_PURPOSES = ['otp', 'status', 'alarm'] as const;
export type SmsPurpose = (typeof SMS_PURPOSES)[number];

export const SMS_STATUSES = ['queued', 'sent', 'delivered', 'failed'] as const;
export type SmsStatus = (typeof SMS_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['platform_wa', 'sms', 'email', 'log'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_KINDS = [
  'new_order_alarm',
  'order_unacknowledged',
  'panel_offline',
  'wa_disconnected',
  'wa_payment_missing',
  'wa_quality',
  'review_negative',
  'cancel_requested',
  'sms_quota_warning',
  'sms_quota_exceeded',
  'trial_ending',
  'support_access_started',
  'courier_login',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const LEAD_STATUSES = ['new', 'contacted', 'demo_scheduled', 'demo_done', 'proposal', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Yeni',
  contacted: 'Arandı',
  demo_scheduled: 'Demo planlandı',
  demo_done: 'Demo yapıldı',
  proposal: 'Teklif',
  won: 'Kazanıldı',
  lost: 'Kaybedildi',
};

export const LEAD_SOURCES = ['demo_form', 'calculator', 'field', 'referral', 'inbound_call', 'other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Durum mesajı ayarı anahtarları (branches.status_messages; 00 §6.5 "hazırlanıyor" varsayılan kapalı). */
export const STATUS_MESSAGE_KEYS = ['received', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered'] as const;
export type StatusMessageKey = (typeof STATUS_MESSAGE_KEYS)[number];
