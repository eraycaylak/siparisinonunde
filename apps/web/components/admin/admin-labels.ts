// Admin arayüzü etiketleri: kanonik değerler @siparis/core/enums'tan; burada yalnız admin'e özgü metinler.

export {
  JOB_STATUS_LABELS,
  KILL_SWITCH_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  QUEUES,
  QUEUE_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUSPENSION_REASONS,
  SUSPENSION_REASON_LABELS,
  WA_ACCOUNT_STATUS_LABELS,
  WA_PROVIDER_LABELS,
} from '@siparis/core/enums';

export const LEAD_SOURCE_LABELS: Record<string, string> = {
  demo_form: 'Demo formu',
  calculator: 'Hesaplayıcı',
  field: 'Saha',
  referral: 'Referans',
  inbound_call: 'Gelen arama',
  other: 'Diğer',
};

export const HEALTH_LABELS = { red: 'Kırmızı', yellow: 'Sarı', green: 'Yeşil' } as const;

/** Kill-switch kapatılınca ne olur (05 A-13 etki özeti). */
export const KILL_SWITCH_IMPACT: Record<string, string> = {
  signup_open: 'Kayıt formu yeni işletme kabul etmez; mevcut işletmeler etkilenmez.',
  wa_onboarding: 'Yeni WhatsApp bağlantısı başlatılamaz; bağlı hesaplar çalışmaya devam eder. İşletmeler web siparişiyle sürer.',
  sms_fallback:
    'SMS yedeği tamamen durur: SMS doğrulama kodu ve kritik durum SMS’leri gitmez. Web siparişi yalnız WhatsApp ile doğrulanır; WhatsApp’ı bağlı olmayan işletmede müşteri “lütfen arayın” görür.',
  llm_parsing: 'Yapay zekâ ile yazılı sipariş okuma kapanır; müşteri menü linki akışına düşer (Faz 2).',
  campaigns_global: 'Tüm kampanya ve toplu mesaj gönderimleri durur (Faz 2).',
};

/** Denetim kaydı aksiyonlarının Türkçe karşılıkları (bilinmeyen kod olduğu gibi gösterilir). */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'admin.tenant_view': 'İşletme detayı görüntülendi',
  'admin.tenant_orders_view': 'İşletme siparişleri görüntülendi',
  'admin.tenant_update': 'İşletme güncellendi',
  'admin.subscription_update': 'Abonelik güncellendi',
  'admin.impersonation_start': 'Destek erişimi başladı',
  'admin.impersonation_end': 'Destek erişimi bitti',
  'admin.impersonation_request': 'Destek oturumunda istek',
  'admin.note_create': 'Not eklendi',
  'admin.note_update': 'Not düzenlendi',
  'admin.note_delete': 'Not silindi',
  'admin.job_retry': 'İş yeniden kuyruğa alındı',
  'admin.flag_update': 'Bayrak değiştirildi',
  'admin.lead_update': 'Lead güncellendi',
  'tenant.signup': 'İşletme kaydı',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
