# 06 — Riskler ve Kırmızı Takım Analizi: Bu fikri ne öldürür?

**Proje:** siparisinonunde ("Siparişin Önünde"), WhatsApp üzerinden komisyonsuz sipariş alma SaaS'ı
**Rapor tarihi:** 24 Eylül 2026
**Kapsam:** Meta/WhatsApp, pazar, operasyon, teknik, hukuk ve finans riskleri; benzer girişimlerden dersler; MVP'den önce doğrulanması gereken hipotezler ve hızlı deney tasarımları; risk matrisi; en kritik 5 tavsiye.
**Okuma notu:** Bu rapor bilerek karamsar yazıldı. Amaç fikri savunmak değil, zayıf noktalarını erken bulmak. Her riskin yanında somut bir azaltma önerisi var.

---

## 0. Yöntem ve güvenilirlik notu (önce bunu okuyun)

**Bu oturumda canlı web doğrulaması çok kısıtlıydı:**

- **WebSearch:** Oturumun 200 aramalık kotası bu rapora başlamadan önce kardeş raporlar tarafından tüketilmişti. Bu rapor için tek arama yapılamadı.
- **WebFetch ve curl:** Ağ egress proxy'si şu alan adlarını engelledi: `developers.facebook.com`, `business.whatsapp.com`, `whatsapp.com`, `about.fb.com`, `faq.whatsapp.com`, `reddit.com`, `techcrunch.com`, `restofworld.org`, `news.ycombinator.com`, `en.wikipedia.org`, `kvkk.gov.tr`, `mevzuat.gov.tr`, `resmigazete.gov.tr`, `iys.org.tr`, `rekabet.gov.tr`, `kurumsal.yemeksepeti.com`, `merchants.doordash.com`, `uber.com`, `webrazzi.com`, `sikayetvar.com`, `web.archive.org` ve diğerleri.
- **Erişilebilen tek dış kaynak GitHub oldu** (github.com, raw.githubusercontent.com ve GitHub arama API'si). Gerçek vaka örnekleri bu yüzden ağırlıkla açık kaynak projelerin issue kayıtlarından ve ekiplerin repo içindeki runbook/durum belgelerinden geliyor. Reddit ve forum örnekleri **toplanamadı**.
- Rakamların çoğu kardeş raporlardan alındı. Oradaki kaynak zinciri (URL'ler) geçerlidir.

**Güven etiketleri:**

| Etiket | Anlamı |
|---|---|
| **[K01]–[K04]** | Kardeş rapor bulgusu: `01-whatsapp-platform.md`, `02-pazar-rakipler-is-modeli.md`, `03-mevzuat-odeme-fatura.md`, `04-mimari-teknoloji.md`. Kaynak URL'si o raporda (önemlileri burada da verildi). |
| **[GH]** | Bu oturumda GitHub'da **okunan** gerçek kayıt (issue, repo belgesi). Tek kaynaklı anekdottur, genelleme için yeterli değildir. Tarih ve URL verildi. |
| **[GH-M]** | Mevzuat metninin GitHub'daki aynası okundu (resmî kaynak referansıyla). Madde metni resmî kaynaktan tekrar teyit edilmeli. |
| **[2K]** | İkincil kaynak (hukuk bürosu yazısı vb.). Bu oturumda doğrudan açılamadı; GitHub'daki bir rapor üzerinden aktarıldı. **Teyit edilmeli.** |
| **[E]** | Eğitim bilgisi. **DOĞRULANAMADI.** Karar vermeden önce birincil kaynaktan kontrol edilmeli. |
| **[T]** | Bizim tahminimiz, hesabımız veya önerimiz. |

**Olasılık ve etki ölçeği [T]:**

| Puan | Olasılık (önümüzdeki 18 ayda gerçekleşme) | Etki |
|---|---|---|
| 1 | Çok düşük (< %5) | İhmal edilebilir |
| 2 | Düşük (%5–20) | Küçük: tek işletme, saatler; gelire etkisi yok denecek kadar az |
| 3 | Orta (%20–50) | Orta: birkaç işletme veya birkaç gün; gelirin < %10'u; toparlanabilir |
| 4 | Yüksek (%50–80) | Büyük: platformun tamamı veya çok sayıda işletme; aylarca gecikme; ciddi churn |
| 5 | Çok yüksek (> %80) | Ölümcül: iş modelini bitirir veya şirketi kapatır |

**Skor = Olasılık × Etki.** 15–25 **Kritik**, 8–14 **Yüksek**, 4–7 **Orta**, 1–3 **Düşük**. Puanlar yargıdır [T]; pilot verisiyle güncellenmeli.

---

## 1. Yönetici özeti: Bu fikri ne öldürür?

**Kısa cevap:** Bu fikri büyük olasılıkla teknoloji ya da Meta öldürmez. **Talep tarafı** öldürür. İşletme müşterisini kendi kanalına taşıyamazsa panel boş kalır. Esnaf "işe yaramadı" der ve 2–3 ay içinde bırakır. Meta ve teknik riskler gerçek ama yönetilebilir. Pazar riski ise ancak sahada test edilerek azaltılabilir.

**Öldürücü riskler (skor sırasıyla):**

1. **Kanal taşıma başarısız olur (R01, skor 20).** Pazaryeri trafik getirir, biz getirmeyiz. Pazaryeri müşterisinin anlamlı bir kısmı işletmenin kendi kanalına geçmezse işletme ödediğinin karşılığını göremez. Brezilya'da bile paket servis cirosunun %54'ü pazaryerinden, %26'sı WhatsApp'tan geliyor (Abrasel, Mart 2025 [K02]). WhatsApp kanalı olgun olduğu bir pazarda bile keşfi pazaryeri yapıyor.
2. **Kurucu ekibin kapasitesi yetmez (R02, 16).** 1–3 geliştirici beş ürün yazmaya çalışıyor: pazarlama sitesi, storefront, işletme paneli, admin paneli ve WhatsApp entegrasyonu. Aynı ekip concierge kurulum ve 7/24 destek de yapacak. Kapsam kısılmazsa pilot gecikir, kalite düşer.
3. **Onboarding sürtünmesi (R03, 16).** Esnafın bağlanması için şu adımlar gerekiyor: Meta hesabı, business portföyü, Embedded Signup, coexistence, Meta'ya kart, görünen ad onayı. Adımlardan biri takılırsa aktivasyon düşer. Gerçek vakalarda Türk bir şahıs şirketinin Meta işletme doğrulaması reddedildi [GH]. Embedded Signup yeni bağlantılarda webhook hatasıyla koptu [GH]. Coexistence senkronu bir işletmenin WhatsApp Business uygulamasını kullanılamaz hale getirdi [GH].
4. **"Zaten WhatsApp'tan alıyorum" itirazı ve düşük ödeme isteği (R04, 16).** Ücretsiz `wa.me` + QR menü çözümleri ve 680 TL'den başlayan 20'den fazla yerli rakip var [K02]. Günde 5 siparişin altındaki esnaf için ürünün değeri gerçekten zayıf.
5. **Sipariş kaçırma (R05, 16).** Cuma akşamı kaçan tek sipariş, esnafın güvenini aylarca geri gelmeyecek biçimde kaybettirir. Tarayıcı ses kısıtları, uyuyan tablet, internet kesintisi ve panel yerine telefondan yazma alışkanlığı gerçek tehlikeler [K04].
6. **Tek nokta arızası: Meta uygulamamız (R06, 15).** Tech Provider modelinde tüm işletmeler **tek bir Meta uygulamasına** bağlı. App Review gecikirse, şirket doğrulaması takılırsa ya da uygulama kısıtlanırsa bütün müşteriler aynı anda etkilenir.
7. **Destek yükü (R07, 15) ve güvenlik (R08, 15).** Esnaf gece 23:00'te arar. Küçük ekiplerin hızlı yazdığı çok kiracılı SaaS'larda kiracılar arası veri sızıntısı (IDOR) sık görülür; GitHub'daki bir Türk SaaS'ının durum belgesinde tam da bu açıklar listelenmiş [GH].

**Bizi öldürmez ama yavaşlatır:** Meta fiyat/politika değişiklikleri (Meta ücreti işletmeden çekildiği için), İYS (kampanya modülü MVP'de yok), 6493 ödeme lisansı (para bizim hesabımıza girmediği sürece), BSUID ve kullanıcı adları, onboarding kotası.

**En kritik 5 tavsiye (ayrıntı §11):**
1. **Önce talebi test et.** Ürünü tam yazmadan önce 6–8 haftalık bir "Seviye 0 concierge" deneyi yapılmalı: `wa.me` + paket içi QR + teşvik. Soru şu: pazaryeri müşterisi kendi kanala geçiyor mu?
2. **Meta kritik yolunu bugün başlat, B planını imzaya bağla.** Şirketin işletme doğrulaması ve App Review hemen başlatılmalı. Paralelde bir Türk Solution Partner ile Multi-Partner Solution ön anlaşması yapılmalı. Web ve manuel sipariş WhatsApp olmadan da çalışmalı.
3. **"Sipariş asla kaçmaz" tasarımı pilottan önce hazır olsun.** Katmanlı alarm, Android sarmalayıcı, sentetik canary, en az iki düğümlü webhook alımı, PITR yedek ve pilot boyunca kurucuların üstlendiği bir P1 (acil) hattı gerekiyor.
4. **Riskli modülleri ertele, güvenliği baştan kur.** MVP'de kampanya ve AI olmasın. Şablon denetimi (linting), kiracı yalıtım testleri ve dış güvenlik incelemesi yapılsın.
5. **Fiyatı enflasyona ve kura karşı koru.** Kurucu üyelere "12 ay sabit fiyat" yerine "12 ay sabit indirim oranı" verilsin. Meta ücreti pass-through kalsın. Dolar bazlı maliyetlerin gelire oranı için bir tavan konsun.

---

## 2. Pre-mortem: "18 ay sonra kapandık, neden?"

Kırmızı takım tekniği olarak projenin başarısız olduğu varsayıldı ve en olası beş hikâye yazıldı [T]:

| # | Senaryo | Hikâye | Önleyen asıl şey |
|---|---|---|---|
| 1 | **Boş panel** | 10 pilotun 7'si ilk ay sonunda günde 1–2 kanal siparişi aldı. Esnaf paket kartlarını basmadı ya da koymayı unuttu. Pazaryeri sözleşmesinden çekindi. Kurucu indirimine rağmen pilot sonrası yalnız 2 işletme ödemeye geçti. | Talep deneyi (§10 D3), pazarlama kiti, teşvik, "kanal payı" metriği |
| 2 | **Onboarding bataklığı** | Şirketin Meta doğrulaması 7 hafta sürdü. App Review bir kez reddedildi. Pilot Hafta 18'e kaydı. Esnafların üçte biri Meta'ya kart eklemedi. 1 Ekim 2026 sonrası servis mesajları teslim edilmedi (131042). | Faz 0'ı hemen başlatmak, Plan B (Solution Partner), concierge kurulum |
| 3 | **Cuma akşamı felaketi** | Tek sunucudaki disk doldu. Webhook'lar 40 dakika 500 döndü. Meta yeniden denedi, siparişler geç düştü. İki büyük müşteri "senin yüzünden 30 sipariş kaçtı" diyerek ayrıldı ve esnaf grubunda kötü yorum yaptı. | En az iki düğüm, alarm, canary, müşteriye otomatik "gecikme" mesajı |
| 4 | **Destek ekibi tükendi** | 60 işletmede haftada 150+ arama geldi. Kurucular geliştirme yapamaz hale geldi. Brüt marj %40'ta kaldı, yeni özellik çıkmadı, churn arttı. | Self-servis yardım, uzaktan tanı, bayi 1. seviye destek, destek metrikleri |
| 5 | **Kiracı sızıntısı** | Bir kiracı, sipariş takip bağlantısındaki sıralı ID'yi değiştirerek başka işletmelerin müşteri adres ve telefonlarını gördü. KVKK ihlal bildirimi 40 işletmeye ayrı ayrı yapıldı. Haber oldu. | RLS, tahmin edilemez token, kiracı yalıtım testleri, dış güvenlik incelemesi |

---

## 3. Meta / WhatsApp riskleri

### 3.1 Numara ve hesap kısıtlama/ban riski

**Nasıl işliyor (özet):**
- Kalite puanı (yeşil/sarı/kırmızı) kullanıcı engelleme ve şikâyetleriyle düşer. Düşük kalitedeki şablonlar duraklatılabilir [K01, R: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits].
- Kaynaklar tekrarlayan ihlalde **5, 7 veya 30 günlük** gönderim engellerinden söz ediyor [K01, 3P]. Resmî sayfa: https://developers.facebook.com/documentation/business-messaging/whatsapp/policy-enforcement (bu oturumda açılamadı).
- İzlenmesi gereken hata kodları (üçüncü taraf BSP rehberinden [GH]: https://github.com/KarzounApps/docs, `ar/help-center/guides/whatsapp/errors.mdx`):

| Kod | Anlamı | Bizim aksiyonumuz |
|---|---|---|
| 368 | Hesap politika ihlali nedeniyle kısıtlandı veya kapatıldı | P1 olay; işletmeye bildirim; itiraz rehberi (Business Support Home) |
| 131031 | Hesap kısıtlı/kapalı **veya** iki adımlı PIN hatası | Health Status API ile nedeni ayır |
| 130497 | Faaliyet kategorisi bazı ülkelerde mesajlaşmaya kapalı | Dikey/Commerce Policy kontrolü |
| 131064 | İhlaller nedeniyle messaging limit kısıtı (ör. utility şablonunda pazarlama içeriği) | Şablon denetimi; kategori düzeltme |
| 132015 / 132016 | Şablon düşük kalite nedeniyle duraklatıldı / kalıcı kapatıldı | Şablon yedek sürümü; alarm |
| 131042 | Ödeme yöntemi hatası | "Meta'ya kart ekle" akışı; **1 Ekim 2026 sonrası kritik** |
| 131049 / 131050 | Pazarlama frekans sınırı / kullanıcı pazarlamayı durdurdu | Pazarlamayı bastır |

**Gerçek vakalar [GH]:**

| Vaka | Tarih | Ne oldu | Ders |
|---|---|---|---|
| Chatwoot #8424 | 27.11.2023 | Kullanıcı yeni uygulamayla varsayılan şablonu gönderir göndermez, iki ayrı doğrulanmamış uygulamada da "Commerce Policy ihlali" gerekçesiyle **anında** banlandı. Kök neden açıklanmadı; issue kapatıldı. https://github.com/chatwoot/chatwoot/issues/8424 | Resmî API'de de yeni ve doğrulanmamış hesaplar hassas. Meta'nın kararı şeffaf değil. |
| Baileys #1876 | 07.10.2025 | Resmî olmayan kütüphane kullanıcısı **bir haftada 5 numarasını kalıcı ban** ile kaybetti; "tanıdığım herkes banlanıyor". https://github.com/WhiskeySockets/Baileys/issues/1876 | Resmî olmayan yol toplu ölüm demek. |
| Baileys #2260 | 14.01.2026 | Kütüphane güncellemesinden sonra numara sık sık banlandı. https://github.com/WhiskeySockets/Baileys/issues/2260 | Protokol değişikliği tek gecede tüm müşterileri vurabilir. |
| Evolution API #2693 | 15.08.2026 | Yalnız **gelen** mesajlara yanıt veren, toplu gönderim yapmayan bir mağaza botu "resmî olmayan uygulama" olarak işaretlendi. Oturum düşürüldü ve **24 saat kısıt** geldi. https://github.com/evolution-foundation/evolution-api/issues/2693 | "Az ve reaktif kullanırsam güvende olurum" varsayımı yanlış. |
| Evolution API #2646, #2659 | Temmuz 2026 | "Güncellemeden sonra WhatsApp bloklandı", "WhatsApp askıya alındı" başlıklı kayıtlar. | Aynı desen sürüyor. |

**Bizim için özel durum:**
- Coexistence ile bağlanan numara **esnafın yıllardır kullandığı ana numara.** API tarafında bir yaptırım, telefondaki WhatsApp Business uygulamasını da etkileyebilir. Etkinin kapsamı **DOĞRULANAMADI**; en kötü durum varsayılmalı [T].
- Chatwoot #12469 (18.09.2025) bu etkinin ne kadar büyük olabileceğini gösteriyor. Coexistence senkronu sırasında bir işletmenin uygulaması mesaj alamaz ve gönderemez hale geldi. Kullanıcının sözleri: "Satışlarımız yalnızca WhatsApp'tan, bu işimi mahvetti." https://github.com/chatwoot/chatwoot/issues/12469 [GH]

**Olasılık/etki:**
- Platformda 18 ay içinde en az bir işletmede kısıtlama: **Orta (3)**.
- O işletme için etki ölümcül; bizim için itibar kaybı: **Büyük (4)**.

**Azaltma:**
1. **MVP'de kampanya/pazarlama gönderimi yok** (KARARLAR ile uyumlu). Kalite puanı riskini en çok bu modül doğurur [K01].
2. **Şablon denetimi (linting):** Utility şablonunda "indirim, %, kampanya, kod, fırsat" gibi kelimeler geçerse şablon engellensin. Bu hem 131064'ü hem ETK riskini önler [K03].
3. **Commerce filtresi:** alkol, tütün/nargile, ilaç ve LPG ürünleri WhatsApp akışında hiç gösterilmesin [K01].
4. **Sağlık izleme:** `phone_number_quality_update`, `account_update` webhook'ları ve yukarıdaki hata kodları için anlık alarm kurulsun. Admin panelinde "kırmızı işletmeler" listesi olsun.
5. **Olay runbook'u:** kısıtlama tespiti → işletmeye telefonla bilgi → web storefront + telefon siparişine geçiş (panel WhatsApp olmadan çalışır) → Meta itiraz rehberi → gerekirse yeni numara. Üçüncü taraf runbook'lar kırmızı numarada tek çözüm olarak "Meta'dan yeni numara"yı gösteriyor (fonoster/qcobro, `docs/whatsapp-runbook.md` [GH]).
6. **Onboarding öncesi yedek:** Esnafa bağlanmadan önce WhatsApp sohbet yedeği aldırılsın (ekran rehberi). Pilotun ilk haftasında coexistence bağlantıları tek tek gözlemlensin.
7. **Sözleşme:** WhatsApp hesabının Meta kurallarına tabi olduğu, yaptırım yetkisinin Meta'da bulunduğu ve sorumluluk sınırı abonelik sözleşmesine yazılsın [K03].

### 3.2 Kalite puanı düşüşü (işletme kaynaklı)

- **Bizim akışta risk düşük.** Mesajların çoğu müşteri başlatmalı. Pencere içi yanıtlar messaging limit'e sayılmaz [K01].
- **Risk yükselten durumlar [T]:**
  - "Değerlendirir misiniz?" mesajları (bazı kullanıcılar engeller),
  - pencere dışındaki web kaynaklı template'ler,
  - esnafın telefondan toplu mesaj atması (coexistence'ta aynı numara!),
  - ileride kampanya modülü.
- **Azaltma:**
  - Değerlendirme mesajı varsayılan kapalı ya da yalnız 2. siparişten sonra gönderilsin.
  - "DUR" ile çıkış anında uygulansın [K01].
  - İşletmeye "toplu mesaj atma" eğitimi verilsin.
  - Kalite düşüşünde işletmeye özel uyarı gösterilsin.

### 3.3 Politika ve fiyat değişiklikleri: Meta kuralları ortalama çeyrekte bir değiştiriyor

| Tarih | Değişiklik | Kaynak |
|---|---|---|
| 1 Tem 2025 | Konuşma bazlı fiyattan mesaj başı fiyata geçiş | [K01, R] https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/ |
| 7 Eki 2025 | Messaging limit'ler business portföyü seviyesine taşındı | [K01, 3P] |
| 15 Eki 2025 / 15 Oca 2026 | "AI Providers" maddesi: genel amaçlı LLM botları yasak (yeni / mevcut kullanıcılar için yürürlük) | [K01, R] https://www.whatsapp.com/legal/business-solution-terms |
| 23 Eki 2025 | On-Premises API tamamen sona erdi | [K01, R] |
| Nis 2026 | Türkiye utility fiyatı ≈ $0,0053'e düştü | [K01, 3P] |
| 3 Haz 2026 | Meta Business Agent (Meta'nın kendi AI ajanı) global | [K01, R] https://about.fb.com/news/2026/06/meta-business-agent/ |
| 1 Tem 2026 | Türkiye utility fiyatı %84 düştü (≈ $0,0009) | [K01, 3P] |
| 1 Ağu 2026 | Business Agent ücretlendirmesi (1M token $2) | [K01, R] |
| **30 Eyl 2026** | **Ödeme yöntemi için son gün** (6 gün sonra) | [K01, R] |
| **1 Eki 2026** | Service mesajları ücretli; numara başı ayda 1.000 ücretsiz | [K01, R] |
| **8 Eki 2026** | Embedded Signup v2 kalkıyor; v4 zorunlu | [K02/KARARLAR] |
| Haz–Eyl 2026 | Kullanıcı adları ve BSUID; Türkiye tarihi DOĞRULANAMADI | [K01] |

**Senaryo: Türkiye utility/service fiyatı Nisan 2026 seviyesine döner [T]**
- Varsayımlar: Pro işletme, ayda 900 sipariş, sipariş başı 4 mesaj = 3.600 mesaj; ilk 1.000 ücretsiz; kur 48,4 TL/$ [K01].
- Bugün: 2.600 × $0,0009 = **$2,34 ≈ 113 TL/ay**.
- Fiyat $0,0053 olursa: 2.600 × $0,0053 = **$13,78 ≈ 667 TL/ay**. Bu, Pro abonelik ücretinin (1.790 TL) yaklaşık %37'si kadar ek yük demek.
- Meta ayrıca 1.000 ücretsiz kotayı kaldırırsa: 3.600 × $0,0053 = **$19,08 ≈ 923 TL/ay**.
- **Bizim marjımızı etkilemez** (pass-through), ama esnafın "komisyonsuz dediniz, Meta para çekiyor" algısını ve churn'ü etkiler.

**Azaltma:**
- Rate card kodda değil konfigürasyonda tutulsun [K01].
- Sipariş başına mesaj bütçesi 4 olsun. "Hazırlanıyor" mesajı kapalı kalsın. Durum takibi web takip sayfasına yönlendirilsin.
- Panelde "bu ay Meta'ya tahmini ödeme" gösterilsin.
- Fiyat sayfasında "Meta ücreti ayrıdır" açıkça yazsın.
- **İzleme görevi:** Meta changelog'u her ay kontrol edilsin; sorumlu atansın.

### 3.4 2026 AI chatbot kuralı

- Yasak, AI'ın "birincil" işlev olduğu genel amaçlı asistanları hedefliyor. İşletmeye özel sipariş botu "yan işlev" sayılıyor [K01]. Karar ise **Meta'nın takdirinde**.
- **Risk düşük (2×3).** Bot MVP'de yok (KARARLAR Akış C v1'de).
- **Azaltma:**
  - Bot kapsamı menü, sipariş, adres ve saatle sınırlansın.
  - Konu dışı sorulara kibar ret verilsin.
  - "Yetkiliyle görüş" her zaman erişilebilir olsun.
  - Ürün "WhatsApp'ta ChatGPT" diye pazarlanmasın.

### 3.5 Kullanıcı adları ve BSUID

- Kullanıcı adı açmış müşterinin telefonu webhook'ta **gelmeyebilir**. Kurye müşteriyi arayamaz [K01].
- **Gerçek vaka [GH]:** Chatwoot #15530 (19.08.2026). Olgun bir üründe bile yalnız BSUID ile tanımlanan kişiler kişi listesinde, aramada ve dışa aktarımda **görünmez oldu**. Neden: kod kimliği telefon, e-posta veya tanımlayıcı üzerinden arıyordu. https://github.com/chatwoot/chatwoot/issues/15530
- **Azaltma:**
  - Müşteri kimliği `(tenant_id, wa_bsuid)`, telefon nullable (KARARLAR).
  - Storefront'ta "teslimat telefonu" alanı ve REQUEST_CONTACT_INFO butonu.
  - Contact book açık tutulsun.
  - **Test:** Telefonu hiç olmayan bir müşteriyle uçtan uca sipariş, kurye ve dışa aktarım senaryosu CI'da koşsun.

### 3.6 Embedded Signup'ta sık yaşanan sorunlar

| Sorun | Kanıt | Olasılık (işletme başına) [T] | Azaltma |
|---|---|---|---|
| **Business Verification reddi / gecikmesi** | Türk bir SaaS'ın durum belgesi (4 Ağustos 2026): şahıs şirketi (Alanya) için Meta işletme doğrulaması **reddedildi**. Ekip, şablon oluşturamadıkları için OTP'yi **resmî olmayan WPPConnect'e** taşıdıklarını yazmış. https://github.com/yunuskbl/BerberApp/blob/HEAD/DURUM.md [GH]. Runbook'lar: doğrulama "aynı gün ile birkaç hafta arası", "belge uyuşmazlığında takılıyor" (fonoster/qcobro; Orenda-Project/rumi-platform `docs/onboarding/whatsapp.md` [GH]). | **Bizim şirketimiz için** orta; esnaf için doğrulama çoğu zaman gerekmez (bkz. not) | Şirket doğrulaması Ltd/AŞ ile, tutarlı ünvan, adres, alan adı ve e-postayla yapılsın. Belgeler hazır olsun (vergi levhası, sicil, faaliyet belgesi). Red durumunda asla resmî olmayan yola düşülmesin; Solution Partner'a geçilsin. |
| **Numara başka hesaba/BSP'ye ya da kişisel WhatsApp'a bağlı** | "En sık takılma noktası; buna zaman ayırın" (fonoster/qcobro runbook [GH]). Coexistence dışındaki taşımada "sohbet geçmişi silinir ve bekleme süresi vardır" (Vacademy ES belgesi, 17.07.2026 [GH]). | Yüksek | Kurulum öncesi kontrol listesi: numara hangi uygulamada, başka BSP'ye bağlı mı? Normal WhatsApp'tan Business'a geçiş rehberi. Taşıma gerekiyorsa uyarı ekranı. |
| **İki adımlı doğrulama PIN'i** | Daha önce PIN konmuş numarada kayıt hata veriyor; işletmenin mevcut PIN'i girmesi gerekiyor (Vacademy [GH]). `/register` numara başına 72 saatte en fazla 10 kez [K01, R]. | Orta (yeni numara yolunda) | PIN hatasını esnafın anlayacağı dille göster. Deneme sayacı olsun. |
| **Görünen ad reddi** | Ticari adla uyuşmayan, jenerik veya yanıltıcı adlar reddediliyor (fonoster, Orenda runbook'ları [GH]). | Orta | Tabela adı + ilçe ("Usta Dönerci Kadıköy"). "Döner", "Pide" gibi tek kelimelik adlar kullanılmasın. |
| **Webhook aboneliği hatası** | Chatwoot #14713 (11.06.2026): ES başarıyla bitiyor, işletme doğrulaması, App Review ve Live mod tamam, ama webhook override'ında `(#100) ... your app must be subscribed` hatası alınıyor ve **yalnız yeni** bağlantılar kopuyor. https://github.com/chatwoot/chatwoot/issues/14713 [GH] | Düşük–Orta | `subscribed_apps` çağrısı ayrı adım, idempotent ve yeniden denenebilir olsun. Bağlantı sonrası sağlık kontrolü (test mesajı) zorunlu. |
| **ES'nin genel kırılganlığı** | Chatwoot #12188 (Ağu 2025) "ES çalışmıyor", #12242 "bağlanmıyor", #13154 (Ara 2025) "birden fazla hata: webhook aboneliği, SDK yükleme, konfigürasyon doğrulama" [GH] | Orta | ES v4 ile baştan yazılsın. Her olay (`FINISH`, `CANCEL`+`current_step`, `ERROR`) loglansın. Terk edilen adım hunisi admin panelinde görünsün. |
| **Coexistence özel sorunları** | #12469 (Eyl 2025): senkron işletmenin uygulamasını bozdu. #13464 (Şub 2026): bazı iPhone gönderenlerin mesajları sessizce düşüyor. #14800 (Haz 2026): coexistence kutusundan 24 saat sonra şablon gönderilemiyor. #15325 (Ağu 2026): telefondan verilen yanıtlarda alıntı bilgisi kayboluyor [GH]. Resmî kısıtlar: 14 gün kuralı, 20 mesaj/sn, API'de grup yok [K01]. | Orta | Pilotta her işletme için "ilk 72 saat gözlem" yapılsın. Geçmiş senkronu varsayılan kapalı olsun (KARARLAR). "Son gelen mesaj" alarmı kurulsun. Yeni numara alternatifi her zaman sunulsun. |
| **Meta'ya kart eklenmemesi** | 1 Ekim 2026 sonrası servis mesajları teslim edilmez (131042) [K01, R]. | **Yüksek** | Kart adımı olmadan "canlı" moda geçilmesin. Kurulumda yanında olunsun. Faz 2'de MPS kredi hattı. |
| **Onboarding kotası** | Doğrulama ve App Review tamamlanana kadar 7 günde en fazla 10 yeni işletme; sonra 200 [K01, R]. | Pilot için sorun değil | Doğrulama hemen başlasın. |
| **App Review reddi** | "Meta ekran kaydında veya kullanım durumu metninde değişiklik isteyebilir; bir tekrar döngüsü planlayın" (Vacademy [GH]). Live mod olmadan ES'yi yalnız uygulama rolü olanlar tamamlayabilir [K01]. | Orta | Video senaryoları erkenden çekilsin. Hafta 8 karar noktası (bkz. docs/02 §2.5). |

> **Not:** Tech Provider modelinde her işletmenin kendi portföyü olur. Esnafın portföy doğrulamasına messaging limit ve numara sayısı için ihtiyaç var, ama müşteri başlatmalı sipariş akışı için şart değil [K01]. Asıl kritik doğrulama **bizim şirketimizin** doğrulamasıdır.

### 3.7 Meta'nın kendi "WhatsApp'ta sipariş" özelliklerini genişletmesi

**Bugün var olanlar:**
- WhatsApp Business uygulamasında katalog ve sepet [E].
- Cloud API'de katalog, `order` mesajı ve Flows [K01].
- Brezilya ve Hindistan'da sohbet içi ödeme [K01, R].
- Meta Business Agent: soru yanıtlama, ürün önerisi, randevu ve insana devir; 3 Haziran 2026'dan beri global [K01].
- Meta, 15 Eylül 2026'da WhatsApp kurulumunu AI ajanlarına yaptıran bir MCP sunucusu duyurdu [K01, 3P].

**Tehdit senaryosu [T]:** Meta; katalog + modifier + Flows sepeti + Business Agent + yerel ödeme (PSP ortaklığı) birleşimini WhatsApp Business uygulamasına **ücretsiz** koyar. Esnaf da "Meta zaten veriyor" der.

**Olasılık:** Türkiye'de 18 ay içinde restoran siparişine yetecek olgunlukta, modifier destekli ve ödemeli bir sürüm **Düşük (2)**. Gerekçeler:
- Katalog modifier desteklemiyor [K01].
- WhatsApp Pay Türkiye'de yok [K01].
- Meta tarihsel olarak işletme operasyon paneli (mutfak, kurye, yazıcı) yapmıyor [T].

**Etki:** **Büyük (4)**. Basit "menü + sipariş" değeri metalaşır.

**Azaltma:**
- Değer önerisi bot veya menü olmamalı. Değer şunlar olmalı: **operasyon** (sesli panel, mutfak ekranı, kurye, yazıcı), **çok kanal** (web, QR, telefon, WhatsApp tek ekranda), **CRM ve tekrar sipariş**, **POS entegrasyonu** [K02].
- Meta'nın yeni özellikleri rakip olarak değil **taşıyıcı** olarak benimsensin. Örneğin Flows Faz 3'te.
- "Meta Business Agent'ı isteyen işletme açabilir" seçeneği tartışılsın [K01 açık soru].

### 3.8 Meta Verified for Business ve taklit riski

- **Meta Verified for Business** WhatsApp'ta bazı ülkelerde abonelikle sunuluyor: doğrulanmış rozet, gelişmiş destek, taklide karşı koruma [E]. **Türkiye'de kullanılabilirliği ve fiyatı DOĞRULANAMADI.**
- Coexistence hesaplarında resmî işletme (OBA, mavi tik) desteklenmiyor [K01, 3P].
- **Riskler [T]:**
  1. Esnafın "mavi tik için Meta'ya ayrıca para mı vereceğim" kafa karışıklığı.
  2. **Sahte işletme numaraları:** dolandırıcılar restoran adıyla WhatsApp hesabı açıp IBAN'a ön ödeme ister. Yaygınlığı DOĞRULANAMADI; Türkiye'de sosyal medya dolandırıcılığı bilinen bir desen [E].
- **Azaltma:** Storefront'ta "Resmî sipariş hattımız: +90..." doğrulama rozeti ve QR'lar yalnız işletmenin alt alan adına gitsin. MVP'de ön ödeme yok (KARARLAR: kapıda ödeme).

### 3.9 Tek nokta arızası: bizim Meta uygulamamız ve portföyümüz

- **Durum:** Tüm kiracıların token'ları ve webhook'ları tek bir Meta App'e bağlı (KARARLAR §6). Uygulama kısıtlanırsa, App Review izinleri geri alınırsa veya şirket doğrulaması sorgulanırsa **tüm müşteriler aynı anda** WhatsApp'sız kalır.
- **Olasılık:** Orta (3), ağırlıklı olarak ilk 6 ayda gecikme veya ret biçiminde. **Etki:** Ölümcül (5). **Skor 15.**
- **Erken uyarı:** App Review "daha fazla bilgi" talebi, işletme doğrulamasının 2 haftayı aşması, Meta'dan politika uyarı e-postası, onboarding'de 10/hafta sınırına takılmak.
- **Azaltma:**
  1. Faz 0 bugün başlasın (KARARLAR §6.3).
  2. `WaTransport` soyutlaması (docs/02 §7.10) ve Solution Partner ile **imzalı** ön anlaşma. "Tanışalım" düzeyi yetmez; sözleşme ve test hesabı hazır olmalı.
  3. Web storefront, manuel sipariş ve SMS/telefon bildirimi WhatsApp'sız çalışabilmeli ("WhatsApp kapalı modu").
  4. Uygulama izinleri minimum tutulsun. Politikalara uyum "tüm kiracıları korur" bilinciyle yönetilsin: tek kötü kiracı hepsini riske atabilir [T].

---

## 4. Pazar riskleri

### 4.1 Pazaryerlerinin karşı hamleleri

**Bağlam [K02]:**
- Uber, Trendyol GO'nun %85'ini aldı (kapanış 17.06.2025).
- GetirYemek'in Uber'e devrine Rekabet Kurulu Haziran 2026'da taahhütlerle izin verdi. Satıcı panelleri Eylül 2026'dan itibaren taşınıyor.
- Yemeksepeti SSW Partners'a geçiyor (kapanış 2027 2. yarı bekleniyor).
- Pazar fiilen iki blok ve Migros Yemek'ten oluşuyor.

**Olası hamleler ve emsaller:**

| Hamle | Emsal / kanıt | Olasılık [T] | Bizim için anlamı |
|---|---|---|---|
| Kendi kuryesiyle çalışan restorana komisyonu düşürmek | Uber Eats Trendyol Go'da "~%9'a kadar düşebiliyor" iddiası; GetirYemek'te kendi kuryesiyle ~%12 (KDV dahil) [K02, B] | **Zaten var** | Tasarruf argümanı zayıflar. Hesaplayıcı gerçek kesinti dökümüyle çalışmalı; %12'lik işletmede başa baş sipariş sayısı yükselir. |
| Pazaryerinin kendi "komisyonsuz doğrudan sipariş" ürünü (markalı web sitesi, QR) | ABD'de DoorDash Storefront (2020, komisyonsuz, yalnız ödeme işlem ücreti), Uber Direct (beyaz etiketli kurye), Grubhub Direct [E, DOĞRULANAMADI]. **Türkiye'de pazaryerlerinin böyle bir ürün sunduğuna dair bu oturumda kanıt bulunamadı** (arama yapılamadı). | Orta (Uber'in global ürün seti Türkiye'ye taşınabilir) | "Kendi kanalın" mesajını pazaryeri de söylerse bizim farkımız WhatsApp, bağımsızlık ve veri sahipliği olur. Uber Direct Türkiye'ye gelirse bizim için **kurye entegrasyonu fırsatı** da doğar. |
| WhatsApp aracını satın almak | iFood → Anota AI (~60 milyon R$; satın alma sonrası sipariş hacmi 4 kat) [K02, H] | Düşük–Orta | Rakibe güç katılması riski; bizim için çıkış yolu. |
| Sözleşme kısıtları: paket içi materyal, müşteri yönlendirme, fiyat paritesi | 2016 Rekabet Kurulu kararı MFN/pariteyi sorunlu buldu (427.977,70 TL ceza) [K02, R] https://www.rekabet.gov.tr/Karar?kararId=b01af595-d4f2-4fe3-b587-a6f9ebe8f279. Güncel sözleşme maddeleri **DOĞRULANAMADI**. | Orta | Esnaf paket kartı koymaktan çekinirse kanal taşıma çöker (R01). **Pilot öncesi 3 sözleşme avukata gösterilmeli.** |
| Algoritmik sıralama cezası (dolaylı misilleme) | Kanıt yok [T] | Düşük–Orta | İspatı zor. Esnafın korkusu bile tek başına satış engeli. |
| Kampanya/indirimle müşteriyi uygulamada tutmak | Joker, flash kampanyalar [K02] | Yüksek | Kendi kanalın avantajı (ör. ücretsiz içecek) yeterince çekici olmalı. |

**Lehimize olanlar [K02, R]:**
- Ticaret Bakanlığı'nın 13 Nisan 2026 düzenlemesi: kesintiler kalem kalem gösterilmek zorunda; aracılığın doğasındaki hizmetler ve sırf kampanyaya katılım için ayrı ücret alınamıyor. https://ticaret.gov.tr/haberler/elektronik-ticarette-yemek-siparis-hizmetlerine-yonelik-yeni-duzenleme
- Rekabet Kurulu'nun Uber–Getir taahhütlerinin içeriği **DOĞRULANAMADI**. İçinde münhasırlık veya parite yasağı varsa esnafın elini güçlendirir; izlenmeli.

**Olasılık 3, etki 4 → skor 12.**

**Azaltma:**
- "Pazaryerini bırak" değil "bağımlı kalma" mesajı (KARARLAR).
- Paket kartı dışında taşıma yolları: telefonla arayanı kanala çekmek, Google, Instagram, magnet.
- Hukuki kontrol listesi.
- Uber Direct benzeri kurye API'leri geldiğinde entegrasyonu hızlı yapabilecek bir mimari.

### 4.2 Fiyat savaşı ve kalabalık rakip alanı

- **20'den fazla yerli rakip** var: SepetTakip, Siparel (680 TL), KolaySiparis (ücretsiz katman: 20 sipariş/ay; 999 TL), QrMenum, OxyMenu (749 TL), İletmen (paket başı 5,99 TL), Yemek Butik ve diğerleri [K02].
- Global ücretsiz katmanlar var: OlaClick, Take App, Goomer [K02].
- En önemlisi: **`wa.me` + WhatsApp Business uygulaması katalogu ücretsiz** [K01].
- **Olasılık 4, etki 3 → skor 12.**
- **Erken uyarı sinyalleri:**
  - Satış görüşmelerinde "X firması 500 TL" itirazı %30'un üstünde,
  - rakibin ücretsiz WhatsApp bot katmanı açması,
  - kayıp nedenlerinde "fiyat" ilk sırada.
- **Azaltma:**
  - Fiyatla değil, **sipariş başı maliyet** ve **operasyon** ile rekabet edilsin ("günde 30 pakette sipariş başı ~2 TL" [K02]).
  - Esnaf paketi, yıllık peşin ödeme ve kurucu üye indirimi kullanılsın.
  - Ücretsiz "Menü" katmanı yalnız Faz 3'te ve yalnız müşteri toplama aracı olarak açılsın (KARARLAR).
  - **Rakiplerin resmî olmayan altyapısı** (QR ile bağlanan botlar [K02]) ban dalgalarında çöktükçe "numaran güvende" argümanı güçlenir (§3.1 vakaları).

### 4.3 Esnafın dijital adaptasyon direnci

**Kanıt:**
- Brezilya'da paket servis yapanların %63'ü WhatsApp'ı satış kanalı olarak kullanıyor, ama yalnız %38'i herhangi bir otomasyon kullanıyor (Abrasel, Mart 2025, 2.176 işletme [K02]). Olgun bir pazarda bile her 10 işletmeden 6'sı elle çalışıyor.
- Persona "Mehmet Usta": "Bir sistem daha" yorgunluğu var. Kasada 3–4 tablet ve bip sesi var [K02].

**Olasılık 4, etki 3.** Bu risk R01 ve R04'ün içinde değerlendirildi.

**Azaltma:**
- Ayrı cihaz istenmesin; mevcut tablet veya telefon kullanılsın.
- Tek tuşla onay.
- İlk 2 hafta kurucu ziyareti.
- Asıl operatör kasiyer "Elif" olduğu için eğitim ona verilsin.
- POS entegrasyonu Faz 2'de. Bu sayede tek ekran vaadi mümkün olur [K02].

### 4.4 "WhatsApp'tan zaten sipariş alıyorum, neden para vereyim?" itirazı

**Bu itiraz ne zaman haklı [T]:**
- Günde **5'ten az** WhatsApp/telefon siparişi alan ve kaçırma yaşamayan işletme için ürün, çözdüğünden fazla iş getirir.
- Müşterisi "yazarak sipariş vermeyi" seven, menüsü 10 üründen az olan işletme için `wa.me` yeterli olabilir.

**Ne zaman haksız [K02/T]:**
- Yoğun saatte mesajlar kaçıyorsa,
- adres ve ödeme her seferinde soruluyorsa,
- sipariş kâğıda yazılıyorsa,
- "nerede kaldı" aramaları geliyorsa,
- müşteri verisi telefonda dağınıksa,
- pazaryeri müşterisini taşımak istiyorsa.

**Ödeme isteği riski:** Olasılık 4, etki 4 → **skor 16 (R04).**

**Erken uyarı sinyalleri:**
- Demo sonrası denemeye geçiş < %30,
- denemeden ücretliye geçiş < %40,
- pilot sonrası ödeme reddi,
- "ücretsizse kullanırım" cevapları [T eşikler].

**Azaltma:**
1. **Segmentasyon:** Hedef, günde en az 10 paket siparişi olan ve en az birinin WhatsApp/telefondan geldiği işletme olsun. Küçükler ileride ücretsiz katmana yönlendirilsin.
2. **Değer raporu:** "Bu ay kanalından X sipariş, pazaryerine kıyasla Y TL tasarruf" [K02].
3. **Kaçırma kanıtı:** Pilot öncesi 1 hafta boyunca esnafa "kaçan/geciken sipariş" çetelesi tutturulsun. Rakam satış argümanı olur.
4. **Ödeme isteği ürünü tam yazmadan ölçülsün** (§10 D5, D6).

### 4.5 Müşteri kazanımını işletme yapmak zorunda (en büyük risk: R01)

**Sorun:** Pazaryeri keşif ve trafik getirir, biz getirmeyiz. Ürünümüz ancak işletme mevcut müşterisini kendi kanalına taşıyabilirse değer üretir.

**Kanıt:**
- **Soğuk başlangıç:** Belediye ve oda destekli "pazaryeri kopyaları" tüketici tarafında zorlanıyor. Lezzet Ankara ilk haftada 546 restoran ve 3.475 müşteri kaydetti, güncel durumu DOĞRULANAMADI [K02]. Bizim model pazaryeri olmadığı için bu sorunu doğrudan yaşamaz. Ama **her işletme kendi küçük soğuk başlangıcını yaşar** [T].
- **Başarılı emsal:** Owner.com, sabit ücretle "biz yaparız" SEO uyumlu web sitesi, uygulama ve pazarlama otomasyonu sunarak büyüdü. ARR Temmuz 2026'da 100 milyon $ [K02, B]. Yani müşteri kazanımını **ürünün parçası** yaptı.

**Çözüm araç kutusu (öncelik sırasıyla) [K02/T]:**

| Araç | Mekanizma | Maliyet | Ölçüm |
|---|---|---|---|
| **Paket içi kart / QR** | Her pakete "WhatsApp'tan doğrudan sipariş ver, X kazan" kartı. QR, `wa.me/<numara>?text=...` açar; müşteri penceresi açılır, bot menü linkini yollar. | Kart başı birkaç kuruş [D?] | QR başına benzersiz kod → tarama → mesaj → sipariş |
| **Buzdolabı magneti** | Mahalle esnafının klasik yöntemi | Düşük | Magnet QR'ı |
| **Kanala özel teşvik** | Ücretsiz içecek, %5–10 indirim, dijital damga kartı ("10. sipariş bedava") | Komisyon oranına göre ayarlanır (%15 komisyonda teşvik küçük olmalı [K02]) | Teşvik varyantı başına dönüşüm |
| **Telefonla arayanı kanala çekme** | Arayan müşteriye "sipariş linkiniz" WhatsApp mesajı (işlemsel) | Neredeyse sıfır | Telefon → kanal dönüşümü |
| **Google İşletme Profili** | Web sitesi/sipariş linki bizim storefront'a | Sıfır; kurulumda biz yaparız | UTM |
| **Instagram bio / hikâye** | Link ve öne çıkan hikâye | Sıfır | UTM |
| **Click-to-WhatsApp reklamı** | Mahalle hedefli reklam; 72 saat ücretsiz pencere (FEP) [K01, R] | Reklam bütçesi (işletmenin) | Reklamdan sipariş |
| **"Aynısından tekrar"** | Tek dokunuşla tekrar sipariş | Geliştirme maliyeti | Tekrar oranı |
| **Kanal karması raporu** | Panelde "pazaryeri ve kendi kanal" payı | Geliştirme maliyeti | Churn ile ilişkisi |

**Kritik uyarılar:**
- Pazaryeri siparişlerinden elde edilen (genelde maskeli) müşteri numaraları izinsiz pazarlama için **kullanılamaz** [K02, K03]. Taşıma yalnız paket içi materyal, müşterinin kendi başlattığı sohbet ve açık rıza ile yapılır.
- Paket kartının pazaryeri sözleşmesine aykırı olup olmadığı **DOĞRULANAMADI** (R32).

**Başarı eşiği (KARARLAR §12):** İlk 14 günde işletme başına ≥ 10 kanal siparişi; 60. günde siparişlerin ≥ %10'u kendi kanalından.

**Olasılık 4, etki 5 → skor 20 (R01).**

### 4.6 Churn: restoran kapanışları ve mevsimsellik

- TOBB'a göre 2023'te 2.136 lokanta kapandı. 2024'te kurulan şirket sayısı %10,2 azalırken kapanan şirket sayısı %21,4 arttı [K02, H].
- Mevsimsellik [T]: yaz tatili (üniversite semtleri), Ramazan (iftar yoğunluğu, gündüz düşüş), turistik bölgelerde kış.
- **Olasılık 4, etki 3 → skor 12.**
- **Azaltma:**
  - Yıllık peşin teşviki.
  - "Dondurma" seçeneği: sezonluk işletmeye düşük ücretle hesap askıya alma.
  - Dikey çeşitlendirme: su bayisi daha istikrarlı [K02].
  - Sipariş hacmi düşen işletme için admin uyarısı.

---

## 5. Operasyonel riskler

### 5.1 Siparişin kaçırılması (R05)

**Kaçırma yolları [K04/T]:**
1. Panel sekmesi kapalı veya tablet uykuda. Wake Lock desteği iOS 18.4+ ile sınırlı [K04, R].
2. Tarayıcı autoplay kuralı: vardiya başında "Sesli uyarıyı başlat"a basılmazsa ses çıkmaz [K04, R].
3. İşletmenin interneti kesik; mobil veri yok.
4. Esnaf coexistence sayesinde siparişi **telefondan** görüp panelde onaylamıyor. Sipariş `new` durumunda kalıyor, müşteriye durum mesajı gitmiyor.
5. Bizim tarafımızda webhook ya da işleme hatası (§6.1).
6. Meta tarafında gecikme. Meta 7 güne kadar yeniden dener, bu yüzden sipariş kaybolmaz ama **gecikir** [K01, 3P].

**Olasılık 4, etki 4 → skor 16.** Her işletmede en az bir kez yaşanması neredeyse kesin.

**Erken uyarı (KRI):**
- `new → accepted` süresi p95 > 2 dk (KARARLAR),
- "sipariş nerede?" diye yazan müşteri oranı,
- panel heartbeat kaybı,
- yoğun saatte 15 dk mesaj gelmemesi [K01].

**Azaltma (katmanlı; docs/04 §3.8 ile uyumlu):**
- Sipariş başına ack (onay).
- 2 ve 5 dk hatırlatma.
- Kademeli eskalasyon: panel sesi → web push → platform numarasından işletme sahibine WhatsApp → SMS → telefon araması.
- Müşteriye otomatik "Siparişiniz alındı, işletme yoğun, en kısa sürede dönülecek" mesajı.
- **Android sarmalayıcı** (native alarm, ekran uyanık) pilotta önerilen cihaz olsun [K04].
- Panelde "bağlantı koptu" kırmızı bandı.
- **"Otomatik kabul"** seçeneği (KARARLAR `new` durumu) yoğun işletmede açılabilsin.
- Esnaf telefondan yanıt verirse (echo webhook) panel siparişi "sohbette yanıtlandı, onaylamayı unutma" diye işaretlesin.

### 5.2 Yanlış sipariş (ürün, seçenek, adres)

- **Nedenler:** serbest metin (AI, v1), eksik adres tarifi, fiyat değişikliği.
- **Olasılık 4, etki 2 → skor 8.**
- **Azaltma:**
  - MVP'de yapılandırılmış web sepeti (Akış A/B). Fiyat sunucuda hesaplanır, sipariş anında kopyalanır (KARARLAR).
  - Konum pini + "kapı no, kat, tarif" zorunlu alanları.
  - Onay adımında özet + toplam [K03].
  - AI v1'de her zaman müşteri onayı + belirsizlikte insan onayı [K01].
  - Yanlış sipariş için panelde "düzelt ve müşteriye bildir" akışı.

### 5.3 Sahte sipariş ve trol

- **Risk:** Kapıda ödemeli sahte sipariş; yemek ve kurye maliyeti işletmede kalır. Web storefront herkese açık.
- **Olasılık 3, etki 3 → skor 9.**
- **Azaltma:**
  1. Akış B: web siparişi WhatsApp ile onaylanmadan `new` olmaz (KARARLAR). Bu hem doğrulama hem düşük mesaj maliyeti sağlar.
  2. BSUID/telefon başına saatlik sipariş sınırı.
  3. İşletme bazında kara liste.
  4. İlk siparişte tutar sınırı (ör. ilk siparişte X TL üstü için telefonla teyit) [T].
  5. Teslimat bölgesi poligonu dışı reddedilsin.
  6. v1'de online ödeme seçeneği.
  7. Admin panelinde anomali uyarısı (aynı cihazdan çok işletmeye sipariş vb.).

### 5.4 Kurye yönetimi

- **Riskler:**
  - Telefonsuz müşteri (BSUID, §3.5),
  - kapıda nakit ve para üstü mutabakatı,
  - kuryenin kişisel telefonuyla müşteri verisine erişmesi (KVKK),
  - kurye olmayan işletme.
- **Olasılık 3, etki 2.**
- **Azaltma:**
  - Kurye görünümü magic link ile açılsın, yalnız atanan siparişi göstersin. Teslimattan sonra adres ve telefon gizlensin [T].
  - Gün sonu tahsilat özeti.
  - İlk segment: **kendi kuryesi olan** işletme (KARARLAR/K02).
  - Kurye çağırma entegrasyonu Faz 3.

### 5.5 Yoğun saatler (Cuma akşamı, maç günleri, iftar)

**Sistem tarafı:**
- 1.000 işletmede tepe yük ~2 sipariş/sn; sunucu yükü küçük [K04, T].
- Coexistence numarası 20 mesaj/sn; aynı alıcıya ~6 sn'de 1 mesaj [K01]. Restoran için yeterli.
- **Asıl risk bizim altyapının tek bir arızasının tepe saatle çakışması** (§6.2).

**İnsan tarafı:**
- Esnaf yoğunlukta paneli değil telefonu kullanıyor.
- "Hazırlanıyor/yolda" butonlarına basılmıyor, durum mesajları gitmiyor.
- Destek hattı aynı saatte yükleniyor.

**Olasılık 3, etki 3 → skor 9.**

**Azaltma:**
- Yük testi (tepe × 5).
- Yoğun saatte **deploy yasağı** (Cuma 17:00–23:00, maç akşamları).
- "Yoğun mod" tek dokunuşla: tahmini süreyi +15 dk yapar, yeni siparişe otomatik "yoğunuz" mesajı gönderir.
- "Yolda/teslim" butonları kuryeye devredilsin.
- İftar saatleri için Ramazan öncesi hazırlık kontrol listesi.

### 5.6 Destek yükü (R07)

**Gerçeklik:**
- Restoranlar gece yarısına kadar ve hafta sonu açık. Esnaf WhatsApp'tan ya da telefonla arar, e-posta yazmaz.
- Destek ve onboarding maliyeti işletme başına aylık 200–400 TL [K02]. Bu tutar Esnaf paketinin (990 TL) %20–40'ı.
- 2026'da bir destek uzmanının işverene asgari maliyeti 40.214 TL/ay [K02, R: csgb.gov.tr].
- **Emsal [E]:** Hindistan'da KOBİ'lere online mağaza kuran Dukaan, 2023'te destek ekibinin büyük kısmını AI botla değiştirdiğini açıkladı ve tepki çekti. KOBİ destek maliyeti bu segmentte kronik bir sorun.

**Olasılık 5, etki 3 → skor 15.**

**Erken uyarı (KRI):**
- İşletme başına aylık destek teması > 3 (ilk ay hariç),
- gece 22:00 sonrası arama oranı,
- kurucuların haftalık geliştirme saatinin < %50'ye düşmesi.

**Azaltma:**
1. **Önceliklendirme:** P1 = "sipariş alamıyorum / panel çalışmıyor", 7/24 ve pilotta kurucular nöbetleşe. Diğer her şey mesai saati.
2. **Uzaktan tanı:** Admin panelinde işletme sağlık kartı: son webhook, panel bağlantısı, ses açık mı, Meta kalite, 131042. Loglu impersonation (KARARLAR rolleri).
3. **Self-servis:** Panel içi 30 saniyelik videolar, "sık sorunlar" sihirbazı ("ses gelmiyor" → adımlar).
4. **Bayi 1. seviye destek:** Faz 2 bayi programında kurulum ve ilk seviye destek bayide.
5. **Destek SLA'sı pakete göre** tanımlansın (Zincir öncelikli).
6. **Durum sayfası** (status page) + WhatsApp yayın mesajıyla "bilinen sorun" bildirimi.
7. **Her destek teması etiketlensin.** En sık 5 neden her sprintte ürün iyileştirmesine dönüşsün.

### 5.7 Onboarding süresi

- **Hedef:** Tek günde canlı (docs/01 persona ihtiyacı).
- **Gerçekçi darboğazlar:**
  - Menü girişi (100+ ürün ve seçenek grupları),
  - Meta adımları (§3.6),
  - görünen ad incelemesi,
  - şablon onayı (utility genelde dakikalar, marketing 24 saate kadar [K01]).
- **Azaltma:**
  - Menü fotoğrafından AI ile menü çıkarma (KARARLAR §10) ve concierge.
  - Onboarding'i iki kapıya bölmek: (1) web storefront + panel **hemen** canlı (QR, telefon, manuel sipariş), (2) WhatsApp bağlantısı hazır olunca devreye girer. Böylece Meta gecikmesi aktivasyonu durdurmaz [T].

---

## 6. Teknik riskler

### 6.1 Webhook kaybı, gecikmesi ve işleme hataları

- **Meta tarafı:** 200 dışı yanıtta 7 güne kadar yeniden deneme [K01, 3P]. Olay kaybolmaz ama gecikir.
- **Asıl risk bizim işleme hatalarımız. Olgun bir üründen gerçek örnekler (Chatwoot [GH]):**

| Issue | Tarih | Sorun | Bizim dersimiz |
|---|---|---|---|
| #15131 | 22.07.2026 | Webhook'lar 200 dönüyor ama gelen mesajlar arayüzde görünmüyor | 200 dönmek yetmez. Uçtan uca doğrulama (canary) şart. |
| #15857 | 17.09.2026 | Toplu silme işleri canlı WhatsApp webhook işlerini aç bırakıyor (kuyruk öncelik terslemesi) | Canlı sipariş kuyruğu ayrı ve en yüksek öncelikte olmalı. |
| #14529 | 21.05.2026 | Yarış durumu nedeniyle mesaj durumu geriye düşüyor (delivered → sent) | Status monotonluğu (docs/02 §7.4). |
| #15754 | 09.09.2026 | Gelen medya hataları başarılı yeniden denemeyi engelliyor | Medya indirme ayrı iş olmalı; mesaj kaydını bloklamamalı. |
| #14739 | 15.06.2026 | Mesajlar Meta zaman damgası yerine işleme zamanıyla kaydediliyor | Sıralama Meta `timestamp` ile yapılmalı. |
| #11901 | 07.2025 | Yinelenen `message_created` olayları | wamid UNIQUE + idempotency. |

**Olasılık 3, etki 4 → skor 12.**

**Azaltma:**
- İmza doğrula → ham olayı kalıcı kaydet → hemen 200 → kuyruk → worker (KARARLAR §10).
- wamid dedupe, outbox, DLQ ve tekrar oynatma.
- **Sentetik canary:** Platform test numarasından her 5 dk'da bir test işletmesine mesaj gönderilsin; panelde görünme süresi ölçülsün; > 60 sn alarm [T].
- Kiracı başına sessizlik alarmı [K01].
- Günlük mutabakat işi: Meta'dan alınan status'lar ile gönderilen outbox kayıtları karşılaştırılsın.

### 6.2 Tek sunucu çökmesi ve kesinti

- docs/04 başlangıç için tek sunucuda Docker Compose öneriyor, sonra 2–3 sunucuya geçiş [K04]. KARARLAR ise **aylık uptime ≥ %99,9** hedefliyor. Bu, ayda yaklaşık 43 dakikalık kesinti bütçesi demek [T hesap]. Tek sunucuyla bu hedefi tutturmak **gerçekçi değil**.
- **Olasılık 3, etki 4 → skor 12.**
- **Azaltma:**
  - Pilottan önce: webhook ingress için **en az 2 düğüm** + yük dengeleyici, yönetilen ya da replikalı PostgreSQL + PITR.
  - Deploy'lar sıfır kesintili olsun (blue-green).
  - Harici uptime izleme ve durum sayfası.
  - Pilot için SLO açıkça "%99,5" yazılabilir; %99,9 Faz 2'de hedeflenir [T].

### 6.3 Veri kaybı

- **Olasılık 2, etki 5 → skor 10.**
- **Azaltma:**
  - pgBackRest veya WAL-G ile PITR [K04].
  - Yedek başka bölgede/sağlayıcıda tutulsun (KVKK için yurt içi tercih [K03]).
  - **Ayda bir geri yükleme tatbikatı.**
  - RPO ≤ 5 dk, RTO ≤ 1 saat hedefi [T].
  - İşletmeye gün sonu sipariş dökümü e-postası (ikincil kopya).

### 6.4 Güvenlik ihlali (müşteri telefon ve adres verisi)

**Saldırı yüzeyi:**
- Herkese açık storefront ve sipariş takip bağlantıları,
- panel oturumları (restoranlarda **paylaşılan tabletler**),
- admin impersonation,
- webhook ucu,
- dışa aktarma.

**Gerçek örnek: küçük bir Türk SaaS ekibinin düzelttiği açıklar.** Ayarlıyo (berber randevu SaaS'ı), `DURUM.md`, 4 Ağustos 2026 [GH] https://github.com/yunuskbl/BerberApp/blob/HEAD/DURUM.md:
- personel hesabının salonu silebilmesi ve fiyat değiştirebilmesi (rol denetimi eksik),
- `GET /api/tenants` ucunun **tüm salonların bilgisini sızdırması**,
- WhatsApp webhook'unda HMAC imza doğrulaması olmaması → **sahte ONAYLA/REDDET** gönderilebilmesi,
- kiracılar arası IDOR (başka salonun çalışma saatini silme),
- OTP kaba kuvvet koruması olmaması,
- Swagger'ın kimlik doğrulamasız erişilebilmesi,
- dosya yüklemede stored XSS,
- loglarda OTP ve gizli anahtar sızıntısı; erişim token'ının config dosyasında durması.

Benzer bir ES belgesinde (Vacademy, 17.07.2026 [GH]) açıkça şunlar not edilmiş: "`X-Hub-Signature-256` doğrulaması bir taslak (stub)", "`hub.verify_token` doğrulanmıyor", "manuel akış token'ları düz metin saklıyor".

**Ders:** Hızlı, AI destekli geliştirilen çok kiracılı ürünlerde bu açıklar **varsayılan durumdur**. Ayrıca aranıp kapatılmaları gerekir.

**Olasılık 3, etki 5 → skor 15.** Etki: KVKK ihlal bildirimi her etkilenen işletme için ayrı (her biri veri sorumlusu), itibar kaybı [K03].

**Azaltma:**
1. OWASP ASVS 5.0 L2 hedefi [K04]. Bu listedeki her madde **pilot öncesi kontrol listesine** girsin.
2. Sipariş takip ve storefront token'ları tahmin edilemez olsun (≥ 128 bit, kısa ömürlü, HMAC imzalı) [K01].
3. Paylaşılan tablet için vardiya PIN'i, kısa oturum ve cihaz yönetimi. Kasiyer ve mutfak rolleri müşteri telefonunu tam görmesin (maskeleme) [T].
4. Admin 2FA ve IP kısıtı (KARARLAR). Impersonation loglu ve süreli.
5. Pilot öncesi **dış güvenlik incelemesi** (en azından tenant yalıtımı ve kimlik doğrulama üzerine). Sürekli olarak `security-review` benzeri otomatik kontrol.
6. KVKK ihlal müdahale planı: 72 saat Kurul bildirimi, veri işleyen olarak işletmelere gecikmesiz bildirim, kiracı bazında etki raporu [K03].

### 6.5 Çok kiracılı veri sızıntısı

**Sızıntı noktaları [T]:**
- ORM sorgusunda eksik `tenant_id`,
- önbellek anahtarları,
- gerçek zamanlı kanallar (başka şubenin SSE/WebSocket olaylarına abone olmak),
- arama indeksleri,
- dışa aktarma işleri,
- dosya/medya URL'leri,
- raporlama sorguları,
- admin toplu işlemleri.

**Olasılık 3, etki 5.** R08 ile birlikte değerlendirildi.

**Azaltma:**
- PostgreSQL RLS **ikinci savunma hattı** [K04].
- Her istekte kiracı bağlamı zorunlu (middleware).
- Gerçek zamanlı kanal aboneliği sunucuda yetki kontrolünden geçsin.
- **Otomatik çapraz kiracı testleri:** Her API ucu için "A kiracısının token'ıyla B'nin kaynağına erişim → 404" testi CI'da koşsun.
- Medya URL'leri imzalı olsun.

### 6.6 Token ve sır sızıntısı

- Kiracı başına BISU token'ları sızarsa saldırgan işletme adına tüm müşterilere mesaj atabilir. Bu da **numaranın banlanması** demek.
- App Secret sızarsa sahte webhook imzalanabilir.
- **Olasılık 2, etki 5 → skor 10.**
- **Azaltma:**
  - Envelope encryption ve KMS (KARARLAR §10).
  - Sırlar yalnız ortam değişkeni/secret manager'da; repoda asla. CI'da secret scanning.
  - Token kullanımında anomali alarmı (olağandışı gönderim hacmi).
  - Token iptal ve yenileme runbook'u.
  - Loglarda token ve telefon maskeleme.
  - Ayrı ortamlar için ayrı Meta uygulamaları.

### 6.7 Diğer teknik riskler

| Risk | Açıklama | Azaltma |
|---|---|---|
| Graph API sürüm kaldırmaları | Meta API sürümlerini ve ES v2'yi (8 Ekim 2026) kaldırıyor | Tek sabit sürüm, takvimli yükseltme, changelog takibi |
| WhatsApp/Meta global kesintisi | 4 Ekim 2021'de Facebook, Instagram ve WhatsApp ~6 saat küresel kesinti yaşadı [E]. Cloud API %99,9 uptime beyanı [K01]. | "WhatsApp kapalı modu": storefront + telefon + SMS bildirimi; müşteriye web takip sayfası |
| Harita/geocoding maliyeti ve hatası | Türkiye adres yapısı dağınık [K04] | Konum pini öncelikli; poligon bölgeler; Google kotası platform genelinde |
| AI geliştirme hızı ve kalite | Kod hacmi yüksek, inceleme düşük | Zorunlu kod incelemesi, test kapsamı hedefi, güvenlik taraması |
| LLM (v1) yurt dışı aktarım ve halüsinasyon | Haiku 4.5 `inference_geo` desteklemiyor [K04] | PII maskeleme, müşteri onayı, fiyat sunucuda |

---

## 7. Hukuki ve finansal riskler

### 7.1 KVKK

**En büyük gri alan (K03): Meta üzerinden yurt dışına aktarım (m.9).** Düzenli aktarım için standart sözleşme + 5 iş günü içinde Kurum'a bildirim gerekiyor. Meta'nın Türk standart sözleşmesini imzalayıp imzalamadığı **DOĞRULANAMADI** [K03].

**2026 idari para cezası bantları** [2K; kaynaklar: esin.av.tr 12.01.2026, mondaq 02.01.2026, kvkkuyum.com 11.02.2026; aktaran: https://github.com/aemreusta/ai-research-agent, `examples/2026-09-17-final/kvkk-2026-saas-action-plan/report.md`]. **Resmî kaynaktan teyit edilmeli.**

| İhlal | 2026 bandı (ikincil kaynak) |
|---|---|
| Veri güvenliği yükümlülüğü | 256.357 TL – 17.092.242 TL |
| VERBİS kayıt/bildirim | 341.809 TL – 17.092.242 TL |
| Standart sözleşmenin 5 iş günü içinde bildirilmemesi (m.9) | 90.308 TL – 1.806.177 TL |
| 2026 artış oranı (yeniden değerleme) | %25,49 |

- **Emsal:** Kurul 2021'de WhatsApp LLC'ye gizlilik politikası güncellemesi nedeniyle ~1,95 milyon TL ceza verdi [K03, O].
- **Bizim rolümüz:** Son müşteri verisinde veri işleyen; kendi verilerimizde veri sorumlusu. Platform genelinde tek müşteri profili kurarsak son müşteri verisinde de veri sorumlusu oluruz [K03].
- **Olasılık 3, etki 4 → skor 12.**
- **Azaltma:**
  - Kişisel veri Türkiye'de barındırılsın. Yurt dışı araçlar PII görmesin.
  - Coexistence geçmiş senkronu kapalı; sipariş notunda alerji alanı yok; otomatik silme işleri [K03].
  - DPA + alt işleyen listesi + işletme adına son müşteri aydınlatma şablonu.
  - **Avukattan yazılı m.9 görüşü; Meta'ya yazılı soru.**

### 7.2 İYS ve 6563 cezaları

- **Kanun metni [GH-M]** (6563 m.12, resmî kaynak: https://mevzuat.adalet.gov.tr/mevzuat/103057; GitHub aynası: https://github.com/onurcan-b/acik-mevzuat):
  - m.12/1-a: Onaysız ticari ileti (m.6/1) gönderen **"hizmet sağlayıcılara ve aracı hizmet sağlayıcılara"** 1.000 TL'den 5.000 TL'ye kadar idari para cezası (taban tutarlar; her yıl yeniden değerlenir). **2026 tutarları DOĞRULANAMADI.**
  - m.12/2: "Bir defada birden fazla kimseye" onaysız ileti gönderilirse ceza **on katına kadar** artırılır.
- **Aracı hizmet sağlayıcı** ifadesi dikkat çekici: kampanya gönderimini mümkün kılan platform olarak doğrudan muhatap olma ihtimalimiz var. Tam kapsamı avukata sorulmalı [K03 açık soru 13.1-2].
- Bir Türk SaaS'ının İYS notu, uygulamada cezanın "ileti başına" hesaplandığını yazıyor (BYSiriusApps/SiriPlan-App, `docs/legal/IYS-HUKUKI-DAYANAK.md`, 29.08.2026 [GH, ikincil]). **Teyit edilmeli.**
- **Olasılık:** MVP'de 2 (kampanya modülü yok). Faz 2'de kontrolsüz açılırsa 4. **Etki 4 → skor 8 (MVP).**
- **Azaltma:**
  - Kampanya modülü MVP'de yok.
  - İşlemsel mesajlara promosyon karışmasın (şablon denetimi).
  - Faz 2'de İYS kontrolü yazılımda zorunlu olsun (onaysız alıcıya gönderim teknik olarak imkânsız), ret senkronu ve audit log [K03 §3.6].

### 7.3 Ödeme aracılığı (6493)

- İşletmeler adına para toplamak lisans gerektirir; lisanssız yapmak suç [K03].
- KARARLAR tasarımı (MVP kapıda ödeme; v1 işletmenin kendi PSP hesabı) riski **Çok düşük (1)** seviyesine indiriyor. **Etki 5 → skor 5.**
- **Risk nasıl geri gelir [T]:**
  - "Bahşiş/kupon bakiyesi",
  - "cüzdan",
  - "ön ödemeli paket",
  - "biz tahsil edelim, haftalık aktaralım" gibi iyi niyetli ürün fikirleri.
- **Kural:** Müşteri parası hiçbir koşulda bizim hesabımıza girmez. Her yeni ödeme özelliği hukuk kontrol listesinden geçer.

### 7.4 ETAHS'a (pazaryeri statüsüne) kayma

- Ortak keşif sayfası, ortak sepet, ödeme aracılığı ve ücretli öne çıkarma bizi aracı hizmet sağlayıcıya dönüştürebilir [K03].
- 6563 m.12'deki aracı hizmet sağlayıcı cezaları çok büyük. Kanun metni [GH-M] bazı yükümlülükler için sabit **10 milyon TL** ve **20 milyon TL**, bazıları için **önceki yıl net satışlarının %5'i veya %10'una kadar** ceza öngörüyor. Bu yükümlülüklerin çoğu büyük ETAHS'lar içindir ve eşiklere bağlıdır; bize uygulanabilirliği [D?].
- **Ders:** "Keşfet" dizini ve ortak müşteri hesabı MVP'de yok (KARARLAR). Faz 3'te ancak avukat görüşüyle.

### 7.5 Döviz kuru

- USD/TRY ≈ 48,4 (TCMB, 24.09.2026 [K01]).
- **Döviz riski üç yerden gelir [T]:**
  1. **Esnafın Meta faturası** (USD). Bizim marjımızı etkilemez ama esnafın toplam maliyetini ve churn'ü etkiler (§3.3 senaryosu). Kart yurt dışı işleme kapalıysa 131042 hatası çıkar.
  2. **Bizim USD/EUR giderlerimiz:** LLM (v1), yurt dışı SaaS araçları, varsa yurt dışı barındırma, Cloudflare. Ayrıca yurt dışı hizmetlerde 2 No'lu KDV ve stopaj riski var [K03].
  3. **Bizim WhatsApp numaramız** (işletmelere bildirim, satış hattı).
- **Olasılık 4, etki 3.** R17 içinde değerlendirildi.
- **Azaltma:**
  - Meta pass-through.
  - Barındırma TL faturalı yurt içi sağlayıcıda (KVKK ile de uyumlu).
  - **Döviz bazlı giderler brüt gelirin %15'ini geçmesin** (kural) [T].
  - Fiyat listesinde çeyreklik gözden geçirme maddesi.

### 7.6 Enflasyon ve fiyat güncelleme

- **Proxy veri:** 2026 idari para cezaları %25,49 yeniden değerleme oranıyla arttı [2K]. Maliyetlerde yıllık %25'in üzerinde nominal artış makul bir planlama varsayımı [T].
- **KARARLAR ile gerilim:** Kurucu üye fiyatı "%30 indirim, **12 ay sabit** (TÜFE uygulanmaz)" (docs/01 §6.4).
- **Senaryo [T]** (enflasyon tahmini değil, duyarlılık):
  - Yıllık %25 maliyet artışında 12 ay sabit 1.253 TL'nin 12. aydaki reel değeri ≈ 1.253 / 1,25 ≈ **1.002 TL**.
  - Yıllık %35'te ≈ **928 TL**.
  - Aynı dönemde destek maliyeti (asgari ücret bazlı) artar. Kurucu dönemin brüt marjı, docs/01'deki %43–75 bandının **altına** inebilir.
- 12 ay sonunda liste fiyatına geçiş, esnafın gözünde birden **%40–70'lik zam** gibi görünebilir (1.253 → o günkü liste fiyatı) [T]. Bu da churn'ü tetikler.
- **Olasılık 4, etki 3 → skor 12 (R17).**
- **Azaltma:**
  - Kurucu üyeye "12 ay boyunca liste fiyatına göre %30 indirim **oranı** sabit" verilsin; liste fiyatı 6 ayda bir TÜFE ile güncellensin.
  - Ya da sabit süre 6 aya indirilsin.
  - Yıllık peşin ödeme teşvik edilsin (nakit öne çekilir).
  - Fiyat artışları küçük ve sık, önceden duyurulan adımlarla yapılsın.

### 7.7 Tahsilat sorunları

**Riskler:**
- Türkiye'de ilk işlemde 3D Secure zorunlu; tekrarlayan çekimde non-3D yetkisi veya abonelik ürünü gerekebilir [K03].
- Esnaf kartlarında limit ve iptal.
- Basit usul esnafın fatura beklentisi.
- Havale eşleştirmesi elle yapılıyor.
- **Pilotta 3 ay ücretsiz** (KARARLAR): tahsilat alışkanlığı geç başlar.

**Olasılık 4, etki 2 → skor 8.**

**Azaltma:**
- Dunning takvimi (G0 → G+14 askıya alma; siparişi hemen kesmeme ilkesi) [K03].
- Yıllık peşin + havale referans kodu.
- PSP seçiminde ilk soru "tekrarlayan çekimde 3DS" olsun.
- Pilot sonrası ödemeye geçiş için **önceden imzalı niyet mektubu** (§10 D6).

### 7.8 Diğer hukuki riskler

| Risk | Açıklama | Azaltma |
|---|---|---|
| Kesinti sonrası tazminat talebi (R33) | "Sistemin yüzünden Cuma 30 sipariş kaçtı" | Sorumluluk sınırı (ör. son 3 ay abonelik bedeli), SLA kredisi, durum sayfası kaydı [T] |
| Pazaryeri sözleşmesi ihlali nedeniyle esnafın cezalandırılması (R32) | Paket içi kart ve fiyat farkı maddeleri [K02 D?] | Pilot öncesi 3 sözleşme incelemesi; esnafa "kendi sözleşmeni kontrol et" uyarısı |
| Karşılaştırmalı reklam | "Yemeksepeti'nden %25 ucuz" gibi iddialar [K03] | Kaynaklı, nesnel dil; avukat kontrolü |
| Marka/alan adı çakışması (R36) | "Siparişin Önünde" tescil durumu DOĞRULANAMADI (KARARLAR) | TÜRKPATENT araştırması + 9/35/38/42. sınıflarda başvuru [K03] |
| Mesafeli satış ön bilgilendirme | WhatsApp siparişinde onay adımı [K03] | Özet + toplam + "Onaylıyorum" butonu + link |

---

## 8. Benzer girişimlerin başarısızlık ve pivot hikâyeleri, dersler

> Web araması yapılamadığı için yurt dışı vakaların çoğu **eğitim bilgisidir [E]** ve birincil kaynaktan teyit edilmelidir. Türkiye vakaları kardeş rapordan [K02], teknik vakalar GitHub'dan [GH].

| Vaka | Ne oldu | Güven | Bizim için ders |
|---|---|---|---|
| **Lezzet Ankara** (Ankara Büyükşehir, 2020) | %0 komisyonlu belediye uygulaması; ilk haftada 546 restoran ve 3.475 müşteri. Güncel durumu bilinmiyor. | [K02, H] başlangıç; güncel durum [D?] | Tüketiciye yönelik "komisyonsuz pazaryeri" soğuk başlangıçta zorlanır. **Pazaryeri olmama kararı doğru.** |
| **TÜRES "kendi sipariş sistemi"** (Kasım 2025) | %40 komisyon tepkisi, boykot söylemi, kendi sistem vaadi. Hayata geçip geçmediği bilinmiyor. | [K02, H]; sonuç [D?] | Dernek girişimleri duyurulur ama yavaş ilerler. **Rakip değil ortak/dağıtım kanalı olarak konumlan.** |
| **Edirne esnaf odası: RooGo → Yemek Butik** | Oda önce bir sağlayıcıyla, sonra başka bir sağlayıcıyla protokol yaptı. | [K02, H] | Oda protokolü dağıtım kanalıdır ama **kalıcı moat değildir**; oda sağlayıcı değiştirebilir. |
| **GloriaFood** (Oracle) | Ücretsiz online sipariş sistemi **30 Nisan 2027'de kapanıyor**; yeni kayıtlar kapalı. | [K02, B] | Ücretsiz model, sahibinin önceliği değişince ölür. Fırsat: **geçiş havuzu** (SambaPOS + GloriaFood kullanıcıları). |
| **iFood → Anota AI** (Brezilya) | Pazaryeri, WhatsApp sipariş otomasyonu aracını ~60 milyon R$'a aldı; satın alma sonrası hacim 4 katına çıktı. | [K02, H] | Pazaryerleri WhatsApp kanalını içselleştirebilir. Hem tehdit hem çıkış yolu. |
| **Owner.com** (ABD) | Sabit ücretli, "biz yaparız" web sitesi + pazarlama; ARR 100 milyon $ (Tem 2026). | [K02, B] | Başarı, **müşteri kazanımını ürüne dahil etmekten** ve outbound satıştan geldi. |
| **Jumia Food** (Afrika) | Jumia, Aralık 2023'te yemek teslimatı işinden tüm pazarlarda çıktığını açıkladı. | [E] | Kurye/lojistik işletmek sermaye yakar. **Kurye filosu işletmeme kararı doğru.** |
| **Getir** (Türkiye, uluslararası) | 2023–2024'te ABD, İngiltere, Almanya ve Hollanda'dan çekildi [E]. GetirYemek 2026'da Uber'e devredildi [K02]. | [E] + [K02] | Sermaye yoğun hızlı teslimat kırılgan. Varlık hafif (asset-light) SaaS modelinin avantajı. |
| **Bikayi** (Hindistan) | KOBİ'ler için WhatsApp ticaret uygulamasıydı; büyük markalara (D2C) yönelik AI ürününe (Bik.ai) pivot etti. | [E, düşük güven] | Mikro KOBİ'de ARPU düşük, destek pahalı. **Esnaf paketi marjı destek yüküne çok duyarlı** (docs/01 §7.2). |
| **Dukaan** (Hindistan) | KOBİ online mağaza kurucusu; 2023'te destek ekibinin büyük kısmını AI botla değiştirdi, tepki çekti. | [E] | KOBİ destek maliyeti yapısal. Self-servis ve otomasyon baştan tasarlanmalı. |
| **ONDC yemek** (Hindistan) | Düşük komisyonlu açık ağda yemek siparişleri, teşvikler azalınca geriledi. | [E, düşük güven] | "Komisyonsuz" tek başına tüketiciyi taşımıyor; **tüketiciye somut avantaj** gerekiyor. |
| **Resmî olmayan WhatsApp botları** (Baileys/Evolution) | Ekim 2025 toplu banlar (5 numara/hafta), Ocak 2026, Ağustos 2026 (reaktif kullanımda bile 24 saat kısıt). | [GH] | Resmî API kararı doğru. Ama esnafın zihninde "WhatsApp otomasyonu = ban" algısı **tüm kategoriyi** lekeleyebilir; satışta anlatılmalı. |
| **Ayarlıyo** (Türk randevu SaaS'ı, Ağu 2026) | Meta işletme doğrulaması reddedilince OTP için resmî olmayan WPPConnect'e döndü. | [GH] | Doğrulama reddi ekipleri kestirmeye iter. **Kural: asla.** B planı Solution Partner. |
| **Chatwoot coexistence** (Eyl 2025) | Senkron bir işletmenin WhatsApp Business uygulamasını bozdu; "işimi mahvetti". | [GH] | Onboarding hatası esnafın **tüm işini** durdurabilir. Yedek + gözlem + geri dönüş planı. |

**Ortak dersler [T]:**
1. Tüketiciye yönelik ortak platform kurma. İşletmenin kendi müşterisine odaklan.
2. Lojistik işletme.
3. Müşteri kazanımı ürünün parçası olmalı (pazarlama kiti, raporlar, teşvik).
4. Mikro esnafta destek maliyeti marjı yer. Segment ve self-servis disiplini şart.
5. Pazaryerleri ve Meta boşluğu kendileri doldurabilir. Operasyon ve dağıtım derinliği tek savunma.

---

## 9. Risk matrisi

### 9.1 Isı haritası (ID'ler; ayrıntı §9.2)

| Etki ↓ / Olasılık → | 1 Çok düşük | 2 Düşük | 3 Orta | 4 Yüksek | 5 Çok yüksek |
|---|---|---|---|---|---|
| **5 Ölümcül** | R35 | R19, R20 | R06, R08 | **R01** | |
| **4 Büyük** | | R24, R25, R29, R30 | R10, R11, R12, R13, R14, R15 | **R02, R03, R04, R05** | |
| **3 Orta** | | R32, R33, R34 | R21, R22, R23 | R09, R16, R17, R18 | **R07** |
| **2 Küçük** | | R36 | R31 | R26, R27, R28 | |
| **1 İhmal** | | | | | |

### 9.2 Ana tablo (skora göre sıralı)

| # | Risk | Kat. | O | E | Skor | Erken uyarı sinyali (KRI) | Azaltma (somut) | Faz |
|---|---|---|---|---|---|---|---|---|
| R01 | **Kanal taşıma başarısız:** işletme müşterisini kendi kanalına taşıyamaz, panel boş kalır | Pazar | 4 | 5 | **20** | 14 günde < 10 kanal siparişi; paket kartı QR tarama < %3; 60. günde kanal payı < %5 | Önce talep deneyi (D3/D4); pazarlama kiti (kart, magnet, GBP, IG, CTWA); kanala özel teşvik; "aynısından tekrar"; kanal karması raporu; segment: tekrar siparişi yüksek | Faz 0 → Pilot |
| R02 | **Ekip kapasitesi / kapsam şişmesi** (5 bileşen + concierge + destek) | Yürütme | 4 | 4 | **16** | Sprint hedefinin < %60'ı; pilot tarihi 2+ hafta kaydı; hata birikimi | MVP kapsamını kes (admin minimal, pazarlama sitesi tek sayfa, kurye görünümü basit); talep deneyi olumlu olmadan ağır geliştirme yok; haftalık kapsam gözden geçirme | Faz 0–1 |
| R03 | **Onboarding sürtünmesi** (Meta portföy, ES, coexistence, kart, görünen ad) | Meta/Op | 4 | 4 | **16** | ES terk > %30; kurulum > 1 gün; 131042 hataları; görünen ad reddi | Concierge; ön kontrol listesi; iki kapılı canlıya geçiş (önce web+panel, sonra WA); yeni numara alternatifi; Faz 2 MPS (kartsız) | Faz 1 |
| R04 | **Ödeme isteği düşük / "zaten WhatsApp'tan alıyorum"** | Pazar | 4 | 4 | **16** | Demo→deneme < %30; deneme→ücretli < %40; pilot sonrası ret | Segmentasyon (≥10 paket/gün); ROI hesaplayıcı; değer raporu; kaçırma çetelesi; ön satış (D6); fiyat testi (D5) | Faz 0 → Faz 2 |
| R05 | **Sipariş kaçırma** (panel kapalı, ses yok, internet, telefondan yanıt) | Op | 4 | 4 | **16** | Onay p95 > 2 dk; "sipariş nerede" mesajları; heartbeat kaybı | Ack + eskalasyon (push→WA→SMS→arama); Android sarmalayıcı; otomatik kabul; müşteriye gecikme mesajı; echo'da hatırlatma | Faz 1 |
| R06 | **Meta uygulamamızın gecikmesi, reddi veya kısıtlanması** (SPOF) | Meta | 3 | 5 | **15** | App Review "daha fazla bilgi"; doğrulama > 2 hafta; politika uyarısı | Faz 0 bugün; imzalı Solution Partner ön anlaşması; `WaTransport`; WhatsApp'sız çalışabilen ürün | Faz 0 |
| R07 | **Destek yükü 7/24** | Op | 5 | 3 | **15** | İşletme başı > 3 temas/ay; gece aramaları; geliştirme saati < %50 | P1 nöbet; uzaktan tanı kartı; self-servis video; bayi 1. seviye; destek etiketleme → ürün iyileştirme | Pilot → Faz 2 |
| R08 | **Güvenlik ihlali / kiracılar arası sızıntı** | Teknik | 3 | 5 | **15** | Pentest bulguları; anormal erişim logları; tahmin edilebilir ID'ler | RLS; çapraz kiracı testleri; ASVS L2; imzalı token'lar; dış güvenlik incelemesi; ihlal planı | Faz 1 |
| R09 | **Fiyat savaşı / ücretsiz alternatifler** | Pazar | 4 | 3 | **12** | "X firması daha ucuz" itirazı > %30; rakip ücretsiz bot katmanı | Sipariş başı maliyet anlatımı; resmî API güvencesi; yıllık plan; Faz 3 ücretsiz katman | Faz 2 |
| R10 | **Pazaryeri karşı hamlesi** (sözleşme, kendi doğrudan kanal ürünü, satın alma) | Pazar | 3 | 4 | **12** | Sözleşme değişikliği; esnafın "uyarı aldım" demesi; Uber Direct/Storefront benzeri duyuru | "Bağımlı kalma" mesajı; sözleşme incelemesi; çoklu taşıma yolu; kurye API entegrasyonuna hazır mimari | Sürekli |
| R11 | **İşletme numarasının kısıtlanması/banı** | Meta | 3 | 4 | **12** | Kalite sarı; 368/131031/131064/132015; engelleme artışı | MVP'de kampanya yok; şablon denetimi; commerce filtresi; sağlık alarmı; olay runbook'u | Faz 1 |
| R12 | **Coexistence kopması / senkron hatası / uygulamanın bozulması** | Meta | 3 | 4 | **12** | Echo gelmemesi; "son mesaj" sessizliği; kullanıcı şikâyeti | Onboarding öncesi yedek; 72 saat gözlem; 14 gün hatırlatıcısı; geçmiş senkronu kapalı; yeni numara alternatifi | Faz 1 |
| R13 | **Webhook kaybı/gecikme/işleme hatası** | Teknik | 3 | 4 | **12** | Canary gecikmesi > 60 sn; DLQ büyümesi; kuyruk yaşı | Ham olay kaydı + 200; ayrı öncelikli sipariş kuyruğu; dedupe; mutabakat işi | Faz 1 |
| R14 | **Tek sunucu / altyapı kesintisi** | Teknik | 3 | 4 | **12** | Uptime < SLO; disk/CPU alarmı; deploy hataları | 2+ düğüm ingress; replikalı DB + PITR; blue-green; yoğun saatte deploy yasağı; durum sayfası | Pilot öncesi |
| R15 | **KVKK** (m.9 aktarım, ihlal, aydınlatma) | Hukuk | 3 | 4 | **12** | Avukat görüşü gecikmesi; ilgili kişi başvurusu; Kurul duyuruları | Yurt içi barındırma; veri minimizasyonu; DPA; m.9 yazılı görüş; ihlal planı | Faz 0 |
| R16 | **Meta fiyat/politika değişikliği** (esnafın Meta faturası artar) | Meta/Fin | 4 | 3 | **12** | Changelog duyurusu; `pricing` nesnesinde kategori değişimi | Pass-through; konfigürasyonda rate card; sipariş başı ≤ 4 mesaj; maliyet paneli | Sürekli |
| R17 | **Enflasyon + kurucu üye sabit fiyatı + kur** | Fin | 4 | 3 | **12** | Brüt marjın %60 altına inmesi; USD gider oranı > %15 | Sabit indirim **oranı**; 6 aylık endeks; yıllık peşin; TL faturalı barındırma | Faz 2 |
| R18 | **Churn: restoran kapanışları ve mevsimsellik** | Pazar | 4 | 3 | **12** | Sipariş hacmi düşüşü; ödeme gecikmesi | Yıllık plan; hesap dondurma; su bayisi dikeyi; hacim düşüş uyarısı | Faz 2 |
| R19 | **Token/sır sızıntısı** | Teknik | 2 | 5 | **10** | Secret scanning uyarısı; olağandışı gönderim hacmi | KMS/envelope; secret manager; iptal runbook'u; log maskeleme | Faz 1 |
| R20 | **Veri kaybı** | Teknik | 2 | 5 | **10** | Yedek işi hatası; geri yükleme tatbikatı başarısız | PITR; farklı konumda yedek; aylık tatbikat; gün sonu döküm e-postası | Faz 1 |
| R21 | **Sahte/trol sipariş** (kapıda ödeme) | Op | 3 | 3 | **9** | İşletme şikâyeti; tekrar eden iptal/teslim edilemedi | WA doğrulaması (Akış B); BSUID başı limit; kara liste; ilk sipariş tutar sınırı; v1 online ödeme | Faz 1 |
| R22 | **Yoğun saat ölçeklenmesi** (insan + sistem) | Op | 3 | 3 | **9** | Tepe saatte p95 gecikme; durum butonlarına basılmaması | Yük testi ×5; deploy yasağı; "yoğun mod"; durum butonları kuryeye | Faz 1 |
| R23 | **WhatsApp/Meta global kesintisi** | Meta | 3 | 3 | **9** | Meta status; canary | "WhatsApp kapalı modu" (web + telefon + SMS) | Faz 1 |
| R24 | **Meta'nın kendi sipariş/AI özellikleri** değeri metalaştırır | Meta/Pazar | 2 | 4 | **8** | Meta duyuruları (Conversations etkinliği vb.) | Değer = operasyon + çok kanal + CRM + POS; Meta özelliklerini taşıyıcı olarak benimseme | Sürekli |
| R25 | **İYS/6563** (kampanya) | Hukuk | 2 | 4 | **8** | Kampanya modülü talebi; onaysız liste yükleme girişimi | MVP'de yok; Faz 2'de yazılımda zorunlu İYS kontrolü | Faz 2 |
| R26 | **Yanlış sipariş/adres** | Op | 4 | 2 | **8** | İade/şikâyet oranı; kurye "adres bulunamadı" | Yapılandırılmış sepet; konum pini; onay adımı; düzeltme akışı | Faz 1 |
| R27 | **Tahsilat sorunları** | Fin | 4 | 2 | **8** | Başarısız çekim > %10; havale gecikmesi | Dunning; yıllık peşin; 3DS uyumlu PSP; niyet mektubu | Faz 2 |
| R28 | **Onboarding kotası** (10/hafta) | Meta | 4 | 2 | **8** | Bekleyen kurulum kuyruğu | Doğrulama ve App Review hemen; sonra 200/hafta | Faz 0 |
| R29 | **Yanlış dikey / Commerce Policy** (tüp, alkol, nargile) | Meta | 2 | 4 | **8** | Satış hattında bu dikeylerden talep | Dikey beyaz listesi; ürün bayrakları; politika teyidi olmadan girme | Sürekli |
| R30 | **Dolandırıcılık** (sahte işletme, numara taklidi) | Güvenlik | 2 | 4 | **8** | Müşteri şikâyeti; aynı adla birden çok kayıt | İşletme onay akışı (admin); resmî hat rozeti; MVP'de ön ödeme yok | Faz 1 |
| R31 | **BSUID/kullanıcı adı: telefon eksik** | Meta/Op | 3 | 2 | **6** | Telefonsuz sipariş oranı | Formda teslimat telefonu; REQUEST_CONTACT_INFO; contact book açık | Faz 1 |
| R32 | **Pazaryeri sözleşmesi nedeniyle esnafın cezalandırılması** | Hukuk | 2 | 3 | **6** | Esnafın uyarı alması | Pilot öncesi sözleşme incelemesi; alternatif taşıma yolları | Faz 0 |
| R33 | **Kesinti sonrası tazminat talebi** | Hukuk | 2 | 3 | **6** | Büyük kesinti sonrası şikâyet | Sorumluluk sınırı; SLA kredisi; olay kaydı | Faz 1 |
| R34 | **AI (v1) yanlış anlama / politika** | Meta/Op | 2 | 3 | **6** | Düzeltme oranı; insan devri oranı | Kapsam sınırı; müşteri onayı; kapatılabilir bot | Faz 2 |
| R35 | **6493 ödeme aracılığı** | Hukuk | 1 | 5 | **5** | Ürün ekibinden "tahsil edelim" fikirleri | Para asla bizim hesaba girmez; ödeme özelliklerinde hukuk kapısı | Sürekli |
| R36 | **Marka/alan adı çakışması** | Hukuk | 2 | 2 | **4** | Tescil araştırması sonucu | TÜRKPATENT araştırması; erken başvuru | Faz 0 |

### 9.3 Admin panelinde izlenecek erken uyarı göstergeleri (KRI) [T]

| Gösterge | Eşik | Bağlı risk |
|---|---|---|
| İşletme başına kanal siparişi (7 gün) | < 5 → sarı, < 2 → kırmızı | R01, R18 |
| Kanal payı (kendi kanal / toplam) | 60. günde < %5 | R01 |
| `new → accepted` p95 | > 2 dk | R05 |
| Panel heartbeat kaybı (açık saatlerde) | > 5 dk | R05 |
| Canary uçtan uca gecikme | > 60 sn | R13, R14 |
| Kiracı sessizliği (yoğun saatte mesaj yok) | > 15 dk | R12, R13 |
| Meta kalite puanı | Sarı/kırmızı | R11 |
| Hata kodları 368/131031/131064/131042/132015 | Herhangi biri | R11, R03 |
| ES huni terki | > %30 | R03 |
| Destek teması / işletme / ay | > 3 | R07 |
| Başarısız abonelik çekimi | > %10 | R27 |
| Döviz bazlı gider / brüt gelir | > %15 | R17 |

---

## 10. "Önce doğrula" hipotezleri ve deney tasarımları

### 10.1 İlke

Faz 0'da en ucuz ve en hızlı öğrenilecek şey **talep ve ödeme isteği**. Meta kritik yolu (doğrulama, App Review) uzun süreli olduğu için paralel başlar. **Ağır ürün geliştirme ise (tam panel, admin, pazarlama sitesi) D1–D6 sonuçlarına bağlanmalı** [T]. KARARLAR "Faz 1 Hafta 1'de Faz 0 ile paralel başlar" diyor. Öneri: paralelliği yalnız teknik iskelet, webhook altyapısı ve ES ile sınırla; Hafta 6–8'de go/no-go kararı ver.

### 10.2 Hipotez listesi

| # | Hipotez | Neden kritik | Öldürme / pivot eşiği [T] | Deney |
|---|---|---|---|---|
| H1 | Hedef işletmelerin çoğu pazaryeri komisyonunu ilk 3 sorunundan biri sayıyor | Acı yoksa satış yok | Görüşülen 25 esnafın < %40'ı komisyonu ilk 3'e koyuyor | D1, D2 |
| H2 | Hedef işletmelerde günde ≥ 5 WhatsApp/telefon siparişi var **veya** pazaryerinden taşınabilecek tekrar eden müşteri kitlesi var | Ürünün çözdüğü hacim | Uygun işletme oranı < %30 | D1 |
| H3 | Pazaryeri müşterisi paket kartı + teşvikle kendi kanala geçiyor | **R01'in çekirdeği** | 4 haftada işletme başı < 10 kanal siparişi **veya** dağıtılan kart başına sipariş dönüşümü < %2 | D3, D4 |
| H4 | Yapılandırılmış web sepeti, "yazarak sipariş"ten daha çok tercih ediliyor veya en az kabul görüyor | Akış A'nın temeli | Menü linkine tıklayanların < %40'ı siparişi tamamlıyor | D3 (Seviye 0 menü sayfası), pilot |
| H5 | Esnaf 990/1.790 TL'yi ödemeye hazır | Gelir modeli | Pilot adaylarının < 3/10'u ön ödeme veya niyet mektubu veriyor; fiyat testinde orta fiyatta lead oranı alt fiyatın < %50'si | D5, D6 |
| H6 | Onboarding ≤ 1 günde tamamlanabiliyor; esnaf Meta'ya kart ekliyor | R03 | 3 kuru koşudan 2'sinde > 1 gün veya kart eklemeyi reddetme | D7 |
| H7 | Şirketimizin Meta doğrulaması ve App Review ≤ 6 haftada tamamlanıyor | R06, takvim | Hafta 8'de Advanced Access yok → Plan B (docs/02 §2.5) | D7 |
| H8 | Esnaf yoğun saatte paneli kullanıyor (telefona dönmüyor) | R05 | Pilotun 2. haftasında siparişlerin < %80'i panelde 2 dk içinde onaylanıyor | D8 |
| H9 | Destek yükü yönetilebilir | R07, marj | 2. ayda işletme başı > 4 temas/ay | D9 |
| H10 | Pazaryeri sözleşmeleri paket içi kartı ve kanala özel avantajı yasaklamıyor, ya da fiilen yaptırım yok | R32, R01 | Avukat "açık yasak ve yaptırım" diyor | D10 |
| H11 | Satış kanalları (oda, POS bayisi, muhasebeci, saha) CAC ≤ 4.000 TL üretebiliyor | Birim ekonomi | İlk 20 kapanışta karma CAC > 6.000 TL | Pilot + Faz 2 |
| H12 | Su bayisi segmenti daha kolay satılıyor ve daha az churn ediyor | Segment sırası | Su bayisinde kanal siparişi restorandan düşük | D3'e 2 su bayisi dahil |

### 10.3 Deney tasarımları

**D1 — Problem görüşmeleri (Hafta 0–2, maliyet: yalnız zaman)**
- **Kimle:** 25 işletme. 15 paket servis restoranı (dönerci, pide/lahmacun, kebap, pizza/burger), 5 su bayisi, 5 pastane. Pilot ilçelerden.
- **Nasıl:** Yüz yüze, 20 dk. "Mom Test" ilkesi: geleceği değil geçmişi sor, ürünü anlatma.
- **Örnek sorular:**
  - "Geçen Cuma akşamı kaç sipariş aldınız? Hangi kanaldan kaçar tane?"
  - "WhatsApp'tan gelen siparişi nasıl kaydediyorsunuz? En son ne zaman bir sipariş kaçırdınız veya karıştırdınız?"
  - "Son ayın pazaryeri kesinti dökümünü gösterebilir misiniz?" (Nisan 2026 düzenlemesiyle panelde kalem kalem var [K02])
  - "Şu an hangi yazılımlara ayda ne ödüyorsunuz?"
  - "Daha önce QR menü veya sipariş sistemi denediniz mi? Neden bıraktınız?"
  - "Pakete kart koymak sizin için sorun mu? Sözleşmenizde bununla ilgili bir şey var mı?"
- **Çıktı:** Acı sıralaması, WhatsApp/telefon sipariş hacmi, mevcut harcama, itirazlar, pilot adayları listesi.

**D2 — Kesinti dökümü analizi (Hafta 1–3)**
- 10 restorandan (izinle, anonimleştirerek) son 1–3 ayın pazaryeri kesinti dökümü toplansın.
- **Ölçüm:** gerçek efektif kesinti oranı (komisyon + reklam + kampanya payı), tekrar eden müşteri oranı (panel gösteriyorsa).
- **Karar:** Medyan efektif oran < %12 çıkarsa tasarruf mesajı zayıf demektir. Mesaj "düzen / sipariş kaçmasın" tarafına kaydırılmalı [T].

**D3 — Seviye 0 concierge talep testi (Hafta 2–8)**
- **Kapsam:** 6–10 işletme (2'si su bayisi). **Hiç ürün kodu yazmadan** sorulan soru: pazaryeri müşterisi kendi kanala geçiyor mu?
- **Kurulum:**
  - İşletme başına tek sayfalık statik menü (fotoğraf + fiyat). "WhatsApp'tan sipariş ver" butonu `wa.me/<işletme>?text=Merhaba, menüden sipariş vermek istiyorum (kod: K1)` açsın. Bu tamamen resmî ve API gerektirmeyen bir yol [K01 §8.3].
  - İşletme mevcut WhatsApp Business uygulamasını kullanmaya devam eder. Resmî olmayan hiçbir bağlantı kurulmaz.
  - **Paket içi kart ve magnet:** Her varyantın kendi QR'ı olsun (UTM + mesajdaki kod).
  - İşletmenin kasiyeri kanal siparişlerini günlük basit bir formla bildirsin. Kurucu her gün 5 dk arayıp kontrol etsin.
- **Ölçüm hunisi:**
  - dağıtılan kart
  - → QR tarama (sayfa ziyareti)
  - → WhatsApp mesajı (kod içeren)
  - → sipariş
  - → 2. sipariş (tekrar)
- **Başarı eşiği (KARARLAR §12 ile uyumlu):** 4 haftada işletme başı ≥ 10 kanal siparişi; 6. haftada tekrar sipariş veren müşteri oranı ≥ %30 [T].
- **Yan kazanım:** Sipariş metinleri toplanır (anonim). Bunlar ileride AI ayrıştırma test seti olur.

**D4 — Teşvik A/B testi (D3 içinde)**
- Üç kart varyantı: (a) "Ücretsiz ayran/içecek", (b) "%10 indirim", (c) "Dijital damga: 10. sipariş bedava".
- Her varyant ayrı QR ile; işletme başına eşit sayıda kart.
- **Ölçüm:** kart başına sipariş ve işletmeye maliyet. Komisyon oranına göre en kârlı teşvik seçilir (docs/01 başa baş mantığı).

**D5 — Landing page + bekleme listesi + fiyat testi (Hafta 1–6)**
- **Sayfa:** Değer önerisinin iki varyantı: "Komisyondan kurtul, sadık müşterin senin olsun" ve "Sipariş kaçmasın, WhatsApp siparişin düzene girsin". Komisyon hesaplayıcı (docs/01 §6.7) dahil.
- **Fiyat testi:** Pro fiyatı ziyaretçiye rastgele üç varyanttan biriyle gösterilsin (ör. 1.290 / 1.790 / 2.290 TL). CTA: "Kurucu üye listesine katıl" veya "Demo iste".
  - Etik not: Kayıt olanlara gerçek fiyat ve kurucu üye koşulu açıkça bildirilir. En düşük gösterilen fiyattan taahhüt verilmez; test yalnız ilgi ölçer [T].
- **Trafik:**
  - Pilot ilçede işletme sahiplerine hedefli Meta reklamı (esnaf/tacire yönelik B2B iletişimde ret hakkı sağlanmalı [K03 §3.7]),
  - saha ziyaretinde bırakılan kartvizit QR,
  - esnaf odası ve derneklerin **onaylı** duyuru kanalları.
- **Ölçüm:** ziyaretçi → hesaplayıcıyı tamamlama → lead; varyant başına lead oranı; demo randevusu.
- **Ek:** D1 görüşmelerinin sonunda Van Westendorp fiyat duyarlılığı soruları (4 soru).

**D6 — Ön satış / niyet mektubu (Hafta 4–8)**
- Pilot adaylarına iki seçenek sunulsun:
  - (a) "Kurucu üye Pro, 12 ay peşin (1.253 × 12 = 15.036 TL + KDV [T hesap]; docs/01'e göre kurucu indirimi yıllık peşin indirimiyle birleşmiyor, açık konu); pilot hedefi tutmazsa tam iade."
  - (b) "3 ay ücretsiz pilot; hedef tutarsa kurucu üye aylık plana geçiş taahhüdü" (imzalı niyet mektubu).
- **Başarı:** 10 adaydan ≥ 3 (a) **veya** ≥ 6 (b).
- **Not:** KARARLAR'daki "pilot 3 ay ücretsiz" ödeme isteği sinyalini zayıflatır. Bu deney o boşluğu kapatır.

**D7 — Meta onboarding kuru koşusu (Hafta 0–6)**
- **Bizim tarafımız:** Şirketin işletme doğrulaması (Ltd/AŞ belgeleriyle; şahıs şirketinde red vakası var [GH]), Tech Provider kaydı, ES v4 demosu, App Review videoları. Her adımın gün sayısı kaydedilsin.
- **İşletme tarafı (geliştirme modunda, tester rolüyle):** 3 dost işletme: (1) şahıs şirketi + WhatsApp Business uygulaması (coexistence), (2) Ltd + normal WhatsApp (önce Business'a geçiş), (3) yeni numara.
- **Ölçüm:** adım adım süre, hata ve iptal adımı (`current_step`), esnafın Meta'ya kart ekleme isteği, görünen ad sonucu, coexistence sonrası 72 saatlik davranış (echo, iPhone mesajları, 14 gün uyarısı).
- **Karar:** Hafta 8'de Advanced Access yoksa Plan B (docs/02 §2.5).

**D8 — Panel dayanıklılık gözlemi (pilotun ilk 2 haftası)**
- Her pilot işletmede bir Cuma ve bir Cumartesi akşamı, kurucu 1–2 saat yerinde gözlem yapsın: ekran nerede, ses açık mı, kim onaylıyor, telefondan mı yanıtlanıyor?
- Onay süresi, kaçırma ve "telefondan yanıt" oranı ölçülsün.

**D9 — Destek yükü ölçümü (pilot boyunca)**
- Her temas etiketlensin: kanal, saat, konu, çözüm süresi.
- 2. ayda işletme başına > 4 temas → ürün/eğitim yeniden tasarımı.

**D10 — Pazaryeri sözleşmesi incelemesi (Hafta 2–4)**
- Pilot adaylarından 3 güncel sözleşme (Yemeksepeti, Uber Eats Trendyol Go, Migros Yemek) avukata gösterilsin.
- **Sorular:** paket içi materyal, müşteri yönlendirme, fiyat paritesi, veri kullanımı, yaptırım maddeleri.

### 10.4 Karar kapıları [T]

| Kapı | Zaman | Geçiş koşulu | Geçemezse |
|---|---|---|---|
| **K1: Problem** | Hafta 2–3 | H1 ve H2 geçti (D1, D2) | Segment veya mesaj değiştir (ör. su bayisi, "düzen" mesajı); 10 görüşme daha |
| **K2: Talep ve ödeme** | Hafta 6–8 | H3 (D3/D4) + H5 (D5/D6) geçti | **Ağır geliştirmeyi durdur.** Pivot seçenekleri: POS'lara WhatsApp modülü satmak (B2B2B), su bayisi dikeyi, "sipariş kaçmasın" operasyon aracı |
| **K3: Platform** | Hafta 8 | H7: Advanced Access var | Solution Partner Plan B ile pilot |
| **K4: Pilot sonu** | Hafta 18 | KARARLAR §12 pilot metrikleri + H8, H9 + pilotların ≥ %60'ı ödemeye geçiyor | Ticari lansmanı ertele; en büyük 3 sorunu çöz; pilotu 6 hafta uzat |

---

## 11. En kritik 5 tavsiye

1. **Talebi ürün yazmadan önce test et (R01, R04).** Hafta 2–8 arasında 6–10 işletmeyle Seviye 0 concierge deneyi yapılsın (`wa.me` + paket kartı + teşvik; D3/D4). Paralelde landing + fiyat testi (D5) ve ön satış (D6) yürüsün. Ağır geliştirme **Hafta 6–8 karar kapısına** (K2) bağlansın. Paralel gidecek olanlar yalnız teknik iskelet, webhook altyapısı ve ES v4. Bu, en pahalı hatayı ("kimsenin kullanmadığı mükemmel panel") en ucuza önler.

2. **Meta kritik yolunu bugün başlat ve tek nokta arızasını kır (R06, R03, R28).**
   - Şirketin Meta işletme doğrulaması Ltd/AŞ belgeleriyle başlatılsın. Şahıs şirketiyle red vakası var.
   - Tech Provider kaydı, ES v4 (v2 8 Ekim 2026'da kalkıyor) ve App Review videoları hazırlansın.
   - Bir Türk Solution Partner ile **imzalı** Multi-Partner Solution ön anlaşması yapılsın.
   - Ürün "WhatsApp kapalı modunda" da (web storefront + manuel sipariş + SMS/telefon) çalışsın.
   - Onboarding iki kapılı olsun: önce web + panel canlı, WhatsApp bağlanınca devreye girsin.
   - 30 Eylül 2026 ödeme yöntemi son günü nedeniyle **kart adımı olmadan canlıya geçilmesin.**

3. **"Sipariş asla kaçmaz" pilottan önce hazır olsun (R05, R13, R14, R22).**
   - Katmanlı alarm ve eskalasyon, pilot cihazı olarak Android sarmalayıcı, otomatik kabul seçeneği.
   - Sentetik canary (5 dk), ayrı ve öncelikli sipariş kuyruğu, en az 2 düğümlü ingress, replikalı DB + PITR, aylık geri yükleme tatbikatı.
   - Cuma/maç akşamı deploy yasağı.
   - Pilot boyunca kurucuların nöbet tuttuğu bir P1 hattı.
   - KARARLAR'daki %99,9 SLO tek sunucuyla tutturulamaz. Ya altyapı güçlendirilsin ya pilot SLO'su açıkça düşürülsün.

4. **Riskli modülleri ertele, güvenliği baştan kur (R08, R11, R19, R25).**
   - MVP'de kampanya ve AI olmasın.
   - Şablon denetimi (utility şablonunda promosyon yasak), commerce filtresi, kalite ve hata kodu alarmları kurulsun.
   - Güvenlik tarafında: RLS + otomatik çapraz kiracı testleri, imzalı ve tahmin edilemez token'lar, webhook HMAC doğrulaması, paylaşılan tablet için vardiya PIN'i ve maskeleme, secret scanning.
   - Pilot öncesi dış güvenlik incelemesi yapılsın. Ayarlıyo'nun düzelttiği açık listesi (§6.4) kontrol listesine dönüştürülsün.

5. **Fiyatı enflasyona, kura ve Meta'ya karşı koru (R16, R17, R27).**
   - Kurucu üyeye "12 ay sabit fiyat" yerine "12 ay sabit %30 indirim **oranı**" verilsin; liste fiyatı 6 ayda bir TÜFE ile güncellensin.
   - Yıllık peşin ödeme teşvik edilsin.
   - Meta ücreti pass-through kalsın, panelde şeffaf gösterilsin, "komisyonsuz" iddiası "Meta'nın mesaj ücreti ayrıdır" notuyla verilsin.
   - Döviz bazlı giderlerin brüt gelire oranı %15'i geçmesin.
   - Pilot "3 ay ücretsiz" yerine niyet mektubu veya iade garantili ön ödemeyle yapılsın (D6).

---

## 12. KARARLAR ile gerilimler ve eklenmesi önerilenler

| KARARLAR maddesi | Kırmızı takım bulgusu | Öneri |
|---|---|---|
| §8: Kurucu üye %30, **12 ay sabit** (docs/01: TÜFE uygulanmaz) | Yüksek enflasyonda reel gelir erir; 12. ay sonunda liste fiyatına geçiş büyük bir zam gibi algılanır (§7.6) | "Sabit indirim oranı" veya 6 ay sabit |
| §8: Pilot 3 ay ücretsiz | Ödeme isteği sinyali oluşmaz (H5) | Niyet mektubu veya iade garantili yıllık ön ödeme (D6) |
| §11: Faz 1 Hafta 1'de Faz 0 ile paralel başlar | Talep doğrulanmadan ağır geliştirme = R02 + R01 | Paralellik teknik iskelet, webhook ve ES ile sınırlı; K2 kapısı (Hafta 6–8) |
| §12: Uptime ≥ %99,9 | docs/04 "tek sunucudan başla" diyor; ayda ~43 dk kesinti bütçesi | Pilot öncesi 2+ düğüm ve replikalı DB, veya pilot SLO'su %99,5 |
| §6.4: Coexistence varsayılan | Senkronun işletme uygulamasını bozduğu vaka var (#12469); iPhone mesajlarının düştüğü rapor var (#13464) | Onboarding öncesi yedek adımı, 72 saat gözlem, yeni numara seçeneği her zaman görünür |
| §12: "Sipariş kaçırma oranı %0" | Operasyonel tanımı yok | Tanım: "`new` durumunda 10 dk'dan uzun kalan ve müşteriye hiçbir yanıt gitmeyen sipariş." Ölçüm panelde. |
| §6.3: Şirket kuruluşu → doğrulama | Şahıs şirketiyle Meta doğrulaması reddi vakası var [GH] | Doğrulama Ltd/AŞ ile; ünvan, adres, alan adı ve e-posta tutarlı |
| (Eksik) | Destek modeli ve P1 nöbeti tanımlı değil | docs/10'da destek seviyeleri, saatler, P1 tanımı ve nöbet çizelgesi |
| (Eksik) | "WhatsApp kapalı modu" tanımlı değil | Web + manuel + SMS/telefon ile çalışma modu, ürün gereksinimi olarak |

---

## 13. Açık sorular

1. **Ekip ve nöbet:** Pilot boyunca (Hafta 10–18) Cuma–Cumartesi akşamları P1 hattına kim bakacak? Kurucular 7/24 nöbeti kabul ediyor mu?
2. **Talep deneyi:** Ağır geliştirmeyi Hafta 6–8 karar kapısına bağlamayı kabul ediyor musunuz, yoksa MVP'yi her durumda paralel mi yazmak istiyorsunuz?
3. **Tüzel kişilik:** Meta işletme doğrulaması hangi şirketle yapılacak (Ltd/AŞ mı, şahıs mı)? Alan adlı e-posta ve web sitesi hazır mı?
4. **Solution Partner:** Plan B için hangi Türk BSP'lerle görüşülecek? Bu partnerler aynı zamanda rakip olabilir [K01]. Hangisi kabul edilebilir?
5. **Coexistence risk iştahı:** Pilotta coexistence mı, yoksa ilk işletmelerde riski düşürmek için yeni numara mı?
6. **Fiyat politikası:** Kurucu üye koşulunu "sabit indirim oranı" olarak değiştirmeye açık mısınız?
7. **Pazaryeri sözleşmeleri:** Pilot adaylarından sözleşme örneği toplayıp avukata göstermek için bütçe ayrıldı mı?
8. **Pilot şehri:** Ekip nerede? Yerinde gözlem (D8) ve saha satışı fiziksel yakınlık gerektiriyor.
9. **Güvenlik incelemesi:** Pilot öncesi dış güvenlik incelemesi için bütçe ayrılabilir mi?
10. **Doğrulanamayan kritik bilgiler (birincil kaynaktan teyit edilmeli):**
    - Meta politika yaptırım süreleri ve coexistence'ta API yaptırımının telefondaki uygulamaya etkisi,
    - 2026 KVKK ve 6563 ceza tutarları,
    - Türkiye'de pazaryerlerinin "doğrudan kanal" ürünleri,
    - Meta Verified for Business'ın Türkiye durumu,
    - Uber–Getir taahhütlerinin içeriği,
    - yurt dışı başarısızlık vakalarının ayrıntıları (§8 [E] satırları).

---

## 14. Kaynaklar

**Bu oturumda GitHub'da okunan gerçek kayıtlar [GH]:**
- Chatwoot #8424 (27.11.2023), varsayılan şablon sonrası anında ban: https://github.com/chatwoot/chatwoot/issues/8424
- Chatwoot #12469 (18.09.2025), coexistence senkronu WhatsApp Business uygulamasını bozdu: https://github.com/chatwoot/chatwoot/issues/12469
- Chatwoot #13464 (06.02.2026), coexistence'ta iPhone mesajları işlenmiyor: https://github.com/chatwoot/chatwoot/issues/13464
- Chatwoot #14713 (11.06.2026), ES sonrası webhook kaydı (#100) hatası: https://github.com/chatwoot/chatwoot/issues/14713
- Chatwoot #13066 (14.12.2025), WhatsApp kutusu bağlantısı kopuyor: https://github.com/chatwoot/chatwoot/issues/13066
- Chatwoot #15530 (19.08.2026), yalnız BSUID'li kişiler görünmüyor: https://github.com/chatwoot/chatwoot/issues/15530
- Chatwoot ES/webhook başlıkları (yalnız başlık ve tarih okundu): #12188, #12242, #13154, #14529, #14739, #14800, #15131, #15325, #15754, #15857, #11901 (https://github.com/chatwoot/chatwoot/issues/<no>)
- Baileys #1876 (07.10.2025) toplu ban: https://github.com/WhiskeySockets/Baileys/issues/1876 ; #2260 (14.01.2026): https://github.com/WhiskeySockets/Baileys/issues/2260
- Evolution API #2693 (15.08.2026) 24 saat kısıt: https://github.com/evolution-foundation/evolution-api/issues/2693 ; #2646, #2659 (Temmuz 2026, başlıklar)
- Ayarlıyo durum belgesi (04.08.2026), Meta doğrulama reddi ve güvenlik düzeltmeleri: https://github.com/yunuskbl/BerberApp/blob/HEAD/DURUM.md
- Vacademy ES belgesi (17.07.2026): https://github.com/Vacademy-io/vacademy_platform/blob/HEAD/docs/whatsapp-embedded-signup/WHATSAPP_EMBEDDED_SIGNUP.md
- fonoster/qcobro WhatsApp runbook'u: https://github.com/fonoster/qcobro/blob/HEAD/docs/whatsapp-runbook.md
- Orenda-Project/rumi-platform WhatsApp onboarding (Mayıs 2026): https://github.com/Orenda-Project/rumi-platform/blob/HEAD/docs/onboarding/whatsapp.md
- KarzounApps WhatsApp hata kodları rehberi: https://github.com/KarzounApps/docs/blob/HEAD/ar/help-center/guides/whatsapp/errors.mdx

**Mevzuat [GH-M] ve ikincil [2K]:**
- 6563 sayılı Kanun m.12 (resmî: https://mevzuat.adalet.gov.tr/mevzuat/103057), GitHub aynası: https://github.com/onurcan-b/acik-mevzuat/blob/HEAD/kanunlar/6563-elektronik-ticaretin-duzenlenmesi-hakkinda-kanun/metin.md
- İYS notu (29.08.2026): https://github.com/BYSiriusApps/SiriPlan-App/blob/HEAD/docs/legal/IYS-HUKUKI-DAYANAK.md
- KVKK 2026 ceza bantları (aktaran rapor): https://github.com/aemreusta/ai-research-agent/blob/HEAD/examples/2026-09-17-final/kvkk-2026-saas-action-plan/report.md. Oradaki birincil/ikincil kaynaklar: https://esin.av.tr/tr/2026/01/12/kisisel-verilerin-korunmasi-kanununda-ongorulen-idari-para-cezalari-guncellendi ; https://mondaq.com/turkey/data-protection/1726256/ ; https://kvkkuyum.com/2026-kvkk-idari-para-cezalari-guncel-tutarlar-ve-artis-oranlari ; https://kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim

**Kardeş raporlar (kaynak zincirleri içlerinde):**
- `01-whatsapp-platform.md`: Meta fiyatlandırma, politika, ES, coexistence, BSUID, hata kodları (developers.facebook.com, whatsapp.com/legal, about.fb.com, 360dialog, YCloud, Courier, TechCrunch)
- `02-pazar-rakipler-is-modeli.md`: pazar, konsolidasyon, komisyonlar, Nisan 2026 düzenlemesi, Rekabet kararları, rakipler, global emsaller (ticaret.gov.tr, rekabet.gov.tr, SEC, Abrasel, Owner.com kaynakları)
- `03-mevzuat-odeme-fatura.md`: KVKK, İYS, 6493, e-ticaret, tahsilat, vergi
- `04-mimari-teknoloji.md`: gerçek zamanlılık, sipariş kaçırmama deseni, barındırma, güvenlik, maliyet

**Eğitim bilgisi [E] (bu oturumda doğrulanamadı):** DoorDash Storefront, Uber Direct, Grubhub Direct; Jumia Food çıkışı (Aralık 2023); Getir'in uluslararası çekilmeleri (2023–2024); Bikayi pivotu; Dukaan'ın destek otomasyonu (2023); ONDC yemek siparişlerinin seyri; 4 Ekim 2021 Meta küresel kesintisi; Meta Verified for Business'ın WhatsApp kapsamı.
