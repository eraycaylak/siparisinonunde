# 13 — Varsayım ve Teyit Kaydı

> **Amaç:** Plan setinde "(teyit edilmeli)", `[D?]`, `[?]`, `[E]`, "DOĞRULANAMADI" ve karar etkileyen `[T]` ile işaretlenmiş iddiaları tek listede toplamak. Her maddenin bir sahibi, son tarihi ve bağlı olduğu kapı var. Böylece hiçbir kapı kararı teyit edilmemiş bir varsayıma dayanarak sessizce verilmez.
> **Kapsam:** Kaydın kullanım kuralları, engelleyici teyitler (V-001–V-028), yüksek, orta ve düşük öneme sahip varsayımlar (V-029–V-090), [00](00-kararlar-ve-sozluk.md) §13'teki açık kararlar için sahip ve son tarih önerisi, işaret istatistiği, haftalık gözden geçirme şablonu ve değişiklik günlüğü.
> **Kapsam dışı:** Risklerin puanlanması ([10](10-riskler-operasyon-ve-metrikler.md) §3), iş hipotezleri ve deney eşikleri ([10](10-riskler-operasyon-ve-metrikler.md) §4.2–4.5; bu kayıt yalnız bağlantı verir), hukuki içerik ([08](08-mevzuat-kvkk-odeme-fatura.md)).
> **İlgili dokümanlar:** [00 Kararlar](00-kararlar-ve-sozluk.md) · [01 İş modeli](01-vizyon-pazar-is-modeli.md) · [02 WhatsApp](02-whatsapp-entegrasyonu.md) · [03 Storefront](03-musteri-deneyimi-ve-storefront.md) · [04 Panel](04-isletme-paneli.md) · [05 Admin ve site](05-admin-paneli-ve-pazarlama-sitesi.md) · [06 Mimari](06-teknik-mimari.md) · [07 Veri modeli](07-veri-modeli-ve-api.md) · [08 Mevzuat](08-mevzuat-kvkk-odeme-fatura.md) · [09 Yol haritası](09-yol-haritasi-ve-sprint-plani.md) · [10 Riskler](10-riskler-operasyon-ve-metrikler.md) · [12 Marka ve tasarım](12-marka-tasarim-ve-kullanilabilirlik.md)
> **Atıf biçimi:** `02 §5.3` = 02 numaralı plan dokümanının 5.3 bölümü. `A01 §4.3` = `arastirma/01-….md` raporunun 4.3 bölümü (URL'ler raporlarda). Satır numarası kullanılmaz, çünkü dokümanlar düzenlenmeye devam ediyor.
> **Tarih:** 2026-09-24 · **Durum:** Taslak v1 · **Kayıt sahibi:** KUR (hesap veren), TL (teknik maddelerin bakımı)

---

## 1. Amaç ve kullanım kuralları

### 1.1 Kayda ne girer, ne girmez

| Girer | Girmez |
|---|---|
| Doğrulanmamış işaretli iddialar: "(teyit edilmeli)", `[D?]`, `[O/D?]`, `[?]`, `[E]`, "DOĞRULANAMADI" | Tasarım önerisi niteliğindeki `[T]`'ler (ör. ekran düzeni, mikro metin önerisi) |
| Bir **kapıyı**, **fiyatı**, **maliyeti**, **hukuki metni** ya da **dışa verilen bir vaadi** etkileyen `[T]` tahminleri | Proje sahibinin vereceği kararlar: bunlar [00](00-kararlar-ve-sozluk.md) §13'te kalır (§4'te yalnız sahip ve tarih önerilir) |
| Birden çok dokümanda tekrar eden işaretler **tek madde** olarak girer ve tüm kaynaklar yazılır | Deney eşikleri ve go/no-go kuralları: kanonik yerleri [10](10-riskler-operasyon-ve-metrikler.md) §4.5 ve [09](09-yol-haritasi-ve-sprint-plani.md) §4.6 |

### 1.2 Sütunlar

- **ID:** `V-NNN`. Bir kez verilir, silinse bile yeniden kullanılmaz.
- **İddia:** Plan dokümanlarında şu an doğru kabul edilen ifade.
- **Kaynak:** İddianın geçtiği doküman ve bölüm. İlk kaynak ana kaynaktır.
- **Yanlışsa etkisi:** Hangi akış, kapı, metin veya rakam değişir.
- **Nasıl teyit edilir:** Kime sorulur ya da hangi birincil kaynağa bakılır, hangi test yapılır.
- **Sahip:** Tek hesap veren rol ([09](09-yol-haritasi-ve-sprint-plani.md) rol kısaltmaları: KUR, OPS, TL, FE, AV, MM, MV, TAS). Parantez içindekiler destek verir.
- **Son tarih:** 09'daki takvim ve kapılara göre **öneridir**. Ara adım varsa ";" ile ayrılır.
- **Kapı:** Madde teyit edilmeden verilmemesi gereken karar (§1.5).
- **Önem:** §1.4. **Durum:** §1.3.

### 1.3 Durum değerleri

| Durum | Anlamı | Geçiş kuralı |
|---|---|---|
| `acik` | Teyit işi başlamadı | Varsayılan |
| `devam` | Soru gönderildi, test veya teklif sürüyor | Sahip ilk adımı attığında |
| `teyit_edildi` | Birincil kaynak ya da test iddiayı doğruladı | Kanıt değişiklik günlüğüne (§7) yazılır. İlgili dokümanlardaki işaret kaldırılır |
| `yanlis_cikti` | İddia yanlış ya da farklı çıktı | Etkilenen dokümanlar güncellenir. Karar etkisi varsa **önce 00** güncellenir. Risk kaydında ([10](10-riskler-operasyon-ve-metrikler.md) §3.3) ilgili risk yeniden puanlanır |
| `iptal` | Madde artık gereksiz (özellik kapsamdan çıktı, karar değişti) | Gerekçe günlüğe yazılır. Satır silinmez |

### 1.4 Önem

| Önem | Tanım |
|---|---|
| **engelleyici** | Teyit edilmeden bağlı kapı kararı verilemez ya da ilgili akış, metin veya vaat yayımlanamaz |
| **yüksek** | Yanlış çıkarsa bir sprinti, pilotu ya da birim ekonomiyi belirgin biçimde etkiler, ama kapıyı tek başına durdurmaz |
| **orta** | Bir özelliği, metni veya maliyet kalemini değiştirir. Etki sınırlıdır |
| **düşük** | Bilgi amaçlıdır ya da Faz 3'e kadar etkisi yoktur |

§2'deki tablo, proje sahibinin kapı düzeyinde izlenmesini istediği maddeleri de içerir. Bunların bir kısmının önemi "yüksek" veya "orta"dır; bu maddeler kapıyı tek başına durdurmaz, ama kapı kararına girdi verir.

### 1.5 Kapılar ve kısaltmalar

| Kod | Kapı | Tarih ([09](09-yol-haritasi-ve-sprint-plani.md) §1.1) |
|---|---|---|
| K1 | Problem kapısı | 16 Eki 2026 (H3) |
| K2 | Talep ve ödeme go/no-go | 20 Kas 2026 (H8) |
| K3 | Platform kapısı (Advanced Access, D11, D12) | 20 Kas 2026 (H8) |
| P0 | Pilot öncesi kapı ("sipariş kaçmaz" paketi dahil) | 4 Ara 2026 (H10) |
| F2 | Faz 2 başı (ticari altyapı) | 28 Ara 2026 (H14) |
| K4 | Ticari lansman kapısı | Ön-onay 29 Oca 2027 (H18) · kesinleşme 12 Şub 2027 (H20) · lansman 15 Şub 2027 (H21) |
| İÜM | İlk ücretli müşteri | ≈ Mar 2027 ([09](09-yol-haritasi-ve-sprint-plani.md) §1.1 "İÜM" satırıyla aynı tanım): pilotların ücretliye geçişi (≈ 8–22 Mar 2027) **ya da** ticari lansmandan (15 Şub 2027) sonraki ilk self-servis ücretli kayıt, hangisi önce gelirse. **İstisna:** D6'da iade garantili ön ödeme gelirse ilk fatura H4–H8'de kesilir ([09](09-yol-haritasi-ve-sprint-plani.md) F0-H16) ve İÜM'ye bağlı mali teyitler o tarihe çekilir |
| F3 | Faz 3 planlaması | ≈ Haz 2027 |

### 1.6 Güncelleme kuralları

1. **Haftalık gözden geçirme:** Her Pazartesi 11:00'daki metrik toplantısında ([10](10-riskler-operasyon-ve-metrikler.md) §9.3, [09](09-yol-haritasi-ve-sprint-plani.md) §5.2), gündemin 5. maddesinin ("Riskler ve deneyler") hemen ardından kayda **5 dakika** ayrılır. Şablon §6'dadır.
2. **Durum değişince:** Sahip aynı gün şunları yapar:
   - (a) Bu kayıtta durumu günceller.
   - (b) §7 günlüğüne tarih, kanıt ve kaynağı yazar.
   - (c) Kaynak sütunundaki dokümanlarda "(teyit edilmeli)" ya da köşeli işareti kaldırır ve yerine kısa kaynak ile tarih koyar (ör. "(teyit: Meta rate card, 01.10.2026)").
   - (d) `yanlis_cikti` ise rakamı veya metni düzeltir, karar etkisi varsa önce [00](00-kararlar-ve-sozluk.md)'ı günceller.
3. **Kapı öncesi kontrol:** Her kapıdan (K1–K4, P0) bir iş günü önce kapıya bağlı tüm maddeler süzülür. `acik` ya da `devam` durumunda engelleyici madde varsa kapı kararına iki seçenekten biri açıkça yazılır: "şu maddeye rağmen şu gerekçeyle geçiyoruz" ya da "karar erteleniyor".
4. **Yeni madde:** Plan dokümanlarına yeni bir doğrulanmamış iddia yazan kişi aynı gün buraya satır ekler. Birden fazla dokümanda geçen iddia için yeni satır açılmaz; mevcut satırın kaynağına eklenir.
5. **Son tarih kaçarsa:** Madde "kırmızı" sayılır ve bir sonraki haftalık toplantıda yeni tarih ile gerekçesi yazılır. Engelleyici maddede tarih ikinci kez kaçarsa [10](10-riskler-operasyon-ve-metrikler.md) risk kaydına KRI olarak eklenir.
6. **Aylık:** Ayın ilk iş günündeki risk yeniden puanlamasında ([10](10-riskler-operasyon-ve-metrikler.md) §3.4) `teyit_edildi` ve `yanlis_cikti` sayıları aylık rapora ([10](10-riskler-operasyon-ve-metrikler.md) §9.4 "Riskler") girer.

### 1.7 Kanıt standardı

Kanıtlar güçten zayıfa şöyle sıralanır:
1. Resmi doküman veya mevzuat metni (Meta geliştirici dokümanı, Resmi Gazete, Kurum rehberi, tarife sayfası).
2. Sağlayıcının **yazılı** cevabı ya da teklifi (e-posta, teklif PDF'i).
3. Kendi testimiz (log, ekran görüntüsü, webhook örneği; D11, D12 gibi).
4. Avukat veya mali müşavirin yazılı görüşü (hukuki ve vergisel maddelerde zorunludur).

Üçüncü taraf blog, arama özeti veya rakip beyanı (`[3P]`, `[B]`) tek başına `teyit_edildi` için yetmez. Kanıt dosyaları ortak sürücüde `teyit/V-NNN/` klasöründe saklanır; bu klasör yapısı bir öneridir.

---

## 2. Engelleyici teyitler (V-001–V-028)

Sıralama son tarihe göredir. Tüm maddelerin durumu 24.09.2026 itibarıyla `acik`tır.

| ID | İddia | Kaynak | Yanlışsa etkisi | Nasıl teyit edilir | Sahip | Son tarih | Kapı | Önem | Durum |
|---|---|---|---|---|---|---|---|---|---|
| V-001 | **Meta Türkiye rate card (1 Eki 2026):** service, utility ve authentication ≈ $0,0009, marketing ≈ $0,0109; numara başına ayda ilk 1.000 service mesajı ücretsiz; Meta çeyreklik günceller | 00 §6.5 Mesaj ekonomisi; 01 §6.5 Meta ücretleri; 02 §4.2 Türkiye fiyatları; 05 A-07 Rate card; A01 §4.3 ([3P] üçgenleme) | Hesaplayıcı, satış dili ("mesaj başı ~4 kuruş", 04 §3.4.2) ve maliyet defteri yanlış olur. Utility fiyatı Nisan–Temmuz 2026 seviyesine ($0,0053) dönerse 30 sipariş/gün işletmede Meta ücreti ~667–898 TL/ay olur | Meta'nın resmi indirilebilir rate card'ının TR satırı + test numarasından alınan ilk ücretli status webhook'undaki `pricing` nesnesi. Kaynak `wa_rate_cards.source` alanına yazılır | TL | 2 Eki 2026 | K2 (D5 hesaplayıcı), P0 | engelleyici | `acik` |
| V-002 | **Marka ve alan adı müsait:** "Siparişin Önünde" 9, 35, 38 ve 42. sınıflarda tescil edilebilir; `siparisinonunde.com` alınabilir | 00 başlık notu ve §13.6; 08 §7.3 Marka tescili; 09 F0-H05, F0-H06; A06 R36 (DOĞRULANAMADI) | İsim, Meta görünen adı, BV unvanı ve künye, alan adları, basılı materyal yeniden yapılır | TÜRKPATENT (EPATS) benzerlik araştırması + marka vekilinin yazılı görüşü; kayıt şirketinde alan adı sorgusu | KUR (MV) | 2 Eki 2026 (başvuru; isim bu tarihten sonra duyurulur) | K3 (BV) | engelleyici | `acik` |
| V-003 | **`request_welcome`** olayı TR numaralarında geliyor ve 131047 almadan serbest CTA URL yanıtına izin veriyor | 00 §7 Mesaj koruma kuralları; 03 §2 Giriş noktaları, §3.1 Akış A; 10 §4.9 D12 (H14) | Akış A karşılaması yalnız müşterinin ilk mesajıyla tetiklenir. QR'lar ön dolu metinli kalır, huni tasarımı değişir | D12: W1–W5 senaryoları (test numarası + gerçek +90). Açılış için gereken hesap ayarı Cloud API resmi dokümanından okunur | TL | 9 Eki 2026 (S1 demo) | K3 | engelleyici | `acik` |
| V-004 | **CTA URL**, `location_request_message` ve **REQUEST_CONTACT_INFO** TR alıcılarında çalışıyor. Buton ≤ 20, gövde ≤ 1.024 karakter | 02 §6.3 Karşılama, §6.8 REQUEST_CONTACT_INFO, §12 #10; 03 §9.1 Yazım kuralları, §12 #18; 04 §5.5; 09 §6.2 DoD | CTA URL yoksa "Menüyü aç" adımı ve App Review videosu değişir. REQUEST_CONTACT_INFO yoksa kurye telefonu yalnız storefront alanından alınır (bugün de birincil yol bu) | Cloud API resmi dokümanı (mesaj türleri ve sınırlar) + test numarasından +90 Android ve iPhone alıcıya gönderim. Yanıt webhook yükü kaydedilir | TL | CTA URL: 9 Eki 2026 (S1); diğerleri: 20 Kas 2026 | K3 | engelleyici (CTA URL) · yüksek (diğerleri) | `acik` |
| V-005 | **Business Verification belge seti:** vergi levhası, ticaret sicil gazetesi veya faaliyet belgesi ve alan adlı e-posta yeterli. Unvan ve adres künyeyle birebir aynı olmalı. Şahıs şirketi reddedilebilir | 02 §2.2 Kontrol listesi; 08 §7.2 Kuruluş ve operasyon belgeleri; 09 §2.1–2.2; A01 §1.3 [?]; A06 R03 | BV reddi veya ek belge talebi App Review'u ve 200/7 gün kotasını geciktirir. T1 ve T2 tetikleri çalışır ([09](09-yol-haritasi-ve-sprint-plani.md) §2.5) | Meta Business Help Center'daki belge listesi + başvurunun kendisi. Ret veya ek belge yanıtı kanıt olarak saklanır | KUR (MM) | Başvuru 9 Eki 2026; onay hedefi 23 Eki | K3 | engelleyici | `acik` |
| V-006 | **Çerezsiz analitiğin rıza muafiyeti:** çerezsiz, kimliksiz, sunucu tarafı analitik (TR'de self-host Umami/Plausible CE) açık rıza gerektirmez | 05 C.9 Analitik ve çerez uyumu, Açık konular #10; 08 §2.13 Çerezler; 09 §2.3 Hukuk belge seti | D5 sayfasına ve storefront'a rıza paneli gerekir. D5 fiyat testinin (G7) verisi rıza oranıyla bozulur | Avukatın yazılı görüşü + KVKK Çerez Uygulamaları Hakkında Rehber (2022) metni ("benzeri teknolojiler" kapsamı) | AV (FE) | 12 Eki 2026 (D5 metin kontrolü) | K2 | engelleyici (D5 için) | `acik` |
| V-007 | **Pazaryeri sözleşmeleri** paket içi QR ve kartı, müşteriyi kendi kanala yönlendirmeyi ve kanala özel fiyatı fiilen yasaklamıyor ya da yaptırım uygulanmıyor | 03 §2 Giriş noktaları; 04 §12.1 QR ve paket kartı; 08 §10 #16; 09 F0-H10; 10 §4.3 D10 (H10); A06 R32 (DOĞRULANAMADI) | D3 talep deneyinin ve ana GTM kanalının (paket içi kart) hukuki zemini çöker. Esnaf pazaryerinden yaptırım görebilir | D10: pilot adaylarından 3 güncel sözleşme avukata verilir, kısa yazılı görüş alınır | AV (KUR) | İlk görüş kart dağıtımından önce; yazılı görüş 16 Eki 2026 | K1, K2 | engelleyici | `acik` |
| V-008 | **Komisyon oranları:** resmi tarife yok; Yemeksepeti ~%25–40, Uber Eats Trendyol Go %15–38, Migros %15–25. Başa baş ~21 sipariş/ay | 00 §8 Başa baş argümanı; 01 §1.1 Komisyon bantları, §6.7 Hesaplayıcı; 05 C.4 Hesaplayıcı; A02 §2.4 | Ana mesaj ve hesaplayıcı yanlış olur. D2 medyanı < %12 çıkarsa mesaj "düzen / sipariş kaçmasın" tarafına kayar (K1 kuralı) | D2: 10 restorandan izinli, kalem kalem kesinti dökümü (Nisan 2026 düzenlemesiyle panelde görünüyor) + D10 sözleşmeleri | KUR | 16 Eki 2026 | K1 | engelleyici | `acik` |
| V-009 | **Yurt içi barındırma:** en az 2 ayrı TR veri merkezi, ≥ %99,9 SLA, ISO 27001, DPA ve S3 uyumlu depolama makul fiyatla alınabiliyor. Maliyet 06 §17 aralığında | 00 §10 Barındırma, §13.4; 01 §7.1 COGS; 05 Açık konular #26; 06 §13.2 Sağlayıcı kriterleri, §17 Maliyet; 08 §2.12; A04 (DOĞRULANAMADI) | Prod ortamı (S4-13), ikinci ingress VPS'i ve iki lokasyonlu PITR gecikir, P0 tehlikeye girer. COGS ve Esnaf marjı artar. "Verileriniz Türkiye'de" iddiası yayımlanamaz | 06 §13.2 kriterleriyle en az 3 yazılı teklif (Turkcell Bulut, Türk Telekom, Huawei Cloud İstanbul, Radore, Bulutistan). Sağlayıcı DPA'sı ve ISO belgesi alınır | TL (KUR bütçe) | 16 Eki 2026 | P0 | engelleyici | `acik` |
| V-010 | **ES v4 ayrıntıları:** `extras` alanları; token süresi (süresiz mi, 60 gün mü); `debug_token` `granular_scopes.target_ids` ile WABA doğrulaması; kod ömrü (~60 sn) | 02 §2.3 ES v4 yapılandırması, §3.4 Backend, §12 #6 ve #10; 09 §5.4 S2 riskleri; A01 §2.3 [?] | Onboarding akışı App Review videosunda çalışmaz. Token süreliyse yenileme alarmı zorunlu olur | Meta ES v4 resmi dokümanı + staging'de uçtan uca ES denemesi | TL | 23 Eki 2026 (S2 demo) | K3 | engelleyici | `acik` |
| V-011 | **Platform şablonları utility kategorisinde onaylanıyor:** `isletme_yeni_siparis_v1`, `isletme_panel_cevrimdisi_v1`, `kurye_giris_v1`, `platform_planli_bakim_v1`, `platform_hizmet_bildirimi_v1`, `platform_hizmet_duzeldi_v1` | 02 §5.3 Platform WABA'sı şablonları, §12 #16; 09 §2.4, F0-M08; 10 §6.3, §11 #10 | Kademeli alarmın 2. dakika adımı, kurye girişi ve olay duyuruları pilotta çalışmaz. `kurye_giris_v1` authentication sayılırsa kod tabanlı şablona veya SMS'e geçilir | Şablonlar H3–H4'te Meta'ya gönderilir; `message_template_status_update` sonucu ve atanan kategori kaydedilir | TL | 23 Eki 2026 | P0 | engelleyici | `acik` |
| V-012 | **SMS/OTP fiyatı:** toplu SMS ≈ 0,16–0,43 TL. OTP özel tarifesi, Türkçe karakter ve segment etkisi bilinmiyor | 00 §4 SMS maliyeti; 01 §7.1, §11 #18; 03 §9.5 SMS metinleri; 06 §17; 10 §6.3; A04 (DOĞRULANAMADI) | Esnaf 100 / Pro 300 SMS kotasının COGS'u değişir. Metinler 2 segmenti aşabilir | Netgsm, İleti Merkezi ve Verimor'dan yazılı teklif (08 §11.3-8) + Türkçe karakterli gönderim testi | TL | 23 Eki 2026 | P0, K4 (Esnaf marjı) | yüksek | `acik` |
| V-013 | **Teknokent KDV istisnası:** KDV geçici m.20 SaaS aboneliğine uygulanabilir; 4691 kazanç istisnası 31.12.2028'e kadar sürüyor | 00 §9 Vergi/şirket, §13.3; 08 §8.5 Teknokent, §10 #19, §11.2-1; 09 §10.3, F0-H14 | Fiyat sayfasındaki KDV dahil tutar, nakit planı, şirket adresi ve NACE seçimi değişir | Mali müşavir + Teknokent yönetimi; ilgili özelgelerin taranması | KUR (MM) | NACE seçiminden önce ön görüş (tescil, en geç 9 Eki); karar notu 23 Eki 2026 | K4 (fiyat sayfası) | yüksek | `acik` |
| V-014 | **SambaPOS ve Adisyo** sipariş aktarımı için API ve sandbox erişimi veriyor; ticari koşullar Pro paketine dahil edilebilecek düzeyde | 01 §4.2 POS ekosistemi, §8.8 Faz 0 görüşmeleri ve entegrasyon karar matrisi; 09 §1.1 (Mar 2027), F0-G10, §8.1 F2-05; A02 §4. Diğer POS adayları ve partner sözleşmesi: V-090 | F2-05 ve GloriaFood geçiş kampanyası (son tarih 30.04.2027) yapılamaz. "POS-agnostik kanal" konumlandırması zayıflar | Faz 0 görüşmeleri: API dokümanı, sandbox, ticari koşul, NDA (SambaPOS, Adisyo; ek olarak robotPOS, Simpra) | KUR (TL) | İlk görüşme 23 Eki 2026 (öneri); yazılı erişim 28 Ara 2026 | F2 | yüksek | `acik` |
| V-015 | **App Review:** inceleme birkaç gün ile birkaç hafta sürer, ret olursa +1–2 hafta eklenir. BV onayının App Review'dan önce şart olup olmadığı ve `business_management` izninin gerekip gerekmediği bilinmiyor | 02 §2.2, §12 #7; 09 §2.1 Kritik yol, §2.5 T2, §12 #23; A01 §1.3 [?] | 2 haftalık bolluk yalnız tek bir reddi karşılar. İkinci ret ya da yanlış sıralama Plan B'yi (T4) tetikler | Meta App Review dokümanı + başvuru sonucu; gerekirse Meta destek kaydı | TL | Başvuru 27 Eki 2026 (en geç 6 Kas) | K3 | engelleyici | `acik` |
| V-016 | **Plan A':** pilot işletme sahipleri uygulamaya "tester" rolüyle eklenince standart erişimle onlar adına mesaj gönderilebiliyor | 02 §2.5 Geliştirme modu kısıtı; 09 §2.5 T3–T4; 10 §4.3 D7 | App Review gecikirse tek seçenek Solution Partner (Plan B) kalır | D7 kuru koşusunda 3 dost işletmeyle gerçek gönderim testi | TL (OPS) | 20 Kas 2026 (T4); test D7 içinde (H5–H8) | K3 | engelleyici | `acik` |
| V-017 | **Solution Partner (Plan B):** Türk bir BSP Cloud API uyumlu uç nokta, yeterli onboarding kapasitesi ve kabul edilebilir fiyat sunuyor (Türk BSP fiyatları doğrulanamadı) | 00 §6.2; 02 §7.10 Taşıyıcı soyutlaması; 09 §2.5, F0-M11, §11.2; A01 §1.4 [?] | T4'te pilot partner üzerinden kurulamaz. K4'te 200/7 gün kotası yoksa lansman durur | 3–4 Türk BSP'den yazılı teklif + teknik not + kapasite taahhüdü | KUR (TL) | Ön anlaşma 6 Kas 2026 | K3, K4 | engelleyici | `acik` |
| V-018 | **Coexistence +90 numaralarda çalışıyor:** bağlanma, iPhone ve Android mesajları, echo, 24 saat sonrası şablon, 7 gün kesintisiz kullanım. Kısıtlar: 20 mesaj/sn, uygulama ≥ 14 günde bir açılmalı | 00 §6.4 Varsayılan onboarding; 02 §3.2, §12 #5; 09 §2.4, §11.1; 10 §4.8 D11 (H13); A01 §3.1 [?]; A06 §3.6 | Varsayılan onboarding yolu yeni numaraya döner. Bu, 00 §6.4'ten sapmadır ve önce 00 güncellenir. Satış mesajı ("numaran değişmez") değişir | D11: 2 gerçek +90 numara, C1–C9 senaryoları. C1–C4 ve C7 zorunlu | TL | 20 Kas 2026 | K3, P0 | engelleyici | `acik` |
| V-019 | **Tech Provider onboarding limitleri:** Advanced Access ve Live mod ile 7 günde 10 işletme; BV ve App Review sonrası 7 günde 200 işletme. "Access Verification" şartı çelişkili | 00 §6.3 Kritik yol; 02 §2.2; 09 §2.1; A01 §1.3 [?] | Pilot dalgaları (3+4+3) 10'luk sınıra sığar. Lansman hızı (ayda 20–25 işletme) ve Faz 3 (~100/ay) 200'lük kotaya bağlıdır | Meta geliştirici dokümanı + App Dashboard'daki kota göstergesi (admin panelde "kalan onboarding kotası" sayacı) | TL | 10/7 gün: 20 Kas 2026; 200/7 gün: 29 Oca 2027 | K3, K4 | engelleyici | `acik` |
| V-020 | **SMS gönderici başlığı:** ≤ 11 karakterlik alfanümerik başlık (örnek "SIPARISNDE") onaylanıyor ve onay süresi pilot öncesine sığıyor | 00 §7 SMS gönderici başlığı; 03 §9.5; 09 §2.4, F0-H12 | SMS OTP yedeği ve 5. dakika alarm SMS'i (S5) çalışmaz. WhatsApp'sız mod P0'da test edilemez | Seçilen sağlayıcı üzerinden başlık başvurusu; sağlayıcının başlık kuralları yazılı alınır | TL (KUR) | Başvuru 9 Eki 2026; onay 20 Kas 2026 | P0 | engelleyici | `acik` |
| V-021 | **Canary numaraları arasında otomatik mesajlaşma** Meta politikasına uygun ve maliyeti ayda birkaç dolar | 06 §7.10 Sentetik canary; 10 §7.3, §11 #19 | Pilot öncesi zorunlu paketin platform canary'si tasarlandığı gibi çalışamaz. Platform WABA'sı kısıtlanabilir | WhatsApp Business Messaging Policy metni + Meta destek kaydı veya partnerden yazılı cevap | TL | 20 Kas 2026 | P0 | engelleyici | `acik` |
| V-022 | **Google Maps kotaları:** Mart 2025'ten beri SKU başına aylık ücretsiz kota var (Essentials 10.000, Pro 5.000, Enterprise 1.000) ve kota platform genelinde geçerli. Places Autocomplete'in SKU'su ve aşım fiyatı bilinmiyor | 00 §10 Harita; 01 §7.1; 06 §10.3 Geocoding, §18 #14; A04 §6.3 | Harita kalemi COGS'a (0–60 TL/işletme) sığmaz; self-host Photon/OSRM öne çekilir | Google Maps Platform fiyatlandırma sayfası (A04'teki kaynak) + Cloud Console'da faturalama raporu ve bütçe alarmı | TL | 20 Kas 2026 (S4 sonu) | P0 | yüksek | `acik` |
| V-023 | **SMS'in İYS sınıflandırması:** müşteri OTP'si, WhatsApp'sız moddaki onay ve iptal SMS'leri ve işletmeye giden alarm SMS'i "bilgilendirme" iletisidir; önceden onay ve İYS kaydı gerekmez | 08 §3.1 SMS kanalı, §9.1, §11.1-10 | Ticari ileti sayılırsa İYS sorgusu olmadan gönderilemez. OTP yedeği ve alarm zinciri hukuken sorunlu hale gelir | Avukatın yazılı görüşü + sağlayıcı arayüzündeki ileti türü alanı ve kuralı + İYS SSS | AV (TL) | 27 Kas 2026 | P0 | engelleyici | `acik` |
| V-024 | **Fişteki "Mali değeri yoktur" ibaresi:** panel fişi (80/58 mm) mali belge yerine geçmeyen bir sipariş fişidir | 00 §10 Yazdırma; 04 §4.14 Yazdırma; 06 §9.2 Fiş şablonu; 08 §5.7, §11.2-5 | Fiş şablonu ve esnafa verilen belge rehberi değişir. Esnaf ceza riskiyle karşılaşabilir | Mali müşavirin yazılı görüşü | MM (KUR) | 27 Kas 2026 | P0 | yüksek | `acik` |
| V-025 | **Online satışta belge (e-Arşiv):** WhatsApp siparişi + kapıda ödemenin "internet satışı" sayılıp sayılmadığı belirsiz. İnternet satışında e-Arşiv zorunluluğu ve daha düşük e-belge eşikleri olduğu hatırlanıyor | 08 §5.7 Belge yükümlülüğü, §6.5, §10 #9, §11.2-5 | Esnafın ÖKC fişi yerine e-Arşiv düzenlemesi gerekebilir. Ürün vaadi, onboarding ve Faz 2–3'te POS/e-Arşiv önceliği değişir | Mali müşavirin yazılı görüşü; VUK 509 sıra no'lu Genel Tebliğ metni; GİB duyuruları | MM (KUR) | 4 Ara 2026 (ön görüş); esnaf belge rehberi K4'ten önce | P0, K4 | yüksek | `acik` |
| V-026 | **KVKK m.9 ve Meta:** Meta (Cloud API) aktarımında standart sözleşme yolu var, ancak Meta'nın Türk standart sözleşmesini imzalayıp imzalamadığı doğrulanamadı. Aktaranın kim olduğu ve Meta sunucu konumu da belirsiz | 00 §9 KVKK rolleri, §10; 08 §1.2, §2.11 Yurt dışına aktarım, §10 #1, §11.1-1; A03; A06 K03 (DOĞRULANAMADI) | Çekirdek kanal hukuki risk taşır. Aydınlatma metni, DPA, satış vaadi ve K4 lansmanı etkilenir; Kurul yaptırımı riski doğar | Meta'ya ve Solution Partner'lara yazılı soru (F0-H15); Meta şartlarında KVKK modülü araması; avukatın yazılı görüşü | KUR (AV) | Soru 9 Eki 2026; risk değerlendirmesi P0'da; yazılı görüş 15 Oca 2027 | P0, K4 | engelleyici | `acik` |
| V-027 | **Esnaf paketi marj varsayımları:** destek 200–400 TL/işletme (uzman başına 150–300 işletme), SMS kotası kısmen kullanılır, altyapı ~$2–3,5/işletme (1.000 işletme ölçeğinde). Bu varsayımlarla marj %29–67 | 00 §12, §13.11; 01 §7.1 COGS, §7.2 Brüt marj; 09 §8.1 Fiyat revizyonu; 10 §11 #22 | Fiyat sayfası ve paket kotaları yanlış kurulur, karma ≥ %70 marj hedefi tutmaz | Pilot verisi: D9 (temas/işletme), SMS ve altyapı gerçekleşmesi (V-009, V-012), admin paneldeki tenant sayaçları | KUR (`finance`) | 29 Oca 2027 (K4 ön-onay); 12 Şub'da teyit | K4 | engelleyici | `acik` |
| V-028 | **Yemek kartı entegrasyonu:** online tahsilat her markayla ayrı iş ortaklığı ve işletmenin online üye işyeri olmasını gerektiriyor. Toplu sunan bir kuruluş olup olmadığı ve komisyon tavanı tartışmaları doğrulanamadı | 00 §5 Ödeme yöntemi, §13.9; 08 §5.6 Kapıda ödeme ve yemek kartları, §10 #18, §11.3-7 | Online yemek kartının fazı ve 00 §13.9 kararı değişir. "Yemek kartı alıyor musunuz?" itirazına verilen cevap etkilenir | Multinet, Pluxee, Edenred, Setcard ve Metropol'e yazılı soru: API, küçük işletme şartları, komisyon | KUR | 29 Oca 2027 | K4 (Faz 2–3 planı) | orta | `acik` |

### 2.2 Kapıya göre görünüm

| Kapı | Tarih | §2 maddeleri | §3 maddeleri |
|---|---|---|---|
| K1 | 16 Eki 2026 | V-007, V-008 | — |
| K2 | 20 Kas 2026 | V-001 (hesaplayıcı), V-006, V-007 | V-034, V-040, V-056, V-079, V-083 |
| K3 | 20 Kas 2026 | V-002, V-003, V-004, V-005, V-010, V-015, V-016, V-017, V-018, V-019 (10/7) | V-030, V-044, V-045 |
| P0 | 4 Ara 2026 | V-001, V-009, V-011, V-012, V-018, V-020, V-021, V-022, V-023, V-024, V-025, V-026 (risk değerlendirmesi) | V-031–V-033, V-035–V-038, V-046–V-052, V-058, V-068, V-069, V-084, V-085, V-086 |
| F2 | 28 Ara 2026 | V-014 | V-041, V-053, V-061, V-062, V-071–V-073, V-075–V-077, V-084, V-090 |
| K4 | 29 Oca / 12 Şub 2027 | V-012, V-013, V-017, V-019 (200/7), V-025 (rehber), V-026 (görüş), V-027, V-028 | V-039, V-053–V-055, V-057, V-059, V-064–V-066, V-076, V-081, V-082 |
| İÜM | §1.5 | — | V-060–V-063 |
| F3 | ≈ Haz 2027 | — | V-042, V-043, V-087, V-088, V-090 |

---

## 3. Yüksek, orta ve düşük öneme sahip varsayımlar (V-029–V-090)

Aynı sütunlar, daha kısa yazım. Tümünün durumu `acik`tır.

### 3.1 Meta ve WhatsApp platformu

| ID | İddia | Kaynak | Yanlışsa etkisi | Nasıl teyit edilir | Sahip | Son tarih | Kapı | Önem | Durum |
|---|---|---|---|---|---|---|---|---|---|
| V-029 | Kendi WABA'mıza 30 Eylül'e kadar ödeme yöntemi eklenmeli; test numarasında da gerekip gerekmediği belirsiz | 09 §1.1, F0-M03, §12 #24 | Platform WABA'sında service mesajı teslim edilmez | Kart her durumda eklenir; Meta duyurusu ve Billing ekranı | KUR (TL) | 30 Eyl 2026 | — | yüksek | `acik` |
| V-030 | 1 Ekim sonrasında işletme WABA'sında kart yoksa service mesajı teslim edilmez (131042). Billing Hub'a derin bağlantı URL'si ve ödeme yönteminin API'den okunup okunamadığı belirsiz | 00 §8; 02 §3.7 Ödeme yöntemi adımı; 04 §3.4.2; 09 §2.4 | Onboarding'in zorunlu adımı ve sağlık kontrolü yanlış kurulur | Meta resmi duyurusu + D7'de gerçek işletmeyle deneme | TL (OPS) | 20 Kas 2026 (D7) | K3 | yüksek | `acik` |
| V-031 | BSUID tüm webhook'larda geliyor; kullanıcı adlarının Türkiye açılış tarihi bilinmiyor; BSUID'ye gönderimde istek alanının adı teyit edilmeli | 00 §6.8; 02 §8.1–8.2, §12 #10; A01 §7 [?]; A06 | Kurye telefonu ve Akış E bilgilendirmesi etkilenir, gönderim yolu değişir | Cloud API resmi dokümanı + test numarasıyla gönderim | TL | 4 Ara 2026 | P0 | yüksek | `acik` |
| V-032 | Ücretsiz 1.000 service kotası webhook'ta işaretleniyor; ay sınırının saat dilimi ve `pricing_model` değeri (PMP?) teyit edilmeli | 02 §4.5 Maliyet defteri; 07 §11 #15; A01 §9.2 [?] | "Bu ay Meta'ya tahmini ödeme" rakamı sapar | Test numarasının status webhook'ları + resmi doküman | TL | 4 Ara 2026 | P0 | orta | `acik` |
| V-033 | Şablon kuralları: gövdenin değişkenle başlaması veya bitmesi reddedilir; TTL aralığı; durum değerlerinin tam listesi | 02 §5.1, §5.4; 03 §9.4 | Şablon reddi pilotu geciktirir; geç teslim edilen "yolda" mesajı gider | Resmi doküman + ilk gönderim sonuçları | TL | 23 Eki 2026 | P0 | orta | `acik` |
| V-034 | `hesap_sonucu_v1` utility kategorisinde onaylanır (marketing'e çevrilme riski var) | 02 §5.3; 05 C.4.5 | Hesaplayıcının "Bu hesabı WhatsApp'ıma gönder" akışı pahalılaşır ya da onaylanmaz | Şablonun gönderim sonucu | TL (KUR) | 23 Eki 2026 | K2 | orta | `acik` |
| V-035 | `biz_opaque_callback_data` status webhook'unda geri geliyor; Graph API'de idempotency anahtarı yok | 02 §7.4 Status monotonluğu, §7.5 Outbox; A01 §9.3 [?] | Belirsiz sonuçlarda mükerrer mesaj gider | Resmi doküman + zaman aşımı testi | TL | 6 Kas 2026 (S3) | P0 | orta | `acik` |
| V-036 | Webhook alan listesi, `account_update` olay tipleri, Health Status API alanları, Meta durum sayfası adresi ve Tech Provider'lara açık destek kanalı biliniyor | 02 §7.9; 10 §5.8 Meta eskalasyonu, §6.6 Runbook'lar, §11 #19 | Yaptırım veya bağlantı kopması algılanmaz; runbook'lar eksik kalır | App Dashboard + resmi doküman + Meta destek | TL | 4 Ara 2026 | P0 | yüksek | `acik` |
| V-037 | Normal WhatsApp'tan Business uygulamasına geçişte sohbetler taşınıyor; numara başka sağlayıcıdaysa ayrılma adımları biliniyor | 02 §3.2, §3.9 Hata ve kurtarma; A01 §3.4 | Onboarding rehberi yanlış olur, kurulum günü takılır | WhatsApp resmi SSS + D7 ve D11 | OPS (TL) | 20 Kas 2026 | P0 | orta | `acik` |
| V-038 | Coexistence yan konuları: WhatsApp Business uygulamasının karşılama ve uzakta mesajları botla çakışabilir (C5); eşlik eden istemcilerin (C9) davranışı ve kişi senkronu kapalıyken yan etki olup olmadığı belirsiz | 02 §12 #5; 03 §8.5; 10 §4.8 | Çift karşılama mesajı gider, mesaj kaybolur | D11'de C5 ve C9 senaryoları | TL | 20 Kas 2026 | P0 | orta | `acik` |
| V-039 | API tarafındaki bir yaptırımın Coexistence numarasında telefondaki uygulamayı ne kadar etkilediği doğrulanamadı; en kötü durum varsayılıyor | A06 §3.6 (DOĞRULANAMADI); 10 §4.8 | Esnafın ana numarası kapanabilir; "numaran güvende" vaadi etkilenir | Meta resmi politika metni + destekten yazılı cevap | KUR (TL) | 29 Oca 2027 | K4 | yüksek | `acik` |
| V-040 | WhatsApp Business uygulamasında sohbet etiketi özelliği var ve D3 sayımında kullanılabilir (özelliğin adı teyit edilmeli) | 09 §4.3 Materyaller, §12 #25; 10 §4.4 | D3 sayımı ve G1–G5 ölçümü bozulur | Uygulamanın güncel sürümünde deneme | OPS | 2 Eki 2026 (H1 çetelesi) | K2 | yüksek | `acik` |
| V-041 | Parent BSUID'nin çok şubeli ve ayrı portföylü yapıdaki davranışı bilinmiyor | 02 §8.4, §12 #13; A01 §7.2 [?] | Faz 2 çoklu şube müşteri modeli değişir | Resmi doküman + test | TL | 28 Ara 2026 | F2 | orta | `acik` |
| V-042 | WhatsApp Flows Türkiye'de kullanılabiliyor; bileşen sınırları A05'teki gibi | 03 §3.6; 09 §8.2 F3-06; A01 §5 [?] | Faz 3'teki `wa_flow` kanalı değişir | Resmi doküman + test | TL | Faz 3 planlaması | F3 | düşük | `acik` |
| V-043 | Meta kredi hattı (MPS) Türkiye'de uygun ve Solution Partner üzerinden paylaşılabiliyor | 00 §6.2; 01 §6.5; A01 §4.4 [?] | Faz 3'teki "mesaj dahil" paket yapılamaz | Solution Partner'dan yazılı cevap | KUR | Faz 3 planlaması | F3 | düşük | `acik` |

### 3.2 Hukuk, KVKK ve e-ticaret

| ID | İddia | Kaynak | Yanlışsa etkisi | Nasıl teyit edilir | Sahip | Son tarih | Kapı | Önem | Durum |
|---|---|---|---|---|---|---|---|---|---|
| V-044 | Künyenin zorunlu alanları (6563 m.3: unvan, MERSİS, adres, e-posta, telefon, oda, VKN) biliniyor | 05 C.3.7 Künye; 08 §4.7 | BV eşleşmesi bozulur, site yasal olarak eksik kalır | Mevzuat metni + avukat | AV (FE) | 7 Eki 2026 (site v0) | K3 | yüksek | `acik` |
| V-045 | WhatsApp adı ve logosu yalnız tanımlayıcı olarak kullanılabilir; logoda konuşma balonu benzeri öğe olmamalı | 05 C.8 Marka tonu | Logo, site ve basılı materyal yeniden yapılır | Meta marka kaynakları + marka vekili | KUR (TAS, MV) | 2 Eki 2026 (logo başvurusu) | K3 | orta | `acik` |
| V-046 | VERBİS muafiyeti: bilanço eşiği 2018/87 kararındaki gibi (sonradan yükseltildiği iddiası DOĞRULANAMADI) | 08 §2.3 VERBİS; A03 | Kayıt yükümlülüğü doğabilir | VERBİS istisnalar sayfası + avukat | AV (KUR) | 6 Kas 2026 | P0 | orta | `acik` |
| V-047 | Saklama süreleri uygun: 5651 trafik logu 1 yıl, panel kullanıcı hesabı kapanıştan 30 gün sonra siliniyor, 08 §2.8 tablosunun geri kalanı | 07 §9 Saklama işleri; 08 §2.8 satır 10 ve 14, §11.1-9 | `retention.*` işleri ve DPA metni değişir | Mevzuat metni + avukat | AV (TL) | 27 Kas 2026 | P0 | orta | `acik` |
| V-048 | P1 durumunda onaysız salt-okunur destek erişimi (impersonation) DPA'ya istisna olarak yazılabilir | 05 A-09 Impersonation | Destek süreci ve DPA değişir | Avukat | AV (KUR) | 20 Kas 2026 (DPA) | P0 | orta | `acik` |
| V-049 | WhatsApp özeti + link + takip sayfası "kalıcı veri saklayıcı" şartını karşılıyor; Akış E'de ön bilgilendirme yöntemi ve onay ibaresi yeterli | 03 §12 #2; 04 §15.2 #10; 08 §4.4, §10 #8, §11.1-6 | Onay adımı metinleri ve akışı değişir | Avukatın yazılı görüşü | AV | 27 Kas 2026 | P0 | yüksek | `acik` |
| V-050 | "Teslim edildi" mesajındaki teşviksiz değerlendirme isteği İYS açısından bilgilendirme sayılıyor | 00 §7 Değerlendirme; 08 §3.2, §10 #4, §11.1-3 | Teslim mesajı şablonu değişir | Avukat | AV | 27 Kas 2026 | P0 | orta | `acik` |
| V-051 | Restoran fiyat düzenlemesi (servis ve kuver yasağı, fiyat listesi) online menüleri de kapsıyor olabilir; gıda işletmesi kayıt numarasının gösterilmesi ve uzaktan satışta alerjen bilgisi zorunlu olabilir | 08 §4.5, §4.6 | Storefront alanları ve uyarılar eksik kalır | Ticaret Bakanlığı düzenlemesi, Gıda Etiketleme Yönetmeliği, avukat | AV (FE) | 27 Kas 2026 | P0 | orta | `acik` |
| V-052 | Cloudflare TLS sonlandırması, Sentry SaaS (AB bölgesi), Google Maps ve Anthropic için m.9 dayanağı kurulabilir; sağlayıcıların standart sözleşme modülü var | 06 §14.3, §18 #11–12; 08 §2.11, §10 #11, §11.3-5 | Mimari değişir: DNS-only kullanım, TR'de self-host GlitchTip | Sağlayıcılara yazılı soru + avukat | TL (AV) | 4 Ara 2026 (aktarım envanteri) | P0 | yüksek | `acik` |
| V-053 | Kampanya gönderiminde platform İYS'de "aracı" sayılmıyor; İYS iş ortağı API'si, ret senkronu, WhatsApp'ın İYS'deki kanal karşılığı ve ücret tarifesi uygun | 08 §3.3, §3.6, §10 #2, §11.1-2, §11.3-6 | Faz 2 kampanya modülünün tasarımı ve sorumluluk dağılımı değişir | Avukat + İYS ve iş ortaklarından yazılı cevap | AV (KUR) | 15 Oca 2027 | K4, F2 | yüksek | `acik` |
| V-054 | Pasif dizin (Senaryo B) ETAHS sayılmıyor; ETAHS eşikleri bizim için yıllarca ilgisiz | 08 §4.1–4.2, §11.1-4 | Keşif ve dizin özellikleri engellenir | Avukat | AV | 15 Oca 2027 | K4 | orta | `acik` |
| V-055 | Müşterinin sipariş notuna kendisinin yazdığı alerji bilgisi 30 gün işlenebilir; maskelenmiş metin LLM'e gidebilir | 08 §2.7, §10 #6–7, §11.1-5 | Not alanı ve AI akışı değişir | Avukat | AV | 15 Oca 2027 | K4 | orta | `acik` |
| V-056 | "Komisyonsuz" iddiası ve rakip adlarıyla karşılaştırma mevzuata uygun. Rakiplerin altyapı türü (resmi API mı, WhatsApp Web oturumu mu) doğrulanamadı | 01 §4.1; 08 §4.5, §10 #17; 09 §2.3; A01 §8.3 (DOĞRULANAMADI) | D5 sayfası, hesaplayıcı ve "resmi altyapı" farkı iddiası değişir | Avukatın metin kontrolü + rakip beyanları + Meta partner dizini | AV (KUR) | 12 Eki 2026 | K2 | yüksek | `acik` |
| V-057 | 2026 yılı KVKK ve 6563 idari para cezası tutarları biliniyor | 08 §2.14, §3.8; A06 | Risk puanlaması değişir | Resmi Gazete'deki yeniden değerleme | AV | 15 Oca 2027 | K4 | düşük | `acik` |
| V-085 | **Çerezsiz ürün analitiğinde `sessionStorage` oturum kimliği rıza gerektirmiyor:** storefront ve panel olayları (`POST /api/v1/store/events`, `analytics_events`; PII yok, 90 gün) sekme ömürlü rastgele bir kimlikle gruplanıyor; bu kimlik Çerez Rehberi'ndeki "benzeri teknolojiler" kapsamında açık rıza gerektirmiyor | 03 §11 Ölçüm planı, §12 #23; 07 §3.5 `analytics_events`, §11 #25; 08 §2.13 Çerezler, §11.1-11, §12 #19; V-006 ile ilişkili | Storefront olayları rıza paneline bağlanır ya da oturum kimliği kaldırılıp yalnız sayfa içi toplu sayım yapılır; storefront hunisi (03 §11) kabalaşır | Avukatın yazılı görüşü (08 §11.1-11) + KVKK Çerez Uygulamaları Hakkında Rehber metni; V-006 sorusuyla aynı yazıda sorulur | AV (FE) | Soru 12 Eki 2026 (V-006 ile); yazılı görüş 27 Kas 2026 | P0 | orta | `acik` |

### 3.3 Vergi, faturalama ve ödeme

| ID | İddia | Kaynak | Yanlışsa etkisi | Nasıl teyit edilir | Sahip | Son tarih | Kapı | Önem | Durum |
|---|---|---|---|---|---|---|---|---|---|
| V-058 | Restoran hizmetinde KDV %10; teslimat ücretinde KDV %20 varsayılıyor | 04 §6.2 Ürün formu; 07 §1.4 Para, §3 `branches`, §5 Sepet; A03 §8.1 | Sepetin KDV kırılımı, fiş ve raporlar hatalı olur | Mali müşavirin yazılı görüşü | MM (TL) | 6 Kas 2026 (S3 sepet hesabı) | P0 | yüksek | `acik` |
| V-059 | Yurt dışı hizmetlerde 2 No'lu KDV ve stopaj sınıflandırması (hizmet mi, gayrimaddi hak mı) | 08 §8.2–8.3, §10 #15, §11.2-2; 09 F0-H14 | Maliyetlere %20'ye varan stopaj eklenebilir | Mali müşavir | MM (KUR) | 23 Eki 2026 | K4 | orta | `acik` |
| V-060 | Bizim e-Fatura, e-Arşiv ve e-Defter yükümlülüğümüzün ne zaman başladığı; pilotun ve ücretsiz kurulumun bedelsiz hizmet olarak KDV'si; iade faturası mı, fatura iptali mi | 08 §6.5–6.6, §11.2-4, -7, -8 | İlk faturalar yanlış kesilir | Mali müşavirin yazılı görüşü | MM (KUR) | İÜM (D6'da ön ödeme gelirse H4; en geç 15 Şub 2027) | İÜM | yüksek | `acik` |
| V-061 | PSP koşulları: tek çekim oranı %0,59–1,95 bandında; abonelik çekimlerinde 3D Secure ve MIT/non-3D kuralı; abonelik API'si ücreti; basit usul üye işyeri kabulü; iadenin karta yansıma süresi | 03 §9.2; 08 §5.4 Sağlayıcı karşılaştırması, §6.1, §11.3-1 | Abonelik tahsilatı (F2-01) ve online ödeme planı değişir | PayTR, iyzico, Craftgate, Param ve Sipay'den yazılı teklif | KUR (TL) | 28 Ara 2026 | F2, İÜM | yüksek | `acik` |
| V-062 | Paraşüt API'sinin hangi pakette olduğu, istek limitleri ve webhook desteği; entegratör kontör maliyeti düşük | 01 §7.1; 07 §6.6 Webhook'lar; 08 §6.5, §8.6, §11.3-2 | Faturalama motoru cron yoklamasına döner, COGS değişir | Paraşüt, Nilvera, QNB eSolutions ve Uyumsoft'tan yazılı cevap | TL (MM) | 28 Ara 2026 | F2, İÜM | orta | `acik` |
| V-063 | İmzasız click-wrap abonelik sözleşmesinde damga vergisi doğmuyor | 08 §8.4, §11.2-6 | Sözleşme maliyeti artar | Mali müşavir | MM | İÜM | İÜM | orta | `acik` |
| V-064 | Esnafın Meta'ya yaptığı USD ödemelerinde KDV durumu (özellikle basit usulde) ve Meta faturasına KDV eklenip eklenmediği | 01 §6.5; 08 §8.2, §10 #20, §11.2-3; A01 §4.4 [?] | Esnafa verilen bilgi notu ve satış itirazına cevap değişir | Mali müşavir | MM | 29 Oca 2027 | K4 | orta | `acik` |
| V-065 | ETBİS kaydı e-Devlet'ten ücretsiz ve kısa sürede yapılıyor | 08 §4.3 ETBİS | Lansman kontrol listesinde gecikme olur | eticaret.gov.tr + avukat | KUR | 29 Oca 2027 | K4 | orta | `acik` |
| V-066 | TÜBİTAK BiGG ve KOSGEB'in güncel çağrıları başvuruya açık | 08 §8.5; 09 §10.3 | Finansman planı değişir | Resmi çağrı sayfaları | KUR | 23 Eki 2026 | K4 | orta | `acik` |
| V-067 | Marka tescilinin resmi ücreti, vekil ücreti ve toplam süresi (bültende 2 ay itiraz) | 08 §7.3, §8.6; 09 §10.2 | Bütçe sapar | TÜRKPATENT tarifesi + marka vekilinden teklif | KUR (MV) | 2 Eki 2026 | — | düşük | `acik` |

### 3.4 Teknik ve maliyet

| ID | İddia | Kaynak | Yanlışsa etkisi | Nasıl teyit edilir | Sahip | Son tarih | Kapı | Önem | Durum |
|---|---|---|---|---|---|---|---|---|---|
| V-068 | Altyapı maliyeti: pilot ~$40–100/ay, 100 işletme ~$600–1.200/ay, 1.000 işletme ~$3.500–7.000/ay. İki düğümlü ingress için Cloudflare Load Balancing ~$5/ay | 00 §10 Altyapı maliyeti; 06 §13.3 Topoloji, §17 Maliyet, §18 #14 | P0'daki iki düğümlü ingress ve bütçe planı sapar | Barındırma teklifleri (V-009) + Cloudflare fiyat sayfası | TL | 20 Kas 2026 | P0 | yüksek | `acik` |
| V-069 | Tarayıcı davranışları: Chrome `--kiosk-printing` ile diyalogsuz yazdırma; push ile tekrarlayan özel alarm sesi; SMS'te WebOTP biçimi | 03 §9.5; 04 §4.14; 06 §7.8, §9.1 | Pilottaki fiş ve alarm deneyimi değişir | Pilot cihaz envanteriyle test | FE | 4 Ara 2026 | P0 | orta | `acik` |
| V-070 | Kütüphane ayrıntıları: Better Auth eklentileri (`admin`, `magicLink`, `phoneNumber`), impersonation ve `generateId`; PostgreSQL 18 `uuidv7()`; Next.js 16 `proxy.ts`; Drizzle 1.0; pnpm `minimumReleaseAge` | 06 §6.1, §15.7, §18 #14; 07 §1.2, §11 #15 | S1 iskeletinde yeniden yazım gerekir | Resmi dokümanlar + kısa deneme (spike) | TL | 9 Eki 2026 (S1) | — | orta | `acik` |
| V-071 | Anthropic modellerine AB bölgesinden (Bedrock/Vertex) erişilebiliyor; LLM maliyeti sipariş başına ≈ $0,005 | 06 §17, §18 #14; A04 [T][E] | Faz 2 AI maliyeti ve m.9 dayanağı değişir | Sağlayıcı dokümanı + pilot eval ölçümü | TL | 28 Ara 2026 | F2 | orta | `acik` |
| V-072 | Otomatik sesli arama (TTS) için uygun API ve fiyat var | 06 §7.6, §18 #10; A04 (DOĞRULANAMADI) | Faz 2'deki alarm adımı değerlendirmesi değişir | Sağlayıcı teklifi | TL | 28 Ara 2026 | F2 | düşük | `acik` |
| V-073 | Açık mahalle sınırı verisinin lisansı ve güncelliği uygun; UAVT'nin ticari API'si yok | 06 §10.1, §10.3; A04 (DOĞRULANAMADI) | Ters geocoding self-host planı değişir | Veri lisansları + NVİ | TL | 28 Ara 2026 | F2 | düşük | `acik` |
| V-074 | Meta test numarasının alıcı sınırı smoke test ve demolar için yeterli | 02 §11 Test stratejisi; 09 §5.3 S1 riskleri | Demo ve smoke testte alıcı eksik kalır | App Dashboard | TL | 9 Eki 2026 | — | düşük | `acik` |
| V-086 | **Panel güncelleme politikasının tarayıcı davranışı:** yeni service worker vite-plugin-pwa/Serwist "prompt" modunda `waiting` durumunda bekletilebiliyor ve yalnız uygulama kararıyla (güvenli an ya da vardiya başlat) etkinleşiyor; iOS/iPadOS ana ekran PWA'sı güncellemeyi kendiliğinden uygulayıp sayfayı yenilemiyor; hash'li dosyaların son 2 sürümü tutulunca eski sekme dosya kaybetmiyor | 06 §16.7 Sürüm yönetimi, §18 #23; 04 §4.1; 12 §6.3, §9.3 EK-06 | Yoğun saatte kendiliğinden yenilenen panel sonraki siparişi sessiz karşılar (R05); güncelleme politikası ve "açık sipariş varken güncelleme" e2e testi yeniden tasarlanır | Kütüphane dokümanı + fiziksel cihaz parkında (12 §9.2) Android Chrome ve iPadOS 16.4–18.3 / 18.4+ ana ekran PWA'sıyla deneme; EK-06 ve 06 §16.7 e2e testi | TL (FE) | 6 Kas 2026 (S3) | P0 | yüksek | `acik` |
| V-087 | **Yurt dışı numaraya SMS:** Faz 1'de SMS OTP ve WhatsApp'sız mod SMS'leri yalnız `+90` numaralara gider [T]. Yurt dışı SMS'in birim fiyatı ve teslim koşulları seçilen sağlayıcıda bilinmiyor; pompalama (uluslararası ücret dolandırıcılığı) riskini büyütüyor | 06 §4.3, §18 #26; 03 §3.2.1; 08 §11.3-8; 12 §11.3 | Faz 3 dil desteğiyle açılırsa SMS maliyeti ve kota hesabı (00 §4) sapar; ülke izin listesi, OTP sınırı ve maliyet tavanı olmadan açılamaz | SMS sağlayıcılarından yazılı fiyat ve teslim koşulları (V-012 teklif turunda ayrı satır olarak istenir) | TL | Soru 23 Eki 2026 (V-012 ile); karar Faz 3 planlaması | F3 | düşük | `acik` |
| V-089 | **Lucide ikon adları** (ör. `bell-ring`, `package-check`, `triangle-alert`, `chef-hat`, `check-check`, `undo-2`) kullanılan Lucide sürümünde bu adlarla mevcut | 04 §14.5 İkon eşlemesi; 12 §3.3, §3.5 | Durum rozeti ve ikon eşlemesi derlemede kırılır, eşleme tablosu güncellenir; kullanıcıya etkisi yok | `packages/ui` iskeletinde Lucide sürümü sabitlenir; eşleme tablosundaki her ad için derleme testi | FE (TAS) | 9 Eki 2026 (S1, S1-11) | — | düşük | `acik` |

### 3.5 İş, pazar ve takvim varsayımları

İş hipotezleri (H1–H15) ve deney eşikleri [10](10-riskler-operasyon-ve-metrikler.md) §4.2–4.5'te izlenir. Aşağıdakiler bu listede olmayan ya da planın rakamlarını doğrudan taşıyan varsayımlardır.

| ID | İddia | Kaynak | Yanlışsa etkisi | Nasıl teyit edilir | Sahip | Son tarih | Kapı | Önem | Durum |
|---|---|---|---|---|---|---|---|---|---|
| V-075 | Karma CAC ≤ 4.000 TL (saha satışında ~5.000 TL, Esnaf tavanı ≈ 2.770 TL) | 00 §12; 01 §7.3 CAC; 10 §4.2 H11 | Kanal karması ve işe alım planı değişir | İlk 20 ücretli kapanışın gerçekleşen maliyeti | KUR | İlk 20 kapanış | F2 | yüksek | `acik` |
| V-076 | Churn ilk yıl aylık %5–7; destek teması ≤ 4/işletme/ay (H9); uzman başına 150–300 işletme | 00 §12; 01 §7.4 Churn ve LTV; 09 §9.2; 10 §4.2 H9 | LTV, Esnaf marjı (V-027) ve işe alım tetikleri değişir | D9 pilot verisi + ilk 6 ayın kohortu | KUR (OPS) | D9: 29 Oca 2027; churn: Faz 2 boyunca | K4, F2 | yüksek | `acik` |
| V-077 | Net yeni işletme hızı Faz 2'de ayda 20–25, Faz 3'te ayda ~100 | 01 §8.3–8.4; 09 §2.1 | Gelir planı ve onboarding kotası ihtiyacı değişir | Lansman sonrası ilk 3 ayın verisi | KUR | Faz 2 ortası | F2 | orta | `acik` |
| V-078 | Pazar rakamları: SAM 40–80 bin işletme; Yemeksepeti payı ~%40; Türkiye'de WhatsApp kanal payı ölçülmemiş | 01 §1.1, §3.2 TAM/SAM/SOM | Yatırımcı sunumu ve SOM hedefi değişir | TÜİK, Ticaret Bakanlığı, sektör raporları; pilot verisi | KUR | Dışa sunumdan önce | — | orta | `acik` |
| V-079 | Nisan 2026 yemek siparişi düzenlemesinin yürürlük tarihi (kaynaklarda 1 ve 13 Nisan geçiyor) | 01 §1.1; 05 C.4.4; 08 §4.8 | Hesaplayıcıdaki uyarı metni yanlış olur | Resmi Gazete / Ticaret Bakanlığı | AV (FE) | 12 Eki 2026 | K2 | düşük | `acik` |
| V-080 | Kur 1 USD ≈ 48,4 TL | 00 §8 Kur varsayımı | TL karşılıkları ve döviz gideri oranı (≤ %15) sapar | TCMB kuru; aylık raporda güncellenir | KUR | Her ayın ilk iş günü | — | orta | `acik` |
| V-081 | Ocak 2027 asgari ücret artışı bütçeye sığıyor | 09 §10.1 Varsayımlar | Maaş bütçesi ve nakit pisti değişir | Resmi Gazete'deki ilan | KUR | Açıklandığında (K4 ön-onayından önce) | K4 | orta | `acik` |
| V-082 | Ramazan ve Kurban Bayramı 2027 tarihleri (Ramazan yaklaşık Şubat–Mart) | 05 C.7 Blog takvimi; 09 okuma notları, §11.2, §12 #26 | Lansman kampanyası, kurulum ziyaretleri ve deploy dondurma pencereleri kayar | Diyanet takvimi | OPS | 4 Ara 2026 | K4 | orta | `acik` |
| V-083 | Seviye 0 deneyi için baskı maliyetleri ve teşvik bedelleri düşük | 10 §4.3 D3, §11 #19 | D3 bütçesi aşılır | 2–3 matbaa teklifi | OPS | 2 Eki 2026 | K2 | düşük | `acik` |
| V-084 | Instagram "Yemek siparişi" butonu yalnız anlaşmalı sağlayıcılarla çalışıyor; Google İşletme Profili'nde sipariş linki seçenekleri var; Google "review gating" yasağı geçerli | 03 §2, §7.5; 04 §12.2; 05 C.7 | Link rehberi, kanal planı ve Faz 2 değerlendirme akışı değişir | Resmi yardım ve politika sayfaları + pilotta deneme | OPS (FE) | 7 Ara 2026 (Dalga 1); review gating F2 | P0, F2 | düşük | `acik` |
| V-088 | **Pazaryeri sipariş API'leri:** Yemeksepeti, Uber Eats Trendyol Go ve Migros Yemek sipariş API'lerine erişim onaylı POS/entegratör ortaklığı gerektiriyor; bağımsız bir SaaS'a açık entegrasyon programı yok | 01 §8.8 "Pazaryeri siparişlerini tek ekranda toplamak: yapılmaz" | Faz 3'teki "tek ekran" yeniden değerlendirmesinin (01 §8.8 koşul c) zemini değişir: doğrudan entegrasyon seçeneği açılabilir ya da yalnız POS aktarımı (F2-05) kalır | Pazaryerlerinin geliştirici/partner sayfaları + POS partnerlerinden (V-014, V-090 görüşmeleri) yazılı bilgi; sözleşmenin hukuki uygunluğu için avukat | KUR (TL, AV) | Faz 3 planlaması (≈ Haz 2027) | F3 | düşük | `acik` |
| V-090 | **POS partner programları ve sözleşme koşulları:** SambaPOS ve Adisyo dışındaki adaylar (robotPOS, Simpra) da açık/partner API ile sipariş aktarımına izin veriyor; partner sözleşmesi (API kullanım koşulları, KVKK rolleri, API değişikliğinde önceden bildirim, gelir paylaşımı veya yönlendirme ücreti) makul koşullarla imzalanabiliyor. SambaPOS/Adisyo API ve sandbox erişimi V-014'tedir; bu madde onun devamıdır | 01 §8.8 Entegrasyon ve iş ortaklığı stratejisi; 06 §4.5; 08 §11.1-12, §12 #20; 09 F0-G10; V-014 | F2-05 partner sözleşmesi olmadan başlayamaz; Faz 3 robotPOS/Simpra entegrasyonu ve "POS-agnostik kanal" konumlandırması zayıflar; POS bayileri dağıtım kanalına dönüşmez | Faz 0 görüşmelerinde (F0-G10) yazılı API dokümanı ve partner sözleşme taslağı; avukatın sözleşme incelemesi (08 §11.1-12) | KUR (TL, AV) | NDA görüşmelerden önce; SambaPOS/Adisyo partner sözleşmesi F2-05 başlamadan (28 Ara 2026, V-014 ile); robotPOS/Simpra Faz 3 planlaması | F2, F3 | orta | `acik` |

---

## 4. Açık kararlar ([00](00-kararlar-ve-sozluk.md) §13): sahip ve son tarih önerisi

Bu tablo bir **öneridir**. 00 düzenlenmez; proje sahibi kabul ederse 00 §13'e işlenir. Sahip = hesap veren (A).

| # | Karar | Varsayılan (00) | Önerilen sahip | Danışılan | Önerilen son tarih | Gerekçe ve bağlı kapı | İlgili V |
|---|---|---|---|---|---|---|---|
| 13.1 | Ekip ve stack | TypeScript monorepo | TL | KUR | 25 Eyl 2026 (Gün 1) | S1 28 Eyl'de başlar; karar sonra değişmez ([09](09-yol-haritasi-ve-sprint-plani.md) F0-T01) | V-070 |
| 13.2 | Pilot şehir ve ilçeler | Ekibin şehrinde 2–3 ilçe | KUR | OPS | 25 Eyl 2026 | D1 görüşmeleri H0–H2'de; K1 | V-007, V-008 |
| 13.3 | Şirket türü ve Teknokent | Ltd | KUR | MM, AV | Şirket türü 25 Eyl; Teknokent karar notu 23 Eki 2026 | Tescil ve BV başvurusu 9 Eki; NACE seçimi | V-005, V-013 |
| 13.4 | Barındırma sağlayıcısı | Yurt içi yerli bulut | TL | KUR (bütçe) | 16 Eki 2026 | F0-H11; prod ortamı (S4-13) ve P0 | V-009, V-068 |
| 13.5 | Meta modeli | Tech Provider + Plan B | KUR | TL | Varsayılan 25 Eyl'de teyit edilir; Plan B hazırlığı 6 Kas (T3), devreye alma kararı 20 Kas (T4) | K3 | V-015–V-017, V-019 |
| 13.6 | Marka ve alan adı | "Siparişin Önünde" / `siparisinonunde.com` | KUR | MV | 2 Eki 2026 | Marka başvurusu, BV unvanı, site v0 | V-002, V-045 |
| 13.7 | Kurye stratejisi | Yalnız işletmenin kendi kuryesi | KUR | OPS | 29 Oca 2027 (K4 ön-onay) | Faz 3'teki kurye çağırma epiğinin önceliği | — |
| 13.8 | AI serbest metin: paket ve kota | Pro ve üstü, adil kullanım kotası | KUR | TL | Paket: 28 Ara 2026 (F2); kota sayısı: 29 Oca 2027 | AI Faz 2'de; fiyat sayfası K4'te | V-071 |
| 13.9 | Yemek kartında online tahsilat | Faz 1'de yalnız kapıda | KUR | AV | 29 Oca 2027 | Faz 2–3 planı | V-028 |
| 13.10 | SLO hedefleri | Aylık %99,9, RPO ≤ 5 dk, RTO ≤ 1 sa | KUR | TL | 20 Kas 2026 (abonelik sözleşmesi ve DPA hedefi; dış SLA metni); RTO P0'da tatbikatla kanıtlanır | P0 | V-068 |
| 13.11 | Esnaf paketi ekonomisi | Pilot verisiyle Faz 2 fiyat revizyonunda karar | KUR | `finance`, OPS | 29 Oca 2027 (K4 ön-onay); 12 Şub'da teyit | [09](09-yol-haritasi-ve-sprint-plani.md) §8.1; lansman fiyat sayfası | V-027, V-012, V-076 |
| 13.12 | Hesap dondurma (sezonluk işletmeler) | Faz 2'de değerlendirilir | KUR | `finance` | 28 Ara 2026 (F2-01 kapsamı kesinleşmeden) | F2 | — |
| 09-17 | Ekip büyüklüğü (DEV3 var mı?) *(09 §12'den; 00 §13'te yok)* | 2 geliştirici | KUR | TL | 25 Eyl 2026 | Tek geliştiriciyle takvim en az 4 hafta kayar | — |
| 09-20 | Pilot cihaz desteği (tablet ödünç, bütçe) *(09 §12)* | — | KUR | OPS | 20 Kas 2026 | P0 kurulum kiti | V-069 |
| 09-21 | D5 reklam bütçesi ve saha yol gideri tavanı *(09 §12)* | — | KUR | — | 12 Eki 2026 | D5 yayını; K2 | — |
| 09-22 | Pilotta 2+ şubeli işletme *(09 §12)* | Pilota alınmaz | KUR | OPS | 20 Kas 2026 | Pilot seçimi ([09](09-yol-haritasi-ve-sprint-plani.md) §7.1) | — |

---

## 5. İstatistik

### 5.1 Doküman başına işaret sayıları

**Yöntem:** 24.09.2026 akşamı `grep -o` ile yapılan **geçiş** sayımıdır (satır değil). Her dokümandaki işaret açıklaması (lejant) satırları da sayıma dahildir. 01–10 o sırada başka yazarlarca düzenleniyordu; sayılar yaklaşıktır ve ilk haftalık gözden geçirmede yeniden alınmalıdır. "(teyit edilmeli)" büyük/küçük harf duyarsız sayıldı; "doğrulanamadı" sütunu hem büyük hem küçük yazımı kapsar. `[D?]` sütunundaki "+n", `[O/D?]` bileşik işaretidir; `[T]` sütunundaki "+n" ise `[Y/T]`, `[O/T]` gibi bileşik işaretlerdir.

| Doküman | "(teyit edilmeli)" | `[D?]` | `[?]` | `[E]` | doğrulanamadı | `[T]` |
|---|---|---|---|---|---|---|
| 00 Kararlar | 1 | 0 | 0 | 0 | 0 | 0 |
| 00 Yönetici özeti | 1 | 1 | 0 | 1 | 0 | 0 |
| 01 İş modeli | 14 | 0 | 0 | 0 | 0 | 13 |
| 02 WhatsApp | 36 | 0 | 5 | 0 | 4 | 1 |
| 03 Storefront | 15 | 0 | 0 | 1 | 0 | 33 |
| 04 Panel | 7 | 0 | 0 | 0 | 0 | 21 |
| 05 Admin ve site | 12 | 0 | 0 | 5 | 1 | 40 |
| 06 Mimari | 18 | 0 | 0 | 0 | 0 | 26 |
| 07 Veri modeli | 7 | 0 | 0 | 0 | 0 | 9 |
| 08 Mevzuat | **85** | **54 (+18)** | 0 | 0 | 5 | **75 (+15)** |
| 09 Yol haritası | 19 | 0 | 0 | 0 | 0 | 14 (+3) |
| 10 Riskler | 9 | 0 | 0 | 0 | 0 | 48 |
| **Plan toplamı** | **224** | **55 (+18)** | **5** | **7** | **10** | **280 (+18)** |
| A01 WhatsApp platformu | 8 | 0 | 32 | 0 | 2 | 0 |
| A02 Pazar ve rakipler | 4 | 35 | 0 | 0 | 1 | 31 |
| A03 Mevzuat | 18 | 58 | 0 | 0 | 2 | 94 |
| A04 Mimari | 4 | 0 | 0 | 65 | 20 | 13 |
| A05 Ürün ve UX | 3 | 21 | 0 | 20 | 2 | 47 |
| A06 Riskler | 6 | 4 | 0 | 13 | 13 | 40 |
| **Araştırma toplamı** | **43** | **118** | **32** | **98** | **40** | **225** |

### 5.2 En çok belirsizlik içeren alanlar

Aşağıdaki bölüm sıralamasında `[T]` hariç tüm işaretler ("(teyit edilmeli)", `[D?]`, `[?]`, `[E]`) sayıldı:

| Sıra | Bölüm | İşaret |
|---|---|---|
| 1 | 08 §5 Son müşteri ödemesi (özellikle §5.4 sağlayıcı karşılaştırması) | 30 |
| 2 | 08 §2 KVKK (özellikle §2.11 aktarım envanteri) | 28 |
| 3 | 08 §8 Vergi | 20 |
| 4 | 08 §3 Ticari elektronik ileti ve İYS | 19 |
| 5 | 08 §4 E-ticaret mevzuatı | 17 |
| 6 | 08 §6 Abonelik tahsilatı ve faturalama | 10 |
| 7 | 02 §3 İşletme onboarding'i | 9 |
| 8 | 02 §2 Meta hazırlık ve kritik yol | 8 |
| 9 | 02 §5 Şablon kataloğu · 03 §9 Müşteri mesaj metinleri | 7'şer |

**Tema bazında:**
1. **Mevzuat, vergi ve ödeme:** Plandaki "(teyit edilmeli)" işaretlerinin yaklaşık %38'i (85/224) ve `[D?]` işaretlerinin hemen hepsi 08'dedir. Bu maddelerin çoğu avukat ve mali müşavir cevabına bağlıdır. Bu yüzden AV ve MM'nin H0–H1'de seçilmesi (F0-H02, F0-H07) en az 20 maddenin ön koşuludur.
2. **Meta ve WhatsApp platform ayrıntıları:** 02'de 36 işaret, A01'de 32 `[?]` var. Çoğu S1–S2'de test numarasıyla kapanabilir (V-003, V-004, V-010, V-031–V-036). Kalanı D11 ve App Review sürecinde kapanır.
3. **Üçüncü taraf fiyatları ve altyapı:** A04'te 20 "DOĞRULANAMADI" ve 65 `[E]` var; 06 §17 maliyet tablosunun çoğu teyitsizdir. Tek bir iş (V-009 barındırma teklifleri) birim ekonomiyi en çok netleştiren adımdır.
4. **Tahmin yoğunluğu:** `[T]` işaretleri en çok 08 (75), 10 (48), 05 (40) ve 03'tedir (33). 03 ve 05'tekiler çoğunlukla tasarım önerisidir ve kayda alınmadı. 10'dakiler eşik ve risk puanıdır; pilot verisiyle kalibre edilir ([10](10-riskler-operasyon-ve-metrikler.md) §3.4).

### 5.3 Kaydın kapsamı

Bu kayıttaki 90 madde (V-085–V-090 son temizlik turunda eklendi, §7), 01–12'deki işaretlerden karar, kapı, fiyat, maliyet veya hukuki metni etkileyenleri birleştirir. Bir madde çoğu zaman birden fazla işareti karşılar (ör. V-001, 01, 02 ve 05'teki rate card işaretlerini tek maddede toplar). Şunlar kayda alınmadı ve ilgili dokümanın açık konularında kalır: tasarım önerisi niteliğindeki `[T]`'ler, SEO arama hacimleri (05 C.6.2), tekil API alan adı teyitleri (02 §3.5 alan adları, 07 §6.1 `RateLimit` başlık biçimi), araç seçimi niteliğindeki maddeler (06 §16.2 deploy aracı, 06 §2.4 Supabase bölgesi).

---

## 6. Haftalık gözden geçirme şablonu

**Ne zaman:** Pazartesi metrik toplantısında, gündemin 5. maddesinin ("Riskler ve deneyler") ardından **5 dakika**. **Kim:** KUR yönetir, TL ve OPS katılır; AV ve MM gerekirse önceden yazılı bilgi verir.

**Gündem (5 dk):**
1. **Son tarihi bu hafta ya da geçmiş olan maddeler (2 dk):** önce engelleyiciler. Her biri için tek cümle: durum, kanıt, yeni tarih gerekiyorsa gerekçe.
2. **Durum değişiklikleri (1 dk):** `teyit_edildi` ve `yanlis_cikti` olanlar. `yanlis_cikti` için etkilenen doküman ve karar sahibi yazılır. Karar etkisi varsa 00 güncellemesi ilk iş olarak atanır.
3. **Önümüzdeki 2 haftadaki kapılar (1 dk):** kapıya bağlı `acik` engelleyici maddeler (§2.2 görünümü).
4. **Yeni maddeler (1 dk):** geçen hafta dokümanlara eklenen doğrulanmamış iddialar ID alır.

**Çıktı:** Kayıt güncellenir, §7 günlüğüne satırlar eklenir, toplantı notuna aşağıdaki blok yapıştırılır.

```markdown
### Teyit kaydı — {tarih}
- Açık engelleyici: {n} · kırmızı (tarihi geçmiş): {liste}
- Bu hafta kapanan: {V-… → teyit_edildi / yanlis_cikti, kanıt}
- Yanlış çıkanların etkisi: {doküman §, karar sahibi, 00 güncellemesi gerekiyor mu?}
- Önümüzdeki kapı: {K?/P0, tarih} → açık bağlı maddeler: {liste}
- Yeni maddeler: {V-…}
- Kararlar: {karar, sahip, tarih}
```

**Kapı haftası eki:** Kapıdan bir iş günü önce §2.2'deki satır süzülür. Kapı kararı tutanağına bağlı maddelerin durum listesi eklenir (§1.6 kural 3).

---

## 7. Değişiklik günlüğü

Durum değişiklikleri buraya **eklenir**, silinmez. En yeni satır en üstte yer alır.

| Tarih | ID | Eski → yeni durum | Kanıt (kaynak, tarih) | Güncellenen dokümanlar | Kim |
|---|---|---|---|---|---|
| 2026-09-24 | V-085–V-090 | — → `acik` | Son temizlik turu: 03 §11, 04 §14.5, 06 §4.3 ve §16.7, 01 §8.8, 08 §2.13 ve §12 #19'daki yeni işaretler kayda alındı; V-014 kaynağına 01 §8.8 eklendi; §1.5 İÜM tanımı 09 §1.1 ile hizalandı; §8 #1–#3 kapatıldı | 13 | AI (inceleme: KUR) |
| 2026-09-24 | V-001–V-084 | — → `acik` | Kayıt oluşturuldu; 01–10 ve `arastirma/*.md` taraması | — | AI (inceleme: KUR) |

---

## 8. Açık konular

1. ~~**D11 zamanlaması çelişkili.**~~ **Karara bağlandı:** [10](10-riskler-operasyon-ve-metrikler.md) §4.1 ve §4.3 D11'i artık [09](09-yol-haritasi-ve-sprint-plani.md) §4.1 ile aynı biçimde **Hafta 5–8** (15 günlük hareketsizlik testi dahil, K3'e yetişir) veriyor. V-018 son tarihi (20 Kas) değişmez.
2. ~~**Onboarding kotasının ifadesi farklı.**~~ **Karara bağlandı:** [00](00-kararlar-ve-sozluk.md) §6.3 artık "kayan 7 günde 10 → doğrulama sonrası kayan 7 günde 200" diyor; 02 bu ifadeye hizalandı, 09'daki "10/7 gün → 200/7 gün" kısaltması aynı anlamdadır. Meta'nın pencereyi fiilen nasıl saydığı V-019 kapsamında teyit edilmeye devam eder.
3. ~~**"İlk ücretli müşteri" 09'da ayrı bir kapı değil.**~~ **Eklendi:** [09](09-yol-haritasi-ve-sprint-plani.md) §1.1'de "İÜM — İlk ücretli müşteri kapısı" satırı ve §11.2'de bağlı mali teyitler (V-060–V-063) maddesi var; §1.5'teki tanım 09 ile hizalandı (pilotların ücretliye geçişi ya da ilk self-servis ücretli kayıt, hangisi önce; D6 ön ödemesi istisna).
4. **Hukuki ve vergisel maddelerin darboğazı AV ve MM'dir.** 25'ten fazla madde yazılı görüş bekliyor. 09 §2.3'teki sabit ücretli uyum paketinin kapsamına bu kayıttaki AV ve MM maddelerinin (V-006, V-007, V-013, V-023–V-026, V-044, V-046–V-060, V-063–V-065, V-079) eklenmesi önerilir.
5. **Finansal model.** Esnaf marjı, churn, CAC, kur ve asgari ücret maddeleri (V-027, V-075–V-081) ileride ayrı bir finansal model dokümanı yazılırsa oraya bağlanmalı; duyarlılık analizi bu maddelerin aralıklarını kullanmalıdır.
6. **Kaydın aracı.** 90 madde markdown tabloda yönetilebilir. Faz 2'de madde sayısı 100'ü geçerse kaydın GitHub Projects'e ([09](09-yol-haritasi-ve-sprint-plani.md) §5.2) `teyit` etiketiyle taşınması ve bu dokümanın özet görünüme dönüşmesi önerilir.
7. **Önem ölçeği risk skoruyla eşlenmedi.** Engelleyici bir madde `yanlis_cikti` olduğunda [10](10-riskler-operasyon-ve-metrikler.md) §3.3'te yeni risk açılıp açılmayacağı madde sahibinin kararıdır. İleride iki ölçeğin eşlenmesi değerlendirilebilir.
8. **§4'teki öneriler 00'a işlenmedi.** Proje sahibi kabul ederse 00 §13'e "sahip / son tarih" sütunu eklenebilir.
9. **Sayımlar anlık görüntüdür.** 01–10 bu kayıt yazılırken düzenleniyordu. İlk haftalık gözden geçirmede §5.1 yeniden sayılır ve farklar bu bölüme not edilir.
