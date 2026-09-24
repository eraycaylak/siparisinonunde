# 01 — WhatsApp Business Platform (Cloud API): Teknik, Maliyet ve Politika Temeli

**Proje:** siparisinonunde (Siparişin Önünde): WhatsApp üzerinden komisyonsuz sipariş SaaS'ı
**Rapor tarihi:** 24 Eylül 2026
**Kapsam:** Erişim modelleri, multi-tenant onboarding (Embedded Signup), Coexistence, fiyatlandırma (1 Ekim 2026 değişikliği dahil), sipariş için mesaj özellikleri, politikalar, kullanıcı adları/BSUID, resmi olmayan çözümler, webhook/rate-limit/hata kodları, önerilen mimari ve onboarding akışı.

---

## Metodoloji ve güvenilirlik notu (önce bunu okuyun)

- Bu oturumda `developers.facebook.com`, `business.whatsapp.com` ve BSP sitelerinin çoğu **ağ proxy'si tarafından doğrudan açılamadı**. Meta'nın resmi dokümanlarındaki bilgiler, arama motorunun bu sayfalardan çıkardığı özetler üzerinden okundu. Mümkün olan her yerde BSP dokümanları ve GitHub'daki açık kaynak kodla (ör. Chatwoot ve whatsapp-api-js tipleri) çapraz kontrol yapıldı.
- Etiketler:
  - **[R]** Meta/WhatsApp resmi sayfası (arama özeti üzerinden okundu, URL verildi)
  - **[3P]** Üçüncü taraf: BSP dokümanı, blog, haber
  - **[K]** GitHub'daki açık kaynak kod veya dokümanda görüldü (uygulamada gerçekten kullanılan alan/endpoint adları)
  - **[?]** DOĞRULANAMADI / tahmin / çıkarım
- **Türkiye fiyatları** Meta'nın rate card CSV'sinden doğrudan okunamadı. Üç bağımsız üçüncü taraf kaynakla üçgenlendi. Canlıya çıkmadan önce Meta rate card'ından bizzat teyit edilmeli.
- Kur: TCMB verisine göre 24.09.2026'da USD/TRY ≈ **48,4** [3P, https://www.tcmb.gov.tr/kurlar/today.xml]. TL karşılıkları bu kurla hesaplandı ve yaklaşıktır.

---

## 0. Yönetici özeti (TL;DR)

1. **Tek geçerli yol resmi Cloud API.** On-Premises API 23 Ekim 2025'te tamamen sona erdi [R]. Resmi olmayan kütüphaneler (Baileys, whatsapp-web.js, Evolution API, WPPConnect, Venom) WhatsApp ToS'u ihlal eder ve numara kapatılma riski taşır. Esnafın tek numarasını riske atan bir ürün satılamaz.
2. **Önerilen model: doğrudan Meta "Tech Provider" olmak + Embedded Signup + Coexistence.** Her işletmenin kendi business portföyü, WABA'sı ve numarası olur. Meta mesaj ücretini doğrudan işletmenin kartından çeker, biz yalnızca sabit abonelik alırız. Bu sayede aracı markup'ı olmaz. Twilio gibi mesaj başı ücret alan BSP'ler Türkiye'de Meta ücretinin yaklaşık 10 katı ek maliyet çıkarır.
3. **Coexistence kritik ve Türkiye'de artık destekleniyor.** Esnaf mevcut WhatsApp Business uygulaması numarasını kaybetmeden API'ye bağlanabilir. Telefondan yazmaya devam eder, 6 aya kadar sohbet geçmişi ve kişiler senkronlanır. Türkiye başta desteklenmeyen ülkeler listesindeydi, 2025 sonu itibarıyla açıldı [3P, birden fazla kaynak]. Kısıtlar: 20 mesaj/sn, uygulama en az 14 günde bir açılmalı, API tarafında grup yok, kaybolan mesaj ve tek seferlik görüntüleme kapanır.
4. **Fiyat, 1 Ekim 2026'da (bir hafta sonra) değişiyor.**
   - Pencere içi serbest mesajlar ("service") ve pencere içi utility şablonları artık **ücretli**.
   - Her işletme numarasına ayda **1.000 ücretsiz service mesajı** tanınıyor.
   - **30 Eylül 2026'ya kadar WABA'da ödeme yöntemi yoksa service mesajları teslim edilmeyecek** [R].
5. **Türkiye dünyanın en ucuz pazarlarından biri** (1 Ekim 2026 rate card'ı, [3P] üçgenleme):
   - marketing ≈ **$0,0109** (~0,53 TL)
   - utility, authentication ve service ≈ **$0,0009** (~0,04 TL)
   - Tipik bir sipariş 4-6 işletme mesajı içerir, bu da yaklaşık **0,2-0,3 TL** eder. Aylık 1.000 ücretsiz mesaj sayesinde küçük bir işletmenin WhatsApp faturası birkaç on TL düzeyinde kalır. Asıl maliyet kalemi **pazarlama kampanyalarıdır**.
6. **Ödeme ve menü akışı:** WhatsApp Pay Türkiye'de yok. Ödeme API'si yalnızca Brezilya ve Hindistan gibi pazarlarda var [R]. Bu yüzden online ödeme için CTA URL butonuyla iyzico/PayTR gibi bir ödeme linki gönderilmeli. Menü ve sepet için WhatsApp Catalog yerine **kendi web storefront'umuz** önerilir. Catalog ekstra/seçenek (modifier) desteklemez, restoran menüsüne uymaz.
7. **AI ile sipariş anlama politikaya uygun.** Ocak 2026 yasağı, AI'ın "birincil" ürün olduğu genel amaçlı asistanları hedefliyor. İşletmeye özel sipariş botu "yan/ancillary" işlev sayılıyor [R/3P]. Yine de botun konu dışına çıkmaması ve insana devir yolu bulunması şart.
8. **Kullanıcı adları ve BSUID, müşteri kimlik modelini değiştiriyor.** Kullanıcı adları Haziran-Eylül 2026'da dünya genelinde açılıyor. Kullanıcı adı açan müşterinin telefonu webhook'ta gelmeyebilir. Müşteri kimliği telefon değil, **tenant başına BSUID** olmalı. Telefon opsiyonel alan olarak tutulmalı ve kurye için gerektiğinde "iletişim bilgisi iste" butonu ya da sipariş formundan alınmalı.
9. **Takvimdeki ilk kritik yol Meta App Review ve Business Verification.** Doğrulama tamamlanmadan Tech Provider olarak 7 günde en fazla 10 yeni işletme bağlanabilir, sonrasında 200/hafta [R]. Bu süreç hemen başlatılmalı.
10. **İşletme onboarding'inde en büyük sürtünme, Meta'ya kredi kartı eklemek.** Faturalama USD üzerinden olur, çünkü TRY Meta'nın fatura para birimleri arasında görünmüyor [R liste, ?]. Orta vadede bir Türk Solution Partner ile "Multi-Partner Solution" kurup kredi hattı paylaşımı (TL fatura ve paket içi mesaj) değerlendirilmeli.

---

## 1. Erişim modelleri

### 1.1 Cloud API ve On-Premises API

| Konu | Durum | Kaynak |
|---|---|---|
| On-Premises API | Son desteklenen istemci sürümünün süresi **23 Ekim 2025**'te doldu. On-Prem ile artık mesaj gönderilemiyor. Ocak 2024'teki v2.53'ten sonra yeni özellikler yalnızca Cloud API'ye geliyor ve yeni numaralar yalnızca Cloud API'ye kaydediliyor. | [R] https://developers.facebook.com/docs/whatsapp/on-premises/sunset |
| Cloud API (Meta hosted) | Numara başına varsayılan **80 mesaj/sn**, otomatik yükseltmeyle **1.000 mesaj/sn**. Meta'nın beyanı: %99,9 uptime, p99 < 5 sn gecikme. | [R] aynı sayfa ve [3P] https://www.sent.dm/resources/whatsapp-cloud-api |
| Türkiye | **15 Mayıs 2024**'ten itibaren Cloud API, Türk numaralı kullanıcılarla konuşma başlatabiliyor ve onlardan mesaj alabiliyor. Öncesinde Türkiye'ye Cloud API ile mesaj gönderimi kısıtlıydı. | [3P] https://help.zoho.com/portal/en/community/topic/zoho-desks-instant-messaging-update-improve-customer-communications-with-whatsapp-in-turkiye, https://gallabox.com/blog/whatsapp-cloud-api-now-available-in-turkey |

**Sonuç:** Mimari tamamen Cloud API üzerine kurulmalı. On-Prem seçenek değildir.

### 1.2 Ortaklık tipleri: BSP / Solution Partner, Tech Provider, Tech Partner

| Tip | Kredi hattı | Faturalamayı kim yapar | Not | Kaynak |
|---|---|---|---|---|
| **Solution Partner** (eski adıyla BSP) | Var | Partner, müşteriye kendi faturasını keser; markup genellikle %5-20 | Müşteri Meta'ya kart girmek zorunda kalmaz. Meta'dan doğrudan destek alır. | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview, [3P] https://ominiflow.com/blog/tech-provider-vs-solution-partner |
| **Tech Provider** | Yok | **Meta, işletmeden doğrudan ücret alır.** Onboarding'den sonra işletme kendi ödeme yöntemini eklemek zorunda. | Tech Provider hizmeti kendisi verebilir ya da bir Solution Partner ile ortak çalışabilir. | [R] aynı sayfa |
| **Tech Partner** | Yok | Tech Provider ile aynı | Ek şartları karşılamış Tech Provider. Meta Business Partner rozeti ve hızlandırıcı programlara erişim sağlar. | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/upgrade-to-tech-partner/ |
| **Multi-Partner Solution (MPS)** | Solution Partner'ın hattı paylaşılır | Solution Partner | Tech Provider ile Solution Partner, müşteri varlıklarını ortak yönetir. Örneğin Solution Partner kendi kredi hattını ortak çözümle onboard edilen müşterilere açar. | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/ |

### 1.3 Tech Provider olma gereksinimleri

Kaynaklar: [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers, https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review, https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider

1. **Meta Business Portfolio ve Business Verification.** İşletme adı, adres, telefon, e-posta ve web sitesi verilir. Meta'nın bulamadığı durumlarda belge yüklenir. Türkiye'de pratikte vergi levhası, ticaret sicil ya da faaliyet belgesi ve alan adlı e-posta gerekir [?].
2. **Meta App ("Business" tipi)** ve WhatsApp ürünü eklenir. Uygulama ikonu, gizlilik politikası URL'si ve kategori girilir.
3. **App Review ile Advanced Access** alınması gereken izinler:
   - `whatsapp_business_messaging`: müşteri adına mesaj göndermek için
   - `whatsapp_business_management`: müşterinin WABA'sını, şablonlarını ve numarasını yönetmek için
   - İnceleme için **video kanıtı** gerekir: (a) uygulamamızdan oluşturulup gönderilen mesajın WhatsApp istemcisinde alınması, (b) uygulamamızdan şablon oluşturulması [R].
   - `business_management`: yalnızca müşterinin business portföyü üzerinde işlem gerekiyorsa. Bizim akışta zorunlu olup olmadığı **[?]**. App Review başvurusunda gereklilik teyit edilmeli.
4. **Webhook yapılandırması** (uygulama seviyesinde callback URL ve verify token).
5. **Onboarding kotası** [R]:
   - Varsayılan: **7 günlük kayan pencerede en fazla 10 yeni işletme**.
   - Business Verification ve App Review tamamlanınca: **200 / 7 gün**.
   - Kaynaklardan biri eşik için "Access Verification"ı da sayıyor, başka bir resmi özet ise Access Verification'ın artık gerekmediğini söylüyor. Bu çelişki [?] olarak bırakıldı.
   - 200'ün üzeri için Meta Business Partner başvurusu gerekir.
6. **Geliştirme modu kısıtı:** Uygulama "Live" moda geçmeden Embedded Signup'ı yalnızca uygulama rolü olan veya test kullanıcıları tamamlayabilir [K] https://github.com/vobase/vobase (embedded-signup referans dokümanı). Pilot işletmeler için bile App Review takvimi kritik.

### 1.4 BSP karşılaştırması (bizim açımızdan)

| Seçenek | Ücret modeli (doğrulanabilen) | Artı | Eksi |
|---|---|---|---|
| **Doğrudan Tech Provider** | Meta ücreti, işletmenin kartından. Aracı yok. | Sıfır markup, tam kontrol, Coexistence ve yeni özelliklere ilk erişim | App Review ve doğrulama süreci; işletmenin Meta'ya kart eklemesi gerekir |
| **Twilio** | Meta ücretine ek olarak gelen ve giden **her mesaj için $0,005** [3P] https://www.twilio.com/en-us/whatsapp/pricing, https://landbot.io/blog/twilio-whatsapp-pricing | Olgun SDK, global destek | Türkiye'de utility ≈ $0,0009 iken Twilio'nun ek ücreti bunun ~5,5 katı. Sipariş başı maliyeti ~10 kat artırır. **Bizim model için uygun değil.** |
| **360dialog** | Numara başına aylık lisans (müşteri planları €49 / €99 / €249), Meta ücretine markup yok [3P] https://docs.360dialog.com/partner/get-started/pricing-and-billing, https://chatmitra.com/chatmitra-vs-360dialog/ | Markup yok, partner API'si iyi, Coexistence destekli | €49/ay/numara, küçük esnaf aboneliğinin büyük kısmını yer. Partner (ISV) fiyatı farklı olabilir **[?]**. |
| **Gupshup / Infobip / Bird / Vonage** | Kurumsal fiyatlandırma, genellikle mesaj başı ek ücret veya aylık taahhüt **[?]** | Kurumsal SLA | KOBİ SaaS birim ekonomisine uymaz. Bird'ün tarihsel olarak "Türkiye'ye mesaj kısıtı" dokümanı vardı: https://docs.bird.com/connectivity-platform/messaging/whatsapp-messaging-restriction-toward-turkey |
| **Türk BSP'ler** (VatanSMS "Meta Teknik Partneri", OctoChat, Invekto, Yanıtly vb.) | TL fatura, yerel destek. Fiyatları doğrulanamadı **[?]**. https://www.vatansms.com/whatsapp/business-api/ | TL fatura, Türkçe destek, Multi-Partner Solution ile kredi hattı paylaşımı adayı | Rakip de olabilirler; kredi hattı paylaşımına ve fiyata ayrıca bakılmalı |

**Öneri:** MVP'de **doğrudan Tech Provider** olunmalı. İkinci fazda, işletmelerin Meta'ya kart girme sürtünmesini kaldırmak ve TL fatura kesebilmek için bir Solution Partner ile **Multi-Partner Solution** değerlendirilmeli.

---

## 2. Multi-tenant onboarding: Embedded Signup (ES)

### 2.1 Mantık

Her işletme bizim sitemizdeki "WhatsApp'ı Bağla" butonundan Meta'nın açılır penceresini (Embedded Signup) kullanır. Bu akışta:

- kendi Meta business portföyünü seçer veya oluşturur,
- WABA oluşturur,
- numarasını ekler ve doğrular, ya da Coexistence ile mevcut WhatsApp Business uygulaması numarasını bağlar,
- uygulamamıza izin verir.

Sonuçta varlıklar (WABA ve numara) **işletmenin** olur. Biz yalnızca yetkili partner uygulamayız [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/.

"Hosted Embedded Signup" ile kodu kendimiz barındırmadan daha basit bir kurulum da mümkün [R, aynı sayfa].

### 2.2 Adım adım teknik akış

(Endpoint ve alan adları [K] açık kaynak uygulamalardan teyit edilmiştir: https://github.com/chatwoot/chatwoot, https://github.com/vobase/vobase, https://github.com/matiasbattocchia/open-bsp-ui)

1. **Hazırlık (bir kez)**
   - Facebook Login for Business altında bir "WhatsApp Embedded Signup" konfigürasyonu oluşturulur ve `config_id` alınır.
   - Client OAuth ayarlarında şunlar açılır: JS SDK login, HTTPS zorunluluğu, Allowed Domains ve Valid OAuth Redirect URIs.
2. **Frontend.** Facebook JS SDK yüklenir. `FB.login()` çağrısından **önce** `window.addEventListener('message', ...)` ile `type: "WA_EMBEDDED_SIGNUP"` olayları dinlenmeye başlanır.
   ```js
   FB.login(cb, {
     config_id: '<CONFIG_ID>',
     response_type: 'code',
     override_default_response_type: true,
     extras: {
       setup: {},
       featureType: 'whatsapp_business_app_onboarding', // Coexistence seçeneğini göstermek için; yeni numara akışında atlanabilir
       sessionInfoVersion: '3'
     }
   });
   ```
3. **Oturum olayları.** Beklenen olaylar [K]:
   - `FINISH`: `waba_id`, `phone_number_id` ve `business_id` döner. Yeni numara ile Cloud API akışı.
   - `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`: Coexistence ile bağlanma tamamlandı.
   - `FINISH_ONLY_WABA`: numarasız, yalnız WABA oluşturuldu.
   - `CANCEL`: `current_step` alanı ile gelir. v4'te hata içeren CANCEL, `error_message` taşır.
   - `ERROR`: v3'te `error` olarak yazılıyordu.
4. **Kod takası (sunucuda, hemen).** `response.authResponse.code` backend'e gönderilir ve şu çağrıyla takas edilir:
   ```
   GET/POST https://graph.facebook.com/<vXX.X>/oauth/access_token?client_id=<APP_ID>&client_secret=<APP_SECRET>&code=<CODE>
   ```
   Kodun ömrü çok kısa. Açık kaynak referansta "~60 saniye" deniyor [K, ?]. Takas hemen yapılmalı. Sonuç, müşteriye özel bir **Business Integration System User (BISU) access token**'dır [3P/K].
5. **Webhook aboneliği:** `POST /<WABA_ID>/subscribed_apps` (BISU token ile). Bu yapılmazsa numaranın webhook'ları gelmez [K].
6. **Numara kaydı (yalnız yeni numara / Cloud API modunda):**
   ```
   POST /<PHONE_NUMBER_ID>/register
   { "messaging_product": "whatsapp", "pin": "<6 haneli>" }
   ```
   - 6 haneli iki adımlı doğrulama PIN'i zorunludur. PIN'i şifreli saklayın.
   - İki adımlı doğrulamayı kapatan bir endpoint yok.
   - Kayıt çağrısı numara başına **72 saatte en fazla 10 kez** yapılabilir [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration.
   - **Coexistence'ta `/register` çağrılmaz.** Meta bu adımı atlamayı söylüyor [K] https://github.com/viniciusandradde/whatsapp-langchain-full (docs/WHATSAPP_COEXISTENCE.md).
7. **Coexistence senkronu (yalnız Coexistence).** Bağlantıdan sonraki **24 saat içinde** şu çağrılar yapılır:
   ```
   POST /<PHONE_NUMBER_ID>/smb_app_data  { "messaging_product":"whatsapp", "sync_type":"smb_app_state_sync" }   // kişiler
   POST /<PHONE_NUMBER_ID>/smb_app_data  { "messaging_product":"whatsapp", "sync_type":"history" }              // geçmiş
   ```
   24 saat kaçırılırsa bağlantıyı kesip akışı tekrarlamak gerekir [K] https://github.com/jusiho/crm-prime (docs/whatsapp-coexistencia.md).
8. **Görünen ad (display name).**
   - Kayıtta görünen ad verilir.
   - Business verification tamamlanınca tüm numaralar için görünen ad incelemesi başlar.
   - Sonraki ad değişiklikleri onaya tabidir.
   - Durumlar: `AVAILABLE_WITHOUT_REVIEW`, `PENDING_REVIEW`, `DECLINED` [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names
9. **Ödeme yöntemi (Tech Provider modelinde zorunlu).** İşletme, WABA'sına Meta Billing Hub'dan kart ekler [R]. **1 Ekim 2026'dan sonra ödeme yöntemi olmayan WABA'ların service mesajları teslim edilmez** [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
10. **Varsayılan şablonların oluşturulması.** Sistem otomatik olarak Türkçe `tr` utility şablonları oluşturur: `siparis_alindi`, `siparis_yolda`, `siparis_teslim`, `siparis_iptal`. Marketing şablonları opsiyoneldir. Utility şablonları çoğunlukla dakikalar içinde onaylanır, marketing 24 saate kadar sürebilir [3P].
11. **Sağlık kontrolü.** Test mesajı gönderilir. Webhook'un geldiği, kalite puanı ve messaging limit okunur.

### 2.3 Token stratejisi

- **Seçenek A. Müşteri başına BISU token (ES'den).** Şifreli saklanır (KMS / envelope encryption). Token ömrü konfigürasyona bağlı. Konfigürasyon şablon adlarında "60 ... expiration token" ifadesi geçiyor [K, ?]. Süresi dolan veya iptal edilen token'lar için panelde "yeniden bağlan" akışı olmalı.
- **Seçenek B. Kendi business portföyümüzdeki System User'ın kalıcı token'ı.** ES ile müşteri WABA'sı partner olarak bizimle paylaşılır. System User'ımıza bu WABA atanabilir ve tek bir kalıcı token ile tüm tenant'lar yönetilebilir. Pek çok BSP'nin kullandığı yaygın desen budur [?]. Resmi dokümandaki güncel öneri teyit edilmeli.
- **Öneri:** MVP'de A (tenant başına token, izolasyon daha iyi). Ölçekte A ile B'yi birleştiren hibrit bir yapı değerlendirilmeli.

### 2.4 Tek webhook, çok tenant

- Tüm tenant'ların olayları, uygulama seviyesinde tanımlı **tek callback URL**'e gelir.
- Yönlendirme `entry[].id` (WABA ID) ve `value.metadata.phone_number_id` ile yapılır: `wa_phone_numbers(phone_number_id) → tenant_id`.
- Abone olunması önerilen alanlar:
  - `messages`
  - `message_template_status_update`
  - `message_template_quality_update`
  - `template_category_update`
  - `phone_number_quality_update`
  - `phone_number_name_update`
  - `account_update`
  - `business_capability_update`
  - Coexistence için: `history`, `smb_app_state_sync`, `smb_message_echoes` [3P] https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence/coexistence-webhooks
- Alan adlarının tam listesi App Dashboard'dan teyit edilmeli [?].

---

## 3. Coexistence: WhatsApp Business uygulaması ve Cloud API aynı numarada

### 3.1 Nedir, Türkiye'de durum ne?

- İşletme, mevcut **WhatsApp Business uygulaması** numarasını Embedded Signup ile Cloud API'ye bağlar. Bağlantıdan sonra hem telefondan hem API'den mesajlaşabilir, mesaj geçmişi iki tarafta senkron kalır [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- Meta özelliği ~Mayıs 2025'te duyurdu [3P].
- **Türkiye (+90)** başlangıçta desteklenmeyen ülkeler listesindeydi (Avustralya, Hindistan, Japonya, Nijerya, Filipinler, Rusya, Güney Kore, Güney Afrika, Türkiye, AB/AEA/BK). Kaynaklara göre Türkiye 2025 Ekim-Kasım'da açıldı, Nijerya ve Güney Afrika da Nisan 2026'da eklendi. Böylece "tüm ülkeler destekleniyor" durumuna gelindi [3P]:
  - https://chakrahq.com/article/whatsapp-coexistence-live-eu-uk-europe-whatsapp-business-for-api-live/
  - https://github.com/gallabox/docs/pull/20 (Meta dokümanına göre düzeltme PR'ı. Türkiye'yi açıkça destekli sayıyor.)
  - https://github.com/orgs/chatwoot/discussions/11216 (Mart 2026 itibarıyla yalnız Nijerya ve Güney Afrika'nın desteklenmediğini belirtiyor)
- Hâlâ bazı eski blog yazıları "+90 desteklenmiyor" diyor. **Eylül 2026 itibarıyla Türkiye'nin desteklendiği kuvvetle muhtemel. Pilotta bir +90 numarayla bizzat test edilerek teyit edilmeli [?].**

### 3.2 Kısıtlar

| Konu | Durum | Kaynak |
|---|---|---|
| Uygulama sürümü | WhatsApp Business app ≥ **2.24.17** | [3P] |
| Throughput | Coexistence numarası **20 mesaj/sn** ile sınırlı (normalde 80) | [3P] https://blog.campaignhq.co/whatsapp-coexistence-pros-cons-20-mps-scaling |
| Aktiflik | Telefondaki uygulama **~14 gün** açılmazsa bağlantı kopabilir. Companion cihazlar ~30 gün hareketsizlikte düşer. | [3P] https://github.com/gallabox/docs/pull/20 |
| Geçmiş senkronu | Kullanıcı onay verirse **son 6 ay (180 gün)** 1:1 sohbet geçmişi ve kişiler aktarılır. Paylaşım tercihi sonradan değiştirilemez (ayrılıp yeniden bağlanmak gerekir). 14 günden eski medya için yalnız metin kaydı gelir. | [3P] |
| Kapanan özellikler | Kaybolan mesajlar, tek seferlik (view once) medya ve canlı konum paylaşımı kapanır. API tarafında **grup mesajı yok** (gruplar telefonda görünmeye devam eder). Groups API iş uygulaması numaralarında kullanılamaz. | [3P] https://docs.360dialog.com/docs/resources/phone-numbers/coexistence, [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/groups |
| Companion istemciler | WhatsApp for Windows ve WearOS desteklenmiyor. Bunlardan gelen mesajlar webhook üretmeyebilir. | [3P] |
| Durum senkronu | Uygulamadan gönderilen mesajların delivered/read durumları gerçek zamanlı senkronlanmaz | [3P] https://github.com/gallabox/docs/pull/20 |
| Mavi tik (OBA) | Coexistence hesaplarında desteklenmez | [3P] |
| Ücret | **Uygulamadan gönderilen mesajlar ücretsiz.** API'den gönderilenler Meta fiyatına tabi. | [3P] |
| Bağlantıyı koparanlar | Numaranın kişisel WhatsApp'a kaydedilmesi, hesap değişikliği, politika yaptırımı vb. Koparma sonrası bazı kaynaklar 1-2 aylık bekleme süresinden söz ediyor. | [3P, ?] |

### 3.3 Teknik

- ES konfigürasyonunda `featureType: 'whatsapp_business_app_onboarding'` kullanılır. Bitiş olayı `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`'dir [K].
- Webhook'lar [3P/K]:
  - `history`: geçmiş mesajlar
  - `smb_app_state_sync`: kişi ekleme ve değişiklikleri
  - `smb_message_echoes`: işletmenin telefondan gönderdiği yeni mesajlar
- Echo webhook'u sayesinde panel, esnafın telefondan yazdığı mesajları da gösterebilir.
- `/register` çağrılmaz. `smb_app_data` senkron çağrıları 24 saat içinde yapılır.

### 3.4 Esnaf için anlamı

- "Numaran, sohbetlerin ve kişilerin yerinde kalır. Telefondan yazmaya devam edersin. Siparişler aynı anda panele de düşer."
- **Kişisel (normal) WhatsApp kullanan esnaf** önce aynı numarayla WhatsApp Business uygulamasına geçmeli. WhatsApp'ın normal hesaptan Business uygulamasına sohbetleri taşıyarak geçişe izin verdiği biliniyor, ancak bu oturumda resmi SSS'den teyit edilemedi [?]. Onboarding sihirbazında bu adım için bir rehber ekranı olmalı.
- Riskler:
  - 14 gün kuralı: panelde "uygulamayı son açılış" uyarısı gösterilmeli. Bu bilgi doğrudan ölçülemiyorsa, bağlantı düşmesi webhook veya hata ile algılanmalı [?].
  - 20 mesaj/sn: bir restoran için fazlasıyla yeterli.

---

## 4. Fiyatlandırma

### 4.1 Zaman çizelgesi

| Tarih | Değişiklik | Kaynak |
|---|---|---|
| 1 Kas 2024 | Service (pencere içi serbest) mesajlar ücretsiz hale geldi | [3P] https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/ |
| 1 Tem 2025 | Konuşma bazlı fiyatlandırmadan **mesaj başı** fiyatlandırmaya geçildi. Ücret yalnızca **teslim edilen template** mesajlarından alınıyor. **Pencere içi utility template ücretsiz.** Utility ve authentication için **hacim kademeleri** getirildi. | [R] https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/ |
| 7 Eki 2025 | Messaging limit'ler business portföyü seviyesine taşındı | [3P] https://support.wati.io/en/articles/12458014-messaging-limit-updates-effective-oct-7-2025 |
| 1 Nis 2026 | Türkiye'de utility ve authentication fiyatları düştü (yaklaşık $0,0053 [3P]). 8 yeni fatura para birimi eklendi (ARS, CLP, COP, MYR, PEN, SAR, SGD, AED). TRY listede yok. | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing, [3P] https://github.com/gondar00/docs (guides/resources.mdx) |
| 1 Tem 2026 | **Türkiye utility fiyatı %84 düştü** ve ≈ **$0,0009** oldu | [3P] https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-july-1-2026 |
| 1 Ağu 2026 | Meta Business Agent (Meta'nın kendi AI ajanı) ücretlendirmesi başladı: 1M token için $2, mesaj başına yaklaşık 4-5 cent | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages |
| 30 Eyl 2026 | **Ödeme yöntemi için son gün.** Ödeme yöntemi olmayan WABA'ların service mesajları 1 Ekim'den itibaren teslim edilmez. | [R] aynı sayfa |
| **1 Eki 2026** | **Service mesajları ücretli oldu** (pazar bazında utility ve authentication ile aynı fiyat, hacim kademesi yok). **Pencere içi utility template'ler de ücretli.** **Numara başına ayda 1.000 ücretsiz service mesajı** (1:1 ve grup mesajları aynı kotayı paylaşır, devretmez, her ay sıfırlanır). | [R] aynı sayfa. [3P] https://www.courier.com/blog/whatsapp-pricing-changes-october-2026, https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/ |

**Not:** Courier'e göre 1 Ekim öncesinde pencere içi utility mesajların status webhook'unda `type: free_customer_service`, sonrasında `type: regular` görünür [3P]. Maliyet takibi bu `pricing` nesnesinden yapılmalı.

### 4.2 Kategoriler ve pencereler

| Kategori | Ne? | 1 Ekim 2026 sonrası ücret |
|---|---|---|
| **Marketing** (template) | Kampanya, indirim, "sizi özledik" vb. | Her zaman ücretli. Hacim kademesi yok. |
| **Utility** (template) | Sipariş onayı, kargo/kurye durumu, fatura | Ücretli (pencere içinde de). Hacim kademesi var. |
| **Authentication** (template) | OTP | Ücretli. Hacim kademesi var. |
| **Service** (template olmayan, serbest mesaj) | Müşteri yazdıktan sonra 24 saat içinde gönderilen her serbest mesaj (metin, görsel, buton, liste) | **Numara başına aylık ilk 1.000 ücretsiz**, sonrası utility fiyatından. Hacim kademesi yok. |
| **Free Entry Point (FEP)** | Click-to-WhatsApp reklamı veya Facebook sayfası CTA'sından gelen kullanıcıya işletme **24 saat içinde** yanıt verirse 72 saatlik pencere açılır | 72 saat boyunca **template dahil tüm mesajlar ücretsiz** [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing |

- **Customer Service Window (CSW):** Kullanıcının her mesajıyla açılan ya da sıfırlanan 24 saatlik penceredir. Pencere dışında **yalnızca template** gönderilebilir [R].
- Meta **gelen mesajlar için ücret almaz**. BSP'ler alabilir (ör. Twilio).

### 4.3 Türkiye fiyatları (1 Ekim 2026 rate card'ı, üçgenlenmiş)

| Kategori | USD / mesaj | ≈ TL / mesaj (48,4) | Kaynak ve güven |
|---|---|---|---|
| Marketing | **$0,0109** | ~0,53 TL | [3P] ProPakistani'nin 15.09.2026 tarihli rate card tablosu (https://propakistani.pk/2026/09/15/meta-charges-pakistan-11x-more-than-india-for-whatsapp-business-messages/, aktaran: https://github.com/shamyl/shamyl.github.io). Gallabox'ın ~%15 markup'lı $0,0125'i ile tutarlı (https://github.com/gallabox/docs/blob/main/pricing-and-billing/whatsapp-pricing/rate-card.mdx). |
| Utility | **≈ $0,0009** | ~0,044 TL | [3P] ProPakistani tablosu ve YCloud (Tem 2026). Gallabox'ın markup'lı $0,0010'u ile tutarlı. |
| Authentication | **≈ $0,0009** | ~0,044 TL | [3P] ProPakistani tablosu. Türkiye için authentication-international fiyatı yok. |
| Service (1 Eki 2026'dan) | **≈ $0,0009** (utility ile aynı) | ~0,044 TL | [R] kural: "service = utility/auth fiyatı". Rakam [3P]. |

**Uyarılar**
- Meta rate card'ları genellikle **üç ayda bir** güncelleniyor [3P]. Türkiye utility fiyatı Nisan-Temmuz 2026 arasında yaklaşık $0,0053 idi, yani mevcut fiyatın ~6 katı. Fiyatlar tekrar artabilir, bu yüzden **fiyat tablosu kodda değil konfigürasyonda** tutulmalı.
- Bazı kaynaklar Türkiye marketing fiyatını $0,0080 veriyor [3P, eski veya hatalı olabilir]. Canlıya çıkmadan önce Meta'nın indirilebilir rate card'ı kontrol edilmeli.
- **Hacim kademeleri:** Yalnız utility ve authentication için geçerli. Business portföyündeki tüm WABA'lar pazar ve kategori bazında toplanır, sayaç her ay sıfırlanır [R]. Türkiye'nin kademe eşikleri doğrulanamadı [?]. Bizim modelde her tenant ayrı portföy olduğundan küçük işletmeler kademe indirimine pratikte ulaşamaz. Fiyat zaten çok düşük olduğu için önemsiz.

### 4.4 Faturalamayı kim yapar?

- **Tech Provider modelinde:** Meta faturayı **işletmenin WABA'sına tanımlı ödeme yöntemine** keser. Biz yalnız kendi aboneliğimizi faturalarız [R].
  - Para birimi pratikte **USD** olur. Meta'nın yerel para birimi listesinde TRY görünmüyor [R liste, ?].
  - Türk kartıyla yurt dışı işlem ve kur farkı doğar. Meta faturasının Türkiye'deki KDV ve muhasebe işlemi **mali müşavirle doğrulanmalı [?]**.
  - 8 Eyl 2026'dan itibaren Visa/Mastercard kredi ve banka kartları tüm işletmelere ödeme yöntemi olarak açıldı. 1 Ağu 2026'dan itibaren uygun işletmelere aylık faturalı Meta kredi hattı sunuluyor [R, arama özeti]. Türkiye'deki uygunluk [?].
- **Solution Partner / Multi-Partner Solution modelinde:** Solution Partner kredi hattını paylaşır, Meta partneri faturalar, partner de bizi veya işletmeyi faturalar. Böylece "paket içi WhatsApp mesajı" ve TL fatura mümkün olur, karşılığında partner markup'ı ve bağımlılık gelir.

### 4.5 Sipariş başı ve aylık maliyet tahmini (1 Ekim 2026 sonrası, Türkiye)

**Varsayım: tipik akış, müşteri yazarak başlıyor ve tüm mesajlar 24 saatlik pencere içinde.** İşletmenin gönderdiği mesajlar:

1. Karşılama ve "Menüyü aç" CTA butonu
2. Sipariş özeti ve Onayla/Değiştir butonları
3. "Siparişiniz onaylandı, tahmini 30 dk"
4. "Yola çıktı"
5. "Teslim edildi, değerlendirir misiniz?"

Hepsi **service** mesajı (template değil), yani 5 × $0,0009 = **$0,0045 ≈ 0,22 TL / sipariş**. Aylık ilk 1.000 service mesajı ücretsiz olduğundan, 5 mesajlık akışla ayda yaklaşık 200 sipariş bedavaya gelir.

| İşletme ölçeği | Sipariş/ay | Service mesajı | Ücretli (1.000 düşülmüş) | Meta maliyeti/ay |
|---|---|---|---|---|
| Küçük (pideci, dönerci) | 300 | 1.500 | 500 | $0,45 ≈ **22 TL** |
| Orta | 1.500 | 7.500 | 6.500 | $5,85 ≈ **283 TL** |
| Büyük / çok yoğun | 5.000 | 25.000 | 24.000 | $21,60 ≈ **1.045 TL** |

**Diğer senaryolar**

- **Web'den gelen, pencere açık olmayan sipariş.** Müşteri WhatsApp'tan yazmadan web storefront'tan sipariş verirse onay için **utility template** gerekir. Template'ler 1.000'lik ücretsiz kotaya girmez.
  - 4 template × $0,0009 = $0,0036/sipariş.
  - Bu mesajlar ayrıca **messaging limit**'e sayılır: yeni portföyde günde 250 tekil kullanıcı. Ayrıntı için bkz. 6.3.
  - Öneri: web sepetinde "Onayı WhatsApp'tan al" butonu olsun. Bu buton `wa.me/<numara>?text=Sipariş #1234` açar, müşteri mesaj gönderince **pencere müşteri tarafından açılmış** olur. Kayıt dışı bırakılan tek kazanç ücret değil, messaging limit'e takılmamak ve daha iyi teslim oranıdır.
- **Pazarlama kampanyası.** 1.000 müşteriye bir kampanya ≈ 1.000 × $0,0109 = **$10,9 ≈ 528 TL**. Ayda 2 kampanya yapan bir işletmede **pazarlama, sipariş bildirimlerinden çok daha büyük maliyet kalemidir**. Kampanya modülü mutlaka maliyet önizlemesi göstermeli ve opt-in ile İYS uyumunu kontrol etmeli.
- **Twilio kullanılsaydı.** Orta ölçekte (1.500 sipariş, siparişte 5 giden ve ~4 gelen mesaj) Twilio ek ücreti = 13.500 × $0,005 = **$67,5 ≈ 3.267 TL/ay**. Aynı ölçekte Meta ücreti $5,85. Bu yüzden mesaj başı ücret alan BSP'ler birim ekonomiyi bozar.
- **Hassasiyet.** Türkiye utility fiyatı Nisan-Temmuz 2026 seviyesine ($0,0053) dönerse orta ölçekli işletmenin maliyeti $34,5 ≈ 1.670 TL/ay olur. Abonelik fiyatlaması bu riske karşı tampon içermeli, ya da Meta ücreti ayrı kalem (pass-through) olarak kalmalı.
- **Maliyeti düşürme taktikleri:**
  1. Pencere içindeyken template yerine **serbest (service) mesaj** gönder. İlk 1.000 bedava.
  2. "Hazırlanıyor" gibi düşük değerli durum mesajlarını opsiyonel yap.
  3. Click-to-WhatsApp reklamlarıyla gelen müşterilerde 72 saatlik FEP'ten yararlan.
  4. Web siparişlerinde müşteriyi WhatsApp'tan ilk mesajı atmaya yönlendir.

---

## 5. Sipariş için kullanılabilecek mesaj özellikleri

| Özellik | Limit / not | Ürünümüzde kullanım | Kaynak |
|---|---|---|---|
| **Interactive reply buttons** | En fazla **3** buton | "Onayla / Değiştir / İptal", "Kapıda nakit / Kapıda kart / Online" | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages |
| **List message** | En fazla 10 bölüm, **toplamda 10 satır** | Kategori seçimi, şube seçimi, teslimat saati | [R] https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages/ |
| **CTA URL butonu** | Tek buton, URL gizli | **"Menüyü aç ve sipariş ver"** (imzalı token'lı storefront linki), "Online öde" (iyzico/PayTR linki), "Siparişi takip et" | [R] https://developers.facebook.com/docs/whatsapp/guides/interactive-messages/ |
| **Location request message** | "Konum gönder" butonu | Teslimat adresi pini. Ardından müşteriden adres tarifi (kapı no, kat) istenmeli. | [R] aynı kaynak |
| **Location mesajı (gelen/giden)** | Tek seferlik konum | Adres doğrulama, kurye | [R] |
| **Typing indicator + okundu** | `status: "read"` ve `typing_indicator: {type:"text"}` ile. En fazla 25 sn ya da yanıt gidene kadar sürer. Mesajı okundu olarak işaretler. | AI siparişi işlerken "yazıyor..." göstermek | [3P] https://www.twilio.com/docs/whatsapp/api/typing-indicators-resource |
| **WhatsApp Flows** | Sohbet içi çok ekranlı form. `data_exchange` ile kendi endpoint'imizden dinamik veri çekilebilir. | Faz 2: sohbetten çıkmadan menü, sepet, adres formu. Türkiye kullanılabilirliği özel olarak doğrulanamadı [?]. | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint |
| **Catalog + single/multi product message + `order` webhook** | Katalog Meta Commerce Manager'da tutulur ve WABA'ya bağlanır. Multi-product mesaj en fazla 30 ürün içerir. Sipariş `type:"order"` olarak `catalog_id`, `product_items[{product_retailer_id, quantity, item_price, currency}]` alanlarıyla gelir. | **Önerilmez (MVP).** Seçenek/ekstra (modifier: "acılı", "soğansız", "yarım porsiyon", "ekstra kaşar") desteklemez. Katalog Commerce Policy'ye tabidir. Türkiye'de katalog mesajı kullanılabilirliği doğrulanamadı [?]. | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/, [K] https://github.com/Secreto31126/whatsapp-api-js/blob/main/src/types.ts |
| **Template'ler** | Kategori: Marketing, Utility, Authentication. Meta kategoriyi denetler ve promosyon içeren utility şablonunu marketing'e çevirir. Utility ve authentication genelde dakikalar içinde, marketing 24 saate kadar sürede onaylanır. Tekrarlayan yanlış kategorizasyon geçici engellere yol açabilir. Doğrulanmamış portföyde WABA başına 250 şablon, doğrulanmışta 6.000. | Sipariş durumu şablonları (`tr`), kampanya şablonları | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization, https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview, [3P] https://support.wati.io/en/articles/12320234-understanding-meta-s-latest-updates-on-template-approval |
| **REQUEST_CONTACT_INFO butonu** | Kullanıcıdan sohbet içinde telefon numarasını paylaşmasını ister | Kullanıcı adı kullanan müşteriden kurye için telefon almak | [3P] https://myoperator.com/blog/whatsapp-username-update-2026 |
| **Payments API (WhatsApp Pay)** | Yalnız belirli pazarlarda: Brezilya'da `order_details`, Hindistan'da ödeme ağ geçitleri | **Türkiye'de yok.** Online ödeme = CTA URL ile PSP linki. | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-br/overview/, https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/pg/ |

**Menü ve sepet kararı:**
- **MVP:** Web storefront'ta (mobil öncelikli, tenant'a özel alt alan adı) menü ve sepet tutulur. WhatsApp'ta yalnız karşılama, CTA URL, onay butonları ve durum bildirimleri gönderilir. Storefront linki, konuşmadaki müşteri (BSUID) ile sipariş arasında bağ kuran **imzalı ve kısa ömürlü bir token** taşır. Böylece telefon numarası olmadan da web siparişi WhatsApp sohbetine bağlanır.
- **Serbest metin siparişi** ("2 lahmacun 1 ayran"): AI ile ayrıştırılır. Müşteriye buton ile özet onayı sorulur. Emin olunamayan durumda panelde "insan onayı" beklenir.
- **Faz 2:** Sohbetten çıkmadan sipariş için WhatsApp Flows.

---

## 6. Politikalar

### 6.1 WhatsApp Business Messaging Policy (opt-in, opt-out, insana devir)

Kaynaklar: [R] https://whatsappbusiness.com/policy/, https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in

- **Opt-in:** Kişinin WhatsApp üzerinden mesaj almayı kabul ettiği açıkça belirtilmeli ve **işletme adı** açıkça yazılmalı.
- **Opt-out:** WhatsApp içinden ya da dışından gelen tüm "durdur/engelle" talepleri uygulanmalı, kişi listeden çıkarılmalı. Mesaj kategorileri için net çıkış talimatı verilmeli.
- **Otomasyon:** 24 saatlik pencerede otomasyona izin var, ancak **hızlı, açık ve doğrudan insana devir yolu** bulunmalı. Ürün gereksinimi: "Yetkiliyle görüş" butonu veya komutu olmalı ve konuşma panelde canlı temsilciye düşmeli.
- **Bizim uygulamamız:**
  - Müşteri ilk yazdığında sipariş bildirimleri için zımni ilişki oluşur.
  - **Pazarlama için ayrı ve açık onay** alınmalı: storefront'ta işaretlenmemiş kutu ve WhatsApp'ta "Kampanyalardan haberdar olmak ister misiniz? Evet/Hayır".
  - Türkiye'de ticari elektronik ileti mevzuatı (6563 sayılı Kanun) ve **İYS** yükümlülükleri ayrıca uygulanır. Bu raporda doğrulanmadı [?]. Hukuk araştırmasıyla teyit edilmeli.

### 6.2 Commerce Policy: ne satılabilir?

Kaynaklar: [R] https://business.whatsapp.com/policy (Commerce Policy bölümü), [3P] https://gallabox.com/blog/whatsapp-commerce-policy, https://www.wuseller.com/whatsapp-business-knowledge-hub/whatsapp-business-commerce-policy-full-prohibited-list-compliance-guide-2026/

- **Gıda satışı ve restoran siparişi yasak listede değil.** Yasaklar belirli ürün sınıflarına yönelik.
- **Yasak ürünler (özet):**
  - **alkol**
  - **tütün ve tütün ekipmanı** (nargile tütünü, elektronik sigara dahil)
  - ilaç (reçeteli, reçetesiz, keyif amaçlı)
  - **tıbbi ve sağlık ürünleri**
  - **tehlikeli madde**
  - canlı hayvan (çiftlik hayvanı hariç)
  - silah
  - kumar
  - yetişkin içerik
  - flört hizmetleri
  - MLM
  - maaş günü kredileri
  - gerçek, sanal veya sahte para
- **Bizim için sonuçları:**
  - Menü editöründe "alkol/tütün" kategorisi WhatsApp akışına **hiç konmamalı**, storefront'ta da bu ürünler için WhatsApp ile işlem yapılmamalı. Meyhane, tekel ve nargile kafe gibi dikeyler hedeflenmemeli.
  - **Tüp (LPG) bayisi** "tehlikeli madde" kapsamına girebilir ve risklidir [?]. **Eczane ve medikal** yasak. **Pet shop** hayvan satmadığı sürece (mama, aksesuar) serbest.
  - Liste bölgeye göre değişebilir ve tam değildir. Yeni dikeye girmeden önce resmi metin tekrar okunmalı.

### 6.3 Kalite puanı, messaging limit ve numara sınırları

Kaynaklar: [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits, [3P] https://support.wati.io/en/articles/12458014-messaging-limit-updates-effective-oct-7-2025

- **Messaging limit** (7 Ekim 2025'ten beri **business portföyü seviyesinde**): pencere dışında (template ile) 24 saatlik kayan sürede mesaj gönderilebilecek **tekil kullanıcı sayısı**.
  - Yeni portföy: **250**. Ardından yükselme basamakları: **2.000 → 10.000 → 100.000 → sınırsız**. Yüksek kaliteli mesajla ya da doğrulama yollarıyla artar.
  - Kriter karşılandığında artış yaklaşık 6 saat içinde gerçekleşir [3P].
  - Kalite düşünce limit artık **düşmüyor** [3P].
  - Portföye eklenen yeni numara, portföyün limitini hemen devralıyor [3P].
- **Pencere içi yanıtlar messaging limit'e sayılmaz.** Sipariş akışımız büyük ölçüde müşteri başlatmalı olduğu için 250 limiti pratikte yalnız pazarlama ve web kaynaklı template'leri etkiler.
- **Numara sınırı:** Yeni portföyde **2 kayıtlı numara**. Doğrulama veya 2.000 limitine ulaşınca 20 [R]. Çok şubeli işletme için önemli.
- **Kalite puanı (yeşil/sarı/kırmızı):** Engelleme ve şikayet oranlarıyla düşer. `phone_number_quality_update` webhook'u izlenmeli. Kötü kalitedeki şablonlar duraklatılabilir.
- **Politika yaptırımı:** Kaynaklar, tekrarlayan ihlalde 5, 7 ya da 30 günlük gönderim engellerinden söz ediyor [3P]. Resmi sayfa: https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement

### 6.4 Pazarlama mesajı frekans sınırları

- Meta, kullanıcı başına pazarlama template sayısını sınırlıyor ("per-user marketing template message limits") [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits
- Sınıra takılan mesajlar **131049** ("healthy ecosystem engagement") hatasıyla teslim edilmez [K].
- Kullanıcı pazarlama mesajlarını durdurduysa **131050** döner [3P].
- Kesin eşik ve pencere değerleri kamuya açık değil ve doğrulanamadı [?].
- Ürün kuralı: kampanya modülünde işletme başına ve müşteri başına frekans sınırı olmalı (ör. haftada en fazla 1). 131049 ve 131050 alan müşteriler bir süre bastırılmalı.

### 6.5 AI chatbot politikası (Ocak 2026) ve bizim AI sipariş fikrimiz

- **WhatsApp Business Solution Terms, "AI Providers" maddesi:**
  - Yeni kullanıcılar için **15 Ekim 2025**, mevcutlar için **15 Ocak 2026**'da yürürlüğe girdi.
  - LLM ve genel amaçlı AI teknolojisi sağlayıcılarının, bu teknolojiler "sunulan **birincil (yan/ancillary değil) işlev** olduğunda" platformu kullanması yasak. Belirleme Meta'nın takdirinde.
  - Kaynaklar: [R] https://www.whatsapp.com/legal/business-solution-terms, [3P] https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform, https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
- **Yasak kapsamında olmayanlar:** müşteri hizmeti, rezervasyon, **sipariş alma ve sipariş takibi** gibi tanımlı iş süreçleri için AI [3P, TechCrunch/respond.io].
- **Değerlendirme:** "Restoranın menüsünden sipariş anlayan, işletme adına çalışan bot" **uyumlu görünüyor**. Şu koşullar uygulanmalı:
  1. Sistem prompt'u ve guardrail'ler konuyu işletme, menü, sipariş, adres ve çalışma saatleriyle sınırlamalı. "Bana şiir yaz" gibi açık alan sorularına kibar ret + menü butonu ile karşılık verilmeli.
  2. İnsana devir yolu (Messaging Policy) bulunmalı.
  3. Ürün "WhatsApp'ta ChatGPT" olarak pazarlanmamalı.
  4. AI devre dışı bırakılabilmeli (işletme tercihi).
- **Rekabet notu, Meta Business Agent:**
  - 3 Haziran 2026'da globalde açıldı. Soru yanıtlama, ürün önerisi, randevu ve insana devir yapabiliyor.
  - Cloud API'de 1 Ağu 2026'dan itibaren 1M token için $2 ücretleniyor, bu da mesaj başı ~4-5 cent eder (≈ 2-2,4 TL). Bizim tahmini LLM maliyetimizden çok daha pahalı olabilir [?].
  - Kaynaklar: [R] https://about.fb.com/news/2026/06/meta-business-agent/, https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages, [3P] https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/
  - Meta, WhatsApp Business uygulamasında da bazı Premium katmanlarda bu ajanı sunuyor. Esnafın "Meta zaten veriyor" algısı bir rekabet riski.
- **Geliştirme aracı notu:** Meta, 15 Eylül 2026'da kurulum, şablon ve test işlerini AI kodlama ajanlarıyla yapmak için bir **WhatsApp Business MCP server** duyurdu [3P] https://techcrunch.com/2026/09/15/meta-now-lets-ai-agents-handle-the-boring-parts-of-whatsapp-business-setup/. Geliştirme ve operasyon için değerlendirilebilir.

---

## 7. WhatsApp kullanıcı adları ve BSUID (business-scoped user ID)

### 7.1 Ne değişiyor?

| Tarih | Olay | Kaynak |
|---|---|---|
| ~31 Mar / Nisan başı 2026 | BSUID tüm mesaj webhook'larında `user_id` alanında görünmeye başladı (kullanıcı adı açmamış olanlar dahil) | [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/, [3P] https://github.com/chatwoot/chatwoot/issues/13837 |
| Nisan 2026 başı | **Contact book:** işletme portföyü seviyesinde telefon ve BSUID eşleşmeleri saklanmaya başladı. Bu tarihten sonra etkileşimde bulunulan kullanıcıların telefonu, kullanıcı adı açsalar bile webhook'larda gelmeye devam eder. Önceki etkileşimler geriye dönük kaydedilmez. İşletme bu özelliği kapatabilir, kapatırsa veriler silinir. | [R] aynı sayfa |
| 29-30 Haz 2026 | İşletmeler kullanıcı adı rezerve edebiliyor | [3P] https://myoperator.com/blog/whatsapp-username-update-2026 |
| 7 Tem 2026 → Eylül 2026 | Kullanıcı adları dalga dalga açılıyor. 1. dalga: Cezayir, Azerbaycan, Gana, Libya, Nepal. 2. dalga 20 Temmuz'dan itibaren. **Küresel dalga Eylül 2026 boyunca.** Türkiye'nin tam tarihi doğrulanamadı [?]. | [3P] https://www.useinvent.com/blog/whatsapp-usernames-explained-what-businesses-need-to-know |
| Temmuz 2026 | BSUID'ye doğrudan mesaj gönderimi tam destekleniyor | [3P] |

### 7.2 Teknik ayrıntılar

- **Format:** ISO ülke kodu + nokta + en fazla 128 alfanümerik karakter, ör. `TR.13491208655302741918`. **Her (business portföyü, kullanıcı) çifti için benzersizdir** [R].
- **Webhook alanları** [K] https://github.com/Secreto31126/whatsapp-api-js/blob/main/src/types.ts:
  - `contacts[].wa_id` ve `messages[].from`: **kullanıcı adını açmış kullanıcıda gelmeyebilir**
  - `contacts[].user_id` ve `messages[].from_user_id`: BSUID, her zaman gelir
  - `contacts[].parent_user_id`: parent BSUID, yalnız açılmışsa
  - `contacts[].username`: kullanıcı adı
  - `statuses[].recipient_id`: BSUID'ye gönderildiyse gelmez
  - `statuses[].recipient_user_id`: her zaman BSUID
- **Gönderim:** BSUID ile tüm mesaj türleri gönderilebilir. **İstisna:** one-tap, zero-tap ve copy-code authentication şablonları telefon numarası ister [R]. Meta, webhook'larda telefonu almaya devam etmek için mümkünse telefona gönderilmesini öneriyor [R].
- **Parent BSUID:** Birden çok portföy arasında ortak kimlik sağlamak için açılabilen bir özellik [R]. Bizim gibi her tenant'ın ayrı portföy olduğu yapıda nasıl davrandığı doğrulanamadı [?].

### 7.3 Tasarım etkisi

- **Müşteri kimliği = (tenant_id, bsuid).** Telefon numarası **nullable** bir özellik olarak tutulur, birincil anahtar olarak değil.
- **Aynı kişi farklı işletmelerde farklı BSUID'ye sahip olur**, çünkü BSUID portföy kapsamlı. Platform genelinde "tek müşteri" kavramı WhatsApp kimliğiyle kurulamaz. Gerekirse storefront'ta opsiyonel hesap ya da telefon doğrulaması ile kurulmalı. KVKK açısından da tenant verisini ayrı tutmak daha doğru.
- **Kurye ve teslimat için telefon:**
  - Webhook'ta `wa_id` varsa alınır.
  - Yoksa storefront formunda "teslimat için telefon" alanı ya da sohbette **REQUEST_CONTACT_INFO** butonu kullanılır.
  - Contact book **açık** tutulmalı. İşletmeye onboarding'de bu önerilmeli.
- **Veri modeli:**
  `contacts(id, tenant_id, bsuid UNIQUE(tenant_id,bsuid), parent_bsuid NULL, phone_e164 NULL, username NULL, display_name, marketing_opt_in, marketing_opt_in_at, last_inbound_at, ...)`
- Telefonla eşleştirme mantığı (ör. POS'tan gelen eski müşteri listesi) BSUID gelince **birleştirme (merge)** yapabilmeli.
- **Loglama ve analitikte** telefon yerine BSUID kullanılmalı. Telefon maskelenmeli (KVKK).

---

## 8. Resmi olmayan çözümler (Baileys, whatsapp-web.js, Evolution API, WPPConnect, Venom)

### 8.1 Nasıl çalışırlar?

- **whatsapp-web.js:** Puppeteer ile gerçek bir tarayıcıda **WhatsApp Web'i otomatikleştirir**. README'de şu uyarılar var: "WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe" ve engellenmeme garantisi yok [K] https://github.com/pedroslopez/whatsapp-web.js
- **Baileys:** Tarayıcı kullanmadan, WhatsApp Web'in **multi-device protokolünü tersine mühendislikle** WebSocket üzerinden konuşur. Bakımcılar WhatsApp ile bağlantısız olduklarını ve ToS ihlalini onaylamadıklarını belirtiyor [K] https://github.com/WhiskeySockets/Baileys
- **Evolution API:** Baileys üzerinde REST katmanı sunar ve resmi Cloud API'yi de destekler. **WPPConnect ve Venom:** benzer WhatsApp Web tabanlı kütüphaneler [3P] https://github.com/evolution-foundation/evolution-api
- Ortak desen: **"QR kodu okut, bağlan"**. Numara, bir "bağlı cihaz" gibi davranan sunucuya bağlanır.

### 8.2 Neden kullanmamalıyız?

1. **ToS ihlali.** WhatsApp Hizmet Koşulları toplu mesajlaşmayı, otomatik mesajlaşmayı ve yetkisiz veya otomatik erişimi yasaklıyor. Meta, yetkisiz toplu mesajlaşmaya karşı hukuki yollara da başvurduğunu belirtiyor [R] https://www.whatsapp.com/legal/terms-of-service, https://faq.whatsapp.com/5957850900902049
2. **Numara kapatılma riski.** Riski en çok "yeni kişilere proaktif mesaj" davranışı artırıyor. Topluluk raporlarında bir protokol güncellemesiyle 48 saatte tüm numaraların gittiği vakalar var [3P] https://zylos.ai/research/2026-01-26-whatsapp-api-automation/, https://github.com/pedroslopez/whatsapp-web.js/issues/2701. Esnafın **tek ve yıllardır kullandığı** numarasının kapanması, ürünümüzün sebep olabileceği en büyük zarardır.
3. **Kırılganlık.** WhatsApp Web protokol değişikliklerinde servis aniden durur ve SLA verilemez.
4. **Güvenlik ve KVKK.** Oturum anahtarları sunucumuzda durur, işletmenin **tüm** kişisel sohbetlerine erişim fiilen bizde olur. Veri minimizasyonu ilkesine aykırıdır.
5. **Yeni özelliklere erişim yok.** Coexistence, Flows, template ve BSUID resmi API'de.
6. **Kullanım durumu:** Üretimde hiçbir durumda önerilmez. Yalnız dahili prototip veya demo için bile resmi Cloud API test numarası tercih edilmeli.

### 8.3 Türkiye pazarında durum

- Türkiye'de "komisyonsuz WhatsApp sipariş" alanında çok sayıda ürün var. Kabaca üç tip görülüyor:
  1. **Seviye 0: `wa.me` bağlantısı.** QR menüde sepet oluşturulur, "WhatsApp'tan sipariş ver" butonu işletmenin numarasına **hazır metin** açar. API yoktur ve resmi olarak serbesttir. Örnekler: Karekod Restoran, QrMenum, Kendisepeti, Restomenum, komisyonsuz.com [3P] https://www.karekodrestoran.com/, https://qrmenum.app/paket-servis, https://www.kendisepeti.com/komisyonsuz-siparis, https://restomenum.com/qr-menu
  2. **Bot tabanlı ürünler.** Örnekler: KolaySipariş, Invekto, SyncResto, Badex, CollectAction [3P] https://www.kolaysiparis.co/, https://invekto.com/restaurant, https://syncresto.com/restoran-whatsapp-otomatik-mesaj. **Hangilerinin resmi API, hangilerinin QR/WhatsApp Web yöntemi kullandığı DOĞRULANAMADI [?].** Açık kaynakta Türkçe "QR okut, bot çalışsın" sipariş botu projeleri ve rehberleri mevcut: https://github.com/tahaozdogan21-dot/whatsapp-siparis-bot, https://codernity.com.tr/blog/whatsapp-siparis-botu-nasil-kurulur
  3. **Resmi BSP / Meta partnerleri.** VatanSMS, OctoChat, Invekto vb. restoranlara özel değil, genel amaçlı [3P].
- **Konumlandırma fırsatı:** "Resmi Meta altyapısı, numaran güvende, telefonundan da yazmaya devam et (Coexistence)" mesajı, ucuz QR tabanlı rakiplere karşı güçlü bir farklılaştırıcı. Seviye 0'a karşı ise siparişin panele yapılandırılmış düşmesi, durum bildirimleri ve müşteri verisinin işletmede kalması öne çıkarılabilir.

---

## 9. Teknik ayrıntılar

### 9.1 Webhook doğrulama (GET) ve imza (POST)

- **GET doğrulama:** `hub.mode=subscribe`, `hub.verify_token` bizim token'ımızla eşleşirse `hub.challenge` düz metin olarak döndürülür [R/3P].
- **POST imzası:** Meta, gövdeyi uygulamanın **App Secret**'ı ile HMAC-SHA256 olarak imzalar ve `X-Hub-Signature-256: sha256=<hex>` başlığında gönderir. **Ham gövde** (JSON parse edilmeden önce) üzerinden doğrulanmalı. Meta özel karakterleri kaçışlı unicode ile imzalar [3P] https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices

```ts
import crypto from 'node:crypto';

export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const got = header.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(got, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Express/Fastify: bu route için raw body parser kullanın (express.raw({ type: 'application/json' })).
```

### 9.2 Temsili webhook payload'ları

Bu örneklerde alan adları resmi yapıya ve [K] kaynaklarına göre yazıldı. Değerler uydurmadır.

**Gelen metin mesajı (BSUID alanlarıyla):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "<WABA_ID>",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "90532XXXXXXX", "phone_number_id": "<PHONE_NUMBER_ID>" },
        "contacts": [{ "profile": { "name": "Ayşe" }, "wa_id": "90555XXXXXXX", "user_id": "TR.1234567890abcdef" }],
        "messages": [{
          "from": "90555XXXXXXX",
          "from_user_id": "TR.1234567890abcdef",
          "id": "wamid.HBgM...",
          "timestamp": "1790000000",
          "type": "text",
          "text": { "body": "2 lahmacun 1 ayran, adres aynı" }
        }]
      }
    }]
  }]
}
```
Kullanıcı adı açmış ve contact book'ta olmayan kullanıcıda `wa_id` ve `from` alanları **gelmeyebilir**.

**Buton yanıtı:**
```json
{ "type": "interactive", "interactive": { "type": "button_reply", "button_reply": { "id": "order:8f3a:confirm", "title": "Onayla" } } }
```

**Konum:**
```json
{ "type": "location", "location": { "latitude": 41.0082, "longitude": 28.9784, "name": "...", "address": "..." } }
```

**Katalog siparişi (kullanmayacak olsak da):**
```json
{ "type": "order", "order": { "catalog_id": "<CATALOG_ID>", "text": "not", "product_items": [
  { "product_retailer_id": "lahmacun", "quantity": 2, "item_price": 90, "currency": "TRY" } ] } }
```

**Durum (status) webhook'u ve fiyat nesnesi:**
```json
{
  "statuses": [{
    "id": "wamid.HBgM...",
    "status": "delivered",
    "timestamp": "1790000100",
    "recipient_id": "90555XXXXXXX",
    "recipient_user_id": "TR.1234567890abcdef",
    "pricing": { "billable": true, "pricing_model": "PMP", "category": "service", "type": "regular" }
  }]
}
```
- `pricing.type` değerleri: `regular` | `free_customer_service` | `free_entry_point`. `category` değerleri: `marketing` | `utility` | `authentication` | `service` vb. [K] https://github.com/david-lev/pywa (message_status.py), https://github.com/Secreto31126/whatsapp-api-js
- `pricing_model` değerinin `PMP` olduğu tahmin, teyit edilmeli [?].

**Başarısız gönderim:**
```json
{ "status": "failed", "errors": [{ "code": 131047, "title": "Re-engagement message",
  "error_data": { "details": "Message failed to send because more than 24 hours have passed since the customer last replied to this number." } }] }
```
Kaynak: [K] https://github.com/zammad/zammad (spec/lib/whatsapp/webhook/message/status/failed_spec.rb)

### 9.3 Retry, sıralama ve idempotency

- **Retry:** 200 dışı yanıt ya da zaman aşımında Meta, **7 güne kadar üstel geri çekilmeyle** yeniden dener. Süre dolunca olay atılır [3P] https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices. Kesin zaman aşımı değeri resmi olarak doğrulanamadı. Birkaç saniye içinde 200 dönülmeli [?].
- **Tasarım:**
  1. Ingress imzayı doğrular, ham olayı kalıcı bir yere (DB veya kuyruk) yazar ve **hemen 200 döner**.
  2. İşleme asenkron worker'da yapılır.
  3. `messages[].id` (wamid) üzerinde **UNIQUE** kısıt olur. Aynı mesaj ikinci kez gelirse işlem yapılmaz.
  4. Status'lar sırasız gelebilir. `sent < delivered < read` sırası monoton tutulur, `failed` terminaldir. Geride kalan durum eskisinin üzerine yazılmaz.
  5. Giden mesajlar için **outbox deseni** kullanılır: `(order_id, event)` UNIQUE, gönderim sonucu `wamid` kaydedilir. Zaman aşımında körlemesine yeniden gönderilmez. Graph API'de idempotency anahtarı olduğu doğrulanamadı [?].
- **Kesinti dayanıklılığı:** Webhook ucu çoklu bölgede ve otomatik ölçeklenen yapıda olmalı. Meta 7 gün yeniden denediği için kısa kesintilerde sipariş kaybolmaz, ancak **gecikir**. Sipariş gecikmesi restoran için kritik olduğundan panelde "son webhook zamanı" alarmı bulunmalı.

### 9.4 Rate limit'ler

| Limit | Değer | Hata | Kaynak |
|---|---|---|---|
| Numara başı throughput | 80 mesaj/sn (otomatik 1.000'e çıkar). Coexistence'ta 20. | 130429 | [R/3P] |
| Pair rate (aynı kullanıcıya) | ~6 saniyede 1 mesaj (kısa patlamalara tolerans olabilir) | 131056 | [3P/K] |
| Messaging limit | Portföy başına tekil kullanıcı/24 saat: 250 → 2.000 → 10.000 → 100.000 → sınırsız | - | [R] |
| `/register` | Numara başı 72 saatte 10 | - | [R] |
| Graph API çağrı limitleri | App/WABA bazlı. Değerler doğrulanamadı [?]. | 4, 80007 vb. [?] | - |

**Uygulama:**
- Numara başına token-bucket limiter kullanılmalı.
- Kullanıcı başına 6 saniyelik aralık bırakılmalı. Durum mesajları arka arkaya gönderilmek yerine birleştirilebilir.
- 130429 ve 131056 hatalarında jitter'lı geri çekilme uygulanmalı.

### 9.5 Medya

- Gelen medyada webhook `media id` verir. `GET /<MEDIA_ID>` çağrısı **5 dakika geçerli** bir URL döndürür. Bu URL'den **Authorization başlığıyla** indirilir. Meta'da medya **30 gün** saklanır [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media, [3P].
- Boyut sınırları: görsel 5 MB, ses/video 16 MB, belge 100 MB [3P].
- Menü görselleri CDN'imizden link ile gönderilebilir ya da `POST /<PHONE_NUMBER_ID>/media` ile yüklenip id yeniden kullanılabilir.
- Sesli sipariş notları: sesli mesaj indirilip STT ile çevrilebilir. KVKK ve saklama politikası gerekir.

### 9.6 Durum yaşam döngüsü

`sent` (Meta sunucusu kabul etti) → `delivered` (cihaza ulaştı) → `read` (okundu, kullanıcı okundu bilgisini kapatmadıysa) / `failed`.

- Ücret **teslim edilen** mesajlardan alınır.
- Coexistence'ta uygulamadan gönderilen mesajların durumları gerçek zamanlı gelmeyebilir [3P].

### 9.7 Sık karşılaşılacak hata kodları

| Kod | Anlam | Bizim aksiyonumuz | Kaynak |
|---|---|---|---|
| 131047 | Re-engagement: 24 saat geçmiş, serbest mesaj gönderilemez | Utility template'e düş | [K] |
| 131026 | Mesaj teslim edilemez (WhatsApp'ı yok, eski sürüm vb.) | Telefon ve SMS yedeği, panelde uyarı | [3P] |
| 131049 | "Healthy ecosystem" nedeniyle teslim edilmedi (pazarlama frekansı) | Pazarlamayı bastır, yeniden deneme | [K] |
| 131050 | Kullanıcı pazarlama mesajlarını durdurmuş | Opt-in'i kapat | [3P] |
| 131056 | Pair rate limit | Geri çekil, mesajları birleştir | [3P/K] |
| 130429 | Throughput aşıldı | Kuyruk ve geri çekilme | [3P] |
| 131042 | Ödeme/uygunluk sorunu (ödeme yöntemi yok vb.) | İşletmeye "Meta ödeme yöntemi" uyarısı. **1 Ekim 2026 sonrası kritik.** | [3P] |
| 131051 | Desteklenmeyen mesaj tipi (gelen) | "Bu içeriği okuyamadık" yanıtı | [3P] |
| 131048 | Spam rate limit | Göndermeyi durdur, kaliteyi incele | [K] |
| 132xxx | Template hataları (parametre uyuşmazlığı, şablon yok, duraklatılmış vb.) | Şablon senkronu, alarm | [?] genel bilgi |
| 190 | Token geçersiz veya süresi dolmuş | "WhatsApp'ı yeniden bağla" akışı | [?] genel Graph API bilgisi |

Resmi liste: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes

---

## 10. Önerilen WhatsApp mimarisi

```
 Müşteri (WhatsApp)                          İşletme (telefonunda WA Business app, Coexistence)
        │  mesaj / buton / konum                         │ (telefondan yazılanlar → smb_message_echoes)
        ▼                                                ▼
 ┌──────────────────────── Meta Cloud API (tenant'ın WABA + numarası) ─────────────────────────┐
 └───────────────┬───────────────────────────────────────────────────────────────▲─────────────┘
                 │ webhooks (tek callback URL, tüm tenant'lar)                     │ Graph API (tenant token)
                 ▼                                                                 │
 ┌───────────────────────────┐   ham olay    ┌──────────────────────┐   ┌─────────┴────────────┐
 │ wa-ingress                │──────────────▶│ Kuyruk (ör. Redis/    │   │ wa-sender (outbox)   │
 │ - GET verify              │  + 200 OK     │ BullMQ, SQS)          │   │ - numara başı limiter│
 │ - X-Hub-Signature-256     │               └──────────┬───────────┘   │ - pair limiter (6 sn)│
 │ - raw event store         │                          ▼               │ - pencere kontrolü:  │
 └───────────────────────────┘               ┌──────────────────────┐   │   service mi template│
                                             │ wa-worker            │   │ - template registry  │
                                             │ - phone_number_id →  │   │ - retry/backoff      │
                                             │   tenant yönlendirme │   └─────────▲────────────┘
                                             │ - wamid dedupe       │             │
                                             │ - status → maliyet   │             │ gönderim isteği
                                             │   defteri (pricing)  │             │
                                             │ - contact upsert     │   ┌─────────┴────────────┐
                                             │   (bsuid, phone?)    │──▶│ Konuşma motoru       │
                                             └──────────────────────┘   │ - durum makinesi     │
                                                                        │ - AI sipariş ayrıştır│
                                                                        │   (kapsam sınırlı)   │
                                                                        │ - insana devir       │
                                                                        └─────────┬────────────┘
                                                                                  ▼
 ┌──────────────────────────┐   WebSocket/SSE   ┌──────────────────────┐  ┌──────────────────────┐
 │ İşletme paneli           │◀──────────────────│ Sipariş servisi      │◀─│ Web storefront       │
 │ - sesli yeni sipariş     │   aksiyonlar ────▶│ - durumlar           │  │ (imzalı token'lı     │
 │ - onay/hazır/yolda/teslim│                   │ - yazdırma/kurye     │  │  link, BSUID bağlı)  │
 │ - canlı sohbet (inbox)   │                   └──────────────────────┘  └──────────────────────┘
 └──────────────────────────┘
 ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 │ Süper admin: tenant başına WABA sağlığı (kalite, messaging limit, görünen ad, ödeme yöntemi   │
 │ hatası 131042, token durumu, Coexistence bağlantısı, son webhook zamanı, aylık Meta maliyeti) │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Temel kararlar:**

1. **Tek Meta App, çok tenant.** Tenant başına WABA ve numara, şifreli token. `wa_accounts(tenant_id, business_id, waba_id)` ve `wa_phone_numbers(phone_number_id, mode: cloud|coexistence, quality, limit_tier, name_status)` tabloları.
2. **Pencere takibi.** Contact başına `last_inbound_at` tutulur. Gönderici, `now < last_inbound_at + 24h` ise serbest mesaj, değilse ilgili utility template'i seçer. CTWA `referral` gelmişse 72 saatlik FEP işaretlenir.
3. **Maliyet defteri.** Her status webhook'undaki `pricing` nesnesi `wa_message_costs` tablosuna yazılır. Tahmini TL maliyeti konfigürasyondaki rate card ile hesaplanır. Admin ve işletme paneli "bu ay WhatsApp maliyeti" gösterir.
4. **Şablon kataloğu.** Platform "ana şablon" setini tutar ve onboarding'de her tenant WABA'sına programatik olarak oluşturur. `message_template_status_update` ile durum izlenir. Reddedilen veya marketing'e çevrilen şablon için alarm üretilir.
5. **Güvenlik.**
   - App Secret, token'lar ve PIN'ler KMS ile şifrelenir.
   - Webhook imzası zorunlu.
   - Storefront linkleri HMAC imzalı ve kısa ömürlü.
   - Loglarda telefon maskelenir.
6. **Gözlemlenebilirlik.**
   - Webhook gecikmesi ve hata oranı izlenir.
   - Tenant başına "son 15 dk'da mesaj geldi mi" kontrolü yapılır. Yoğun saatte sessizlik alarm üretir.
   - 131042 ve 190 hataları için anında işletme bildirimi (SMS/e-posta) gönderilir.

---

## 11. İşletme onboarding akışı

### 11.1 Teknik akış (sistemin yaptığı)

1. İşletme kaydı (panel): ünvan, VKN, şube, adres, çalışma saatleri, teslimat bölgesi.
2. Menü girişi: manuel, Excel ya da fotoğraftan AI ile. Alkol ve tütün ürünleri WhatsApp akışından hariç tutulur.
3. "WhatsApp'ı Bağla" ile Embedded Signup açılır.
   - a) Varsayılan yol **Coexistence**: `featureType: whatsapp_business_app_onboarding`. Bitiş olayı `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` gelir. `/register` çağrılmaz, 24 saat içinde `smb_app_data` (kişiler ve geçmiş) çağrılır.
   - b) Alternatif yol **yeni numara**: SMS veya sesli arama ile doğrulama. `FINISH` gelir, `/register` 6 haneli PIN ile çağrılır.
4. Kod takası ile BISU token alınır ve şifreli saklanır. Ardından `subscribed_apps` çağrılır.
5. Ödeme yöntemi kontrolü: işletme Meta Billing Hub'dan kart ekler. Panel adım adım rehber ve deep link sunar. Bu adım tamamlanmadan "canlı" moda geçilmez.
6. Varsayılan utility şablonları `tr` dilinde oluşturulur ve onaylar beklenir.
7. Görünen ad kontrolü: ad işletme markasıyla tutarlı olmalı.
8. Test: panelden test siparişi verilir, sesli uyarı ve durum mesajları doğrulanır.
9. Canlıya geçiş:
   - QR afişi (masa, kapı, paket poşeti), Instagram ve Google İşletme profili linki.
   - `wa.me` linki ve storefront.
   - Opsiyonel Click-to-WhatsApp reklam rehberi (FEP ile 72 saat ücretsiz mesaj).
10. İzleme: kalite puanı, 14 gün aktiflik, ödeme hatası ve token durumu.

### 11.2 Esnafın anlayacağı dille

> **WhatsApp'ınızı 10 dakikada bağlayın. Numaranız ve sohbetleriniz aynen kalır.**
>
> 1. **Hesabınızı açın.** İşletme adınızı, adresinizi ve çalışma saatlerinizi girin.
> 2. **Menünüzü ekleyin.** Ürün, fiyat ve fotoğraf. İsterseniz menünüzün fotoğrafını çekin, biz dolduralım.
> 3. **"WhatsApp'ı Bağla" düğmesine basın.** Facebook (Meta) hesabınızla giriş yapın. Yoksa 1 dakikada açılır.
> 4. **"Mevcut WhatsApp Business numaramı kullan"ı seçin.** Telefonunuzdaki WhatsApp Business uygulamasına gelen onayı verin. Eski sohbetleriniz ve kişileriniz aktarılır.
>    - Normal (yeşil) WhatsApp kullanıyorsanız önce aynı numarayla **WhatsApp Business** uygulamasına geçin. Size adım adım gösteriyoruz.
>    - İsterseniz sipariş için yeni bir numara da açabilirsiniz.
> 5. **Meta'ya bir kredi/banka kartı ekleyin.** WhatsApp, müşterilerinize giden mesajlar için çok küçük bir ücret alır. Mesaj başına yaklaşık 4 kuruş, ayda ilk 1.000 mesaj ücretsiz. Bu ücret bize değil doğrudan Meta'ya ödenir, biz komisyon almayız.
> 6. **Deneme siparişi verin.** Panelde "ding" sesini duyun, "Onayla"ya basın. Müşteriye "Siparişiniz alındı" mesajı otomatik gider.
> 7. **Hazırsınız.** QR afişinizi asın, Instagram profilinize linki koyun.
>
> **Unutmayın:**
> - Telefonunuzdaki WhatsApp Business uygulamasını **en az 2 haftada bir açın**, yoksa bağlantı kopabilir.
> - Müşterilerinize izinsiz kampanya mesajı atmayın. Numaranızın kalitesi düşer.
> - Alkol ve sigara WhatsApp üzerinden satılamaz.

---

## 12. Maliyet modeli özeti

| Kalem | Kim öder | Tutar (Türkiye, Ekim 2026) |
|---|---|---|
| Aboneliğimiz | İşletme bize öder | Ürün kararı (ayrı araştırma) |
| Sipariş bildirimleri (service, pencere içi) | İşletme Meta'ya öder | Aylık ilk 1.000 mesaj ücretsiz, sonra ~$0,0009 (≈0,04 TL). Tipik sipariş ≈ 0,22 TL. |
| Pencere dışı durum ve onay (utility template) | İşletme Meta'ya öder | ~$0,0009 / mesaj, ücretsiz kota yok |
| Pazarlama kampanyası | İşletme Meta'ya öder | ~$0,0109 / mesaj (≈0,53 TL). **En büyük değişken kalem.** |
| CTWA reklamından gelen konuşma | - | 72 saat ücretsiz (FEP) |
| Gelen mesajlar | - | Meta ücret almaz |
| Bizim altyapımız | Biz | Webhook, kuyruk, DB ve AI/LLM maliyeti (ayrı hesap) |
| (Alternatif) BSP ücreti | Biz/işletme | Twilio $0,005/mesaj (gelen+giden) veya 360dialog ~€49/numara/ay. **MVP'de önerilmez.** |

---

## 13. Riskler

| # | Risk | Olasılık | Etki | Azaltma |
|---|---|---|---|---|
| 1 | **App Review / Business Verification gecikmesi veya reddi.** Onboarding 10/hafta ile sınırlı kalır ya da hiç başlamaz. | Orta | Yüksek | Şirket belgeleri ve web sitesi (gizlilik politikası) hazır olmalı. Video demo erken çekilmeli. Paralelde bir Solution Partner ile B planı. |
| 2 | **İşletmenin Meta'ya kart eklememesi.** 1 Ekim 2026 sonrası service mesajları durur (131042). | Yüksek | Yüksek | Onboarding'de zorunlu adım, rehber video ve canlı destek. Orta vadede MPS ile kredi hattı. |
| 3 | **Fiyat değişikliği.** Türkiye fiyatları çeyreklik değişiyor, utility Tem 2026'da %84 düştü, tekrar artabilir. | Orta | Orta | Meta ücreti pass-through kalmalı. Rate card konfigürasyonda tutulmalı. Maliyet paneli. |
| 4 | **Coexistence kopması** (14 gün kuralı, uygulama silme, numara taşıma) | Orta | Orta | Bağlantı sağlık izleme, hatırlatma bildirimleri, hızlı yeniden bağlama akışı. |
| 5 | **Numara kalite düşüşü veya yaptırım** (işletmenin spam kampanyası) | Orta | Yüksek | Opt-in zorunluluğu, frekans sınırı, kampanya ön onayı, 131049 ve 131050 bastırma. |
| 6 | **Kullanıcı adları ve BSUID ile telefonun gelmemesi.** Kurye müşteriyi arayamaz. | Orta (Eyl 2026 sonrası artar) | Orta | BSUID merkezli model, contact book açık, REQUEST_CONTACT_INFO ve formda telefon alanı. |
| 7 | **Commerce Policy ihlali** (alkol, tütün, tüp, eczane) | Düşük-Orta | Yüksek | Menü kategorisi filtreleri, dikey seçiminde politika kontrolü. |
| 8 | **AI politikası yorumu.** Meta'nın "birincil işlev" takdiri. | Düşük | Orta | Kapsam sınırlı bot, insana devir, bot olmadan da çalışan ürün. |
| 9 | **Platform bağımlılığı.** Meta politika ve fiyatını tek taraflı değiştirebilir. Meta Business Agent ile rekabet. | Yüksek (uzun vade) | Yüksek | Storefront ve panel WhatsApp'tan bağımsız değer üretmeli (web sipariş, SMS/telefon yedeği). Veri işletmede ve bizde kalmalı. |
| 10 | **Ucuz resmi olmayan rakipler** (QR tabanlı) | Yüksek | Orta | "Resmi altyapı, numara güvencesi" pazarlaması. Fiyatı Seviye 0 çözümlere yakın bir giriş paketi. |
| 11 | **Webhook kesintisi veya gecikmesi** yüzünden sipariş kaçar | Düşük | Yüksek | Hızlı 200, kuyruk, çoklu instance, alarm. Meta 7 gün yeniden dener. |
| 12 | **KVKK ve yurt dışına aktarım** (Meta sunucuları, LLM sağlayıcısı) | Orta | Yüksek | Hukuk araştırması ile aydınlatma metni, açık rıza ve VERBİS kararları (ayrı rapor) [?]. |
| 13 | **Numara sınırı** (yeni portföyde 2 numara) ile çok şubeli zincir | Düşük | Düşük | Business verification ile 20'ye çıkar. |
| 14 | **Görünen ad reddi** | Düşük | Düşük | Tabela veya ticari ünvanla tutarlı ad. |

---

## 14. Net tavsiyeler

1. **Bugün başlanacaklar:**
   - Şirketin Meta Business Portfolio'su açılsın ve **Business Verification** başvurusu yapılsın.
   - Meta App oluşturulsun, **Tech Provider** kaydı yapılsın.
   - Embedded Signup ile bir demo yapılıp **App Review** videoları çekilsin: `whatsapp_business_messaging` ve `whatsapp_business_management` izinleri için.
   - Bu adımlar MVP takviminin kritik yolu.
2. **Varsayılan onboarding yolu Coexistence olsun, "yeni numara" ikinci seçenek.** Pilotta bir +90 numarayla Coexistence'ın Türkiye'de çalıştığı **bizzat teyit edilsin**.
3. **Resmi olmayan hiçbir kütüphane kullanılmasın.** Pazarlamada "resmi Meta altyapısı" vurgulansın.
4. **Mesaj stratejisi "müşteri yazsın, biz pencere içinde serbest mesajla yanıtlayalım" olsun.**
   - Web siparişlerinde "Onayı WhatsApp'tan al" (`wa.me` ön dolu mesaj) ile pencereyi müşteri açsın.
   - Template yalnız pencere dışında kullanılsın.
   - Hedef: sipariş başına en fazla 5 işletme mesajı.
5. **Menü ve sepet web storefront'ta olsun.** WhatsApp Catalog kullanılmasın (modifier desteği yok). Flows faz 2'ye bırakılsın. Online ödeme PSP linkiyle (CTA URL) yapılsın.
6. **Müşteri kimliği `(tenant_id, BSUID)` olsun.** Telefon nullable tutulsun. Storefront linki imzalı token ile BSUID'ye bağlansın. Contact book açık tutulsun ve kurye için telefon toplama akışı eklensin.
7. **Meta ücreti pass-through kalsın** (Tech Provider modelinde zaten işletmenin kartından çekiliyor). Aboneliğe "WhatsApp maliyeti dahil" vaadi verilmesin. Panelde şeffaf "bu ay Meta'ya ödenen tahmini tutar" gösterilsin. Pazarlama kampanyası öncesinde maliyet önizlemesi zorunlu olsun.
8. **Ödeme yöntemi eklemek onboarding'de zorunlu adım olsun.** 131042 hatası için anlık uyarı kurulsun.
9. **AI sipariş botu:**
   - Kapsamı sıkı sınırlansın (menü, sipariş, adres, saat).
   - "Yetkiliyle görüş" her zaman erişilebilir olsun.
   - İşletme botu kapatabilsin.
   - Emin olunamayan siparişler panelde insan onayına düşsün.
10. **Webhook altyapısı:**
    - İmza doğrulama, hızlı 200, kuyruk, wamid dedupe, monoton status ve outbox baştan kurulsun.
    - Tenant başına "sessizlik" alarmı eklensin.
11. **Pazarlama modülü MVP'de olmasın ya da çok sınırlı olsun.** Önce opt-in, İYS ve frekans sınırı altyapısı gelsin (hukuk raporu ile). Kalite puanı riskini en çok bu modül doğurur.
12. **Faz 2:** Bir Türk Solution Partner ile **Multi-Partner Solution** görüşülsün (kredi hattı ve TL fatura). Hedef, işletmenin Meta'ya kart girme zorunluluğunu kaldırmak ve "mesaj paketi dahil" abonelik sunabilmek.
13. **Dikey seçimi:** Restoran, kafe, pastane, market, çiçekçi ve su bayisi ile başlanması uygun. **Tüp bayi, eczane, tekel ve nargile** için politika teyidi yapılmadan girilmesin.

---

## 15. Açık sorular

1. **Tüzel kişilik:** Business Verification'ı hangi şirket yapacak? Vergi levhası, alan adı ve kurumsal e-posta hazır mı?
2. **İşletme faturalama tercihi:** Esnaf Meta'ya USD kartla ödemeyi kabul eder mi, yoksa ilk günden TL ve paket içi faturalama mı şart? İkincisi Solution Partner gerektirir.
3. **Coexistence mı, yeni numara mı?** Pilot işletmeler hangi WhatsApp'ı kullanıyor: normal mi, Business mı?
4. **MVP'de AI serbest metin siparişi olacak mı,** yoksa önce yalnız storefront ve buton akışı mı?
5. **Online ödeme MVP'de var mı?** Hangi PSP (iyzico, PayTR vb.)? Kapıda ödeme yeterli mi?
6. **Kurye ve teslimat:** İşletmenin kendi kuryesi mi, üçüncü taraf entegrasyonu mu? Kurye müşteri telefonuna mutlaka ihtiyaç duyuyor mu?
7. **Çok şubeli zincirler:** Tek WABA'da çok numara mı, şube başına ayrı portföy mü? Parent BSUID gerekecek mi?
8. **Pazarlama kampanyaları** ne zaman ürüne girecek? İYS entegrasyonunu kim yapacak?
9. **Meta Business Agent ile ilişki:** Rakip olarak mı konumlanacağız, yoksa işletme isterse onu açabileceği bir seçenek mi sunacağız?
10. **Türkiye rate card ve kullanıcı adı tarihleri:** Canlıya çıkıştan önce Meta'nın resmi rate card CSV'si ve Türkiye kullanıcı adı açılış tarihi doğrudan teyit edilmeli (bu oturumda erişilemedi).
11. **Token modeli:** Tenant başına BISU token mı, kendi System User token'ımız mı? Meta'nın güncel önerisi ve güvenlik değerlendirmesi netleştirilmeli.
12. **KVKK:** Sohbet geçmişi senkronu (6 ay) açılacak mı? Esnafın eski kişisel sohbetleri bizim veritabanımıza gelir. Veri minimizasyonu açısından **varsayılan "geçmişi paylaşma"** olmalı mı?

---

## 16. Başlıca kaynaklar

**Meta ve WhatsApp resmi (arama özetleri üzerinden okundu):**
- Fiyatlandırma: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Eki 2026 güncellemeleri: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- Tem 2025 güncellemesi: https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/
- Changelog: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- Embedded Signup: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/ ve implementasyon: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- Coexistence: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- Tech Provider: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- App Review: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Solution Partner: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview
- Messaging limits: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- BSUID: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
- Numara kaydı: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration
- Görünen adlar: https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names
- Medya: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
- Hata kodları: https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
- On-Prem sunset: https://developers.facebook.com/docs/whatsapp/on-premises/sunset
- Katalog: https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/
- Flows: https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint
- Ödemeler (BR): https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-br/overview/
- Politikalar: https://whatsappbusiness.com/policy/ ve https://business.whatsapp.com/policy
- Solution Terms: https://www.whatsapp.com/legal/business-solution-terms
- Hizmet Koşulları: https://www.whatsapp.com/legal/terms-of-service
- Meta Business Agent: https://about.fb.com/news/2026/06/meta-business-agent/

**Üçüncü taraf:**
- 360dialog Eki 2026: https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/
- Courier: https://www.courier.com/blog/whatsapp-pricing-changes-october-2026
- YCloud Tem 2026: https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-july-1-2026
- ProPakistani rate card (15.09.2026): https://propakistani.pk/2026/09/15/meta-charges-pakistan-11x-more-than-india-for-whatsapp-business-messages/
- Wati (limitler): https://support.wati.io/en/articles/12458014-messaging-limit-updates-effective-oct-7-2025
- Twilio fiyat: https://www.twilio.com/en-us/whatsapp/pricing
- 360dialog fiyat: https://docs.360dialog.com/partner/get-started/pricing-and-billing
- Coexistence webhook'ları: https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence/coexistence-webhooks
- ChakraHQ Coexistence: https://chakrahq.com/article/whatsapp-coexistence-live-eu-uk-europe-whatsapp-business-for-api-live/
- Hookdeck webhook rehberi: https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices
- TechCrunch AI yasağı (18.10.2025): https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform
- TechCrunch Meta Business Agent (03.06.2026): https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/
- TechCrunch MCP (15.09.2026): https://techcrunch.com/2026/09/15/meta-now-lets-ai-agents-handle-the-boring-parts-of-whatsapp-business-setup/
- Kullanıcı adı durumu: https://www.useinvent.com/blog/whatsapp-usernames-explained-what-businesses-need-to-know
- TCMB kur: https://www.tcmb.gov.tr/kurlar/today.xml

**Açık kaynak kod (alan ve endpoint teyidi):**
- Chatwoot ES ve Coexistence: https://github.com/chatwoot/chatwoot
- whatsapp-api-js tipleri (BSUID ve pricing alanları): https://github.com/Secreto31126/whatsapp-api-js/blob/main/src/types.ts
- pywa: https://github.com/david-lev/pywa
- Gallabox docs (rate card ve Coexistence PR'ı): https://github.com/gallabox/docs
- smb_app_data kullanım örnekleri: https://github.com/jusiho/crm-prime, https://github.com/viniciusandradde/whatsapp-langchain-full
- ES referansı: https://github.com/vobase/vobase
- Zammad (131047 metni): https://github.com/zammad/zammad
- Baileys: https://github.com/WhiskeySockets/Baileys
- whatsapp-web.js: https://github.com/pedroslopez/whatsapp-web.js
- Evolution API: https://github.com/evolution-foundation/evolution-api
