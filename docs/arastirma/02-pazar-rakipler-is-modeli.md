# 02 — Pazar, Rakipler ve İş Modeli Araştırması

**Proje:** siparisinonunde (Siparişin Önünde): WhatsApp üzerinden komisyonsuz sipariş alma SaaS'ı
**Tarih:** 2026-09-24
**Kapsam:** Türkiye online yemek pazarı, yerli ve global rakipler, POS ekosistemi, fiyatlandırma, birim ekonomi, go-to-market (GTM), personalar, moat

---

## 0. Yöntem, güven etiketleri ve sınırlamalar

- **Araç kısıtı:** Bu oturumda `WebFetch` ve doğrudan HTTP (curl) erişimi kurum ağ politikası (egress proxy) nedeniyle **engellendi**. Tüm bulgular `WebSearch` sonuç özetlerinden derlendi. Yani listelenen URL'lerin içeriği, arama motorunun o sayfadan çıkardığı özet üzerinden görüldü; sayfalar tek tek açılıp okunamadı. **Dışarıya sunulmadan önce kritik rakamlar birincil kaynaktan yeniden teyit edilmeli.**
- Oturumun web arama kotası (200 arama) doldu. Bazı konular bu yüzden açık kaldı ve metinde işaretlendi.
- **Etiketler:**
  - **[R]** Resmi/birincil kaynak (bakanlık, Rekabet Kurumu, Meta/Google geliştirici dokümanı, SEC, şirketin kendi duyurusu). Kaynak özet üzerinden görüldü.
  - **[H]** Haber kaynağı.
  - **[B]** Blog, rakip sitesi, üçüncü taraf karşılaştırma. Ticari çıkar olabilir.
  - **[T]** Bizim tahminimiz, hesabımız veya çıkarımımız.
  - **[D?]** DOĞRULANAMADI.
- Kur varsayımı: **1 USD ≈ 48,8 TL** (23 Eylül 2026 serbest piyasa; [H] https://finans.mynet.com/haber/detay/doviz/23-eylul-2026-dolar-bugun-kac-tl-serbest-piyasa-dolar-kuru-dolartl-gunluk-sinirli-yukselis-haftalik-sinirli-yukselis/576478/).

---

## 1. Yönetici özeti (TL;DR)

1. **Pazar büyük ve hızla büyüyor.** Ticaret Bakanlığı verisine göre 2025'te hızlı ticaret hacmi %55,6 artarak **388,7 milyar TL** oldu ve bunun **%69,5'i yemek siparişi**. Buradan yemek siparişi hacmi **≈270 milyar TL** çıkıyor [R + T hesap].
2. **Pazar iki bloğa toplanıyor.**
   - **Uber** Haziran 2025'te Trendyol GO'nun %85'ini yaklaşık 700 milyon $'a aldı. GetirYemek'i de 335 milyon $'a aldı; Rekabet Kurulu bunu Haziran 2026'da taahhütlerle onayladı. Bu marka artık **"Uber Eats Trendyol Go"**.
   - **Yemeksepeti**, Uber'in Delivery Hero'yu alma anlaşmasıyla (14,8 milyar $) **SSW Partners'a (~1,6 milyar $) devrediliyor**; işlemin kapanışı 2027'nin ikinci yarısında bekleniyor.
   - **Migros Yemek** dördüncü oyuncu olarak kalıyor.
   - Restoranın pazarlık gücü azalıyor. Bu durum "kendi kanalın olsun" argümanını güçlendiriyor.
3. **Komisyon acısı gerçek ve kamuoyu önünde.**
   - TÜRES, Kasım 2025'te "%40'a varan komisyon" açıklaması yaptı ve boykot çağrısında bulundu: "1.000 TL'lik siparişin 531 TL'si restorana kalıyor."
   - Komisyon bantları blog ve şikâyet kaynaklarına göre kendi kuryesiyle çalışan restoran için yaklaşık **%9–25**, platform kuryesiyle **%25–40** (+%20 KDV) [B/H]. Resmi tarife yayımlanmıyor; oranı sözleşme belirliyor.
4. **Regülasyon rüzgârı lehimize.** Ticaret Bakanlığı 13 Nisan 2026'da yeni kurallar açıkladı:
   - Platformlar restorandan aldıkları tüm bedelleri kalem kalem göstermek zorunda.
   - Temel aracılık hizmetleri ve kampanyaya sırf katılım için ayrıca ücret alınamıyor [R].
   - Restoran artık ne ödediğini net görüyor. Bu da "komisyon hesaplayıcı" pazarlamamızı çok güçlendirir.
5. **WhatsApp altyapısı hazır ve Türkiye için ucuz.**
   - TÜİK 2025 verisine göre bireylerin %88,6'sı WhatsApp kullanıyor [R-özet].
   - Meta tarifesinde Türkiye pazarlama mesajı **0,0109 $** ile dünyadaki en ucuzlardan. Utility ve authentication mesajı **~0,0009 $** [B, Meta tarifesine atıfla].
   - **Coexistence** artık tüm dünyada açık: esnaf WhatsApp Business uygulamasını telefonunda kullanmaya devam ederken aynı numara API'ye bağlanabiliyor [B].
6. **Dikkat, 1 Ekim 2026 değişikliği:** Müşteri penceresi içindeki serbest metin (servis) mesajları artık ücretli. **Her numaraya ayda 1.000 mesaj ücretsiz**, sonrası utility tarifesinden ücretlendiriliyor [B, 360dialog/ycloud; Meta sayfasına atıf]. Birim ekonomide mesaj tasarımı kritik hale geliyor.
7. **Yerli rakip pazarı kalabalık ama parçalı.** 20'den fazla oyuncu var: SepetTakip, Siparel, KolaySiparis, QrMenum, Restajet, Yemek Butik, İletmen, OxyMenu vb. Genel gözlemler [T]:
   - Çoğu ya "QR menü + `wa.me` linkiyle sepeti WhatsApp mesajı olarak yollama" modelinde, ya da resmi olmayan (QR ile WhatsApp Web bağlantılı) bot modelinde.
   - Belirgin bir lider yok.
   - Fiyatlar **680–1.500 TL/ay** bandında yoğunlaşıyor.
8. **Global kanıt güçlü.**
   - Brezilya'da WhatsApp, bar ve restoranların paket servis cirosunun **%26'sını** oluşturuyor (Abrasel, Mart 2025).
   - iFood, WhatsApp otomasyonu yapan **Anota AI'yı ~60 milyon R$'a** satın aldı.
   - ABD'de **Owner.com** sabit abonelikle (499 $/ay) büyüdü: ARR 2024 sonunda ~34 milyon $, Temmuz 2026'da 100 milyon $ [B].
9. **Önerilen fiyat, üç kademe (KDV hariç):**
   - **Esnaf 990 TL/ay**, **Pro 1.790 TL/ay**, **Zincir 2.990 TL/ay/şube**.
   - 14 gün kartsız deneme.
   - İlk 100 işletmeye "kurucu üye" indirimi (%30, 12 ay sabit).
   - Pazarlama mesajları kredi olarak ayrı satılır.
   - Başa baş noktası: %25 komisyonlu bir restoranın **ayda sadece ~21 siparişi** kendi kanalına geçerse Pro paketin ücreti çıkıyor [T].
10. **GTM önerisi:**
    - Tek şehirde 2–3 ilçeye yoğunlaş. İlk segment: **kendi kuryesi olan paket servis ağırlıklı bağımsız restoranlar** (dönerci, pide/lahmacun, kebap, pizza/burger, çiğ köfte). İkinci segment: **su/tüp bayileri**.
    - İlk 10 işletme kurucu satışıyla ve "biz kuralım" hizmetiyle alınır. İlk 100 için saha satışı, referans programı, esnaf odası protokolü ve POS bayileri kullanılır.
    - Kısıt: Meta Tech Provider varsayılan olarak **haftada 10 yeni işletme** bağlamaya izin veriyor [B]. Ölçeklenmeden önce bu limit yükseltilmeli.
11. **Moat:** Yazılımın kopyalanması kolay. Savunma üç yerde kurulur: (a) işletmenin müşteri veritabanı ve sipariş geçmişi, (b) dağıtım ağı (bayi, oda, muhasebeci), (c) entegrasyonlar (POS, yazıcı, yemek kartı, kurye) ve operasyonel mükemmellik.

**Neden şimdi?** Beş etken üst üste geliyor:
- Konsolidasyon, restoranlarda platform bağımlılığı korkusunu artırıyor.
- Nisan 2026 şeffaflık düzenlemesi kesintileri görünür kıldı.
- TÜRES'in boykot söylemi sektörün alternatif arayışını gösteriyor.
- WhatsApp'ta coexistence açıldı ve Türkiye tarifesi ucuz.
- GloriaFood (ücretsiz online sipariş sistemi) **30 Nisan 2027'de kapanıyor** ve bir geçiş havuzu doğuyor.

---

## 2. Türkiye online yemek siparişi pazarı (2025–2026)

### 2.1 Pazar büyüklüğü

| Gösterge | Değer | Kaynak |
|---|---|---|
| Hızlı ticaret hacmi 2025 | **388,7 milyar TL** (%55,6 artış) | [R] Ticaret Bakanlığı, "Türkiye'de E-Ticaretin Görünümü 2025": https://etbis.ticaret.gov.tr/tr/Post/postturkiyede-e-ticaretin-gorunumu-2025-raporu-yayimlandi-3 ; PDF: https://ticaret.gov.tr/data/6a02f2c7269de183c0b98bc4/T%C3%BCrkiye'de%20E-Ticaretin%20G%C3%B6r%C3%BCn%C3%BCm%C3%BC%20Raporu%202025.pdf |
| Yemek siparişinin hızlı ticaretteki payı | **%69,5** (gıda/süpermarket %30,5) | [R] aynı rapor; [H] https://www.cumhuriyet.com.tr/ekonomi/turkiye-de-en-cok-siparis-edilen-yemekler-belli-oldu-lahmacun-birinci-sirayi-kaptirdi-2503753 |
| **Yemek siparişi hacmi 2025 (hesap)** | **≈ 270 milyar TL** (388,7 × 0,695) | [T] |
| Hızlı ticaretin e-ticaretteki payı | 2019: %1,6 → 2025: %8,5 | [R-özet] aynı rapor |
| En yüksek harcama kalemleri (2025) | Hamburger 26,74 milyar TL, pizza 17,03 milyar TL; lahmacun birinciliği kaptırdı | [H] Cumhuriyet, yukarıdaki link |
| 2024 beklentisi | ~150 milyar TL | [H] https://www.fortuneturkey.com/2024te-online-yemek-siparisleri-150-milyar-lirayi-bulacak |
| Daha eski baz | "78 milyar TL" (haberin ait olduğu yıl [D?], muhtemelen 2023) | [H] https://www.dunya.com/sektorler/bir-yilda-katlandi-online-yemek-siparisi-hacmi-78-milyar-lirayi-buldu-haberi-729267 |
| Yılda online yemek siparişi veren kişi | ~23 milyon | [D?]: arama özetinde geçti ama kaynağı net değil |

> Not: Büyümenin önemli kısmı nominal, yani enflasyon etkisi var. Reel büyüme bu çalışmada ayrıştırılmadı.

### 2.2 Oyuncular ve konsolidasyon (kritik gelişme)

| Oyuncu | 2025–2026 durumu | Kaynak |
|---|---|---|
| **Uber Eats Trendyol Go** (eski Trendyol Yemek / Trendyol GO) | Uber, %85 hisseyi ~700 milyon $ nakitle aldı; anlaşma 6 Mayıs 2025, kapanış **17 Haziran 2025**. Trendyol GO 2024'te 200 milyondan fazla sipariş ve 2 milyar $ brüt rezervasyon yaptı. | [R] Uber SEC 10-Q: https://www.sec.gov/Archives/edgar/data/1543151/000154315125000023/uber-20250630.htm ; [H] https://techcrunch.com/2025/05/06/uber-eats-comes-to-turkey-via-700m-trendyol-go-acquisition/ ; https://www.cnbc.com/2025/05/06/uber-buys-85percent-stake-in-turkish-food-delivery-platform-for-700-million.html |
| **GetirYemek** → Uber | Anlaşma 9 Şubat 2026'da duyuruldu (~335 milyon $). Rekabet Kurulu **Haziran 2026'da taahhütler çerçevesinde izin verdi**; Uber 500 milyon $ Türkiye yatırımı taahhüt etti. Eylül 2026'dan itibaren GetirYemek satıcı panelleri Uber Eats Trendyol Go'ya taşınıyor. | [R] https://www.rekabet.gov.tr/tr/Guncel/uber-technologies-inc-tarafindan-getir-a-b7a6d2dc226bf11193eb0050568549fa ; [H] https://webrazzi.com/2026/06/19/rekabet-kurulu-uberin-getirin-yemek-ve-market-teslimati-islerini-devralmasina-onay-verdi/ ; https://www.businesswire.com/news/home/20260209015918/en ; [B] panel taşıma: https://www.siparisustasi.com/blog/uber-eats-komisyon-orani |
| **Yemeksepeti** → SSW Partners | Uber, Delivery Hero'yu 14,8 milyar $ değerlemeyle alıyor. Yemeksepeti ise **SSW Partners'a (~1,6 milyar $)** satılıyor ve Uber'in kontrolüne girmiyor. Kapanış **2027'nin ikinci yarısında** bekleniyor. Yemeksepeti'nin 30 milyondan fazla kullanıcısı ve ~90.000 iş ortağı var (Delivery Hero 2025 raporu). | [H] https://www.turkiyetoday.com/business/turkiyes-yemeksepeti-sold-to-ssw-partners-as-uber-acquires-delivery-hero-3224009 ; https://www.turkishminute.com/2026/07/16/turkeys-largest-food-delivery-platform-to-be-sold-in-uber-delivery-hero-deal/ ; https://medyascope.tv/2026/07/16/uberden-148-milyar-dolarlik-anlasma-yemeksepeti-el-degistiriyor/ ; [R-özet] https://www.paulweiss.com/insights/client-news/ssw-partners-to-acquire-delivery-hero-operations-in-14-markets-in-europe-and-south-america |
| Yemeksepeti büyümesi | 2025'te **22.209 yeni restoran** katıldı. | [H] https://webrazzi.com/2026/05/13/yemeksepeti-nin-25-yilinda-one-cikan-verileri/ |
| **Migros Yemek** | Dördüncü oyuncu. Kampanyalarla büyüyor. Restoran sayısı [D?]. | [B] https://pakettakip.net/migros-yemek-komisyon-oranlari-ve-karlilik-rehberi-2025/ |
| Pazar payları | Yemeksepeti ~%40; üç büyük oyuncunun (YS, TGO, Getir) toplam payı ~%90 | [H] Doğruluk Payı: https://www.dogrulukpayi.com/dogruluk-kontrolu/getiryemek-trendyol-ve-yemeksepeti-uber-catisi-altinda-tek-elde-mi-toplandi. Rekabet Kurumu'nun resmi pay verisi [D?]. |
| Eleştiriler | Prof. Yalçın Karatepe "tekelleşme" uyarısında bulundu. Komisyon, münhasırlık ve algoritmik sıralama konularında taahhüt olup olmadığı sorgulanıyor. | [H] https://tclira.com/prof-dr-yalcin-karatepeden-carpici-tepki-uber-online-yemek-siparisinde-tekellesmeye-gidiyor/ ; https://www.elyazmalari.com/2026/08/29/uber-eats-turkiyede-buyumuyor-pazari-topluyor/ |

**Proje için anlamı [T]:**
- 2026–2027'de restoranın karşısında fiilen **iki büyük blok** (Uber ve YS/SSW) ile Migros kalıyor.
- Blokların komisyon ve kampanya koşullarını tek taraflı sıkılaştırma riski, işletmelerin "B planı" (kendi kanalı) arayışını hızlandıracak.
- Satış mesajı "pazaryerini bırak" olmamalı, "pazaryerine bağımlı kalma" olmalı.

### 2.3 Restoran ve işletme sayıları

| Gösterge | Değer | Kaynak |
|---|---|---|
| En az bir sigortalı çalıştıran kayıtlı yeme-içme işyeri | 2010'da 62.384 → **2025'te 158.725** | [H/R-özet] TEPAV "Cafe Latte Ekonomisi" (Ağustos 2026): https://files.tepav.org.tr/upload/files/1787904391748-0.Cafe_latte_ekonomisiBir_fincanda_iki_Turkiye.pdf ; https://www.milligazete.com.tr/turkiyede-kayitli-yeme-icme-is-yeri-sayisi-2010-yilinda-62-bin-iken-2025te-159-bine-cikti |
| Yiyecek-içecek hizmetlerinde kayıtlı çalışan | 913.782 (2025) | [H] aynı kaynak |
| Ticari restoran sayısı (2024) | ~113.500; satış 647 milyar TL | [D?]: arama özetinde geçti, kaynak rapor net değil |
| Dernek söylemi | "300 bin restoran ve kafe" | [H] TÜRES; aşağıdaki linkler |
| Yemeksepeti iş ortağı | ~90.000 (market vb. dahil) | [H] Delivery Hero 2025 raporuna atıfla |

**Hedef kitle tahmini [T]:**
- Paket servis yapan ve kendi kuryesi olan bağımsız işletme sayısı 40–80 bin aralığında olabilir. Kaba mantık: SGK kayıtlı 159 bin işyerinin önemli kısmı paket servis yapıyor ve Yemeksepeti'nin 90 bin iş ortağı var. Bu rakam doğrulanmadı.
- Su/tüp bayileri, pastaneler ve şarküteriler ek dikeyler olarak üstüne eklenir.

### 2.4 Komisyon oranları ve ek ücretler (2025–2026)

> **Uyarı:** Platformlar tek bir resmi tarife yayımlamıyor. Oranı sözleşme, şehir, kategori ve teslimat modeli (platform kuryesi mi, restoranın kendi kuryesi mi) belirliyor. Aşağıdaki bantlar blog, şikâyet ve dernek beyanlarından derlendi; **resmi olarak doğrulanmadı.**

| Platform | Kendi kuryesiyle | Platform kuryesiyle | Not / kaynak |
|---|---|---|---|
| **Yemeksepeti** | Şikâyetlerde ~%25 örneği | ~%25–40 bandı; şikâyette %38,4 örneği | Genel bant %15–40 [B] https://www.siparisustasi.com/blog/yemeksepeti-komisyon-orani ; şikâyetler [H] https://www.sikayetvar.com/yemeksepeti/komisyon |
| **Uber Eats Trendyol Go** | "~%9'a kadar düşebiliyor" iddiası | Genel bant %15–38 | [B] https://www.siparisustasi.com/blog/trendyol-yemek-komisyon-orani ; https://www.ideasoft.com.tr/trendyol-yemek-komisyon-oranlari/ |
| **GetirYemek** (TGO paneline taşınıyor) | **~%12 (KDV dahil)** | **~%35–38 (KDV dahil)** | [B] https://kafe360.com/blog/yemeksepeti-mi-getir-yemek-mi-komisyon-karsilastirma ; https://www.eleman.net/is-rehberi/isveren-markasi/getir-yemekte-satici-olmak-h15234 |
| **Migros Yemek** | Daha düşük bant | Genel bant %15–25 | [B] https://pakettakip.net/migros-yemek-komisyon-oranlari-ve-karlilik-rehberi-2025/ |
| **Sektör beyanı** | | "%40'a varan" | [H] TÜRES, Kasım 2025 (aşağıda) |

**Komisyon dışındaki kesintiler:**
- **KDV:** Komisyon faturasına %20 KDV eklenir; yemeğin kendi KDV'si ise %10 [B] https://www.edenred.com.tr/restoran-ve-hazir-yemek-kdv-oranlari. KDV mükellefi restoran bu KDV'yi indirebilir; yani yük nakit akışında hissedilir. Basit usul gibi istisna durumlarda gerçek maliyettir.
- **Kampanya ve indirim finansmanı:** Joker ve flash kampanyalarda indirimin bir kısmını restoran finanse eder.
- **Joker başına reklam ücreti:** Şikâyetlerde Joker siparişi başına **6,80 TL reklam ücreti** iddiası var [H] https://www.sikayetvar.com/yemeksepeti/yemeksepetiye-asiri-komisyon-ve-reklam-bedeli-sikayeti. Hizmetin koşulları: [R] https://kurumsal.yemeksepeti.com/joker-hizmeti-kullanim-kosullari/
- **Görünürlük/reklam bedeli, kurye/teslimat bedeli, ödeme hizmeti:** Nisan 2026 düzenlemesiyle kalem kalem gösterilmesi zorunlu hale geldi (bkz. 2.5).
- **TÜRES örneği:** 1.000 TL'lik siparişte %32 komisyon (320 TL) ve komisyon KDV'si (64 TL) düşülünce restorana 616 TL kalıyor. Diğer kesintilerle birlikte "531 TL kalıyor" [H] https://www.gazetepencere.com/ekonomi/restoranlardan-online-platformlara-boykot-uyarisi-komisyon-yuzde-40i-buluyor-681695h
- **Esnaf örneği:** İstanbul'da bir tantuni işletmecisi %38 komisyon nedeniyle 200 TL'lik ürünü 276 TL'ye çıkarmak zorunda kaldığını söylüyor [H] https://www.turkiyegazetesi.com.tr/ekonomi/esnaf-komisyonlar-yuksek-ama-mecburuz-diyor-online-platformlar-isletme-karina-ortak-1816030

### 2.5 Regülasyon: Ticaret Bakanlığı yemek sipariş düzenlemesi (Nisan 2026)

Kaynaklar:
- [R] https://ticaret.gov.tr/haberler/elektronik-ticarette-yemek-siparis-hizmetlerine-yonelik-yeni-duzenleme
- [H] https://www.ekonomigazetesi.com/sektor-haberleri/bakanlik-elektronik-yemek-siparislerinde-tum-hizmet-bedelleri-seffaf-hale-getirildi-76900
- [B] https://www.alomaliye.com/2026/04/13/yemek-siparis-platformlarina-yeni-duzenleme-komisyon-ve-hizmet-bedelleri/
- Hukuk bilgi notu (21.04.2026): https://www.lexology.com/library/detail.aspx?g=2f758278-12b1-45ec-be5d-31c9969fe954

Getirilen kurallar:
- Pazaryerleri restorandan tahsil ettikleri **tüm bedelleri hizmet kalemi bazında** satıcı panelinde göstermek zorunda.
- Siparişin alınması, iletilmesi, ödeme süreci ve temel altyapı gibi **aracılığın doğasında olan hizmetler için ayrı bedel** talep edilemiyor.
- **Sırf kampanyaya katılım** ayrı bir ücret kalemi yapılamıyor.
- İndirim yoksa komisyon ana fiyat üzerinden, restoran indirim yaptıysa tüketicinin fiilen ödediği tutar üzerinden hesaplanıyor.
- Tüketiciye, ödediği bedelin içinde komisyon, taşıma ve görünürlük gibi kalemler bulunabileceği bilgisi veriliyor.

**Tarih çelişkisi:** Haberlerde "13 Nisan 2026'da yürürlüğe girdi" ve "uyum için son tarih 1 Nisan 2026" ifadeleri birlikte geçiyor [D?]. Resmi metinden teyit edilmeli.

**Bizim için fırsat [T]:** Restoranlar artık panellerinde kalem kalem kesinti görüyor. **"Panelindeki son ayın kesinti dökümünü getir, 2 dakikada ne kadar tasarruf edeceğini hesaplayalım"** kampanyası doğrudan bu veriye dayanabilir.

### 2.6 Rekabet Kurumu geçmişi

| Tarih | Olay | Sonuç | Kaynak |
|---|---|---|---|
| 2016 | Yemeksepeti hakkında hâkim durum ve "en çok kayrılan müşteri" (MFN, fiyat paritesi) ile münhasırlık soruşturması | Hâkim durumda olduğu ve 4054 s.K. m.6'yı ihlal ettiği tespit edildi; **427.977,70 TL** idari para cezası verildi. MFN uygulamaları, rakip platformlarda farklı fiyat ve kampanya sunulmasını engelliyordu. | [R] https://www.rekabet.gov.tr/Karar?kararId=b01af595-d4f2-4fe3-b587-a6f9ebe8f279 ; [H] https://webrazzi.com/2016/06/15/rekabet-kurumu-yemek-sepetine-428-bin-tl-idari-para-cezasi-kesti/ |
| 7 Mart 2024 (karar no. 24-12/211-M) | Kurye zorlaması soruşturması: yeni üye restoranlara kendi kuryesini (Vale/Express) dayatma, bunun komisyonu artırması ve teslimat alanını kısıtlaması iddiaları | Soruşturma açıldı | [H] https://www.aa.com.tr/tr/ekonomi/yemek-sepetine-rekabet-sorusturmasi-acildi/3171362 |
| Gerekçeli karar (haberler Şubat 2026) | Aynı soruşturma | **Hâkim durum tespit edilmedi, ceza verilmedi.** Gerekçe: Yemeksepeti'nin payı 2021'den beri Trendyol ve Getir karşısında düşüyor; platform kuryeleri daha hızlı, şikâyetler daha az; dışlama sistematik değil. Nihai karar tarihi [D?]. | [H] https://halktv.com.tr/ekonomi/kurye-sorusturmasinda-kararinin-gerekcesi-aciklandi-1009874h ; https://www.cnbce.com/is-dunyasi/rekabet-kurumu-yemek-sepeti-icin-kurye-sorusturmasinda-gerekceli-kararini-acikladi-h25376 ; [R] https://www.rekabet.gov.tr/Karar?kararId=e7152b1a-f634-4293-9f0d-6ddf0013edb9 |
| Haziran 2026 | Uber–Getir devralması | Taahhütlerle izin (yukarıda) | [R] yukarıda |

**Bizim için anlamı [T]:**
- 2016 kararı MFN ve fiyat paritesi dayatmalarını sorunlu buldu. Bu, restoranın **kendi kanalında daha düşük fiyat veya avantaj sunabilmesi** için önemli bir emsal.
- Yine de her restoranın **güncel sözleşmesindeki hükümler** (ör. pakete broşür koyma, müşteriyi yönlendirme) avukatla kontrol edilmeli [D?].

### 2.7 Sektör tepkisi, şikâyetler ve yerel alternatif girişimler

**TÜRES (Kasım 2025):**
- "%40'a varan komisyon" açıklaması yapıldı.
- Türkiye genelinde %20 indirim kampanyası (restoranda veya gel-al) duyuruldu.
- "Ya masaya oturursunuz ya da 300 bin restoran ve kafe sistemden çıkar" denildi.
- Sektörün **kendi sipariş sistemini kuracağı** açıklandı. Bu sistemin hayata geçip geçmediği [D?]. **Takip edilmeli: rakip olabilir veya partner olabilir.**
- Kaynaklar [H]: https://www.dunya.com/ekonomi/restoranlardan-yuzde-20-indirim-karari-online-platformlari-boykota-hazirlaniyorlar-haberi-805101 ; https://gazeteoksijen.com/turkiye/fiyatlar-yuzde-10-dusebilir-restoranlar-yemek-platformlarini-boykota-hazirlaniyor-256385

**Şikâyetvar:** Komisyon, reklam bedeli ve KDV başlıklarında çok sayıda restoran şikâyeti var:
- https://www.sikayetvar.com/yemeksepeti/komisyon
- https://www.sikayetvar.com/trendyol-yemek/komisyon
- https://www.sikayetvar.com/getiryemek/komisyon/restoran

**Belediye ve oda girişimleri:**
- **Lezzet Ankara (ABB, 2020):** %0 komisyonlu belediye uygulaması. İlk haftada 546 restoran ve 3.475 müşteri kaydoldu [H] https://www.gazeteduvar.com.tr/ankara-buyuksehirden-0-komisyonlu-lezzet-ankara-uygulamasi-haber-1525072. Güncel durumu [D?].
- **Edirne esnaf odası:** Tatlıcı, Büfeci, Kebap ve Lokantacılar Esnaf Odası önce RooGo, sonra **Yemek Butik** ile protokol yaptı [H] https://edirneahval.com/esnaf-icin-komisyonsuz-uygulama-anlasmasi ; https://www.sondakika.com/haber/haber-edirne-den-komisyonsuz-yemek-siparisi-yemek-butik--19432044/
- **Sivas:** Esnafa "düşük komisyonlu sipariş uygulaması" haberi [H] https://sivas360.com/ekonomi/esnafa-dusuk-komisyonlu-siparis-uygulamasi-geliyor/26765364

**Ders [T]:** Belediye ya da oda destekli "pazaryeri kopyaları" tüketici tarafında soğuk başlangıç (cold-start) sorunu yaşar. Bizim modelimiz pazaryeri değil. Her işletmenin **kendi müşterisini kendi kanalına taşıması** üzerine kurulu olduğu için bu sorunu yaşamaz. Esnaf odaları ise **dağıtım kanalı** olarak kanıtlanmış durumda.

---

## 3. Türkiye'deki doğrudan rakipler: komisyonsuz, WhatsApp ve QR sipariş

> "Resmi API" sütunu: Rakiplerin hangi WhatsApp altyapısını kullandığı çoğunlukla sitelerinde açıkça yazmıyor. Sütundaki değerler çıkarımdır [T] ve doğrulanamadı [D?].
>
> - **`wa.me` modeli:** Müşteri web menüden sepetini oluşturur, sepet hazır metin olarak işletmenin WhatsApp'ına gönderilir. Resmi bir tüketici özelliğidir, API kullanılmaz. Ancak otomatik durum bildirimi yoktur ve işletme siparişi elle işler.
> - **QR ile bağlanan botlar:** WhatsApp Web oturumunu kullanan resmi olmayan yöntemdir. Numaranın banlanma riski vardır.

| Rakip | Konum | Fiyat (TL) | WhatsApp yaklaşımı | Güçlü yön | Zayıf yön / fırsat | Kaynak |
|---|---|---|---|---|---|---|
| **SepetTakip** | Restoran için WhatsApp sipariş, adisyon, kurye | Sabit aylık, ücretsiz kurulum; rakam yayımlanmamış [D?] | "Siparişler otomatik düşer"; API türü [D?] | "Türkiye'de ilk" iddiası, adisyon ve kurye paketi | Şeffaf fiyat yok | [B] https://sepettakip.com/siparis-uygulamalari/whatsapp-siparis-cozumu |
| **Siparel** | WhatsApp sipariş + yapay zekâ asistanı ("yazan veya arayan müşteriyle Türkçe konuşur") | **Başlangıç 680 TL/ay** (web paketi); 7 gün deneme | AI asistan; API türü [D?] | Düşük fiyat, AI | Genel amaçlı AI yasağı (Ocak 2026) ve yeni mesaj ücretleri maliyet ve uyum riski yaratıyor [T] | [B] https://siparel.com/ |
| **KolaySiparis (.co)** | Instagram ve WhatsApp sipariş yönetimi (dikeyler arası) | **Ücretsiz** (1 mağaza, 20 sipariş/ay); **Başlangıç 999 TL/ay** (liste 1.499) | Panel + WA/IG | Freemium | Restorana özel değil | [B] https://www.kolaysiparis.co/ |
| **Komisyonsuz** (partner.komisyonsuz.com) | Restoran/kafe online sipariş, QR sipariş | Bireysel satıcılara ücretsiz; ödeme ve SMS modülleri ücretli | [D?] | SEO içerik ağı | Fiyat belirsiz | [B] https://partner.komisyonsuz.com/siparis-sistemi-fiyatlari.html |
| **KendiSepeti** | Restoran için kendi sipariş kanalı | Komisyonsuz kanal ücretsiz; "Pro" ücretli [D?] | Web, QR, WA link | Ücretsiz giriş | Monetizasyon belirsiz | [B] https://www.kendisepeti.com/komisyonsuz-siparis |
| **QrMenum** | QR menü + paket servis modülü | Yıllık **Temel 6.000**, **Gelişmiş 10.000**, AI eklentisi +10.000; paket servis modülü lansmana özel 12 ay ücretsiz | Muhtemelen `wa.me` modeli ("müşteri WhatsApp'tan sipariş gönderir") [T] | Güçlü içerik ve SEO, şeffaf fiyat | Sipariş işletmeye mesaj olarak düşüyor, operasyon paneli sınırlı [T] | [B] https://qrmenum.app/paket-servis ; https://www.qrmenum.app/fiyatlandirma |
| **Restajet** | Markalı web sitesi, mobil uygulama, QR, sadakat | Sabit aylık; fiyat demoyla [D?] | Web ve uygulama kanalı | "Kendi markalı uygulama" | WhatsApp-merkezli değil | [B] https://www.restajet.com/tr/fiyatlar |
| **Restoran Ödül** | Online sipariş sistemi | Kurulum ücreti + 14 gün deneme; "aylık hizmet ücreti yok" iddiası | Web | Tek seferlik model | Sürdürülebilirliği belirsiz | [B] https://www.restoranodul.com/ucretler/ |
| **Yemek Butik** | Komisyonsuz sipariş, oda protokolleri | Satışa göre kademeli, **en fazla 10.000 TL/ay** (70.000 TL üzeri satışta sabit) | Web/uygulama | Esnaf odası kanalı (Edirne) | Ciroya bağlı ücret "komisyonsuz" algısını zayıflatıyor [T] | [B] https://yemekbutik.com/ |
| **İletmen TekEkran / TekMenü** | Pazaryeri siparişlerini tek ekranda toplama + komisyonsuz menü + kapıda kartlı tahsilat | TekMenü **paket başı 5,99 TL** | Web menü | Pazaryeri entegrasyonu, yemek kartı | Paket başı ücret, hacim arttıkça pahalılaşıyor | [B] https://www.iletmen.com.tr/ ; https://www.iletmen.com.tr/blog/restoran-komisyonsuz-siparis-nasil-alinir |
| **OxyMenu** | Adisyon, QR, sipariş, paket servis | **Lite 749 TL/ay + KDV**, **Start 1.499 TL/ay**; 30 gün deneme | Web ve uygulama | Adisyonla bütünleşik | WhatsApp-merkezli değil | [B] https://oxymenu.com/restoran-siparis-programi |
| **FoodEmp** | Kanal bazlı sipariş | QR menü ücretsiz, diğer kanallar **20 $/ay** | [D?] | Ucuz | Dolar bazlı fiyat | [B] https://partner.foodemp.com/komisyonsuz-siparis-secenekleri-ve-degerlendirme-rehberi.html |
| **Doysana** | Komisyonsuz sipariş | Sabit aylık [D?] | [D?] | | | [B] https://doysana.com/blog/restoran-icin-en-iyi-siparis-sistemi |
| **SiparişGo** | **Su bayi, market, yerel teslimat** için WhatsApp sipariş, CRM, rota, tahsilat | 14 gün kartsız deneme; kullanıcı limitli paketler (3/10/sınırsız); rakam [D?] | "WhatsApp üzerinden otomatik sipariş" | Dikey odak, rota optimizasyonu | Restoran dışı | [B] https://siparisgo.net/ |
| **Siparişmatik, Qolay, Mevlana, Bilsist** | Su/tüp bayi otomasyonu | Genelde lisans veya abonelik [D?] | Siparişmatik: telefon + web + WhatsApp, AI telefon asistanı | Köklü dikey yazılımlar | Eski arayüz, masaüstü ağırlıklı [T] | [B] https://siparismatik.com/ ; https://www.qolaybilisim.com/index.html |
| **Wabo** ve benzeri AI botlar | Genel WhatsApp AI asistanı | Piyasa bandı **1.490–5.490 TL/ay** | **"QR kod ile bağlanır"**, yani muhtemelen resmi olmayan WhatsApp Web bağlantısı [T/D?] | 15 dakikada kurulum | Ban riski; sipariş ve operasyon paneli yok [T] | [B] https://www.wabo.tr/ ; https://www.chatbotwhatsapp.com.tr/whatsapp-siparis-botu-fiyatlari-2026/ |
| **Sipariş Ustası** | *Rakip değil.* Pazaryeri panel yönetimi ajansı (menü, fiyat, kampanya optimizasyonu) | Teklif usulü | — | — | **Partner olabilir** (müşteri yönlendirme) | [B] https://www.siparisustasi.com/blog/komisyon-oranlari-2026 |
| QR menü fiyat bandı (referans) | Sadece menü | Aylık 200–2.500 TL. Örnekler: MONU 249–2.499/ay; myQR yıllık 1.500–3.000; Kafe360 yıllık 8.999 | — | — | Menüden siparişe geçiş boşluğu | [B] https://www.monu.com.tr/blog/qr-menu-fiyatlari ; https://myqrmenu.tr/qr-menu-fiyatlari ; https://kafe360.com/blog/qr-menu-fiyatlari-2026-maliyet-rehberi |

**Yerli rakip pazarından çıkarımlar [T]:**
1. **Fiyat bandı:** Giriş paketleri 680–1.000 TL/ay, orta paketler 1.500 TL/ay, AI bot paketleri 1.500–5.500 TL/ay. Bazı oyuncular yıllık ödeme veya ciro/paket bazlı model kullanıyor.
2. **Boşluk:** Aşağıdakilerin hepsini **birlikte** sunan net bir lider görünmüyor:
   - **resmi WhatsApp Cloud API**'ye dayalı sipariş, durum bildirimi ve kayıtlı müşteri CRM'i,
   - işletme panelinde **sesli uyarı ve mutfak/kurye akışı**,
   - pazaryerleriyle **birlikte** kullanıma yönelik araçlar (paket içi QR, sadakat, "aynısından tekrar"),
   - şeffaf fiyat ve self-servis kurulum.
3. **Risk:** Pazar kalabalık, müşteri edinme maliyeti (CAC) düşük tutulmalı. Ürün farkı tek başına yetmez; **dağıtım ve kurulum hizmeti** fark yaratır.

---

## 4. Adisyon/POS ekosistemi: fırsat mı tehdit mi?

| Firma | Model / fiyat | Online sipariş ve WhatsApp | Pazaryeri entegrasyonu | Bizim için anlamı | Kaynak |
|---|---|---|---|---|---|
| **Adisyo** | Bulut. Yıllık lisans: **Esnaf 9.000 / Büyük İşletme 15.000 / Kurumsal 22.000 TL (+KDV)** (üçüncü taraf karşılaştırması); 15 gün deneme | QR menü ve QR sipariş var; WhatsApp sipariş [D?] | Yemeksepeti, Getir, Trendyol, Migros, Fuudy | Entegrasyon ortağı (siparişi Adisyo'ya aktarma); bayileri dağıtım kanalı olabilir | [B] https://novempos.com/en-iyi-adisyon-programlari/ ; [R-özet] https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari |
| **SambaPOS** | V5 Pro **339 $** tek seferlik + KDV; Entegrasyon Paketi 15.000 TL; teknik destek 1.500 TL | **GloriaFood entegrasyon modülü** var | Yemeksepeti, Getir | **GloriaFood 30.04.2027'de kapanıyor**, SambaPOS + GloriaFood kullanıcıları geçiş havuzu oluşturuyor | [B] https://www.dinamikpos.com/marka/sambapos ; https://sambapos.com/tr/yemek-sepeti-entegrasyonu/ |
| **Menulux** | Donanım + yazılım teklifi | **Web Store** (restoran web sitesi + online sipariş + 3D Secure) ve mobil uygulama | Yemeksepeti, Getir, Trendyol | **Tehdit:** kendi web store'u var. WhatsApp-merkezli değil [T] | [B] https://www.menulux.com/restoran-yazilimi/web-sitesi/online-siparis-sistemi |
| **Simpra** | Bulut RMS (daha büyük ve zincir işletmeler) | QR, kiosk, platform entegrasyonları; WhatsApp sipariş görünmüyor [D?] | Var | Zincir segmentinde entegrasyon ortağı | [B] https://simprasuite.com/ |
| **robotPOS** | Kurumsal | QR menü ve QR sipariş | Yemeksepeti, Trendyol Yemek, Getir, Migros | Entegrasyon ortağı | [B] https://www.robotpos.com/pazaryeri-entegrasyonlari ; https://www.robotpos.com/qr-menu-sistemi |
| **Posrestoran** | [D?] | [D?] | [D?] | Veri bulunamadı | — |
| Genel adisyon fiyat bandı | Aylık lisans 465–1.050 TL; kasa ve online sipariş entegrasyonu ayrı ücretli | | | | [B] Paketmaster blog özeti |

**Değerlendirme [T]:**
- **Fırsat:**
  - POS firmaları pazaryeri siparişlerini tek ekrana zaten topluyor. Biz **"bir kanal daha"** olarak POS'a sipariş aktarırsak (Adisyo, SambaPOS ve robotPOS entegrasyonları) işletme ekranını değiştirmek zorunda kalmaz. Benimsemede en büyük engel ortadan kalkar.
  - POS **bayileri** ve kurulum yapan teknik servisler, ayda onlarca restoran ziyaret eden hazır bir satış ağı. Gelir paylaşımıyla (rev-share) bayi programı kurulabilir.
- **Tehdit:**
  - Menulux gibi oyuncular web store'a WhatsApp modülü ekleyebilir.
  - Pazaryerleri, iFood'un Anota AI'yı alması gibi kendi "doğrudan sipariş" aracını çıkarabilir veya satın alabilir.
- **Strateji:** POS'la rekabet etmek yerine **"POS-agnostik WhatsApp sipariş kanalı"** olarak konumlanmak. POS'u olmayan küçük esnafa ise panelimiz hafif bir adisyon görevi görür.

---

## 5. Global emsaller

| Şirket (ülke) | WhatsApp-merkezli mi? | Fiyat modeli | Ölçek ve öne çıkanlar | Kaynak |
|---|---|---|---|---|
| **Anota AI** (Brezilya) | **Evet.** WhatsApp'ta AI ile otomatik karşılama, dijital menü, PIX ödeme | Aylık **Start 219,99 R$ / Advanced 254,99 / Premium 329,99 / Gestão Avançada teklif**; sipariş başı ücret yok; 7 gün kartsız deneme | iFood yaklaşık **60 milyon R$'a satın aldı**. Satın alma sırasında 15 bin+ otomatik restoran ve yılda 40 milyon+ sipariş vardı; 2026'da "50 bin+ restoran" iddiası. Satın almadan sonra sipariş hacmi 4 katına çıktı. | [H] https://abrasel.com.br/noticias/noticias/ifood-compra-a-anota-ai-para-oferecer-atendimento-pelo-whatsapp/ ; [B] https://botaihub.com.br/ferramentas/anota-ai/ ; https://reidodelivery.com.br/blog/anota-ai-vale-a-pena |
| **Brendi** (Brezilya) | **Evet.** "WhatsApp'ı satış kanalına çevirir" | **Faturaya göre değişen aylık ücret**; cezasız iptal; deneme | 8.500+ restoran; küçük şehirlerde güçlü (büyük uygulamaların zayıf olduğu yerler) | [B] https://brendi.com.br/ ; [H] https://www.mobiletime.com.br/noticias/09/09/2026/brendi-faz-de-whatsapp-c/ |
| **Goomer** (Brezilya) | Kısmen (dijital menü + WhatsApp siparişi) | **Grátis 0 / Básico 59,94 / Automatizar 138,68 / Integrar 224,93 R$/ay** (yıllık); Integrar aylık ödemede 299,90 R$ (yıllıkta %40 indirim) | **Referans programı** ("indique e ganhe"); ~100 POS entegrasyonu | [B] https://goomer.com.br/planos ; https://goomer.com.br/indique-ganhe |
| **Cardápio Web** (Brezilya) | Kısmen | **169,99–269,99 R$/ay** (Delivery planı 209,99); otomasyon ve mesaj gönderimi **ek modül** | Çeyreklik ve yıllık indirim | [B] https://ajuda.cardapioweb.com/boas-vindas/planos-funcionalidades-e-modulos-adicionais ; https://reidodelivery.com.br/blog/cardapio-web-vale-a-pena |
| **Saipos** (Brezilya) | POS; iFood entegre | **240,79 R$/ay'dan** başlıyor | 25 bin+ restoran | [B] https://saipos.com/planos-e-precos |
| **OlaClick** (LatAm, 27 ülke) | **Evet.** Menüden WhatsApp'a sipariş, AI chatbot, toplu WhatsApp mesajı | **Ücretsiz plan**; ücretli planlar **~8 $/ay**'dan (Brezilya'da 39 R$); Premium'da chatbot ve otomatik yazdırma | 120 bin+ işletme; 50 bin aktif restoran; ayda 1,3 milyon+ sipariş; Y Combinator mezunu | [B] https://olaclick.com/en/orders-by-whatsapp/ ; https://pricing.olaclick.com/ |
| **Take App** (Asya) | **Evet.** WhatsApp için e-ticaret | **Ücretsiz** (ayda 50 siparişe kadar panele kaydedilir); ücretli planlar **50 $/ay**'dan; Business planda ayda 1.000 otomatik WA mesajı | Komisyon yok | [B] https://www.take.app/pricing |
| **Zbooni** (BAE/MENA) | **Evet.** Sohbet üzerinden ödeme linki ve katalog | **Abonelik yok, sipariş başı %3,5 + KDV** | Sosyal ticaret ve ödeme odaklı | [B] https://www.zbooni.com/pricing/all-in-one/ ; https://www.thenationalnews.com/business/money/zbooni-the-uae-payment-service-helping-micro-businesses-process-transactions-1.852272 |
| **DotPe / Petpooja** (Hindistan) | Kısmen (WhatsApp ve sosyal medyadan paylaşılan sipariş linki) | DotPe: ücretsiz başlangıç + online siparişten komisyon. Petpooja: ~10.000 ₹/yıl'dan + %1,5–2 işlem ücreti | POS + online sipariş ekosistemi | [B] https://blog.slantco.com/petpooja-vs-dotpe-whats-the-difference/ ; https://restrofi.com/blog/restaurant-pos-alternatives-india |
| **Owner.com** (ABD) | Hayır (web sitesi, uygulama, SEO, pazarlama otomasyonu) | **Sabit 499 $/ay** veya **249 $/ay + sipariş başı %5** | ARR ~34 milyon $ (2024 sonu) → 81 milyon $ (2025 sonu) → **100 milyon $ (Temmuz 2026)**. Seri C 120 milyon $, 1 milyar $ değerleme (Mayıs 2025); Seri D 240 milyon $, 2,3 milyar $ (Ağustos 2026). Restoran sayısı 2 bin (Ocak 2024) → 10 bin+ (Haziran 2025). | [B] https://sacra.com/c/owner/ ; https://research.contrary.com/company/owner ; [H] https://www.bloomberg.com/news/articles/2025-05-13/restaurant-tech-startup-owner-com-hits-1-billion-valuation ; https://runtimewire.com/article/adam-guild-owner-240m-series-d-ai-restaurants |
| **ChowNow** (ABD) | Hayır | **249 / 349 / 449 $/ay** (yıllıkta 229/319/409); işlem ücreti %2,95 + 0,29 $; kurulum 119–499 $ | %0 komisyon | [B] https://www.labrador.ai/blog/chownow-pricing-explained |
| **Flipdish** (İrlanda/AB/ABD) | Hayır | ABD'de web sitesi **119 $/ay**, web + uygulama 199 $/ay; AB'de 49–79 €; artı **sipariş başı ücret** | Kiosk dahil geniş ürün | [B] https://www.g2.com/products/flipdish-restaurant-management-system/pricing ; https://restauranttools.ai/tools/flipdish |
| **Slerp** (Birleşik Krallık) | Hayır | Özel teklif; komisyonsuz sabit aylık | **Kurye entegrasyonu** (Uber Direct, Stuart, Deliveroo): her sipariş için otomatik kurye çağırır | [B] https://www.slerp.com/ |
| **Deliverect** (global) | Hayır (pazaryeri siparişlerini POS'ta toplayan ara katman) | Kurulum + lokasyon başı abonelik + işlem ücreti; bağımsız tahminler ~99 $+/lokasyon | Entegrasyon katmanı | [R-özet] https://www.deliverect.com/en/pricing |
| **GloriaFood** (Oracle) | Hayır | Ücretsiz; eklentiler: ödeme 29 $, web sitesi 9 $, uygulama 59 $/ay | **30 Nisan 2027'de kapanıyor**; yeni kayıtlar kapalı | [B] https://menuro.io/blog/gloriafood-shutting-down-2027/ ; https://www.foxifood.com/blog/gloriafood-shutting-down-alternatives/ |

**Brezilya'dan kanıt: Abrasel araştırması, Mart 2025, 2.176 işletme sahibi** [H]
- Paket servis cirosunun **%54'ü pazaryerlerinden**, **%26'sı WhatsApp'tan**, %12'si kendi uygulama veya sitesinden, %8'i telefondan geliyor.
- Paket servis yapan işletmelerin **%63'ü WhatsApp'ı satış kanalı olarak kullanıyor**.
- %38'i bir tür otomasyon kullanıyor: %21'i bot ve insanı birlikte, %17'si yalnızca AI.
- Kaynaklar: https://abrasel.com.br/noticias/noticias/whatsapp-representa-26-do-faturamento-delivery-bares-restaurantes/ ; https://www.mobiletime.com.br/noticias/14/03/2025/whatsapp-bar-restaurante/

**Başarıyı getiren özellikler ve stratejiler [T, kaynaklara dayalı sentez]:**
1. **Sohbet içinde link + bot:** Anota AI, Brendi ve OlaClick'te bot müşteriyi karşılar, menü linkini yollar, sepet web'de tamamlanır, durum bildirimi WhatsApp'tan gider. Türkiye'deki `wa.me` modelinin **tersi**: sipariş yapılandırılmış veri olarak panele düşer.
2. **Freemium ve düşük giriş fiyatı** Latin Amerika'da yaygın (Goomer, OlaClick, Take). Ücretsiz plan, QR menü rakiplerine karşı müşteri kazanma aracı olarak işe yarıyor.
3. **Pazaryeri entegrasyonu:** Anota AI ve Saipos iFood ile entegre. Mesaj "pazaryerinin yerine" değil, **"pazaryerinin yanında"**.
4. **Owner.com büyüme oyun kitabı:**
   - Kurucunun bizzat yaptığı soğuk aramalarla başlayan ve 20'den fazla satış geliştirme temsilcisiyle (BDR) ölçeklenen **outbound satış**.
   - **YouTube ve içerik** (30 bin+ abone).
   - "Biz senin için yaparız" yaklaşımıyla **SEO uyumlu web sitesi** (28 günde SEO trafiğinde %30 artış iddiası).
   - **Mobil uygulama**: uygulamayı kullanan müşteri grubu ortalamanın 2 katı tekrar sipariş veriyor.
   - "Goliath'lara (DoorDash vb.) karşı küçük restoran" hikâyesi.
   - Kaynaklar [B]: https://newsletter.outbound.kitchen/p/how-ownercom-scaled-outbound-to-30m ; https://review.firstround.com/owners-path-to-product-market-fit/ ; https://research.contrary.com/company/owner
5. **Çıkış ve tehdit sinyali:** iFood'un Anota AI'yı alması, pazaryerlerinin WhatsApp kanalını **kendi bünyesine alma** eğilimini gösteriyor. Türkiye'de Uber veya Yemeksepeti yerli bir WhatsApp aracını satın alabilir. Bu bizim için hem **risk** (rakibe güç katılması) hem **çıkış (exit) yolu**.

---

## 6. WhatsApp maliyet ve kural çerçevesi (iş modeline etkisi)

| Konu | Durum | Kaynak |
|---|---|---|
| Mesaj başı fiyatlandırma | 1 Temmuz 2025'ten beri şablon mesajları mesaj başına ücretlendiriliyor. Pencere içindeki utility şablonları ücretsizdi. | [R] https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing |
| **Türkiye tarifesi** | Pazarlama **0,0109 $/mesaj** (≈0,53 TL); utility ve authentication **~0,0009 $** (≈0,044 TL; 2026'daki indirimlerden sonra) | [B] https://whautomate.com/whatsapp-business-api-pricing ; https://www.vatansms.com/whatsapp/business-api-fiyatlar/. Meta tarife tablosunda teyit edilmeli. |
| **1 Ekim 2026: servis mesajları ücretli** | Müşteri penceresindeki serbest metin yanıtları, **numara başına ayda 1.000 mesajdan sonra** utility tarifesinden ücretlendiriliyor. Kalan hak devretmiyor. Ödeme yöntemi eklemeyen işletmelere servis mesajı teslimi duruyor (son gün 30 Eylül 2026). CTWA reklamından veya Facebook sayfası butonundan başlayan sohbetlerde 72 saatlik ücretsiz pencere devam ediyor. | [R-özet] https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages ; [B] https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/ ; https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026 ; [H] https://www.sozcu.com.tr/whatsapp-1-ekim-den-itibaren-mesaj-basina-para-almaya-baslayacak-p363112 |
| Meta Business Agent | Meta'nın kendi AI ajanı Haziran 2026'da global kullanıma açıldı. Ajanın mesajları token başına ücretli (Ağustos 2026'dan itibaren ~2 $ / 1 milyon token). | [H] https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/ ; [R] https://about.fb.com/news/2026/06/meta-business-agent/ ; [B] https://zernio.com/blog/meta-business-agent-pricing |
| Genel amaçlı AI chatbot yasağı | 15 Ocak 2026'dan itibaren genel amaçlı LLM botları yasak. **Sipariş ve müşteri hizmeti gibi göreve odaklı AI serbest.** | [H] https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/ ; [B] https://respond.io/blog/whatsapp-general-purpose-chatbots-ban |
| **Coexistence** (uygulama + API aynı numarada) | Türkiye Ekim 2025'te açıldı; Mayıs–Haziran 2026 itibarıyla tüm dünyada mevcut. Kısıtları teyit edilmeli [D?]. | [B] https://chakrahq.com/article/whatsapp-coexistence-live-eu-uk-europe-whatsapp-business-for-api-live/ ; [R] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users |
| Tech Provider ve Embedded Signup | Varsayılan olarak **haftada (kayan 7 gün) 10 yeni işletme** bağlanabiliyor. Embedded Signup v2 8 Ekim 2026'da kullanımdan kalkıyor; v4 zorunlu. Tech Provider modelinde **işletme Meta'ya doğrudan öder**, sağlayıcı yalnızca kendi yazılımını faturalar. | [R-özet] https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers ; [B] https://developers.telnyx.com/docs/messaging/whatsapp/embedded-signup/tech-provider |
| İYS | **Kampanya ve pazarlama** içerikli WhatsApp mesajları için önceden onay, İYS kaydı ve aynı kanaldan ücretsiz ret yolu gerekli. **Sipariş onayı, teslimat bildirimi gibi işlemsel mesajlar onaya tabi değil.** | [R] https://iys.org.tr/iys/sss ; [B] https://www.iletimerkezi.com/docs/guides/iys-rehberi |

**İş modeli sonuçları [T]:**
- Sipariş başına gönderilen mesaj sayısı 2–3 ile sınırlandırılmalı: "alındı/onaylandı", "yola çıktı", "teslim edildi + değerlendirme". Durum takibi web'deki **sipariş takip sayfası** üzerinden yapılmalı.
- Pazarlama mesajları **kredi** olarak satılmalı. Maliyet dolar bazlı olduğu için TL fiyatı çeyreklik güncellenmeli.
- Kritik karar: **Tech Provider** (işletme Meta'ya kendi kartıyla öder) mi, **Solution Partner / BSP kredi hattı** (biz öder, işletmeye fatura ederiz) mı? Esnafın Meta Business Manager'a kredi kartı tanımlaması ciddi bir sürtünme. MVP'de bir **BSP'nin kredi hattı** kullanılarak maliyetin bizde toplanması önerilir. Bkz. "Açık sorular".
- Meta Business Agent, basit soru-cevap ve "menü nedir" botlarını **metalaştırıyor**. Bizim değerimiz bot değil; **sipariş operasyonu**, yani panel, mutfak, kurye, CRM ve entegrasyonlar.

---

## 7. Fiyatlandırma önerisi

### 7.1 İlkeler
- Liste fiyatı **KDV hariç** yazılır ve yanında **KDV dahil** tutar gösterilir. Yazılım hizmetinde KDV %20'dir. Esnaf "ne ödeyeceğim?" sorusunu KDV dahil düşünür.
- **Sipariş başı ücret yok, ciro yüzdesi yok.** Konumlandırmamız "komisyonsuz, sabit ücret". Yemek Butik ve İletmen'in ciroya veya pakete bağlı modellerinden bilinçli olarak ayrışıyoruz.
- **Şube başı** fiyatlandırma; ikinci ve sonraki şubelere indirim.
- **TL enflasyonuna karşı:** Sözleşmeye yıllık TÜFE endeksli güncelleme maddesi konur. Dolar bazlı maliyetler (Meta, bulut) için mesaj kredileri çeyreklik fiyatlanır.

### 7.2 Paketler (öneri)

| | **Esnaf** | **Pro** (önerilen ana paket) | **Zincir** |
|---|---|---|---|
| Hedef | Günde 5–20 sipariş alan tek şube | Günde 20–80 sipariş alan tek şube | 2 ve üzeri şube, markalı zincir |
| **Aylık, KDV hariç** | **990 TL** | **1.790 TL** | **2.990 TL / şube** |
| Aylık, KDV dahil | 1.188 TL | 2.148 TL | 3.588 TL / şube |
| **Yıllık peşin (%20 indirim), KDV hariç** | 9.504 TL (792 TL/ay) | 17.184 TL (1.432 TL/ay) | 28.704 TL / şube |
| Kurucu üye (ilk 100 işletme, %30, 12 ay sabit) | 693 TL | 1.253 TL | 2.093 TL |
| İçerik | WhatsApp sipariş hattı (resmi API, coexistence), web menü ve sipariş sayfası, panel + sesli uyarı, 2 kullanıcı, QR ve paket kartı şablonları | Esnaf paketinin tümü + kurye uygulaması ve ataması, teslimat bölgesi ve ücret haritası, müşteri CRM'i ("aynısından tekrar"), kupon ve sadakat, yazıcı entegrasyonu, raporlar, online ödeme (işletmenin kendi ödeme kuruluşu hesabıyla), ayda 300 pazarlama mesajı kredisi | Pro'nun tümü + merkezi menü ve fiyat, şube bazlı rapor, POS entegrasyonları, API/webhook, öncelikli destek, ayda 1.000 mesaj kredisi |
| Servis ve utility mesajları (Meta) | Adil kullanım kapsamında dahil | Adil kullanım kapsamında dahil | Adil kullanım kapsamında dahil |

**Ek ücretler:**
- **Kurulum:** Self-servis ücretsiz. **"Biz kuralım"** hizmeti 1.990 TL + KDV, tek seferlik; ilk 100 işletmeye ücretsiz. Kapsamı: menü girişi, temel fotoğraf düzenleme, WhatsApp API ve coexistence kurulumu, 1 QR stand seti ve paket kartı tasarımı.
- **Deneme:** **14 gün, kredi kartı istenmeden.** Piyasadaki örnekler: Siparel 7, Anota 7, Restoran Ödül 14, SiparişGo 14, Adisyo 15, OxyMenu 30 gün.
- **Şube:** 2. ve sonraki şubelerde şube başına %20 indirim.
- **Pazarlama mesajı kredisi:** Fiyat kuralı **Meta maliyeti × 1,6** (çeyreklik güncellenir). Bugünkü maliyetle 1.000 mesajın Meta bedeli ≈ 532 TL, satış fiyatı ≈ **850–890 TL + KDV** [T]. Eğer BSP mesaj başına 0,003–0,010 $ ek ücret alıyorsa ([B] bossbot.uk ve whautomate kaynakları) maliyet 0,68–1,02 TL/mesaja çıkar; fiyat buna göre ≈ **1.200 TL + KDV / 1.000 mesaj** olur.
- **Opsiyonel ücretsiz katman (Faz 2, ürün oturduktan sonra):** "Menü" paketi. QR/web menü ve web siparişinin panele düşmesini sağlar; **ayda 50 sipariş** sınırı ve "siparisinonunde ile" markası taşır; WhatsApp API içermez. Amaç ücretsiz QR menü rakiplerinden müşteri toplamak (Take App ve Goomer modeli).

### 7.3 Rakip fiyatlarıyla kıyas (aylık, TL)

| Çözüm | Aylık eşdeğer | Not |
|---|---|---|
| Siparel Başlangıç | 680 | AI odaklı |
| OxyMenu Lite / Start | 749 (+KDV) / 1.499 | Adisyon ağırlıklı |
| **siparisinonunde Esnaf** | **990 (+KDV)** | Resmi API, panel, CRM |
| KolaySiparis Başlangıç | 999 (liste 1.499) | Dikeyler arası |
| Adisyo (yıllık lisans / 12) | 750 / 1.250 / 1.833 (+KDV) | POS |
| QrMenum (yıllık / 12) | 500 / 833 (+AI 833) | QR ağırlıklı |
| **siparisinonunde Pro** | **1.790 (+KDV)** | |
| WhatsApp AI botları | 1.490–5.490 | Çoğu sipariş paneli sunmuyor |
| İletmen TekMenü | Paket başı 5,99 TL: günde 30 sipariş = **5.391/ay** | Hacim arttıkça pahalılaşıyor |
| Yemek Butik | En fazla 10.000/ay | Ciroya bağlı |
| Owner.com (ABD) | 499 $ ≈ 24.350 | Referans; pazar farklı |

**Karşılaştırma [T]:** Pro paket, yerli pazarın orta-üst bandında. Fark "resmi API + operasyon paneli + pazaryeriyle birlikte kullanım araçları" ile anlatılmalı. Pro'nun günde 30 siparişteki sipariş başı eşdeğeri **~2 TL** (1.790 / 900). İletmen'in 5,99 TL'sinin yaklaşık üçte biri.

### 7.4 "Pazaryerine ayda X TL ödüyorsun, bize Y TL" hesaplayıcı mantığı

**Varsayım:** Günde 30 sipariş, ortalama sepet 350 TL, ayda 30 gün. Aylık platform cirosu = 30 × 350 × 30 = **315.000 TL**.

**A) Bugün platforma ödediğin (aylık)**

| Komisyon oranı | Komisyon (KDV hariç) | Komisyon KDV'si (%20) | **Toplam nakit çıkışı** | Yıllık nakit çıkışı |
|---|---|---|---|---|
| %15 (kendi kuryesiyle, iyi sözleşme) | 47.250 TL | 9.450 TL | **56.700 TL** | 680.400 TL |
| %25 (kendi kuryesiyle, tipik) | 78.750 TL | 15.750 TL | **94.500 TL** | 1.134.000 TL |
| %35 (platform kuryesiyle) | 110.250 TL | 22.050 TL | **132.300 TL** | 1.587.600 TL |

> KDV mükellefi işletme komisyon KDV'sini indirebildiği için **gerçek maliyet KDV hariç tutardır.** Nakit akışı etkisi ise KDV dahil tutardır. Hesaplayıcı ikisini de göstermeli. Kampanya, Joker ve reklam kalemleri bu tabloya dahil değil; bunlar eklendiğinde gerçek oran daha yüksek.

**B) Bizim ücretimiz:** Pro 1.790 TL + KDV = **2.148 TL/ay**. Yıllık peşin ödemede 1.432 TL + KDV/ay.

**C) Gerçekçi senaryo: siparişlerin %20'si kendi kanalına taşınıyor**

Platformdaki 30 siparişin 6'sı kendi kanalına geçiyor: ayda 180 sipariş, 63.000 TL ciro.

| | A: Kendi kuryesi, %15 komisyon | B: Kendi kuryesi, %25 komisyon | C: Platform kuryesi, %35 komisyon |
|---|---|---|---|
| Kaçınılan komisyon (KDV hariç) | 9.450 | 15.750 | 22.050 |
| Müşteriye doğrudan sipariş teşviki | −3.150 (%5) | −6.300 (%10) | −6.300 (%10) |
| Online ödeme komisyonu (siparişlerin %50'si kartla, %2,5) | −787,5 | −787,5 | −787,5 |
| siparisinonunde Pro (KDV hariç) | −1.790 | −1.790 | −1.790 |
| Ek kurye maliyeti (180 × 40 TL) [B: paket başı 25–45 TL bandı] | 0 (kurye zaten var) | 0 | −7.200 |
| **Net aylık kazanç** | **+3.722,5 TL** | **+6.872,5 TL** | **+5.972,5 TL** |
| Yıllık | ~44.670 TL | ~82.470 TL | ~71.670 TL |

**D) Başa baş noktası:**
- %25 komisyonda sipariş başına kaçınılan tutar 350 × 0,25 = 87,5 TL. Pro'nun ücretini çıkarmak için **ayda ~21 sipariş**, yani **günde 1'den az** sipariş yeterli.
- Müşteriye %10 teşvik verilirse başa baş **ayda ~35 sipariş**.
- %15 komisyon ve %10 teşvikte başa baş ayda ~103 sipariş. **Sonuç:** Düşük komisyonlu (kendi kuryesiyle çalışan) işletmede teşvik küçük tutulmalı; ücretsiz içecek veya %5 gibi.

**Hesaplayıcı tasarımı (web sitesi için) [T]:**
1. **Girdiler:** günlük sipariş, ortalama sepet, platform komisyon oranı veya panelden kopyalanan aylık kesinti kalemleri, kurye modeli.
2. **Çıktılar:** aylık/yıllık kesinti, %10/%20/%30 kanal geçişinde net kazanç, başa baş sipariş sayısı.
3. **Uyum:** Kaynaklı bantlar ve "sözleşmenize göre değişir" uyarısı eklenir. Bu, Nisan 2026 şeffaflık düzenlemesiyle de uyumlu; işletme kalem kalem kesintiyi kendi panelinden alabiliyor.

---

## 8. Birim ekonomi (işletme başına, aylık, Pro paket, KDV hariç)

> Tüm kalemler **[T] tahmindir**. Kur 48,8 TL/$. Pro işletme için varsayılan hacim: ayda 900 sipariş (günde 30).

| Kalem | Tahmin (TL/ay) | Varsayım ve kaynak |
|---|---|---|
| **Gelir: abonelik** | 1.790 | Liste fiyatı (kurucu üyede 1.253) |
| **Gelir: mesaj kredisi (ortalama)** | ~150 | İşletmelerin bir kısmı kampanya mesajı alır [T] |
| **Toplam gelir (ARPU)** | **~1.940** | |
| Bulut altyapısı (API, veritabanı, websocket, depolama, CDN, izleme) | 60–120 | Çok kiracılı mimari; 500 işletmede toplam ~600–1.000 $/ay [T] |
| WhatsApp servis ve utility (Meta) | 75–155 | Sipariş başına 3–5 mesaj → 2.700–4.500 mesaj; −1.000 ücretsiz; × 0,044 TL. **Tarife 5 katına çıkarsa: 375–770 TL.** Tech Provider modelinde bu kalem 0 (işletme öder). |
| Satılan pazarlama kredisinin Meta maliyeti | ~95 | 150 TL gelirin maliyeti (×1,6 kuralı) |
| BSP platform ücreti | 0–? [D?] | BSP'ye göre değişir; teklif alınmalı |
| SMS (OTP ve yedek kanal) | 20–80 | Ayda ~200 SMS × 0,16–0,43 TL. WhatsApp authentication OTP'si (≈0,044 TL) tercih edilirse daha düşük. Kaynaklar [B]: https://wamessage.app/toplu-sms-fiyatlari ; https://www.mutlucell.com.tr/toplu-sms-tarifeleri ; https://www.netgsm.com.tr/fiyatlar/toplu-sms |
| Harita, geocoding, adres tamamlama | 0–60 | Google Maps'te Mart 2025'ten beri SKU başına aylık ücretsiz kota var (Essentials 10.000, Pro 5.000, Enterprise 1.000). **Kota platform genelinde geçerli, işletme başına değil.** Poligon teslimat bölgesi ve kayıtlı adres kullanımıyla API çağrısı en aza indirilmeli. Aşım fiyatları [D?]. [R] https://developers.google.com/maps/billing-and-pricing/march-2025 |
| Aboneliğin kartla tahsili (%2–3) | 40–60 | Ödeme kuruluşu tek çekim oranları piyasada %0,59–1,95 [B] (poskomisyonlari.com). Taksit ve iade payıyla birlikte. |
| Destek ve onboarding (amortize) | 200–400 | 1 destek/onboarding uzmanı ~60.000 TL/ay (2026 asgari ücretin işverene maliyeti 40.214 TL [R] https://www.csgb.gov.tr/haberler/2026-yilinda-gecerli-olacak-yeni-asgari-ucret-28-bin-75-lira-olarak-belirlendi/), uzman başına 150–300 işletme [T] |
| **Toplam satılan malın maliyeti (COGS)** | **~495–975** | |
| **Brüt kâr / brüt marj** | **~965–1.445 TL → %50–75** | Ölçekle ve self-servis onboarding'le hedef **≥%70** |

İşletmenin online ödeme işlemleri kendi ödeme kuruluşu (iyzico, PayTR vb.) hesabından geçer, bu yüzden bizim maliyetimiz değildir. İleride iyzico **pazaryeri / alt üye işyeri** modeliyle bir platform payı alınabilir [R] https://docs.iyzico.com/urunler/pazaryeri. Ancak bu "komisyonsuz" algısını zedeleyebilir; önerimiz başta ödeme tarafından **pay almamak**.

**CAC (müşteri edinme maliyeti) hedefleri [T]:**

| Kanal | Maliyet varsayımı | İşletme başı CAC |
|---|---|---|
| Saha satış temsilcisi | ~70.000 TL/ay (maaş, prim, yol); ayda 20 kapanış | ~3.500 TL + onboarding emeği 1.000 + basılı materyal 500–1.000 → **~5.000 TL** |
| Bayi (POS teknik servisi, reklam ajansı) | İlk 12 ay aylık ücretin %30'u (Pro'da ~537 TL/ay) veya tek seferlik 2 aylık ücret | ~3.600–6.400 TL (zamana yayılır) |
| Referans programı | Her iki tarafa 1 ay ücretsiz | ~1.790 TL gelir kaybı (nakit değil) |
| İçerik ve organik (Instagram, TikTok, YouTube, SEO) | İçerik üreticisi ve reklam bütçesi | Hedef < 2.000 TL |
| **Karma hedef** | | **≤ 4.000 TL; geri ödeme süresi < 4 ay** |

**Churn (kayıp) ve LTV (yaşam boyu değer) [T]:**
- SMB SaaS için aylık logo churn'ü genelde **%3–5**, fiyatı düşük ürünlerde %3–8 [B] https://www.koji.so/blog/saas-churn-rate-benchmarks-2026.
- Restoran kapanışları churn'ü artırır. TOBB verisine göre 2023'te 2.136 lokanta kapandı; 2024'te kurulan şirket sayısı %10,2 azalırken kapanan şirket sayısı %21,4 arttı [H] https://www.gastronomidergisi.com/haber/iste-acilan-ve-kapanan-restoran-sayisinda-son-durum.
- **Beklenti:** İlk 6–12 ayda **aylık %5–7**; ürün oturunca ve yıllık planlar yaygınlaşınca **< %3**.
- **LTV:** ARPU 1.940 × %65 brüt marj ≈ 1.261 TL/ay.
  - %4 churn → ortalama ömür 25 ay → **LTV ≈ 31.500 TL**.
  - %6 churn → 16,7 ay → **≈ 21.000 TL**.
  - CAC 5.000 TL ile **LTV/CAC ≈ 4–6×**.
- **En güçlü churn önleyici [T]:** Panelde her ay **"Bu ay kendi kanalından X sipariş aldın, pazaryerine kıyasla Y TL tasarruf ettin"** raporu göstermek. Değeri görünür kılar ve yenilemeyi kolaylaştırır.

---

## 9. Go-to-market planı

### 9.1 Başlangıç şehri ve segment
- **İlke:** **Tek şehir, 2–3 ilçe, yoğunluk.** Saha satışı, referans ağı ve vaka videoları aynı mahallede birbirini besler.
- **Şehir seçimi** ekibin bulunduğu yere bağlı (bkz. Açık sorular). Kriterler:
  - (a) yoğun paket servis,
  - (b) kendi kuryesi olan çok sayıda bağımsız esnaf,
  - (c) ulaşılabilir esnaf odası veya dernek,
  - (d) ekibin fiziksel yakınlığı.
- **Pilot hipotezleri:** İstanbul'da Anadolu yakasında bir ilçe kümesi; İzmir (Bornova/Karşıyaka); ya da Anadolu'da güçlü esnaf kültürü olan bir şehir (Eskişehir/Konya/Kayseri, veya oda protokolü emsali olan Edirne). Pazaryeri penetrasyonunun şehirlere göre dağılımı [D?].
- **Segment sırası:**
  1. **Kendi kuryesi olan, paket ağırlıklı bağımsız restoranlar:** dönerci, pide/lahmacun, kebap, çiğ köfte, bağımsız pizza/burger, ev yemekleri. Neden?
     - Lojistikleri hazır, komisyon tasarrufu ilk günden görünür.
     - Tekrar siparişi yüksek kategoriler: 2025'te Yemeksepeti'nin favorileri döner, lahmacun ve simit [R] https://kurumsal.yemeksepeti.com/newsroom/yemeksepeti-2025-siparis-ozetini-acikladi-2025te-turkiyenin-favorileri-doner-lahmacun-ve-simit/
  2. **Su/tüp bayileri:** Tamamen WhatsApp ve telefon alışkanlığıyla çalışıyorlar, tekrar sipariş çok yüksek, pazaryeri kapsaması zayıf. Rakipleri eski masaüstü yazılımlar (SiparişGo, Siparişmatik vb. yeni yeni giriyor).
  3. **Pastane ve tatlıcılar:** Fotoğraflı özel sipariş ve ön sipariş; WhatsApp'ta yoğun.
  4. **Market, şarküteri, çiçekçi:** Faz 2.
  - **İlk aşamada kaçınılacak:** tamamen platform kuryesine bağlı olanlar (lojistik sorunu), zincirler (uzun satış döngüsü).

### 9.2 İlk 10 işletme (ay 0–2): kurucu satışı ve "concierge" kurulum
- Ekibin tanıdığı ve mahalledeki 30–40 işletmeyle **yüz yüze** görüşülür. Hedef: 10 pilot.
- **Teklif:** 3 ay ücretsiz ve "biz kuralım" hizmeti; karşılığında haftalık geri bildirim, vaka çalışması ve video izni.
- **Biz yaparız:**
  - Menü girişi.
  - WhatsApp API ve coexistence kurulumu.
  - **Paket içi QR kartları, buzdolabı magneti ve kasa QR standı** basımı.
  - Google İşletme Profili'ne sipariş linki ve Instagram bio'suna link eklenmesi.
- **Başarı ölçütleri:**
  - İşletme başına ilk 14 günde ≥ 10 kanal siparişi.
  - 60. günde siparişlerin ≥ %10'u kendi kanalından.
  - Panelin günlük aktif kullanımı.
- **Kurucu ritmi:** İlk iki hafta her gün kısa bir ziyaret veya arama; ürün hatalarının aynı gün düzeltilmesi.

### 9.3 İlk 100 işletme (ay 2–6)
1. **Saha satışı (1–2 kişi):** İlçe bazlı yoğun ziyaret. **Hesaplayıcıyla demo:** "Panelindeki son ayın kesintisini göster, net tasarrufunu hesaplayalım."
2. **Referans programı:** Getiren ve gelen işletmeye 1'er ay ücretsiz (Goomer'in "indique e ganhe" modeli). Esnaf esnafı dinler.
3. **Esnaf odası ve dernek protokolleri:** Lokantacılar odası, TÜRES şubeleri, TESK'e bağlı odalar. Edirne'deki oda ve Yemek Butik protokolü bu kanalın çalıştığını gösteriyor. Teklif: üyelere özel indirim ve odaya eğitim semineri.
4. **POS bayileri ve teknik servisler:** Adisyo, SambaPOS ve robotPOS bayileriyle gelir paylaşımı (ilk yıl %30). **GloriaFood'dan geçiş kampanyası** (SambaPOS + GloriaFood kullananlar; son tarih 30.04.2027).
5. **Muhasebeciler:** Esnafın en güvendiği danışman. Tavsiye ücreti ve "müşterine tasarruf raporu" içeriği.
6. **İçerik (Instagram, TikTok, YouTube Shorts):**
   - "Bir dönercinin aylık komisyon faturası" gibi gerçek hesaplar.
   - Önce/sonra vaka videoları.
   - Esnaf röportajları.
   - "Kesinti dökümünü okuma" rehberi (Nisan 2026 düzenlemesiyle çok güncel).
7. **Performans pazarlaması:** Meta **Click-to-WhatsApp** reklamları. Hem bizim satışımız için, hem işletmelerin kendi müşterilerini çekmesi için (CTWA sohbetlerinde 72 saat ücretsiz pencere).
8. **Ortaklıklar:** Pazaryeri panel ajansları (ör. Sipariş Ustası), ambalaj ve paket tedarikçileri (paket içi kart baskısı), yemek kartı şirketleri (kapıda yemek kartı).

**Hedef:** Ayda 20–25 net yeni işletme. **Meta Tech Provider varsayılan limiti haftada 10 yeni işletme.** 100 işletmeye ~10–12 haftada ulaşılabilir; ölçeklenmeden önce işletme doğrulaması ve limit artışı alınmalı [B/D?].

### 9.4 100'den 1.000'e (ay 6–18)
- İkinci şehir. Bayi ağının resmileşmesi (sertifikalı kurulum ortağı programı).
- Self-servis onboarding: menü fotoğrafından yapay zekâyla menü çıkarımı, Embedded Signup v4.
- Ücretsiz "Menü" katmanının açılması.
- Dikey genişleme: su/tüp paketi.
- Zincir segmenti: POS entegrasyonları ve API.

### 9.5 Mesaj ve konumlandırma
- **Ana mesaj:** *"Pazaryeri yeni müşteri getirsin; sadık müşterin senin olsun. Komisyonsuz, WhatsApp'tan."*
- **Kaçınılacak mesaj:** "Yemeksepeti'ni bırak." İşletmeler keşif için pazaryerine ihtiyaç duyuyor ve bu mesaj güven kaybettirir.
- **Kanıt noktaları:** hesaplayıcı, vaka videoları, "ayda 21 siparişle kendini amorti eder" hesabı, resmi WhatsApp API (ban riski yok).

---

## 10. Personalar

### 10.1 İşletme sahibi, "Esnaf Mehmet Usta" (40–55 yaş, dönerci veya pideci, 1 şube, 3–8 çalışan)
- **Profil:** Günde 20–60 paket, yarısından fazlası pazaryerinden. 1–2 kendi kuryesi var. Telefonu WhatsApp Business'la dolu. Teknolojiye mesafeli ama ekranda "para" görünce ikna oluyor.
- **Hedefler:** Komisyonu düşürmek, fiyatını pazaryerine göre ayarlamak zorunda kalmamak, müşterisini tanımak, günü aksatmadan akşam kasayı kapatmak.
- **Acı noktaları:**
  - Aylık kesinti dökümünü anlamakta zorlanmak (Joker, reklam ve KDV kalemleri).
  - Algoritmada görünmez olma korkusu.
  - Telefon ve WhatsApp siparişlerinin kâğıda yazılması: adres hatası, unutulan sipariş.
  - "Bir sistem daha" yorgunluğu.
- **İhtiyaçlar:**
  - 1 günde kurulum (bizim yapmamız).
  - Numarasını ve WhatsApp uygulamasını kaybetmemek (coexistence).
  - Sesli uyarı.
  - Tek tuşla onay.
  - Aylık "ne kadar tasarruf ettim" raporu.
  - Sabit ve öngörülebilir ücret.
- **Satın alma kriteri:** Tanıdık tavsiyesi, somut TL hesabı, "istersem bırakırım" rahatlığı (taahhütsüz aylık plan).

### 10.2 Kasiyer, operatör ve garson, "Operatör Elif" (20–30 yaş)
- **Profil:** Yoğun saatte hem kasaya hem telefona hem pazaryeri tabletlerine bakıyor.
- **Acı noktaları:** 3–4 ayrı tablet ve bip sesi, siparişi elle yazma, adres ve ödeme karışıklığı, "sipariş nerede?" diye arayan müşteri.
- **İhtiyaçlar:**
  - Tek ekranda sipariş kuyruğu: yeni / hazırlanıyor / yolda / teslim.
  - Büyük butonlar, klavyesiz akış.
  - Hazır yanıtlar ("20 dk", "adres teyidi").
  - Otomatik mutfak ve kasa fişi yazdırma.
  - Müşteri geçmişinin görünmesi ("her zaman acısız").
- **Başarı ölçütü:** Yoğun saatte hatasız ve hızlı onay; müşteri aramalarının azalması.

### 10.3 Kurye, "Kurye Burak" (işletmenin kendi kuryesi veya esnaf kurye)
- **Acı noktaları:** Yanlış veya eksik adres, kapıda ödeme ve para üstü karmaşası, müşteriye ulaşamamak, rota.
- **İhtiyaçlar:**
  - Mobil web veya uygulamada atanmış siparişler.
  - Tek tuşla navigasyon (Google/Yandex/Apple Maps).
  - Müşteriyi arama ve WhatsApp'tan yazma (maskelenmiş olabilir).
  - "Yola çıktım" ve "teslim ettim" butonları (müşteriye otomatik bildirim).
  - Kapıda ödeme tipi (nakit, kart, yemek kartı) bilgisi.
  - Gün sonu tahsilat özeti.

### 10.4 Son müşteri, "Müşteri Ayşe" (25–45 yaş, mahallenin düzenli müşterisi)
- **Profil:** Pazaryerini keşif için kullanıyor. Sevdiği dönerciyi zaten biliyor.
- **Acı noktaları:**
  - Pazaryerinde fiyatların yüksek olması (komisyon fiyata yansıyor).
  - İşletmeyi arayınca meşgul hattı.
  - Menü ve fiyatın telefonda belirsiz kalması.
  - Uygulama indirme ve üyelik zorunluluğu.
- **İhtiyaçlar:**
  - WhatsApp'tan tek mesajla veya QR'dan **uygulama indirmeden** sipariş.
  - Fotoğraflı ve fiyatlı menü.
  - "Geçen seferkinin aynısı."
  - Durum bildirimi ve takip linki.
  - Kapıda kart veya yemek kartı seçeneği.
  - Doğrudan siparişe özel avantaj (indirim, puan).
- **Dikkat:** Kampanya mesajları ancak **açık rıza ve İYS kaydıyla** gönderilebilir. Sipariş bildirimleri işlemseldir ve onaya tabi değildir.

### 10.5 Platform admini, "Admin Can" (bizim ekip: operasyon, destek, finans)
- **İhtiyaçlar:**
  - İşletme (tenant) yönetimi: açma, askıya alma, paket değişikliği.
  - WhatsApp numara ve WABA durumu: kalite puanı, limitler, şablon onayları.
  - Mesaj maliyeti izleme (işletme başına Meta maliyeti ve kredi bakiyesi).
  - Abonelik ve fatura (e-Arşiv/e-Fatura).
  - Destek talepleri ve işletmenin paneline güvenli erişim (impersonation, loglu).
  - Onboarding hunisi (deneme → aktivasyon → ödeme).
  - Churn uyarıları: sipariş hacmi düşen işletmeler.
  - Bayi ve referans komisyon takibi.
  - Denetim kayıtları (audit log), KVKK talepleri.
- **Acı noktaları:** Meta politika ve fiyat değişiklikleri, işletme başına maliyetin görünmemesi, manuel onboarding yükü.

### 10.6 (Ek) Bayi / kurulum ortağı, "Bayi Serkan"
- **İhtiyaçlar:** Kendi müşteri listesini görebileceği bayi paneli, komisyon raporu, demo hesabı, eğitim materyali, kurulum kontrol listesi.

---

## 11. Rekabet avantajı, savunulabilirlik ve pazaryerleriyle birlikte kullanım

### 11.1 Moat önerileri
1. **Müşteri veritabanı ve geçiş maliyeti:** Sipariş geçmişi, adresler, sadakat puanları ve "aynısından tekrar" verisi işletmenin bizdeki birikimi olur. Verinin dışa aktarılabilir olması güven verir, ama birikim ve alışkanlık yine de geçiş maliyeti yaratır.
2. **Dağıtım ağı:** Esnaf odası protokolleri, POS bayileri, muhasebeci ağı, referans döngüsü. Kopyalanması yazılımdan çok daha zor.
3. **Entegrasyon derinliği:** POS'lar (Adisyo, SambaPOS, robotPOS), yazıcılar, yemek kartı kapıda tahsilat, ödeme kuruluşları, ileride kurye ağları. Slerp'in Uber Direct ve Stuart ile yaptığı kurye çağırma modelinin Türkiye karşılığı [D?].
4. **Resmi WhatsApp altyapısında operasyonel mükemmellik:** Coexistence, şablon kütüphanesi, kalite puanı yönetimi, mesaj maliyeti optimizasyonu. Resmi olmayan bot rakiplerine karşı "numaran banlanmaz" güvencesi.
5. **Dikey derinlik:** Restoran + su/tüp + pastane için özelleşmiş akışlar: abonelik siparişi, damacana depozitosu, özel pasta formu.
6. **Veri ürünleri:** Tekrar sipariş tahmini ("Ayşe Hanım 10 gündür sipariş vermedi"), en iyi kampanya zamanı, menü mühendisliği. Anonim ve toplu kıyas: "ilçendeki dönercilerin ortalama sepeti".
7. **Marka ve güven:** Esnafın yanında duran marka hikâyesi ("Siparişin Önünde"), şeffaf fiyat, taahhütsüzlük.
8. **Bilinçli olarak pazaryeri olmamak:** Tüketiciye yönelik ortak bir uygulama kurmamak. Rekabeti, fiyat baskısını ve soğuk başlangıç sorununu önler. İleride en fazla "keşfet" dizini olabilir.

### 11.2 Pazaryerleriyle birlikte kullanım: müşteriyi kendi kanalına taşıma taktikleri
**Strateji: "Keşif pazaryerinde, sadakat kendi kanalında."**

| Taktik | Nasıl | Not |
|---|---|---|
| **Paket içi kart veya QR** | Her pakete "WhatsApp'tan doğrudan sipariş ver, X kazan" kartı. QR, hazır metinli `wa.me/90XXXXXXXXXX?text=Merhaba...` linkine gider; sohbet açılınca müşteri penceresi başlar ve bot menü linkini yollar. | Pazaryeri sözleşmesinde "müşteri yönlendirme" veya "materyal koyma" kısıtı olup olmadığı **kontrol edilmeli [D?]**. |
| **Buzdolabı magneti** | Mahalle esnafının klasik yöntemi. QR ve numara magnet üzerinde. | Düşük maliyet, uzun ömür |
| **Doğrudan kanala özel avantaj** | Ücretsiz ayran/içecek, %5–10 indirim, "her 10. siparişe 1 bedava" dijital damga kartı | Teşvik komisyon oranına göre ayarlanmalı (bkz. 7.4 D) |
| **Farklı fiyatlandırma** | Kendi kanalında pazaryerinden daha düşük liste fiyatı | 2016 Rekabet kararı MFN ve paritesini sorunlu buldu; **güncel sözleşme maddesi kontrol edilmeli [D?]** |
| **"Aynısından tekrar"** | Önceki siparişi tek dokunuşla tekrarlama. Kullanıcı arayüzünde en belirgin buton. | Owner.com: uygulama kullanan müşteri 2 kat daha sık tekrar sipariş veriyor [B] |
| **Telefonla arayanı kanala çekme** | Arayan müşteriye "sipariş linkiniz" WhatsApp mesajı. İleride Calling API ve IVR. | İşlemsel mesaj |
| **Google İşletme Profili, Instagram bio ve hikâye linki** | "Sipariş ver" linki bizim sayfamıza | Kurulumda biz yaparız |
| **Click-to-WhatsApp reklamları** | İşletme adına mahalle hedefli reklam | 72 saat ücretsiz pencere |
| **Adisyondaki müşterilerin içeri aktarılması** | Mevcut müşteri numaralarının rızayla aktarılması | KVKK: işletme veri sorumlusu, biz veri işleyen; pazarlama için İYS onayı gerekli |
| **Kanal karması raporu** | Panelde "pazaryeri ve kendi kanal" payı ile tasarruf grafiği | Churn'ü azaltır, esnafı motive eder |

**Uyarı [T]:** Pazaryeri siparişlerinden elde edilen müşteri telefon numaraları (genelde maskeli) izinsiz pazarlama için **kullanılamaz**. Taşıma yalnızca **paket içi materyal**, **müşterinin kendi başlattığı WhatsApp sohbeti** ve **açık rıza** üzerinden yapılmalı.

---

## 12. Riskler (özet)

| Risk | Olasılık / etki | Azaltma |
|---|---|---|
| Meta fiyat ve politika değişikliği (Ekim 2026 servis ücreti, ileride yeni değişiklikler) | Orta / yüksek | Mesaj tasarımında durum takibi web sayfasına taşınır; kredi modeli; fiyat endeksleme maddesi |
| Meta Business Agent'ın basit bot ihtiyacını metalaştırması | Yüksek / orta | Değer önerisini "operasyon ve CRM" üzerine kurmak; bot bir özellik olarak kalır |
| Pazaryerlerinin misillemesi (sözleşme kısıtları, sıralama cezası) veya kendi doğrudan sipariş aracını çıkarması veya satın alması (iFood → Anota emsali) | Orta / yüksek | "Birlikte kullanım" mesajı; hukuki kontrol listesi; olası exit fırsatı olarak değerlendirme |
| Kalabalık, parçalı yerli rakip pazarı → fiyat baskısı | Yüksek / orta | Dağıtım ağı, kurulum hizmeti, entegrasyonlar |
| Tech Provider onboarding limiti (haftada 10 işletme) ve işletme doğrulaması | Yüksek (ilk aylar) / orta | Erken başvuru, BSP ortaklığı, doğrulama süreci |
| TL enflasyonu ve dolar bazlı maliyet | Yüksek / orta | Çeyreklik kredi fiyatı; yıllık planlara endeks; Türkiye'de barındırma seçeneği |
| Restoran kapanışları kaynaklı churn | Yüksek / orta | Yıllık plan teşviki; dikey çeşitlendirme (su/tüp daha istikrarlı) |
| KVKK ve İYS uyumsuzluğu (kampanya mesajları) | Orta / yüksek | Rıza akışı, İYS entegrasyonu, ret yolu |

---

## 13. NET TAVSİYELER (projeye özel)

1. **Konumlandırma:** Pazaryeri değil; **"işletmenin kendi WhatsApp sipariş kanalı ve operasyon paneli"**. Mesaj: *"Keşif pazaryerinde, sadakat sende. Komisyonsuz."*
2. **Teknik temel resmi WhatsApp Cloud API olmalı. Coexistence ilk günden desteklenmeli** (esnaf numarasını ve uygulamasını kaybetmemeli). Resmi olmayan (WhatsApp Web/QR) bağlantı **kesinlikle kullanılmamalı**; bu, rakiplere karşı bir satış argümanıdır.
3. **Sipariş akışı "sohbet + web sepeti" olmalı:** Bot selamlar ve menü linkini yollar; sepet web'de yapılandırılmış veri olarak oluşur; panele sesli uyarıyla düşer; müşteriye 2–3 bildirim gider. `wa.me` ile "sepeti metin olarak yollama" modelinden **kaçınılmalı**.
4. **Mesaj ekonomisi baştan tasarlanmalı:** Sipariş başına ≤ 3 işletme mesajı, takip sayfası, OTP'de WhatsApp authentication (SMS yedek), numara başına aylık 1.000 ücretsiz servis mesajının izlenmesi, pazarlama mesajlarının kredi olarak satılması.
5. **Fiyat:** Esnaf 990 / Pro 1.790 / Zincir 2.990 TL/şube (KDV hariç), 14 gün kartsız deneme, yıllıkta %20 indirim, ilk 100 işletmeye %30 kurucu üye indirimi (12 ay sabit), "biz kuralım" hizmeti ilk 100'e ücretsiz. Sipariş veya ciro yüzdesi **alınmaz**.
6. **Web sitesindeki komisyon hesaplayıcısı birincil satış aracı olmalı.** Hesaplayıcı Nisan 2026 şeffaflık düzenlemesiyle görünür hale gelen kalem kalem kesintileri girdi olarak almalı ve başa baş sipariş sayısını göstermeli.
7. **İlk segment:** kendi kuryesi olan, paket servis ağırlıklı bağımsız restoranlar. **İkinci segment:** su/tüp bayileri. Tek şehirde 2–3 ilçeye yoğunlaşılmalı.
8. **Dağıtım:** Kurucu satışıyla ilk 10, ardından saha satışı, referans programı, esnaf odası protokolleri ve POS bayileriyle ilk 100. Muhasebeci ve içerik kanalları paralel yürütülmeli.
9. **Entegrasyonlar:** MVP'de yazıcı ve sesli uyarı. Hemen ardından **SambaPOS/Adisyo entegrasyonu** ve **GloriaFood geçiş kampanyası** (son tarih 30.04.2027).
10. **Meta süreçleri kritik yolda:** İşletme doğrulaması, Tech Provider veya BSP seçimi, onboarding limitinin artırılması ve Embedded Signup v4 (v2 8 Ekim 2026'da kalkıyor) **hemen** başlatılmalı.
11. **Churn'ü değer raporuyla yönet:** Aylık "kendi kanalından X sipariş, Y TL tasarruf" raporu ve sipariş hacmi düşen işletmeler için admin uyarısı.
12. **Hukuki kontrol listesi:** Pazaryeri sözleşmelerindeki yönlendirme ve parite maddeleri, KVKK rolleri (veri sorumlusu / veri işleyen), İYS entegrasyonu, abonelik e-faturası. Ayrı bir hukuk araştırmasıyla derinleştirilmeli.
13. **Takip edilecek gelişmeler:**
    - Uber–Getir gerekçeli kararı ve taahhütlerin içeriği.
    - Yemeksepeti–SSW kapanışı ve yeni sahiplik altındaki komisyon politikası.
    - TÜRES'in "kendi sipariş sistemi" girişimi (rakip mi, partner mi?).
    - Meta'nın Ekim 2026 sonrası tarife güncellemeleri.

---

## 14. AÇIK SORULAR

1. **Ekip nerede konumlu, pilot şehir hangisi olmalı?** Saha satışı yakınlık gerektiriyor.
2. **Meta ilişki modeli:** Tech Provider (işletme Meta'ya kendi kartıyla öder, bizim nakit riskimiz yok) mu, BSP kredi hattı veya Solution Partner (biz öder, fatura ederiz; esnaf için sürtünme yok) mu? Hangi BSP (ör. 360dialog, Twilio, yerli iş ortakları) ve ek ücretleri ne?
3. **Mesaj maliyeti pakete dahil mi olacak?** Servis ve utility mesajları "adil kullanım" ile dahil, pazarlama ayrı kredi öneriliyor. Onay gerekiyor.
4. **Ödeme:** İşletmenin kendi ödeme kuruluşu hesabı mı (önerilen), yoksa ileride iyzico pazaryeri modeliyle platform payı mı?
5. **Ücretsiz katman** ürün oturduktan sonra mı açılsın, yoksa lansmanda müşteri kazanma aracı olarak mı?
6. **Zincir ve franchise segmenti** ilk 12 ayda hedeflenecek mi, yoksa bilinçli olarak ertelenecek mi?
7. **Kurye:** İleride esnaf kurye veya kurye firmalarıyla (Uber Direct benzeri) "tek tuşla kurye çağır" entegrasyonu stratejik bir hedef mi?
8. **Yemek kartı ile kapıda tahsilat** (Pluxee, Multinet, Edenred, Setcard vb.) MVP kapsamında mı?
9. **Veri barındırma:** KVKK ve yurt dışı aktarım açısından Türkiye'de mi barındırılacak? Maliyet etkisi ne?
10. **Pazaryeri sözleşmeleri:** Pilot işletmelerin güncel Yemeksepeti / Uber Eats TGO / Migros sözleşmelerinde paket içi materyal ve fiyat paritesi kısıtı var mı? Pilot öncesi avukat incelemesi gerekli.
11. **Doğrulanamayan veriler (tekrar teyit gerekli):**
    - Platform bazlı güncel komisyon oranları (resmi tarife yok).
    - Pazar payları.
    - Türkiye utility tarifesinin kesin değeri ve pencere içi utility şablonlarının Ekim 2026 sonrasındaki durumu.
    - Rakiplerin kullandığı WhatsApp altyapısı.
    - Posrestoran verisi.
    - Meta Business Agent'ın Türkiye'de Türkçe olarak kullanılabilir olup olmadığı.
12. **Marka:** "Siparişin Önünde" adı ve alan adları müsait mi, marka tescili yapılacak mı?

---

## 15. Kaynakça (kategoriye göre)

**Pazar ve regülasyon**
- Ticaret Bakanlığı E-Ticaretin Görünümü 2025: https://etbis.ticaret.gov.tr/tr/Post/postturkiyede-e-ticaretin-gorunumu-2025-raporu-yayimlandi-3 ; https://ticaret.gov.tr/duyurular/turkiyede-e-ticaretin-gorunumu-raporu-yayinlandi-06-05-2025
- Yemek sipariş düzenlemesi: https://ticaret.gov.tr/haberler/elektronik-ticarette-yemek-siparis-hizmetlerine-yonelik-yeni-duzenleme ; https://www.lexology.com/library/detail.aspx?g=2f758278-12b1-45ec-be5d-31c9969fe954 ; https://www.alomaliye.com/2026/04/13/yemek-siparis-platformlarina-yeni-duzenleme-komisyon-ve-hizmet-bedelleri/
- TEPAV: https://files.tepav.org.tr/upload/files/1787904391748-0.Cafe_latte_ekonomisiBir_fincanda_iki_Turkiye.pdf
- TÜİK 2025 BT kullanımı (haber): https://www.birgun.net/haber/whatsapp-zirvede-tuik-internet-kullanim-verilerini-acikladi-727545 ; https://medyascope.tv/2025/08/27/turkiyede-internet-kullanimi-yuzde-909a-ulasti/
- Rekabet Kurumu: https://www.rekabet.gov.tr/Karar?kararId=b01af595-d4f2-4fe3-b587-a6f9ebe8f279 ; https://www.rekabet.gov.tr/Karar?kararId=e7152b1a-f634-4293-9f0d-6ddf0013edb9 ; https://www.rekabet.gov.tr/tr/Guncel/uber-technologies-inc-tarafindan-getir-a-b7a6d2dc226bf11193eb0050568549fa ; https://www.aa.com.tr/tr/ekonomi/yemek-sepetine-rekabet-sorusturmasi-acildi/3171362

**Konsolidasyon**
- https://techcrunch.com/2025/05/06/uber-eats-comes-to-turkey-via-700m-trendyol-go-acquisition/ ; https://www.sec.gov/Archives/edgar/data/1543151/000154315125000023/uber-20250630.htm ; https://webrazzi.com/2026/06/19/rekabet-kurulu-uberin-getirin-yemek-ve-market-teslimati-islerini-devralmasina-onay-verdi/ ; https://www.turkiyetoday.com/business/turkiyes-yemeksepeti-sold-to-ssw-partners-as-uber-acquires-delivery-hero-3224009 ; https://www.dogrulukpayi.com/dogruluk-kontrolu/getiryemek-trendyol-ve-yemeksepeti-uber-catisi-altinda-tek-elde-mi-toplandi ; https://webrazzi.com/2026/05/13/yemeksepeti-nin-25-yilinda-one-cikan-verileri/

**Komisyon, şikâyet ve sektör**
- https://www.siparisustasi.com/blog/komisyon-oranlari-2026 ; https://kafe360.com/blog/yemeksepeti-mi-getir-yemek-mi-komisyon-karsilastirma ; https://pakettakip.net/migros-yemek-komisyon-oranlari-ve-karlilik-rehberi-2025/ ; https://www.sikayetvar.com/yemeksepeti/komisyon ; https://www.dunya.com/ekonomi/restoranlardan-yuzde-20-indirim-karari-online-platformlari-boykota-hazirlaniyorlar-haberi-805101 ; https://www.gazetepencere.com/ekonomi/restoranlardan-online-platformlara-boykot-uyarisi-komisyon-yuzde-40i-buluyor-681695h ; https://www.turkiyegazetesi.com.tr/ekonomi/esnaf-komisyonlar-yuksek-ama-mecburuz-diyor-online-platformlar-isletme-karina-ortak-1816030

**Yerli rakipler**
- https://sepettakip.com/siparis-uygulamalari/whatsapp-siparis-cozumu ; https://siparel.com/ ; https://www.kolaysiparis.co/ ; https://partner.komisyonsuz.com/siparis-sistemi-fiyatlari.html ; https://www.kendisepeti.com/komisyonsuz-siparis ; https://www.qrmenum.app/fiyatlandirma ; https://www.restajet.com/tr/fiyatlar ; https://www.restoranodul.com/ucretler/ ; https://yemekbutik.com/ ; https://www.iletmen.com.tr/ ; https://oxymenu.com/restoran-siparis-programi ; https://siparisgo.net/ ; https://siparismatik.com/ ; https://www.wabo.tr/ ; https://www.chatbotwhatsapp.com.tr/whatsapp-siparis-botu-fiyatlari-2026/ ; https://www.monu.com.tr/blog/qr-menu-fiyatlari

**POS**
- https://adisyo.com/adisyon-programi-pos-sistemi-fiyatlari ; https://novempos.com/en-iyi-adisyon-programlari/ ; https://www.dinamikpos.com/marka/sambapos ; https://www.menulux.com/restoran-yazilimi/web-sitesi/online-siparis-sistemi ; https://simprasuite.com/ ; https://www.robotpos.com/pazaryeri-entegrasyonlari

**Global**
- https://abrasel.com.br/noticias/noticias/ifood-compra-a-anota-ai-para-oferecer-atendimento-pelo-whatsapp/ ; https://abrasel.com.br/noticias/noticias/whatsapp-representa-26-do-faturamento-delivery-bares-restaurantes/ ; https://brendi.com.br/ ; https://goomer.com.br/planos ; https://saipos.com/planos-e-precos ; https://pricing.olaclick.com/ ; https://www.take.app/pricing ; https://www.zbooni.com/pricing/all-in-one/ ; https://sacra.com/c/owner/ ; https://research.contrary.com/company/owner ; https://newsletter.outbound.kitchen/p/how-ownercom-scaled-outbound-to-30m ; https://www.labrador.ai/blog/chownow-pricing-explained ; https://www.slerp.com/ ; https://www.deliverect.com/en/pricing ; https://menuro.io/blog/gloriafood-shutting-down-2027/

**WhatsApp ve maliyetler**
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing ; https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages ; https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/ ; https://whautomate.com/whatsapp-business-api-pricing ; https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/ ; https://techcrunch.com/2026/06/03/metas-ai-agent-for-whatsapp-business-is-now-available-globally/ ; https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers ; https://iys.org.tr/iys/sss
- https://developers.google.com/maps/billing-and-pricing/march-2025 ; https://www.netgsm.com.tr/fiyatlar/toplu-sms ; https://docs.iyzico.com/urunler/pazaryeri ; https://www.csgb.gov.tr/haberler/2026-yilinda-gecerli-olacak-yeni-asgari-ucret-28-bin-75-lira-olarak-belirlendi/ ; https://www.koji.so/blog/saas-churn-rate-benchmarks-2026
