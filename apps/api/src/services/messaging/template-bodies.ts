// Şablon kataloğu (02 §5.2, §5.3) — TEK KAYNAK: gövde metni, değişken sırası, örnek değerler ve butonlar.
// Kullanım: (1) gösterim (panel sohbeti, simülatör, platform uyarı kaydı: renderTemplateBody); (2) admin "WhatsApp kurulumu"
// şablonları Meta'ya bu tanımlardan gönderir (services/admin/wa-setup.ts). Gönderimde yalnız ad + parametreler gider;
// Meta'daki gövde buradaki metnin aynısıdır. Metin değişirse yeni sürüm açılır (_v2); eski ad Meta'da onaylı kalır.
// Meta kuralı: gövde değişkenle BAŞLAYAMAZ ve BİTEMEZ (sondaki nokta sayılmaz; 2388299). v1'de onaylandı/hazır/yolda
// "Sipariş no: {{3}}." gibi değişkenle bittiği için reddedildi, v2'de kapanış cümlesi var (testle denetlenir).
//
// Değişken sırası core'daki CUSTOMER_TEMPLATES / PLATFORM_TEMPLATES `params` dizisidir (gönderen kod da onu kullanır:
// order-notify.ts templateParams, platform-alert.ts). Butonlar gönderen kodla uyumludur:
//   - müşteri 'track' / 'review': dinamik URL butonu, tek değişken = takip token'ı (order-notify.ts templateFor → index 0)
//   - müşteri 'quick_reply': hızlı yanıt butonu (gönderimde parametre gerekmez)
//   - platform uyarıları: yalnız SABİT URL butonu (platform-alert.ts buton parametresi göndermez); kurye girişi dinamik
//     (tek kullanımlık token, index 0) — gönderimi henüz yok, eklenirse token buton parametresi olarak verilir.

import { CUSTOMER_TEMPLATES, PLATFORM_TEMPLATES, type CustomerTemplateName, type PlatformTemplateName } from '@siparis/core';

const CUSTOMER_TEMPLATE_BODIES: Record<CustomerTemplateName, string> = {
  siparis_alindi_v1: 'Merhaba {{1}}, {{2}} siparişinizi aldı. Sipariş no: {{3}}, tutar: {{4}}. İşletme onayladığında size buradan haber vereceğiz.',
  siparis_onaylandi_v2:
    'Siparişiniz onaylandı. {{1}} siparişinizi hazırlamaya başladı, tahmini süre {{2}} dakika. Sipariş no: {{3}}. Durum değiştiğinde size buradan haber vereceğiz.',
  siparis_hazir_v2: 'Siparişiniz hazır. {{1}} sizi bekliyor. Sipariş no: {{2}}. Adres: {{3}}. Teslim alırken sipariş numaranızı söylemeniz yeterli.',
  siparis_yolda_v2:
    'Siparişiniz yola çıktı. {{1}} kuryesi yaklaşık {{2}} dakika içinde adresinizde olacak. Sipariş no: {{3}}. Ödeme: {{4}}. Afiyet olsun!',
  siparis_teslim_v1:
    'Siparişiniz teslim edildi, afiyet olsun! {{1}} olarak bizi tercih ettiğiniz için teşekkür ederiz. Sipariş no: {{2}}. Deneyiminizi aşağıdaki bağlantıdan paylaşabilirsiniz.',
  siparis_reddedildi_v1: 'Üzgünüz, {{1}} siparişinizi şu anda alamıyor. Sebep: {{2}}. Sipariş no: {{3}}. Anlayışınız için teşekkür ederiz.',
  siparis_iptal_v1: 'Siparişiniz iptal edildi. Sipariş no: {{1}}. Sebep: {{2}}. Sorunuz varsa bu mesajı yanıtlayarak {{3}} ile görüşebilirsiniz.',
  siparis_iptal_yanitsiz_v1:
    'Üzgünüz, {{1}} numaralı siparişiniz {{2}} tarafından zamanında onaylanamadığı için iptal edildi. Siparişinizi telefonla vermek isterseniz {{3}} numarasını arayabilirsiniz. Sizi beklettiğimiz için özür dileriz.',
  yanit_bekliyor_v1: 'Merhaba {{1}}, {{2}} olarak mesajınızı gördük ve yanıtlamak istiyoruz. Devam etmek için aşağıdaki butona dokunmanız yeterli.',
};

const PLATFORM_TEMPLATE_BODIES: Record<PlatformTemplateName, string> = {
  isletme_yeni_siparis_v1:
    'Yeni sipariş onay bekliyor. İşletme: {{1}}, sipariş no: {{2}}, bekleme: {{3}} dakika, tutar: {{4}}. Müşteriniz beklemesin, panelden onaylayın ya da reddedin.',
  isletme_panel_cevrimdisi_v1:
    'Dikkat: {{1}} şu an sipariş alıyor ama {{2}} dakikadır sesi açık hiçbir panel ekranı yok. Yeni siparişleri kaçırmamak için paneli açıp "Siparişleri almaya başla" düğmesine dokunun.',
  kurye_giris_v1:
    'Merhaba, {{1}} sizi kurye olarak ekledi. Kurye ekranına girmek için aşağıdaki butona dokunun. Bağlantı tek kullanımlıktır, lütfen kimseyle paylaşmayın.',
  isletme_baglanti_sorunu_v1:
    'Dikkat: {{1}} WhatsApp bağlantısında sorun var ({{2}}). Çözülene kadar müşterilerinize mesaj gitmeyebilir. Panelde "Yeniden bağlan" adımını tamamlayın.',
  isletme_meta_odeme_v1:
    'Dikkat: {{1}} WhatsApp hesabında Meta ödeme yöntemi eksik veya geçersiz. Müşterilerinize giden mesajlar durdu. Meta hesabınıza geçerli bir kart ekleyin; adım adım rehber panelde.',
  isletme_kalite_uyari_v1:
    'Bilgilendirme: {{1}} WhatsApp numaranızın kalite durumu {{2}} oldu. Numaranızı korumak için izinsiz toplu mesajdan kaçının; ayrıntılar panelde.',
};

/** Meta'ya gönderilen örnek değerler (değişken anahtarı → örnek). Satır sonu içermez (02 §5.2). */
const PARAM_EXAMPLES: Record<string, string> = {
  musteriAdi: 'Ayşe',
  isletme: 'Bozok Pide Salonu',
  no: '#1042',
  tutar: '245,00 TL',
  dk: '25',
  subeAdres: 'Cumhuriyet Mah. Lise Cad. No: 5, Merkez',
  odeme: 'Kapıda nakit',
  sebep: 'işletme şu an kapalı',
  subeTel: '0354 212 34 56',
  beklemeDk: '3',
  sube: 'Bozok Pide Salonu',
  sorun: 'erişim anahtarı geçersiz',
  kalite: 'Orta',
};

/**
 * Şablon butonu. `path` APP_BASE_URL'ye eklenir. `dynamic`: URL'nin sonuna gönderimde verilen tek değişken ({{1}})
 * eklenir; `example` o değişkenin örneğidir.
 */
export type TemplateButtonDef =
  | { type: 'url'; text: string; path: string; dynamic: false }
  | { type: 'url'; text: string; path: string; dynamic: true; example: string }
  | { type: 'quick_reply'; text: string };

export interface TemplateDef {
  name: CustomerTemplateName | PlatformTemplateName;
  /** customer: müşteriye (sipariş durumu); platform: işletme sahibine/kuryeye */
  audience: 'customer' | 'platform';
  category: 'UTILITY';
  language: 'tr';
  body: string;
  /** Değişken anahtarları, {{1}}.. sırasıyla (core CUSTOMER_TEMPLATES / PLATFORM_TEMPLATES) */
  params: readonly string[];
  /** Değişken örnekleri, params sırasıyla */
  examples: string[];
  buttons: TemplateButtonDef[];
}

const EXAMPLE_TRACKING_TOKEN = 'AbCdEfGhIjKlMnOpQrStUv.0123456789abcdef';

function customerButtons(kind: (typeof CUSTOMER_TEMPLATES)[CustomerTemplateName]['button']): TemplateButtonDef[] {
  switch (kind) {
    case 'track':
      return [{ type: 'url', text: 'Siparişi takip et', path: '/t/', dynamic: true, example: EXAMPLE_TRACKING_TOKEN }];
    case 'review':
      return [{ type: 'url', text: 'Değerlendir', path: '/t/', dynamic: true, example: EXAMPLE_TRACKING_TOKEN }];
    case 'quick_reply':
      return [{ type: 'quick_reply', text: 'Devam et' }];
    default:
      return [];
  }
}

/** Platform şablonlarının butonları (02 §5.3). Gönderen kod parametre vermediği için sabit URL'dir (kurye girişi hariç). */
const PLATFORM_BUTTONS: Record<PlatformTemplateName, TemplateButtonDef[]> = {
  isletme_yeni_siparis_v1: [{ type: 'url', text: 'Siparişleri aç', path: '/panel/siparisler', dynamic: false }],
  isletme_panel_cevrimdisi_v1: [{ type: 'url', text: 'Paneli aç', path: '/panel', dynamic: false }],
  kurye_giris_v1: [{ type: 'url', text: 'Kurye ekranını aç', path: '/kurye/giris?t=', dynamic: true, example: 'ornek-tek-kullanimlik-belirtec' }],
  isletme_baglanti_sorunu_v1: [{ type: 'url', text: 'Yeniden bağlan', path: '/panel/ayarlar/whatsapp', dynamic: false }],
  isletme_meta_odeme_v1: [{ type: 'url', text: 'Rehberi aç', path: '/panel/ayarlar/whatsapp', dynamic: false }],
  isletme_kalite_uyari_v1: [{ type: 'url', text: 'Ayrıntılar', path: '/panel/ayarlar/whatsapp', dynamic: false }],
};

function examplesFor(params: readonly string[]): string[] {
  return params.map((p) => PARAM_EXAMPLES[p] ?? p);
}

/** Kodun kullandığı tüm şablonlar (müşteri + platform), Meta'ya gönderilecek biçimde. */
export const WA_TEMPLATE_CATALOG: readonly TemplateDef[] = [
  ...(Object.keys(CUSTOMER_TEMPLATE_BODIES) as CustomerTemplateName[]).map(
    (name): TemplateDef => ({
      name,
      audience: 'customer',
      category: 'UTILITY',
      language: 'tr',
      body: CUSTOMER_TEMPLATE_BODIES[name],
      params: CUSTOMER_TEMPLATES[name].params,
      examples: examplesFor(CUSTOMER_TEMPLATES[name].params),
      buttons: customerButtons(CUSTOMER_TEMPLATES[name].button),
    }),
  ),
  ...(Object.keys(PLATFORM_TEMPLATE_BODIES) as PlatformTemplateName[]).map(
    (name): TemplateDef => ({
      name,
      audience: 'platform',
      category: 'UTILITY',
      language: 'tr',
      body: PLATFORM_TEMPLATE_BODIES[name],
      params: PLATFORM_TEMPLATES[name].params,
      examples: examplesFor(PLATFORM_TEMPLATES[name].params),
      buttons: PLATFORM_BUTTONS[name],
    }),
  ),
];

/** Gövdedeki en büyük {{n}} (değişken sayısı). */
export function templateVariableCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

function fill(body: string, params: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, i: string) => params[Number(i) - 1] ?? '');
}

/** Şablonun okunur gövdesi; bilinmeyen şablonda ad + parametreler. */
export function renderTemplateBody(name: string, params: readonly string[]): string {
  const body = (CUSTOMER_TEMPLATE_BODIES as Record<string, string>)[name] ?? (PLATFORM_TEMPLATE_BODIES as Record<string, string>)[name];
  if (!body) return `[${name}] ${params.join(' · ')}`;
  return fill(body, params);
}
