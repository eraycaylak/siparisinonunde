// Şablon gövdeleri (02 §5.2, §5.3) — yalnız GÖSTERİM içindir (panel sohbeti, simülatör, platform uyarı kaydı).
// Asıl gövdeler Meta'da onaylıdır; gönderimde yalnız ad + parametreler gider.

const CUSTOMER_TEMPLATE_BODIES: Record<string, string> = {
  siparis_alindi_v1: 'Merhaba {{1}}, {{2}} siparişinizi aldı. Sipariş no: {{3}}, tutar: {{4}}. İşletme onayladığında size buradan haber vereceğiz.',
  siparis_onaylandi_v1: 'Siparişiniz onaylandı. {{1}} siparişinizi hazırlamaya başladı, tahmini süre {{2}} dakika. Sipariş no: {{3}}.',
  siparis_hazir_v1: 'Siparişiniz hazır. {{1}} sizi bekliyor. Sipariş no: {{2}}. Adres: {{3}}.',
  siparis_yolda_v1: 'Siparişiniz yola çıktı. {{1}} kuryesi yaklaşık {{2}} dakika içinde adresinizde olacak. Sipariş no: {{3}}. Ödeme: {{4}}.',
  siparis_teslim_v1:
    'Siparişiniz teslim edildi, afiyet olsun! {{1}} olarak bizi tercih ettiğiniz için teşekkür ederiz. Sipariş no: {{2}}. Deneyiminizi aşağıdaki bağlantıdan paylaşabilirsiniz.',
  siparis_reddedildi_v1: 'Üzgünüz, {{1}} siparişinizi şu anda alamıyor. Sebep: {{2}}. Sipariş no: {{3}}. Anlayışınız için teşekkür ederiz.',
  siparis_iptal_v1: 'Siparişiniz iptal edildi. Sipariş no: {{1}}. Sebep: {{2}}. Sorunuz varsa bu mesajı yanıtlayarak {{3}} ile görüşebilirsiniz.',
  siparis_iptal_yanitsiz_v1:
    'Üzgünüz, {{1}} numaralı siparişiniz {{2}} tarafından zamanında onaylanamadığı için iptal edildi. Siparişinizi telefonla vermek isterseniz {{3}} numarasını arayabilirsiniz. Sizi beklettiğimiz için özür dileriz.',
  yanit_bekliyor_v1: 'Merhaba {{1}}, {{2}} olarak mesajınızı gördük ve yanıtlamak istiyoruz. Devam etmek için aşağıdaki butona dokunmanız yeterli.',
};

const PLATFORM_TEMPLATE_BODIES: Record<string, string> = {
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

function fill(body: string, params: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, i: string) => params[Number(i) - 1] ?? '');
}

/** Şablonun okunur gövdesi; bilinmeyen şablonda ad + parametreler. */
export function renderTemplateBody(name: string, params: readonly string[]): string {
  const body = CUSTOMER_TEMPLATE_BODIES[name] ?? PLATFORM_TEMPLATE_BODIES[name];
  if (!body) return `[${name}] ${params.join(' · ')}`;
  return fill(body, params);
}
