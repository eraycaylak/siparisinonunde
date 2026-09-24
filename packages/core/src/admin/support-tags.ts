// Destek kaydı etiket sözlüğü (05 A-10; 00 §7 "Destek kayıtları"). Tek sözlük, İngilizce snake_case.
// admin_notes.tags bu değerlerden oluşur; web ve API aynı listeyi kullanır.

/** Temas kanalı (contact_channel). */
export const SUPPORT_CONTACT_CHANNELS = ['p1_line', 'whatsapp', 'panel_form', 'email', 'visit'] as const;

/** Konu etiketleri (tags). */
export const SUPPORT_TOPIC_TAGS = [
  'order_not_received',
  'sound_alarm',
  'device_network',
  'wa_connect',
  'meta_payment',
  'coexistence',
  'template_quality',
  'menu_pricing',
  'zone_fee',
  'courier',
  'printer',
  'status_message',
  'fake_order',
  'billing',
  'kvkk',
  'training',
  'feature_request',
  'bug',
] as const;

/** Kök neden (root_cause). */
export const SUPPORT_ROOT_CAUSES = [
  'product_bug',
  'usage_knowledge',
  'device_network',
  'meta',
  'third_party',
  'infrastructure',
  'tenant_config',
] as const;

/** Önlenebilir mi (preventable). */
export const SUPPORT_PREVENTABLE = ['yes_product', 'yes_training', 'no'] as const;

/** Öncelik (priority) — ayrı alan; Faz 1'de not etiketi olarak saklanır. */
export const SUPPORT_PRIORITIES = ['p1', 'p2', 'p3', 'p4'] as const;

/** admin_notes.tags için izinli tüm değerler (tekrarsız). */
export const SUPPORT_NOTE_TAGS = Array.from(
  new Set<string>([
    ...SUPPORT_TOPIC_TAGS,
    ...SUPPORT_CONTACT_CHANNELS,
    ...SUPPORT_ROOT_CAUSES,
    ...SUPPORT_PREVENTABLE,
    ...SUPPORT_PRIORITIES,
  ]),
) as readonly string[];

export type SupportNoteTag = string;

export function isSupportNoteTag(value: string): boolean {
  return SUPPORT_NOTE_TAGS.includes(value);
}

/** Arayüz grupları (etiket seçici). */
export const SUPPORT_TAG_GROUPS: ReadonlyArray<{ key: string; label: string; tags: readonly string[] }> = [
  { key: 'topic', label: 'Konu', tags: SUPPORT_TOPIC_TAGS },
  { key: 'contact_channel', label: 'Temas kanalı', tags: SUPPORT_CONTACT_CHANNELS },
  { key: 'root_cause', label: 'Kök neden', tags: SUPPORT_ROOT_CAUSES.filter((t) => !(SUPPORT_TOPIC_TAGS as readonly string[]).includes(t)) },
  { key: 'preventable', label: 'Önlenebilir mi', tags: SUPPORT_PREVENTABLE },
  { key: 'priority', label: 'Öncelik', tags: SUPPORT_PRIORITIES },
];

/** Türkçe etiketler (değer İngilizce kalır). */
export const SUPPORT_TAG_LABELS: Record<string, string> = {
  order_not_received: 'Sipariş düşmedi',
  sound_alarm: 'Ses / alarm',
  device_network: 'Cihaz / ağ',
  wa_connect: 'WhatsApp bağlantısı',
  meta_payment: 'Meta ödeme',
  coexistence: 'Coexistence',
  template_quality: 'Şablon / kalite',
  menu_pricing: 'Menü / fiyat',
  zone_fee: 'Bölge / ücret',
  courier: 'Kurye',
  printer: 'Yazıcı',
  status_message: 'Durum mesajı',
  fake_order: 'Sahte sipariş',
  billing: 'Fatura / ödeme',
  kvkk: 'KVKK',
  training: 'Eğitim',
  feature_request: 'Özellik isteği',
  bug: 'Hata',
  p1_line: 'P1 hattı',
  whatsapp: 'WhatsApp',
  panel_form: 'Panel formu',
  email: 'E-posta',
  visit: 'Ziyaret',
  product_bug: 'Ürün hatası',
  usage_knowledge: 'Kullanım bilgisi',
  meta: 'Meta',
  third_party: 'Üçüncü taraf',
  infrastructure: 'Altyapı',
  tenant_config: 'İşletme ayarı',
  yes_product: 'Önlenebilir (ürün)',
  yes_training: 'Önlenebilir (eğitim)',
  no: 'Önlenemez',
  p1: 'P1',
  p2: 'P2',
  p3: 'P3',
  p4: 'P4',
};
