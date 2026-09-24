# 03 — Türkiye Mevzuatı, Ödeme ve Faturalama Araştırması

**Proje:** siparisinonunde (Siparişin Önünde), WhatsApp üzerinden komisyonsuz sipariş alma SaaS'ı
**Rapor tarihi:** 24 Eylül 2026
**Kapsam:** KVKK (roller, DPA, VERBİS, aydınlatma, açık rıza, saklama, ihlal, yurt dışına aktarım), 6563 sayılı Kanun ve İYS, e-ticaret mevzuatı (ETAHS/ETHS, ETBİS, mesafeli satış, fiyat gösterimi), 6493 sayılı Kanun ve online ödeme, SaaS abonelik tahsilatı ve e-Fatura, şirket kurulumu, marka ve sözleşmeler, vergi.
**Uyarı:** Bu metin hukuki veya mali müşavirlik tavsiyesi değildir. Ürün planlaması için hazırlandı. Canlıya çıkmadan önce KVKK ve e-ticaret alanında çalışan bir avukat ile bir mali müşavir tarafından teyit edilmelidir.

---

## 0. Yöntem, güven etiketleri ve önemli sınırlama (önce bunu okuyun)

**Bu oturumda canlı web doğrulaması yapılamadı:**

- **WebSearch:** Oturumun 200 aramalık kotası, bu rapora başlanmadan önce 01 ve 02 numaralı raporlar tarafından tüketilmişti. Bu rapor için tek bir arama bile yapılamadı.
- **WebFetch:** Denenen tüm alan adları ağ egress proxy'si tarafından engellendi: `kvkk.gov.tr`, `mevzuat.gov.tr`, `resmigazete.gov.tr`, `iys.org.tr`, `iyzico.com`, `docs.iyzico.com`, `developers.facebook.com`, `tr.wikipedia.org`.
- **Sonuç:** Bu rapordaki **hiçbir iddia bu oturumda birincil kaynaktan canlı olarak okunmadı.** Rapor iki kaynağa dayanıyor:
  1. Modelin eğitim verisindeki mevzuat bilgisi (bilgi kesimi 2026 ortası).
  2. Aynı klasördeki kardeş raporlar: `01-whatsapp-platform.md` [K01] ve `02-pazar-rakipler-is-modeli.md` [K02]. Bu raporlar arama motoru özetleri üzerinden kaynak bulmuştu.
- Bu nedenle **uydurma rakam riskine karşı birçok sayı bilinçli olarak verilmedi.** Güncel komisyon oranları, entegratör fiyatları ve 2026 idari para cezası tutarları bu kapsamda. Verilen her rakam etiketlendi.
- Bölüm 14'te, her iddianın teyit edileceği birincil kaynak adresleri listelendi. Bu URL'ler **bu oturumda açılamadı**. Kanun URL'leri mevzuat.gov.tr'nin standart kalıbıyla, Resmî Gazete URL'leri arşiv kalıbıyla yazıldı.

**Güven etiketleri:**

| Etiket | Anlamı |
|---|---|
| **[Y]** | Yüksek güven. Uzun süredir yürürlükteki, köklü bir düzenleme (kanun maddesi, iyi bilinen Kurul kararı). Madde metni yine de teyit edilmeli. |
| **[O]** | Orta güven. Ayrıntı (madde no, tarih, eşik, ürün özelliği) hatırlanıyor ama değişmiş veya yanlış hatırlanmış olabilir. |
| **[D?]** | DOĞRULANAMADI / tahmin. Karar vermeden önce mutlaka teyit edilmeli. |
| **[T]** | Bizim çıkarımımız, yorumumuz veya ürün önerimiz. |
| **[K01] / [K02]** | Kardeş rapordan alınan bulgu. Kaynak URL'si o raporda. |

---

## 1. Yönetici özeti (TL;DR)

1. **Roller net olmalı.** Son müşterinin (sipariş veren kişinin) verileri için **işletme veri sorumlusu (VS), biz veri işleyeniz (Vİ).** İşletme sahibi ve yetkilileri, abonelik, fatura ve site ziyaretçisi verileri için **biz veri sorumlusuyuz** [Y/T]. Bazı özellikler bu ayrımı bozar ve bizi son müşteri verisi için de veri sorumlusu yapar: platform genelinde tek müşteri profili, işletmeler arası pazarlama, tüketiciye dönük keşif uygulaması [T].
2. **VERBİS'e başlangıçta büyük olasılıkla kayıt yükümlülüğümüz yok.** Muafiyet için çalışan sayısı 50'nin altında, mali bilanço eşiğin altında ve ana faaliyet özel nitelikli veri işleme olmamalı. Temel karar 2018/87 [Y]. Bilanço eşiği sonradan yükseltilmiş olabilir [D?]. Muafiyet diğer KVKK yükümlülüklerini kaldırmaz.
3. **En büyük hukuki gri alan yurt dışına aktarım.** 2024 değişikliğinden sonra m.9'a göre düzenli aktarımlar için yeterlilik kararı ya da uygun güvence (pratikte **Kurul'un standart sözleşmesi + imzadan sonra 5 iş günü içinde Kurum'a bildirim**) gerekiyor [Y/O]. "Arızi aktarım" istisnaları (açık rıza dahil) süreklilik arz eden WhatsApp kullanımına dayanak olamaz [O/T]. **Meta'nın Türk standart sözleşmesini imzalayıp imzalamadığı doğrulanamadı** [D?]. Önerimiz: kendi veritabanımız Türkiye'de olsun, yurt dışı alt işleyen sayısı en aza insin, WhatsApp mesajlarında veri minimizasyonu uygulansın ve yazılı avukat görüşü alınsın.
4. **İYS kuralı:** Sipariş durum mesajları (alındı, yola çıktı, teslim edildi) **bilgilendirme** iletisidir ve onay/İYS gerektirmez. Ancak içine tek satır indirim kodu eklenirse **ticari elektronik ileti** olur [O/T]. Kampanya ve duyuru mesajları için üç şart var: işletmenin İYS kaydı, alıcının önceden onayı ve her mesajda ücretsiz ret yolu [K02]. WhatsApp mesajları SMS gibi operatörün İYS filtresinden geçmez, bu yüzden **İYS kontrolü bizim yazılımımızda yapılmalı** [T]. Öneri: **kampanya modülü MVP'de olmasın.**
5. **Sipariş kanalı olarak (ETAHS riski düşük):** Mevcut kurguda her işletmenin kendi markalı vitrini var, satış sözleşmesi işletmeyle kuruluyor ve tahsilatı biz yapmıyoruz. Bu kurguda "yazılım/altyapı sağlayıcı" savunması güçlü, işletme ise ETHS'dir [T]. Şu özellikler eklenirse **pazaryeri (ETAHS) sayılma riski yükselir:** ortak keşif sayfası, ortak sepet/hesap, ödeme aracılığı, ücretli öne çıkarma. Bu durumda Nisan 2026 yemek sipariş şeffaflık kuralları da devreye girer [K02].
6. **Mesafeli satış:** Yemek siparişinde **cayma hakkı yok.** Yönetmelik çabuk bozulan mallar ile yiyecek-içecek tedarikini istisna sayıyor [O]. Buna rağmen **ön bilgilendirme ve "ödeme yükümlülüğü doğuran" onay adımı** gerekli [O]. WhatsApp'tan gelen siparişte bu adım, özet mesajı + onay butonu + link ile çözülür [T].
7. **Ödeme:** 6493 sayılı Kanun'a göre işletmeler adına para toplayamayız. Bu lisans gerektirir, lisanssız yapmak suçtur [O]. MVP'de ödeme kapıda alınır (işletmenin kendi POS'u ve yemek kartı cihazları). Faz 2'de **işletme kendi PayTR/iyzico hesabını bağlar.** Pazaryeri / alt üye işyeri modeli yalnızca platform payı almak istersek gündeme gelir ve "komisyonsuz" konumlandırmayla çelişir [T/K02].
8. **Ürün kısıtları:** Gıda ve yemek harcamalarında kredi kartıyla **taksit yapılamaz** [O]. **Alkol ve tütün internetten satılamaz** [O]. Storefront'ta bunlar teknik olarak engellenmeli.
9. **Kendi abonelik tahsilatımız:** Faturalama motoru bizde olsun, PSP'nin kart saklama/abonelik API'si kullanılsın, yıllık planda havale/EFT seçeneği sunulsun. Fatura için MVP'de **Paraşüt API** (e-Fatura/e-Arşiv), ölçek büyüyünce doğrudan özel entegratör (Nilvera, QNB eSolutions, Uyumsoft vb.) önerilir [O/T]. Fiyatlar doğrulanamadı.
10. **Vergi:**
    - SaaS hizmeti **%20 KDV**'ye tabi [Y].
    - Basit usul esnaf KDV indiremez, bu yüzden fiyatlar KDV dahil de gösterilmeli [K02].
    - Yurt dışı hizmetlerde (AWS, Meta, LLM API'leri, SaaS araçları) **sorumlu sıfatıyla KDV (2 No'lu beyanname)** ödenir. Bu yaklaşık bir aylık nakit akışı etkisi yaratır [O].
    - Yurt dışı **yazılım lisansı** ödemelerinde stopaj riski var [O/D?].
    - **Teknokent**'te kurumlar vergisi ve koşullu KDV istisnası ciddi bir fiyat avantajı olabilir [O].
11. **Şirket türü:** Yatırım alma ihtimali varsa **AŞ**, bootstrap ise **Ltd** önerilir. Asgari sermaye 1 Ocak 2024'ten beri AŞ'de 250.000 TL, Ltd'de 50.000 TL [O].
12. **MVP öncesi zorunlu belge seti** (ayrıntı §7.5):
    - İşletme abonelik sözleşmesi ve kullanım koşulları
    - DPA (veri işleme sözleşmesi) ve alt işleyen listesi
    - Bizim aydınlatma metnimiz ve gizlilik politikası
    - Çerez politikası ve rıza paneli
    - İşletme adına son müşteri aydınlatma metni şablonu
    - Ön bilgilendirme formu ve mesafeli satış sözleşmesi şablonu
    - Site künyesi
    - Veri ihlali müdahale planı
    - Saklama-imha politikası

---

## 2. KVKK (6698 sayılı Kanun)

Temel kaynaklar:
- 6698 sayılı Kişisel Verilerin Korunması Kanunu (RG 07.04.2016, sayı 29677) [Y]
- 7499 sayılı Kanun ile yapılan 2024 değişikliği (RG 12.03.2024, sayı 32487; KVKK hükümleri 01.06.2024'te yürürlüğe girdi) [O]

### 2.1 Roller: kim veri sorumlusu, kim veri işleyen?

| Veri / işleme faaliyeti | Veri sorumlusu (VS) | Veri işleyen (Vİ) | Not |
|---|---|---|---|
| Son müşterinin adı, telefonu/BSUID'si, adresi, sipariş içeriği, WhatsApp mesajları (siparişin alınması ve teslimi için) | **İşletme** | **Biz**. Alt işleyenler: hosting, Meta (Cloud API), SMS/e-posta sağlayıcısı, varsa LLM sağlayıcısı | [Y/T] |
| İşletmenin kampanya listesi ve müşteri segmentleri (işletmenin talimatıyla) | İşletme | Biz | ETK onayı ve İYS işletmenin sorumluluğunda, ama araç bizde. Kontroller yazılımda olmalı (§3.6) [T] |
| İşletme sahibi/yetkilisinin kimlik ve iletişim bilgisi, abonelik, fatura, ödeme | **Biz** | Fatura entegratörü, PSP, hosting | [Y/T] |
| Panel kullanıcı hesapları ve güvenlik logları | Biz (hizmet güvenliği amacıyla) | — | İşletmenin kendi personeline ilişkin performans raporlarında (kurye süresi, kasiyer işlemleri) VS işletmedir [T] |
| Web sitesi ziyaretçileri, demo talepleri, çerezler | Biz | Analitik, CRM, e-posta araçları | [Y/T] |
| Platform geneli anonim istatistik (ortalama sepet, yoğun saatler) | Biz | — | Gerçekten anonimse KVKK kapsamı dışında kalır. Takma adlı (pseudonymous) veri kişisel veri olmaya devam eder [Y] |
| Son müşterinin WhatsApp kullanıcısı olarak Meta ile ilişkisi | Meta/WhatsApp | — | Son müşterinin WhatsApp ile kendi sözleşmesi [T] |

**Rol kayması riski [T].** Aşağıdaki özellikler bizi son müşteri verisi için de veri sorumlusu (veya müşterek VS) yapar:
- Farklı işletmelerin müşterilerini tek profilde birleştirmek (örneğin "bu kişi 3 işletmeden sipariş verdi").
- Son müşteri verisini kendi pazarlamamız veya keşif önerilerimiz için kullanmak.
- Bir işletmenin müşteri verisini başka bir işletmeye taşımak.

Bu durumda kendi hukuki sebebimiz, kendi aydınlatma metnimiz ve büyük olasılıkla açık rıza gerekir. [K01] de BSUID'nin portföy kapsamlı olduğunu ve tenant verisinin ayrı tutulması gerektiğini söylüyor. **Kural: tenant verisi tenant içinde kalır.**

**Müşterek sorumluluk:** KVKK m.12/2'ye göre veri sorumlusu, kendi adına veri işleyenle birlikte veri güvenliği tedbirlerinden **müştereken sorumludur** [Y]. Bu nedenle işletmeler bizden güçlü güvenlik taahhüdü isteyecektir ve istemelidir.

### 2.2 Veri işleme sözleşmesi (DPA)

KVKK'da GDPR m.28 gibi maddeleri tek tek sayan bir liste yok. Ancak m.12/2'deki müşterek sorumluluk ve Kurum uygulaması yazılı bir sözleşmeyi fiilen zorunlu kılıyor [O/T]. DPA, abonelik sözleşmesinin **eki** olarak elektronik onayla (click-wrap) kabul edilebilir [T].

**DPA'da bulunması önerilen maddeler [T, iyi uygulama]:**

1. **Kapsam:** Konu, süre, işlemenin niteliği ve amacı, veri kategorileri (kimlik, iletişim, adres, sipariş, işlem güvenliği, pazarlama izni), ilgili kişi grupları (son müşteri, işletme personeli).
2. **Talimat:** Veri yalnızca işletmenin belgelenmiş talimatıyla işlenir. Talimat hukuka aykırı görünürse işletmeye bildirilir.
3. **Gizlilik:** Personelin gizlilik taahhüdü.
4. **Güvenlik:** Teknik ve idari tedbirler ek olarak listelenir. Kurum'un *Kişisel Veri Güvenliği Rehberi (Teknik ve İdari Tedbirler)* dokümanına atıf yapılır [O]. İçerik: tenant izolasyonu, şifreleme, erişim yetkisi ve logları, yedekleme, sızma testi, çalışan eğitimi.
5. **Alt veri işleyenler:** Güncel liste (Meta, hosting, e-posta/SMS, hata izleme, LLM, harita). Değişiklik önceden bildirilir, işletmenin itiraz ve fesih hakkı olur.
6. **Yurt dışına aktarım:** Hangi alt işleyenin hangi ülkede olduğu, hangi m.9 mekanizmasının kullanıldığı, standart sözleşmeyi kimin imzalayıp Kurum'a kimin bildireceği (§2.10).
7. **İlgili kişi başvuruları:** m.11 başvurularına teknik destek (dışa aktarma, silme, düzeltme). Cevap süresi 30 gün [O].
8. **İhlal bildirimi:** Veri ihlalinde işletmeye bildirim süresi. Öneri: **tespitten itibaren en geç 24 saat.** İşletmenin 72 saatlik Kurul bildirimini yapabilmesi buna bağlı [T].
9. **Denetim:** İşletmenin bilgi talebi ve denetim hakkı. Makul sınırlarla tanımlanır, rapor veya sertifika ile karşılanabilir.
10. **Sözleşme sonu:** Veri işletmeye iade edilir veya silinir. Öneri: 30 günlük dışa aktarma penceresinden sonra silme. Yasal saklama istisnaları ayrıca belirtilir.
11. **Sorumluluk:** Sorumluluk dağılımı, tazmin ve üst sınır.
12. **İşletmenin yükümlülükleri:** Aydınlatma metnini yayımlamak, ETK onay ve İYS yükümlülüklerini yerine getirmek, hukuka uygun talimat vermek, VERBİS kaydı varsa güncel tutmak.

### 2.3 VERBİS (Veri Sorumluları Sicili)

- **Dayanak:** Veri Sorumluları Sicili Hakkında Yönetmelik (RG 30.12.2017, sayı 30286) [Y].
- **Temel muafiyet:** Kurul'un 19.07.2018 tarihli ve 2018/87 sayılı kararı. Üç koşulun birlikte sağlanması gerekiyor [Y]:
  - yıllık çalışan sayısı 50'den az,
  - yıllık mali bilanço toplamı 25 milyon TL'den az,
  - ana faaliyet konusu özel nitelikli kişisel veri işleme değil.
- **Güncelleme:** Mali bilanço eşiğinin sonraki bir Kurul kararıyla yükseltildiğine dair bir hatıra var (100 milyon TL gibi bir rakam) — **DOĞRULANAMADI.** VERBİS istisnalar sayfasından teyit edilmeli (§14).
- Yurt dışında yerleşik veri sorumluları bu istisnadan yararlanamaz [O].
- **Bizim durumumuz [T]:** Başlangıçta muafız. "Ana faaliyet özel nitelikli veri değil" koşulunu korumak için sağlık verisi toplayan alanlar açmamalıyız (§2.6).
- **İşletmeler [T]:** Hedef işletmelerin (dönerci, pideci, kafe) çok büyük kısmı muaftır. Zincir restoranlar istisna olabilir; onboarding'de "VERBİS kaydınız var mı?" sorusu sorulabilir.
- **Muafiyet yükümlülüksüzlük değildir [Y]:** Aydınlatma, veri güvenliği, başvurulara cevap, ihlal bildirimi ve m.9 yükümlülükleri aynen geçerli. Saklama ve imha politikası yalnızca VERBİS'e kayıtlı olanlar için zorunlu, bizim için iyi uygulamadır.
- **Takip [T]:** Çalışan sayısı ve bilanço eşikleri şirketin yıllık uyum takviminde izlenmeli.

### 2.4 Aydınlatma metni

- **Dayanak:** KVKK m.10 ve Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ (RG 10.03.2018, sayı 30356) [Y].
- **Zorunlu içerik [Y]:** VS'nin kimliği, işleme amaçları, verinin kimlere ve hangi amaçla aktarılabileceği, toplama yöntemi ve hukuki sebep, m.11'deki haklar.
- **Tebliğ kuralları [O]:** "vb.", "gibi" türünden belirsiz ifadeler kullanılmamalı. Aydınlatma ile açık rıza aynı metinde birleştirilmemeli.

**Hazırlanması gereken metinler [T]:**

| Metin | Kim adına | Nerede yayımlanır |
|---|---|---|
| A. Kurumsal site aydınlatma metni + gizlilik politikası (ziyaretçi, demo talebi, işletme yetkilisi, abonelik) | Biz | siparisinonunde.com altbilgisi, kayıt formu, panel |
| B. **Son müşteri aydınlatma metni şablonu.** İşletmenin unvanı, adresi ve iletişim bilgisi otomatik dolar | İşletme (VS) | Storefront altbilgisi ve checkout, sipariş takip sayfası, **WhatsApp'taki ilk otomatik yanıtta kısa özet ve link** |
| C. Panel kullanıcıları (işletme personeli) için kısa bilgilendirme | Hesap güvenliği için biz; personel yönetimi için işletme | Panel girişi |

**WhatsApp'ta ilk temas [T]:**
- Müşterinin ilk mesajına verilen otomatik yanıta bir satır eklenir: *"Kişisel verileriniz siparişinizi almak ve teslim etmek amacıyla [İşletme] tarafından işlenir. Ayrıntı: [link]"*.
- Bu satır yalnızca ilk konuşmada veya metin sürümü değiştiğinde gönderilmeli. 1 Ekim 2026'dan itibaren numara başına aylık 1.000 servis mesajından sonrası ücretli [K01].
- Aydınlatma metninde **yurt dışına aktarım** açıkça yazılmalı: Meta/WhatsApp altyapısı, ülke ve dayanak.

### 2.5 Hukuki sebepler ve açık rıza gereken durumlar

| İşleme | Hukuki sebep | Açık rıza gerekir mi? |
|---|---|---|
| Siparişi almak, hazırlamak, teslim etmek, müşteriyle iletişim | m.5/2-c: sözleşmenin kurulması/ifası [Y] | Hayır |
| Fiş/fatura, muhasebe kaydı | m.5/2-ç: hukuki yükümlülük [Y] | Hayır |
| Adresi sonraki siparişler için hatırlamak | m.5/2-c veya m.5/2-f (meşru menfaat). Aydınlatmada belirtilmeli, müşteriye "adresimi sil" seçeneği verilmeli [T] | Genelde hayır [T] |
| İşletme içi basit sipariş istatistiği | m.5/2-f meşru menfaat [T] | Hayır |
| Kampanya ve duyuru mesajı göndermek | 6563 kapsamında **önceden onay** şart (ayrı rejim, §3). KVKK açısından ETK onayının yeterli sayılıp sayılmadığı tartışmalı [O/D?] | Pratikte **ETK onayı şart**. Profilleme varsa ayrıca açık rıza önerilir [T] |
| Kişiye özel profil ve segment (davranışa göre teklif, "sadık müşteri" etiketi) | Kurul'un pazarlama profillemesinde açık rızaya yöneldiği biliniyor [O] | **Evet** (öneri) |
| Alerji/sağlık bilgisi, inanç çıkarımı (helal/koşer tercihi gibi) | m.6: özel nitelikli veri. Sözleşmenin ifası **dayanak değil** [Y] | **Evet**, ya da hiç toplamayın (§2.6) |
| Yurt dışına aktarım (arızi yol) | m.9/6-a | Evet, ama **yalnızca arızi aktarım için** (§2.10) |
| Zorunlu olmayan çerezler (analitik, pazarlama) | Açık rıza (Kurum Çerez Rehberi) [O] | **Evet** |
| Müşteri yorumunu isimle yayımlamak | Açık rıza, ya da anonim yayın [T] | İsim varsa evet |

**Genel kurallar:**
- Açık rıza hizmet şartına bağlanamaz, yani "onay vermezsen sipariş veremezsin" denemez [O].
- Önceden işaretlenmiş kutu kullanılamaz [Y].
- Rıza metni belirli bir konuya ilişkin, bilgilendirmeye dayalı ve özgür iradeyle verilmiş olmalı [Y].

### 2.6 Özel nitelikli veri tuzağı: sipariş notlarındaki alerji bilgisi

- 7499 sayılı Kanun ile değişen m.6'ya göre özel nitelikli veri şu hallerde işlenebilir [O]:
  - açık rıza,
  - kanunda açıkça öngörülme,
  - fiili imkânsızlık halinde hayati koruma,
  - ilgili kişinin kendisinin alenileştirmesi,
  - hakkın tesisi,
  - kamu sağlığı (sır saklama yükümlülüğü altındakiler),
  - istihdam ve sosyal güvenlik yükümlülükleri,
  - vakıf/dernek faaliyetleri.
- **"Sözleşmenin ifası" bu listede yok** [Y/O].
- Müşteri notuna "fıstık alerjim var" veya "çölyak hastasıyım" yazdığında bu bir **sağlık verisidir** [Y].

**Ürün kararları [T]:**
- Müşteri profilinde yapılandırılmış bir "alerji/sağlık" alanı **açmayın**.
- Serbest not alanında yazılan bilgi yalnızca o siparişte kullanılsın, müşteri profiline kalıcı etiket olarak taşınmasın ve kısa sürede silinsin (§2.7).
- Alerjen bilgisini **menü ürün özelliği** olarak gösterin ("içinde fıstık var"). Bu kişisel veri değildir, iyi uygulamadır ve gıda mevzuatı açısından da faydalıdır (§4.9).
- Bu yaklaşım yine de gri alan. Avukata sorulacak (§13).

### 2.7 Saklama ve imha

- **Dayanak:** Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik (RG 28.10.2017, sayı 30224) [Y].
  - Periyodik imha en fazla 6 aylık aralıklarla yapılır [O].
  - İmha işlemlerinin kayıtları en az 3 yıl saklanır [O].
  - Saklama ve imha politikası VERBİS'e kayıtlı VS'ler için zorunlu [O].

**Önerilen saklama süreleri** (süreler [T]; yasal dayanaklar [O], mali müşavir/avukatla teyit edilmeli):

| Veri | Öneri | Dayanak / not |
|---|---|---|
| Sipariş kaydı (ürün, tutar, tarih, ödeme şekli) | Abonelik süresince işletme adına saklanır. Hesap kapanınca dışa aktarım + silme | Ticari defter/belge saklama yükümlülüğü **işletmenindir** (VUK m.253: 5 yıl; TTK m.82: 10 yıl) [O]. İşletme kendi kopyasını almalı |
| Son müşteri adı, telefonu, adresi | Son siparişten sonra 24 ay hareketsizlikte anonimleştirme. İşletme süreyi ayarlayabilir | [T] |
| WhatsApp mesaj içerikleri | 6–12 ay, sonra silme. Sipariş özeti kalır | [T]. Coexistence ile 6 aylık geçmiş senkronu varsayılan olarak **kapalı** olmalı [K01] |
| Sipariş notu (serbest metin) | Sipariş tamamlandıktan sonra 30–90 gün | Sağlık verisi riski (§2.6) [T] |
| Canlı konum, kurye konumu | Sipariş tamamlandıktan sonra ≤30 gün | [T] |
| Medya (sesli mesaj, fotoğraf) | 30–90 gün | [T] |
| ETK onay ve ret kayıtları | Onayın geçerliliği sona erdikten sonra 3 yıl | Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik [O] |
| Trafik ve erişim logları (yer sağlayıcı olarak) | 1–2 yıl | 5651 m.5 ve ilgili yönetmelik [O] |
| Kendi abonelik faturalarımız ve muhasebe belgelerimiz | 10 yıl | TTK m.82, VUK m.253 [O] |
| Panel güvenlik logları | 2 yıl | [T] |
| Yedekler | Rotasyonla en geç 35–90 günde yedekten de düşmeli | [T] |

**Teknik gereksinim [T]:** Her tenant için ayarlanabilir, otomatik çalışan silme/anonimleştirme işleri kurulmalı. Silme kayıtları (imha tutanağı karşılığı) tutulmalı.

### 2.8 Veri ihlali bildirimi

- **KVKK m.12/5:** Kişisel veriler hukuka aykırı olarak başkalarınca elde edilirse, VS bunu "en kısa sürede" ilgili kişiye ve Kurul'a bildirir [Y].
- **Kurul'un 24.01.2019 tarihli ve 2019/10 sayılı kararı** [Y/O]:
  - "En kısa süre", Kurul'a bildirim için **72 saat** olarak yorumlanır.
  - İlgili kişilere, etkilenenler belirlendikten sonra makul en kısa sürede bildirim yapılır.
  - 72 saatte bildirim yapılamazsa gecikmenin gerekçesi açıklanır.
  - İhlal kayıtları tutulur ve bir müdahale planı hazırlanır.
  - **Veri işleyen, ihlali gecikmeksizin veri sorumlusuna bildirir.**
- Kurum'un çevrimiçi "Veri İhlali Bildirim Formu" kullanılır [O].

**Çok kiracılı (multi-tenant) yapıda anlamı [T]:**
- Bizde yaşanan bir ihlalde **etkilenen her işletme ayrı bir VS**'dir ve her biri Kurul'a ayrı bildirim yapmakla yükümlüdür.
- Kendi VS olduğumuz veriler (işletme yetkilileri, abonelik) için biz de ayrıca bildirim yaparız.
- Hazırlık:
  - Tenant bazında "hangi veriler, hangi kayıtlar etkilendi?" raporu üretebilen log altyapısı.
  - İşletmelere gönderilecek hazır bildirim şablonları.
  - 7/24 iletişim zinciri.
  - Yılda bir tatbikat.
- **7545 sayılı Siber Güvenlik Kanunu** (RG 19.03.2025) izlenmeli [O]. Bu kanunun siber olay bildirim yükümlülüklerinin bize uygulanıp uygulanmadığı belirsiz [D?].

### 2.9 İlgili kişi başvuruları

- **Dayanak:** KVKK m.11, m.13 ve Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ (RG 10.03.2018, sayı 30356) [Y].
  - Cevap süresi en geç **30 gün** [Y].
  - Başvuru kural olarak ücretsizdir [O].
- **Akış [T]:**
  - Son müşteri işletmeye başvurur.
  - Başvuru bize gelirse işletmeye yönlendiririz ve DPA kapsamında teknik destek veririz.
  - Panelde işletme için "müşteri verisini dışa aktar", "düzelt" ve "sil/anonimleştir" butonları olmalı.

### 2.10 Yurt dışına aktarım (m.9, 2024 değişikliği)

**Dayanaklar:**
- 7499 sayılı Kanun (RG 12.03.2024, sayı 32487) ile m.9 baştan yazıldı. Değişiklik 01.06.2024'te yürürlüğe girdi. Eski m.9/1 (açık rızayla aktarım) 01.09.2024'e kadar yeni hükümle birlikte uygulanabildi [O].
- Kişisel Verilerin Yurt Dışına Aktarılmasına İlişkin Usul ve Esaslar Hakkında Yönetmelik (RG 10.07.2024, sayı 32598) [O].

**Mekanizmalar (sırasıyla) [O]:**

| Sıra | Mekanizma | Açıklama | Bizim için pratiklik |
|---|---|---|---|
| 1 | **Yeterlilik kararı** | Kurul'un ülke, uluslararası kuruluş veya sektör bazında verdiği karar. Ayrıca m.5 veya m.6'daki bir işleme şartı aranır. | Bilgi kesimimiz itibarıyla Kurul **hiçbir ülke için yeterlilik kararı yayımlamadı** [O; teyit edilmeli]. Bu yol şimdilik yok. |
| 2 | **Uygun güvenceler.** Ön koşul: bir işleme şartı ve ilgili kişinin aktarılan ülkede de haklarını kullanabilmesi ve etkili kanun yoluna başvurabilmesi | (a) Kamu kurumları arası anlaşma + Kurul izni. (b) Bağlayıcı şirket kuralları (BCR) + Kurul onayı. (c) **Kurul'un ilan ettiği standart sözleşme.** (ç) Yazılı taahhütname + Kurul izni. | Bizim için tek pratik yol **(c) standart sözleşme** |
| 3 | **Arızi aktarım** (yalnızca 1 ve 2 yoksa) | Muhtemel riskler anlatılarak alınan açık rıza, ilgili kişiyle yapılan sözleşmenin ifası için zorunluluk, ilgili kişi lehine sözleşme, üstün kamu yararı, hakkın tesisi, hayati koruma, kamuya açık sicil | Yalnızca **düzenli olmayan, bir veya birkaç kez gerçekleşen, süreklilik arz etmeyen, olağan iş akışı dışındaki** aktarımlar için kullanılabilir [O]. **WhatsApp üzerinden sürekli sipariş akışı arızi değildir** [T] |

**Standart sözleşmenin ayrıntıları:**
- Kurum Temmuz 2024'te dört modül ilan etti: VS→VS, VS→Vİ, Vİ→Vİ, Vİ→VS [O].
- Metin **değiştirilmeden** kullanılmalı [O].
- İmzadan itibaren **5 iş günü içinde** veri sorumlusu veya veri işleyen tarafından **Kurum'a bildirilir** [Y].
- Bildirim yapılmazsa m.18'e göre idari para cezası uygulanır. 2024 nominal tutarı **50.000–1.000.000 TL**; tutar her yıl yeniden değerleme oranıyla artar [O].
- Bildirim yöntemi (KEP, e-imza, posta vb.) güncel Kurum duyurusundan teyit edilmeli [D?].

**Diğer notlar:**
- Yurt dışından **uzaktan erişim** de aktarım sayılır [O]. Örnekler: yurt dışındaki bir destek aracının müşteri verisini görmesi, yurt dışındaki bir geliştiricinin üretim veritabanına bağlanması.
- Kurum'un 2025'te bir "Kişisel Verilerin Yurt Dışına Aktarılması Rehberi" yayımladığı hatırlanıyor [D?].

### 2.11 WhatsApp/Meta ve diğer yurt dışı alt işleyenler nasıl yönetilmeli?

**Veri akışı [T]:**
1. Son müşteri kendi WhatsApp hesabından işletmenin numarasına yazar.
2. Mesaj Meta'nın Cloud API altyapısından geçer. Cloud API Meta'nın barındırdığı bir servistir ve sunucu konumu Türkiye değildir [K01; konum ayrıntısı D?].
3. Mesaj webhook ile bizim sunucumuza gelir.
4. İşletmenin yanıtı bizden Meta'ya, oradan müşteriye gider.

**Tech Provider modelinde roller [K01/T]:** WABA işletmenindir ve işletme Meta'nın WhatsApp Business şartlarını doğrudan kabul eder. Meta'nın Cloud API mesaj içeriği için "işletme adına veri işleyen" konumunda olduğu anlaşılıyor [O/D?]. Yani ihracatçı (aktaran) büyük olasılıkla **işletme** (VS→Vİ modülü). İşletmenin talimatıyla veriyi Meta'ya yollayan teknik taraf olarak **biz** de akışın içindeyiz (Vİ→Vİ yorumu da mümkün).

**Sorun:** Standart sözleşmenin taraflarca imzalanması gerekiyor. **Meta'nın her Türk işletmesiyle ya da bizimle Türk standart sözleşmesini imzalayıp imzalamadığı, ya da şartlarına bir KVKK modülü ekleyip eklemediği doğrulanamadı** [D?]. Böyle bir modül yoksa düzenli aktarım için geçerli bir m.9 dayanağı kurmak zorlaşır. Bu, Türkiye'de WhatsApp Business API kullanan herkesin ortak sorunu [T].

**Önerilen yönetim planı [T]:**

1. **Kendi verimiz Türkiye'de kalsın.** Ana veritabanı, dosya depolama ve yedekler Türkiye'de tutulursa kendi altyapımız için m.9 yükü ortadan kalkar (§2.12).
2. **Kaçınılabilir yurt dışı araçlar kişisel veri görmesin:**
   - Hata izleme (Sentry vb.) için PII temizleme açılsın.
   - Analitik rıza sonrasında çalışsın, IP maskelensin; mümkünse self-host analitik kullanılsın.
   - E-posta ve SMS için Türkiye'deki sağlayıcılar tercih edilsin.
   - Destek aracına müşteri verisi aktarılmasın.
   - Harita/geocoding çağrılarına ad ve telefon gönderilmesin.
3. **LLM ile sipariş ayrıştırma [T]:** LLM sağlayıcısına gönderilen metinden telefon, ad ve adres çıkarılsın; yalnızca "2 lahmacun 1 ayran, acısız" gibi sipariş metni gitsin. Tanımlayıcısı temizlenmiş metin çoğu durumda kişisel veri olmaktan çıkar. Tamamen anonim olup olmadığı ise bağlama göre değerlendirilmeli [O/T]. LLM sağlayıcısıyla standart sözleşme imzalanabiliyorsa ayrıca imzalanıp Kurum'a bildirilmeli.
4. **Meta için:**
   - (a) Meta'nın güncel veri işleme ve veri aktarım şartlarında KVKK standart sözleşme modülü olup olmadığı araştırılsın. Tech Provider başvurusu kanalından veya bir Türk Solution Partner üzerinden **yazılı olarak sorulsun**.
   - (b) Modül varsa: imza ve bildirim sorumluluğu DPA'da netleştirilsin. Öneri: bildirimi biz işletme adına yaparız, işletme vekâlet verir [D? — pratikte mümkün mü teyit edilmeli].
   - (c) Modül yoksa:
     - Yazılı bir aktarım risk değerlendirmesi hazırlansın.
     - Aydınlatma metninde Meta aktarımı açıkça belirtilsin.
     - **WhatsApp mesajlarında veri minimizasyonu** uygulansın: şablonlarda adres ve telefon tekrar edilmesin; ayrıntı Türkiye'de barınan sipariş takip sayfasında gösterilsin.
     - **WhatsApp'a alternatif sipariş kanalı** (web storefront) her zaman açık tutulsun; müşteri WhatsApp kullanmaya mecbur kalmasın.
     - Avukat görüşü alınsın.
   - (d) **Düzenli akışı arızi aktarım açık rızasıyla meşrulaştırmaya çalışmayın.** Bu, Yönetmelik'teki "arızi" tanımıyla çelişir [O/T].
5. **Alt işleyen envanteri** tutulsun: ülke, veri kategorisi, m.9 dayanağı, sözleşme tarihi, bildirim tarihi. Admin panelinde veya uyum dokümanında yer alsın.

### 2.12 Hosting yurt içinde mi olmalı?

- **Yasal durum:** KVKK genel bir veri yerelleştirme zorunluluğu getirmiyor [Y]. Veriyi yurt dışında barındırmak, m.9'a uyulduğu sürece mümkün.
- Yerelleştirme **sektörel** kurallarda var: bankacılık, ödeme ve elektronik para kuruluşları (birincil ve ikincil sistemler yurt içinde), e-belge özel entegratörleri, bazı kamu hizmetleri [O]. Bizim hizmetimiz bu sektörlerden birinde değil [T].

**Seçenekler:**

| Seçenek | Artı | Eksi |
|---|---|---|
| **A. Türkiye'de barındırma** (yerli bulut ya da İstanbul bölgesi olan bir sağlayıcı) | Kendi altyapımız için m.9 yükü yok. Esnafa "verileriniz Türkiye'de" güven mesajı verilir. Vergi mevzuatının e-belge yaklaşımıyla uyumlu | Yönetilen servis çeşitliliği az, DevOps yükü fazla, bazı sağlayıcılarda fiyat ve olgunluk belirsiz [D?] |
| **B. AB'de barındırma** (Frankfurt vb.) + Türk standart sözleşmesi | Olgun yönetilen servisler | Sağlayıcının Türk standart sözleşmesini imzalaması şart. Bazı global sağlayıcıların KVKK modülü sunduğu hatırlanıyor [D?]. Sözleşme başına 5 iş günü içinde bildirim yükü |
| **C. Hibrit** (kişisel veri Türkiye'de, anonim/uygulama katmanı yurt dışında) | Esnek | Mimari karmaşıklık |

**Öneri [T]:** MVP'de **A seçeneği.** Postgres, nesne depolama ve yedekler Türkiye'de; ikinci yedek başka bir Türkiye lokasyonunda.

Değerlendirilecek sağlayıcılar (özellikler ve fiyatlar doğrulanmadı) [D?]:
- Turkcell Bulut
- Türk Telekom bulut hizmetleri
- Huawei Cloud İstanbul bölgesi [O]
- Yerli veri merkezleri ve bulut sağlayıcıları (Radore, Bulutistan vb.)

Global bir sağlayıcı seçilirse, **seçimden önce** o sağlayıcının Türk standart sözleşmesini imzaladığı yazılı olarak teyit edilmeli.

### 2.13 Çerezler

- **Kaynak:** Kurum'un *Çerez Uygulamaları Hakkında Rehber*'i (2022) [O].
- **Kurallar [O]:**
  - Zorunlu çerezler dışındakiler (analitik, pazarlama) için **açık rıza** gerekir.
  - Rıza alınmadan bu çerezler yüklenmez.
  - "Reddet" seçeneği "Kabul et" kadar kolay olmalı.
  - Önceden işaretlenmiş seçenek olmaz.
- **Storefront [T]:** Varsayılan olarak çerezsiz veya yalnızca zorunlu çerezlerle çalışsın; birinci taraf, çerezsiz analitik kullanılsın. İşletme Meta Pixel veya Google Ads etiketi eklemek isterse rıza paneli (CMP) zorunlu hale gelsin. Bu durumda işletme VS, biz Vİ olmaya devam ederiz.

### 2.14 Teyit edilecek Kurul kararları ve rehberler

| Belge | Konu | Güven |
|---|---|---|
| Kurul kararı 2018/87 (19.07.2018) | VERBİS muafiyet eşiği (50 çalışan / 25 milyon TL) | [Y] |
| VERBİS eşiğini güncelleyen sonraki karar(lar) | Bilanço eşiği yükseltmesi | [D?] |
| Kurul kararı 2019/10 (24.01.2019) | Veri ihlali bildirimi, 72 saat | [Y] |
| Aydınlatma Tebliği ve Başvuru Tebliği (RG 10.03.2018) | Aydınlatma içeriği, başvurulara 30 günde cevap | [Y] |
| Silme, Yok Etme, Anonimleştirme Yönetmeliği (RG 28.10.2017) | Saklama ve imha | [Y] |
| Kişisel Veri Güvenliği Rehberi (Teknik ve İdari Tedbirler) | Güvenlik tedbirleri | [O] |
| Çerez Uygulamaları Hakkında Rehber (2022) | Çerez rızası | [O] |
| Yurt dışına aktarım Yönetmeliği (RG 10.07.2024) ve standart sözleşme metinleri | m.9 | [O] |
| Yurt dışına aktarım rehberi (2025?) | m.9 uygulaması | [D?] |
| Kurul'un WhatsApp LLC hakkındaki 2021 kararı (yaklaşık 1,95 milyon TL idari para cezası) | 2021 gizlilik politikası güncellemesi, aydınlatma ve açık rıza | [O] |

### 2.15 İdari para cezaları (ölçek)

- m.18'de ceza verilen başlıca ihlaller: aydınlatma yükümlülüğü, veri güvenliği yükümlülüğü, Kurul kararlarına uymama, VERBİS kaydı ve 2024'te eklenen **m.9/5 standart sözleşme bildirimi** [Y/O].
- Tutarlar her yıl yeniden değerleme oranıyla artar. **2026 tutarları doğrulanamadı** [D?]. Güncel tutarlar Kurum'un sitesinden alınmalı.
- 2024 değişikliğiyle idari para cezalarına itiraz yolu sulh ceza hakimliğinden **idare mahkemesine** taşındı [O].
- **İtibar riski:** Kurul, karar özetlerini yayımlıyor. Esnafa "KVKK uyumlu altyapı" vaat eden bir ürün için bir ihlal kararı ciddi itibar kaybı demek [T].

---

## 3. 6563 sayılı Kanun, Ticari Elektronik İleti ve İYS

**Dayanaklar:**
- 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun (RG 05.11.2014, sayı 29166) [Y]
- Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik (RG 15.07.2015, sayı 29417) [Y]
- İYS'yi getiren 2020 değişikliği (RG 04.01.2020) [O]

### 3.1 WhatsApp mesajı "ticari elektronik ileti" sayılır mı?

- **Kanundaki tanım [Y]:** "Telefon, çağrı merkezleri, faks, otomatik arama makineleri, akıllı ses kaydedici sistemler, elektronik posta, kısa mesaj hizmeti **gibi** vasıtalar kullanılarak elektronik ortamda gerçekleştirilen ve ticari amaçlarla gönderilen veri, ses ve görüntü içerikli iletiler."
- Liste "gibi" ifadesiyle **açık uçlu**. Anlık mesajlaşma uygulaması üzerinden gönderilen ticari amaçlı içerik de kapsama girer [O/T].
- İYS'nin SSS sayfasına göre **kampanya ve pazarlama içerikli WhatsApp mesajları** için üç şart var: önceden onay, İYS kaydı ve aynı kanaldan ücretsiz ret yolu. Sipariş onayı ve teslimat bildirimi gibi işlemsel mesajlar onaya tabi değil [K02; kaynak: https://iys.org.tr/iys/sss].

### 3.2 Mesaj sınıflandırması: onay gerekir mi?

Kanun ve Yönetmelik, **onay gerektirmeyen** iletileri de düzenliyor [O]:
- Kurulmuş sözleşmenin ifasına yönelik bilgilendirme, tahsilat, borç hatırlatma ve bilgi güncelleme iletileri.
- Satın alınan mal veya hizmetin teslimatına, değişikliğine, kullanımına ve bakımına ilişkin iletiler.
- Alıcının kendi iletişim bilgisini vererek başlattığı talebe verilen cevaplar.
- **Esnaf ve tacir** alıcılara gönderilen iletiler.

Madde numaraları ve sınırları teyit edilmeli.

| Mesaj örneği | Sınıf | Onay/İYS gerekir mi? |
|---|---|---|
| "Siparişiniz alındı / onaylandı / hazırlanıyor / yola çıktı / teslim edildi" | Bilgilendirme (sözleşmenin ifası) | **Hayır** [O] |
| "Ürün tükendi, yerine X ister misiniz?", "Siparişiniz iptal edildi" | Bilgilendirme | **Hayır** [O] |
| Müşteri yazdı, işletme aynı konuşmada menü linki veya fiyatla cevap verdi | Talebe cevap | **Hayır** [O]. Ama talep dışı promosyon eklenmemeli |
| "Teşekkürler, siparişinizi değerlendirir misiniz?" (promosyonsuz) | **Gri alan.** Bilgilendirme lehine yorumlanabilir [T] | İhtiyatlı yol: onayı olanlara gönder ya da ret seçeneği ekle |
| "Teslim edildi! Bir sonraki siparişe %10 indirim: KOD10" | **Ticari ileti** (promosyon eklendi) | **Evet** [O/T] |
| "Sepetinde ürün kaldı", "Seni özledik" | Ticari ileti | **Evet** |
| "Bugün lahmacunda 2 al 1 öde", "Ramazan menümüz çıktı", "Yeni şubemiz açıldı" | Ticari ileti (tanıtım) | **Evet** |
| "Yarın bakım nedeniyle kapalıyız" (tüm müşterilere toplu) | **Gri alan.** Saf bilgilendirmeyse savunulabilir, ama toplu gönderim risk taşır [T] | İhtiyatlı yol: onayı olanlara gönder |
| Bizim işletmelere gönderdiğimiz satış/tanıtım mesajları (B2B) | Ticari ileti; alıcı esnaf/tacir | **Önceden onay gerekmez, ret hakkı vardır** [O] |

**Ürün kuralı [T]:** WhatsApp "utility" şablonlarında promosyon içeriği **yasak** olmalı. Hem ETK hem de Meta'nın kategori kuralları [K01] bunu gerektiriyor. Şablon editörüne otomatik kontrol (linting) eklenmeli: "indirim", "%", "kampanya", "kod", "fırsat" gibi kelimeler geçerse şablon uyarı versin veya pazarlama kategorisine zorlansın.

### 3.3 İYS kaydı zorunluluğu, eşikler ve esnaf

- **Genel kural [O]:** 2020 değişikliğiyle hizmet sağlayıcılar aldıkları onayları **İYS'ye kaydetmek** zorunda. İYS'ye kaydedilmemiş onay geçersiz sayılır. İleti göndermeden önce İYS'de onay durumu kontrol edilmeli.
- **Eşik / muafiyet:**
  - Küçük işletmeler veya esnaf için kayıt yükümlülüğünden **genel bir muafiyet** olduğuna dair güvenilir bir bilgi yok. Geçiş dönemi tarihleri 2020–2021'de doldu [O/D?].
  - Bilinen istisna **alıcı tarafında**: alıcı esnaf veya tacirse önceden onay gerekmez [O].
- **Esnaf/şahıs işletmesi kaydı:** VKN veya TCKN ile, e-Devlet üzerinden İYS'ye kayıt yapılabildiği hatırlanıyor [O].
- **Ücret:** İYS'nin izin sayısına göre kademeli bir ücret tarifesi var; küçük kademelerin ücretsiz veya düşük ücretli olduğu hatırlanıyor [D?].
- **Kayıt süresi:** Alınan onayların **3 iş günü içinde** İYS'ye kaydedilmesi gerektiği hatırlanıyor [O].
- **İşletme:** İYS nezdinde "hizmet sağlayıcı", yani kendi adına ileti gönderen taraf **işletmenin kendisidir** [T]. Biz bu gönderimi mümkün kılan teknoloji tarafıyız (§3.6).

### 3.4 Onay alma yöntemi ve ispat

- **Kural:** Onay yazılı olarak veya her türlü elektronik iletişim aracıyla alınabilir. **İspat yükü hizmet sağlayıcıdadır** [Y/O].
- **Onay metninde bulunması gerekenler [T]:**
  - hangi işletme adına alındığı,
  - hangi kanallar için geçerli olduğu (WhatsApp / SMS / arama / e-posta; İYS'deki kanal ayrımına uygun),
  - hangi içerik türünü kapsadığı (kampanya, duyuru).
- **Toplama noktaları [T/K01]:**
  - Storefront checkout'ta **işaretlenmemiş** kutu: *"[İşletme]'nin kampanya ve duyurularını WhatsApp ve SMS ile almak istiyorum."*
  - WhatsApp'ta, sipariş sonrası bilgilendirme mesajının içinde **promosyon içermeyen** bir soru ve iki buton: *"Kampanyalardan haberdar olmak ister misiniz?"* [Evet] [Hayır]. Onay isteyen mesajın kendisi tanıtım içermemeli [O/D?].
- **Kaydedilecek kanıt [T]:** tarih-saat, kanal, yöntem (checkbox / buton / yazılı cevap), onay metninin sürümü, IP adresi veya WhatsApp mesaj ID'si, işletme ID'si.
- **Meta tarafı:** WhatsApp Business Policy'nin opt-in şartı İYS'den **ayrı ve ek** bir yükümlülüktür. Opt-in'de işletme adı açıkça yazılmalı [K01].

### 3.5 Ret hakkı

- **Kural [O]:** Alıcı istediği zaman, gerekçe göstermeden reddedebilir. Ret kolay ve ücretsiz olmalı ve her iletide ret bilgisi yer almalı. Ret talebi ulaştıktan sonra **3 iş günü içinde** gönderim durdurulmalı.
- **WhatsApp'ta uygulama [T]:**
  - Her kampanya mesajına "Beni listeden çıkar" hızlı yanıt butonu ve "RET yazarak çıkabilirsiniz" satırı eklenir.
  - Ret, yerel veritabanına ve işletmenin İYS kaydına yansıtılır.
  - İYS üzerinden (e-Devlet veya İYS mobil) yapılan retler düzenli olarak çekilir.
- Müşterinin numarayı engellemesi veya "spam" bildirmesi WhatsApp kalite puanını düşürür. Bu, İYS'den bağımsız ayrı bir iş riskidir [K01].

### 3.6 Platformun rolü ve İYS entegrasyon mimarisi

- **Rolümüz:** Kampanya mesajını işletme adına tetikleyen yazılım olarak "gönderime aracılık eden" konumundayız. Yönetmelik'te hizmet sağlayıcı adına ileti gönderimine aracılık edenlere yükümlülükler getirildiği hatırlanıyor (SMS firmalarının İYS kontrol yükümlülüğü gibi). Kavramın tam adı, maddesi ve bize uygulanıp uygulanmayacağı **teyit edilmeli** [O/D?].
- **İhtiyatlı varsayım [T]:** "Onaysız gönderime yazılımımız izin verirse biz de sorumlu tutulabiliriz."

**Minimum kontrol seti (kampanya modülü açılmadan önce) [T]:**

1. **Aktivasyon kapısı:** İşletme kampanya modülünü açmak için İYS'ye kayıtlı olduğunu beyan eder, İYS numarasını ve marka kodunu girer, bize yetki verir.
2. **Onay toplama ve kayıt:** Onaylar storefront ve WhatsApp akışlarımızda toplanır. Onay kaydı ve kanıtı saklanır. Onay 3 iş günü içinde işletmenin İYS hesabına iletilir; bunun için İYS entegratör/iş ortağı yetkilendirmesi kullanılır [O/D?].
3. **Gönderim öncesi kontrol:** Her alıcı için İYS izin sorgusu yapılır, ya da düzenli senkronize edilen yerel bir kopya kullanılır. **Onayı olmayana gönderilmez.**
4. **Ret senkronizasyonu:** İYS'deki izin değişiklikleri düzenli olarak çekilir [D?, API davranışı teyit edilmeli].
5. **Otomatik şablon ekleri:** İşletme kimliği ve ret satırı her kampanya şablonuna otomatik eklenir.
6. **Sınırlar:** Frekans sınırı (örneğin müşteri başına haftada en fazla 1 kampanya) ve sessiz saatler. Bunlar yasal zorunluluk değil, kalite puanı ve itibar koruması için [T]. Mevzuatta saat sınırı olup olmadığı [D?].
7. **Denetim kaydı:** Kim, ne zaman, kime, hangi şablonu gönderdi (audit log).

**İYS entegrasyon seçenekleri:**

| Seçenek | Açıklama | Ne zaman |
|---|---|---|
| (a) Kendimiz İYS entegratörü veya iş ortağı olmak | İYS ile sözleşme. Teknik ve idari şartlar [D?] | Faz 3 (ölçek) |
| (b) Mevcut bir İYS iş ortağının API'sini kullanmak (İYS entegrasyonu olan SMS sağlayıcıları) | Hızlı; SMS yedek kanalıyla birlikte alınabilir | Faz 2 |
| (c) İşletmenin onayları elle İYS'ye yüklemesi | Hataya açık | Önerilmez |

**MVP'de kampanya modülü yok. Dolayısıyla İYS entegrasyonu da MVP'de yok.**

### 3.7 Bizim işletmelere pazarlamamız (B2B)

- Esnaf ve tacirlere önceden onay olmadan ticari ileti gönderilebilir, ancak **ret hakkı** tanınmalı ve uygulanmalı [O].
- Esnaf ve tacirlerin İYS üzerinden ret kaydı yapabildiği hatırlanıyor. Toplu B2B gönderimde bu retler kontrol edilmeli [O/D?].
- Soğuk WhatsApp mesajı Meta'nın politikası açısından ayrıca riskli: opt-in olmadan pazarlama şablonu göndermek numaranın kalitesini düşürür [K01/T]. B2B satış için kendi WhatsApp numaramızda bile opt-in toplanmalı.

### 3.8 Yaptırımlar

- 6563 m.12 kapsamında idari para cezaları Ticaret Bakanlığı il müdürlüklerince verilir. **Birden fazla alıcıya gönderimde ceza 10 katına kadar artırılabilir** [O]. Tutarlar her yıl yeniden değerlenir [D? — 2026 tutarları doğrulanamadı].
- Ayrıca Meta'nın numara kısıtlaması veya kapatması ve itibar kaybı riski var [K01].

---

## 4. Elektronik Ticaret Mevzuatı

### 4.1 2022 değişikliği ve temel tanımlar

- **7416 sayılı Kanun** (RG 07.07.2022) 6563'te kapsamlı değişiklik yaptı. Yürürlük: 01.01.2023 [O].
- **Elektronik Ticaret Aracı Hizmet Sağlayıcı ve Elektronik Ticaret Hizmet Sağlayıcılar Hakkında Yönetmelik** (RG 29.12.2022, sayı 32058) [O].
- **Tanımlar [O]:**
  - **ETAHS (elektronik ticaret aracı hizmet sağlayıcı):** Başkalarına ait iktisadi ve ticari faaliyetlerin elektronik ticaret ortamında yapılmasına **aracılık hizmeti** sağlayan gerçek ve tüzel kişiler. Pazaryeri bunun tipik örneği.
  - **ETHS (elektronik ticaret hizmet sağlayıcı):** Elektronik ticaret ortamında mal veya hizmet satan gerçek ve tüzel kişiler, yani satıcı.
  - **Elektronik ticaret pazar yeri:** ETAHS'nin aracılık hizmeti sunduğu elektronik ticaret ortamı.

### 4.2 Biz ETAHS mıyız? Senaryo spektrumu

| Senaryo | Özellikler | Muhtemel nitelik [T] | Risk |
|---|---|---|---|
| **A. Saf SaaS (önerilen MVP)** | Her işletmenin kendi markalı vitrini (`isletme.siparisinonunde.com` veya işletmenin kendi alan adı). WhatsApp numarası işletmenin. Satış sözleşmesi işletme ile müşteri arasında. Fiyatı işletme belirler. Tahsilat işletmenin kendi POS/PSP hesabından. Biz sabit abonelik alırız | **Biz: yazılım/altyapı sağlayıcı.** E-ticaret altyapısı satan SaaS şirketlerinin modeline benzer. **İşletme: ETHS** | **Düşük** |
| **B. A + pasif dizin** | "Şehrindeki işletmeler" listesi. Her kart işletmenin kendi vitrinine veya WhatsApp'ına link verir. Sıralama nesnel ve ücretsiz. Ortak sepet, ortak hesap, ortak ödeme yok | **Gri alan.** "İlan/yönlendirme" savunusu var, ama "aracılık" unsuru tartışmaya açılır | **Orta** |
| **C. Pazaryeri özellikleri** | Ortak arama ve sepet, ortak müşteri hesabı, bizim markamızla sipariş, ortak ödeme (pazaryeri/alt üye işyeri), ücretli öne çıkarma, sipariş başı ücret | **ETAHS (pazaryeri)** | **Yüksek.** ETAHS yükümlülükleri, Nisan 2026 yemek sipariş kuralları [K02], müşteri verisinde VS rolü (§2.1) |

**Riski artıran sinyaller [T]:**
- Ortak tüketici hesabı ve uygulaması
- Sipariş ekranında bizim markamızın öne çıkması
- Ödeme ekranında veya kart ekstresinde bizim adımızın görünmesi
- Sipariş başı veya ciro yüzdesi ücret
- Görünürlük veya sıralama ücreti
- Müşteri şikâyetlerini bizim karşılamamız
- Fiyat veya kampanyayı bizim belirlememiz

**Senaryo A'yı güçlendiren önlemler [T]:**
- Vitrinin altbilgisinde şu beyan yer alsın: *"Bu sayfa [İşletme Unvanı] tarafından işletilmektedir. Siparişin Önünde yalnızca yazılım altyapısı sağlar."*
- İşletmenin künyesi vitrinde gösterilsin (§4.10).
- Ön bilgilendirme formu ve mesafeli satış sözleşmesi **işletme adına** düzenlensin.
- Ödeme işletmenin kendi hesabına alınsın.

### 4.3 Keşif / dizin sayfası

- MVP'de **olmasın.** [K02] de "bilinçli olarak pazaryeri olmamak" yönünde öneri yapmıştı.
- İleride yapılacaksa önce avukat görüşü alınmalı ve dizin **Senaryo B sınırlarında** tutulmalı [T]:
  - Yalnızca yönlendirme yapsın.
  - Sıralama ücretli olmasın.
  - Ortak sepet veya hesap olmasın.
  - Kişisel veri toplamasın.
  - Konum tabanlı arama cihazda veya anonim olarak yapılsın.

### 4.4 Nisan 2026 yemek sipariş düzenlemesi [K02]

[K02]'nin Ticaret Bakanlığı duyurusu ve hukuk notlarına dayanan özeti:
- Pazaryerleri restorandan tahsil ettikleri tüm bedelleri **hizmet kalemi bazında** göstermek zorunda.
- Aracılığın doğasında olan hizmetler (sipariş alma, iletme, ödeme, temel altyapı) için ayrı bedel alınamaz.
- Sırf kampanyaya katılım için ücret alınamaz.
- Komisyon, tüketicinin fiilen ödediği tutar üzerinden hesaplanır.
- Tüketiciye bilgilendirme yapılır.

Yürürlük tarihi konusunda çelişki var [K02, D?].

**Bizim için anlamı [T]:**
- Senaryo A'da bu kurallar doğrudan bize değil, pazaryerlerine uygulanır.
- Senaryo C'ye geçersek aynı kurallar bize de uygulanır. Bu, iş modelini (öne çıkarma ücreti vb.) kısıtlar.
- Pazarlamada fırsat: restoranın kalem kalem kesinti dökümü "komisyon hesaplayıcı"nın girdisi olabilir [K02].

### 4.5 E-ticaret lisansı eşikleri

- 7416 ile, **net işlem hacmi 10 milyar TL'yi aşan ETAHS'ler için lisans** zorunluluğu ve kademeli lisans ücretleri getirildi. Orta ve büyük ölçekli ETAHS'lere ek yükümlülükler (reklam/indirim finansmanı sınırları, veri kullanım kısıtları vb.) de getirildi [O].
- Eşikler her yıl yeniden değerlemeyle güncelleniyor. 2026 değerleri doğrulanamadı [D?].
- **Bizim için yıllarca ilgisiz** [T]. Senaryo A'da ETAHS değiliz; C'de bile eşikler milyar TL seviyesinde.

### 4.6 ETBİS (Elektronik Ticaret Bilgi Sistemi)

- Ticaret Bakanlığı'nın sistemi. ETHS ve ETAHS'lerin kayıt yükümlülüğü var [O].
- Kayıt e-Devlet üzerinden yapılır ve ücretsizdir. Kayıttan sonra sitede ETBİS karekodu gösterilir [O].
- Kayıt süresi (faaliyete başlamadan önce mi, belirli bir süre içinde mi) [D?].
- Yalnızca sosyal medya veya WhatsApp üzerinden satış yapanların kapsamda olup olmadığı [D?].
- ETBİS portalı: https://www.eticaret.gov.tr ; istatistik ve duyurular: https://etbis.ticaret.gov.tr [K02].

**Uygulama [T]:**
- **Biz:** Kendi abonelik satışımızı (B2B) sitemizden online yapıyoruz. Kayıt düşük maliyetli ve önerilir.
- **İşletmeler:**
  - Onboarding kontrol listesine "ETBİS kaydı" adımı eklenir, vitrin alan adıyla kayıt için bir rehber hazırlanır.
  - Panelde ETBİS karekodu yükleme alanı olur ve karekod vitrinin altbilgisinde gösterilir.
  - Kayıt zorunlu tutulmaz, ama eksikse uyarı verilir.

### 4.7 Mesafeli Sözleşmeler Yönetmeliği

**Dayanak:** Mesafeli Sözleşmeler Yönetmeliği (RG 27.11.2014, sayı 29188), 6502 sayılı Tüketicinin Korunması Hakkında Kanun (RG 28.11.2013, sayı 28835) [Y].

- **Kapsam dışı hali [O]:** "Yiyecek ve içecekler gibi günlük tüketim maddelerinin, satıcının **düzenli teslimatları** çerçevesinde tüketicinin meskenine veya işyerine götürülmesine ilişkin sözleşmeler."
  - Tek seferlik restoran siparişi için bu istisnaya **güvenmeyin** [T]. Büyük platformlar da ön bilgilendirme uyguluyor.
  - Düzenli su ve tüp teslimatı gibi abonelik tipi siparişlerde istisna gündeme gelebilir [T/D?].
- **Cayma hakkı istisnaları (m.15) [O]:**
  - çabuk bozulabilen veya son kullanma tarihi geçebilecek malların teslimi,
  - belirli bir tarihte veya dönemde yapılması gereken yiyecek-içecek tedariki.
  - **Sonuç:** Yemek siparişinde cayma hakkı yok, ama bu durum ön bilgilendirmede **belirtilmeli**.
- **Ön bilgilendirme içeriği (m.5) [O]:**
  - satıcının kimliği ve iletişim bilgileri,
  - malın temel nitelikleri,
  - vergiler dahil toplam fiyat,
  - teslimat masrafları,
  - ödeme ve teslimat bilgisi,
  - cayma hakkının bulunmadığı bilgisi,
  - şikâyet ve başvuru yolları.
- **Teyit [O]:**
  - Tüketici ön bilgilendirmeyi teyit etmeden sözleşme kurulmaz.
  - Sipariş butonu, siparişin **ödeme yükümlülüğü doğurduğunu** açıkça belirtmeli.
  - Sözleşme tüketiciye kalıcı veri saklayıcısıyla iletilmeli.

**WhatsApp'tan gelen sipariş için önerilen akış [T]:**
1. Müşteri serbest metinle yazar.
2. Bot veya kasiyer sepeti oluşturur.
3. WhatsApp'ta özet gönderilir: *"Sipariş özeti: … Toplam (KDV dahil): … Teslimat ücreti: … Ödeme: kapıda nakit/kart. Gıda siparişlerinde cayma hakkı yoktur. Ön bilgilendirme ve sözleşme: [link]"*. Altında bir buton olur: **[Onaylıyorum, siparişi ver (ödeme yükümlülüğü doğar)]**.
4. Onay kaydedilir: mesaj ID, zaman damgası, metin sürümü.
5. Onaylanan özet ve link WhatsApp sohbetinde kalır. Bunun "kalıcı veri saklayıcı" sayılıp sayılmayacağı gri alan [D?]. İhtiyatlı yol: e-posta verilmişse PDF'i e-postayla da göndermek.

**Kendi abonelik satışımız:** İşletmeler ticari amaçla hareket ettiği için 6502 anlamında tüketici değildir [O]. Mesafeli Sözleşmeler Yönetmeliği uygulanmaz, B2B click-wrap sözleşme yeterlidir [T].

### 4.8 Fiyat gösterimi, servis ücreti ve indirim duyuruları

- **Fiyat Etiketi Yönetmeliği:** Fiyat, **tüm vergiler dahil Türk lirası** olarak gösterilmeli. Bu kural internet satışlarında da geçerli [O].
- **Restoran ve kafelere özgü düzenleme [O/D?]:** 2024–2025 döneminde şu düzenlemelerin yapıldığı hatırlanıyor:
  - fiyat listelerinin işletme girişinde ve masalarda bulundurulması,
  - porsiyon/gramaj bilgisi,
  - **"servis ücreti", "kuver", "masa ücreti" gibi adlarla ek ücret alınamaması.**
  - Yayım tarihi, madde numarası ve karekod menülere ilişkin özel hüküm **doğrulanamadı**.
  - Bu kuralların **online menüleri** doğrudan kapsayıp kapsamadığı belirsiz [D?]. Online vitrinde genel internet satışı fiyat kuralları ile mesafeli satış kuralları zaten uygulanıyor [O].
- **Storefront kuralları [T]:**
  - Menü fiyatları KDV dahil gösterilir.
  - "Servis ücreti" türünden gizli ek kalem **olmaz**. Sistem bu tür kalem eklenmesine izin vermemeli.
  - Teslimat ücreti ve minimum sepet tutarı ön bilgilendirmede açıkça gösterilir.
  - Kapıda kartla ödemeye ek ücret konmamalı.
- **İndirim duyuruları [O/D?]:** Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği'nde (RG 10.01.2015) yapılan değişiklikle "indirim öncesi fiyat, son 30 gün içindeki en düşük fiyattır" kuralı getirildiği hatırlanıyor.
  - Ürün kuralı [T]: Panel fiyat geçmişini tutsun. "Üstü çizili fiyat" özelliği bu kurala göre otomatik hesaplansın ve manuel girilemesin.
- **Karşılaştırmalı reklam [O]:** "Yemeksepeti'nden %25 ucuz" gibi pazarlama iddiaları aynı Yönetmelik'teki karşılaştırmalı reklam şartlarına tabi: nesnel, ölçülebilir ve kötüleme içermeyen olmalı; rakip markanın kullanımına dikkat edilmeli. Web sitesi metinleri avukata gösterilmeli.

### 4.9 Satışı yasak veya kısıtlı ürünler ve gıda bilgileri

| Konu | Kural | Ürün aksiyonu [T] |
|---|---|---|
| Alkollü içkiler | İnternet üzerinden satış yasak (4250 sayılı Kanun'da 6487 sayılı Kanun ile 2013'te yapılan değişiklik) [O] | Kategori engeli. Market/şarküteri dikeyinde kritik |
| Tütün ürünleri | İnternet üzerinden satış yasak [O] | Kategori engeli |
| İlaç | Eczane dışında satış yasak [Y] | Kategori engeli |
| Meta Commerce Policy | Alkol, tütün, ilaç, silah vb. yasak [K01/O] | Aynı engel, hem WhatsApp hem vitrin için |
| Gıda işletmesi kaydı | 5996 sayılı Kanun'a göre gıda işletmeleri kayıt/onay belgesine sahip olmalı [O]. Online satışta işletme kayıt numarasının gösterilmesi zorunluluğu [D?] | Onboarding'de "İşletme kayıt no" alanı (opsiyonel, önerilen), vitrinde gösterim |
| Alerjen ve gıda bilgisi | Türk Gıda Kodeksi Gıda Etiketleme ve Tüketicinin Bilgilendirilmesi Yönetmeliği (2017). Uzaktan satışta zorunlu bilgilerin satın alma öncesinde sunulması ve ambalajsız gıdada alerjen bilgisi [O/D?] | Menü ürünlerinde alerjen etiketleri (14 ana alerjen), gramaj/porsiyon alanı |
| Tüp gaz (LPG) | EPDK lisanslı bayilik ve teslimat kuralları [D?] | Dikey genişlemede ayrıca araştırılmalı |
| Taksit | Gıda ve yemek harcamalarında kredi kartıyla taksit yapılamaz (BDDK düzenlemesi) [O] | Online ödemede taksit kapalı |

### 4.10 Site künyesi ve 5651 sayılı Kanun

- **6563 m.3:** Hizmet sağlayıcı şu bilgileri sitede kolay erişilebilir şekilde yayımlamalı [O]: unvan, MERSİS numarası, adres, e-posta ve telefon, meslek odası, vergi numarası.
  - **Bizim sitemizde:** Kendi bilgilerimiz.
  - **Vitrinde:** İşletmenin bilgileri. Onboarding'de zorunlu alanlar: unvan veya ad-soyad, adres, telefon, VKN/TCKN, varsa MERSİS numarası.
- **5651 sayılı Kanun** [O]:
  - İçerik, yer ve erişim sağlayıcılar tanıtıcı bilgilerini sitede bulundurur.
  - İşletmelerin içeriğini (menü, fotoğraf) barındırdığımız için **yer sağlayıcı** sayılabiliriz. Hukuka aykırı içerik bildirildiğinde kaldırma yükümlülüğü doğar.
  - Trafik bilgisi 1–2 yıl saklanır.
  - Ürün aksiyonu [T]: İçerik bildirim formu ve admin panelinde "içeriği yayından kaldır" aracı.

---

## 5. Online Ödeme (İşletmeler Adına)

### 5.1 6493 sayılı Kanun çerçevesi: neden tahsilat yapamayız?

- **Dayanak:** 6493 sayılı Ödeme ve Menkul Kıymet Mutabakat Sistemleri, Ödeme Hizmetleri ve Elektronik Para Kuruluşları Hakkında Kanun (RG 27.06.2013, sayı 28690) [Y].
  - **Ödeme hizmeti** olarak sayılan faaliyetler: ödeme hesabı işlemleri, ödeme işleminin gerçekleştirilmesi, ödeme aracının ihracı veya **kabulü**, para havalesi, ödeme emri başlatma, hesap bilgisi hizmeti vb. [Y/O].
  - Bu hizmetler yalnızca izinli kuruluşlarca sunulabilir. Yetkili kurum 7192 sayılı Kanun ile 01.01.2020'den itibaren **TCMB** [O].
  - İzinsiz ödeme hizmeti için **hapis ve adli para cezası** öngörülüyor [O].
- **Pratik sonuç [T]:** Müşteri ödemelerini **bizim** banka hesabımızda toplayıp sonra işletmelere dağıtmak lisanssız ödeme hizmeti riski taşır. Kanundaki "ticari temsilci" gibi istisnalar dar yorumlanır [O/D?].
- **Kural:** Müşteri parası **ya doğrudan işletmenin hesabına ya da lisanslı bir ödeme kuruluşunun pazaryeri yapısına** gider. Bizim hesabımıza hiçbir zaman girmez.

### 5.2 Model karşılaştırması

| Model | Nasıl çalışır | Artı | Eksi | Öneri |
|---|---|---|---|---|
| **M0. Kapıda ödeme** | Nakit veya işletmenin kendi banka POS'u, ÖKC-POS'u, yemek kartı cihazı. Panel yalnızca ödeme yöntemini kaydeder | Sıfır regülasyon yükü, sıfır entegrasyon. Esnafın alışık olduğu yöntem | Online ödeme yok, iptal/"gelmedi" riski | **MVP** |
| **M1. İşletme kendi PSP hesabını bağlar** | İşletme PayTR veya iyzico gibi bir ödeme kuruluşundan üye işyeri hesabı açar. API anahtarlarını panele girer (bizde şifreli saklanır). Sipariş başına ödeme linki veya iframe oluşturulur | Para doğrudan işletmeye gider. "Komisyonsuz" iddiası korunur. KYC ve ters ibraz (chargeback) PSP ile işletme arasında kalır | İşletme ayrıca başvuru yapar (sürtünme). Her PSP için ayrı entegrasyon | **Faz 2** |
| **M2. Pazaryeri / alt üye işyeri** | Biz lisanslı kuruluşta "pazaryeri üye işyeri", işletmeler "alt üye işyeri" oluruz. Ödeme kuruluşu parayı tutar, hakedişi işletmeye aktarır, isteğe bağlı olarak bize platform payı ayırır | Tek entegrasyon, tek onboarding akışı, platform payı alma imkânı | ETAHS görüntüsü güçlenir (§4.2). "Komisyonsuz" algısı zedelenir [K02]. Alt üye işyeri riskinin bir kısmı ve ters ibraz süreçleri bize yansır. Kuruluşun pazaryeri onayı gerekir | Yalnızca strateji değişirse |
| **M3. Kendi ödeme lisansımız** | TCMB'den ödeme kuruluşu izni almak | — | Sermaye, yerelleştirme, denetim, yıllar süren bir iş | **Hayır** |

### 5.3 Ödeme sağlayıcıları

> **Önemli:** Güncel komisyon oranları, sabit ücretler ve valör seçenekleri **bu oturumda doğrulanamadı**. Genel piyasa gözlemi olarak, ödeme kuruluşlarının tek çekim oranları banka POS'una göre daha yüksektir ve hacim ile valör pazarlığına açıktır [T]. [K02] abonelik tahsili için %2–3 tahmini kullanmıştı [T]. Karar öncesi **en az 3 sağlayıcıdan yazılı teklif** alınmalı.

| Sağlayıcı | Lisans / tür | İlgili ürünler | Entegrasyon | Not |
|---|---|---|---|---|
| **iyzico** | Lisanslı ödeme kuruluşu [O] | Sanal POS / Checkout Form, **Pazaryeri** (alt üye işyeri, ürün bazında alt üye işyeri tutarı, hakediş onayı) [O; K02: https://docs.iyzico.com/urunler/pazaryeri], **Abonelik API'si** [O], ödeme linki [O], iyzico cüzdanı | Çok dilde resmi SDK, sandbox [O]. Kolay | Alt üye işyeri tipleri: `PERSONAL`, `PRIVATE_COMPANY`, `LIMITED_OR_JOINT_STOCK_COMPANY` [O]. Tüketici tarafında marka bilinirliği yüksek |
| **PayTR** | Lisanslı ödeme kuruluşu [O] | iFrame API (token), Direkt API, **Link API**, **Kart Saklama** ve tekrarlayan ödeme, pazaryeri / platform transfer [O] | Basit token + hash yapısı, PHP ağırlıklı örnekler [O]. Kolay | Küçük işletme onboarding'i hızlı olarak bilinir [O/D?] |
| **Param** (TURK Elektronik Para) | Elektronik para kuruluşu [O] | ParamPOS, tekrarlı ödeme ve kart saklama [D?], pazaryeri [D?] | Tarihsel olarak **SOAP** tabanlı API [O]. Orta | Fiyat [D?] |
| **Sipay** | Elektronik para ve ödeme kuruluşu [O] | Sanal POS, ödeme linki, pazaryeri [D?] | REST [O]. Orta | Fiyat [D?] |
| **Paynet** | Ödeme kuruluşu [O] | B2B bayi tahsilatı ile bilinir, sanal POS, pazaryeri [D?] | REST [O] | B2B odağı güçlü [O] |
| **Moka United** | Ödeme ve e-para kuruluşu, İş Bankası iştiraki [O] | Sanal POS, bayi/pazaryeri yapısı [D?] | REST [O] | Fiyat [D?] |
| **Papara** | Elektronik para kuruluşu [O] | Cüzdan ile öde, işletme hesapları | — | **Kurumsal risk:** Mayıs 2025'te kurucusuna yönelik soruşturma ve şirkete TMSF'nin kayyum olarak atandığı haberleri çıktı [O, haber; teyit edilmeli]. Kritik bağımlılık yaratmayın |
| **Craftgate** | Ödeme orkestrasyonu. Kendi lisans durumu [D?] | Birden çok banka POS'u ve ödeme kuruluşunu tek API'de toplama, akıllı yönlendirme, **pazaryeri** (alt üye işyeri, hakediş), kart saklama ve tekrarlayan ödeme, ortak ödeme sayfası [O] | Modern REST, çoklu SDK [O]. Kolay | Faz 3'te "işletme hangi POS'u kullanıyorsa bağlasın" ihtiyacına en uygun aday [T]. Fiyat [D?] |
| **Doğrudan banka sanal POS'u** (Garanti, İş, Yapı Kredi, Akbank vb.) | Banka | 3D Secure sanal POS (Nestpay, Posnet vb. altyapılar) [O] | Her banka için ayrı entegrasyon [O]. Zor | Oran genelde daha düşük ama çok kiracılı SaaS için ağır. Orkestrasyon (Craftgate) üzerinden desteklenebilir [T] |
| **Stripe** | — | — | — | **Türkiye'de yerleşik şirketlere hizmet vermiyor** [O] |

**M1 için önerilen sıra [T]:** Önce **PayTR** (ödeme linki ve iframe, küçük işletmede yaygın), ardından **iyzico** (SDK kalitesi, marka). Bu tercih teklif ve pilot işletme tercihleriyle doğrulanmalı. Faz 3'te "istediğin POS'u bağla" ihtiyacı için **Craftgate**.

**M1 teknik gereksinimler [T]:**
- API anahtarları tenant bazında, KMS/HSM ile şifreli saklanır.
- Callback/webhook imzası tenant anahtarıyla doğrulanır.
- İdempotent sipariş-ödeme eşleşmesi sağlanır.
- Ödeme linki WhatsApp'ta CTA URL butonuyla gönderilir [K01].
- İade (refund) API'si panelden tetiklenir.
- **Kart verisine asla dokunulmaz:** Yalnızca PSP'nin barındırdığı sayfa veya iframe kullanılır. Bu, PCI DSS kapsamını SAQ-A seviyesinde tutar [O].

### 5.4 Alt üye işyeri ve üye işyeri onboarding belgeleri

Bilgiler genel piyasa uygulamasına dayanıyor [O/D?]. Her sağlayıcının güncel listesi ayrıca alınmalı.

| İşletme tipi | Tipik istenenler |
|---|---|
| Şahıs işletmesi (esnaf, gerçek kişi tacir) | Kimlik, TCKN/VKN, **vergi levhası**, işletme adına veya kişinin kendi adına IBAN, adres, telefon, (gerekirse) web sitesi veya vitrin linki |
| Basit usul esnaf | Vergi kaydı var ama bazı sağlayıcılar kabul etmeyebilir veya limit koyabilir [D?] |
| Limited / Anonim şirket | Vergi levhası, ticaret sicil gazetesi, imza sirküleri, yetkili kimliği, şirket IBAN'ı, MERSİS numarası, faaliyet belgesi |
| Vergi kaydı olmayan (esnaf muaflığı) | Genelde online ödeme hesabı açılamaz [O/T] |

**Ürün aksiyonu [T]:** Vitrinin PSP başvurusunda istenen zorunlu sayfaları (künye, iletişim, gizlilik, mesafeli satış, iade/iptal, teslimat) **otomatik üretmesi** işletmenin PSP onayını hızlandırır. Bu bir satış argümanıdır.

### 5.5 Kapıda nakit, kart ve yemek kartları

- **Nakit ve kart:** Kart ödemesinde işletmenin kendi banka POS'u veya ÖKC-POS cihazı kullanılır. Panel yalnızca "ödeme yöntemi" ve "tahsil edildi" durumunu kaydeder [T].
- **Yemek kartları:** Multinet, **Pluxee** (Sodexo Türkiye'nin 2024'teki yeni markası [O]), Edenred (Ticket Restaurant), Setcard, Metropol.
  1. **Kapıda:** İşletme her markayla **ayrı üye işyeri sözleşmesi** yapar ve fiziki veya mobil POS kullanır. Kurye bu cihazla tahsil eder [O].
  2. **QR / uygulama ile ödeme:** Markaların uygulamalarında karekodla ödeme var [O/D?]. Kapıda "karekodu okut" akışı mümkün olabilir.
  3. **Online:** Büyük platformlar markalarla doğrudan API ortaklığıyla online yemek kartı ödemesi alıyor [O]. Küçük bir SaaS için **her markayla ayrı iş ortaklığı** gerekir ve işletmenin o markanın online üye işyeri olması şarttır. Yemek kartlarını toplu sunan bir ödeme kuruluşu veya entegratör var mı [D?].
- **Öneri [T]:**
  - MVP: vitrinde "Kapıda ödeme: Nakit / Kart / Multinet / Pluxee / Edenred / Setcard / Metropol" seçimi (işletme hangilerini kabul ettiğini işaretler). Bu seçim kuryenin doğru cihazı almasını sağlar.
  - Online yemek kartı: Faz 3, en az 1–2 marka ile görüşmeden sonra.
- **Regülasyon:** Yemek kartı komisyonları ve rekabet incelemeleri gündemde. Rekabet Kurulu'nun yemek kartı şirketlerine yönelik bir inceleme veya soruşturma yürüttüğü ve komisyon tavanı tartışmaları olduğu hatırlanıyor [D?]. Güncel durum teyit edilmeli.

### 5.6 Belge düzeni (fiş/fatura): işletmenin yükümlülüğü, ürünün vaadi

- Satış belgesini (ÖKC fişi veya fatura/e-Arşiv) düzenlemek **işletmenin** yükümlülüğü [Y].
- Gri alan: İnternet üzerinden (özellikle online ödemeli) satışlarda satış belgesi olarak **fatura/e-Arşiv** gerektiği, ÖKC fişinin yeterli olmayabileceği hatırlanıyor. İnternet satışı yapanlar için daha düşük e-Arşiv/e-Fatura geçiş eşikleri de hatırlanıyor [O/D?]. WhatsApp siparişi + kapıda ödeme durumunun "internet satışı" sayılıp sayılmadığı belirsiz [D?].
- **Öneri [T]:**
  - Pazarlama metinlerinde "fatura/fiş derdi yok" gibi bir vaatte bulunulmamalı.
  - Mali müşavirle bir "işletme belge rehberi" hazırlanmalı.
  - Faz 3: İşletme adına e-Arşiv düzenleme entegrasyonu (entegratörün çok kiracılı veya bayi API'si ile).

---

## 6. Kendi SaaS Abonelik Tahsilatımız ve Faturalama

### 6.1 Tekrarlayan ödeme seçenekleri

| Seçenek | Model | Artı | Eksi |
|---|---|---|---|
| **iyzico Abonelik API'si** [O] | Ürün → fiyat planı → abonelik. Otomatik çekim ve yeniden deneme, kart güncelleme formu | Hazır abonelik mantığı, az kod | Ayrı aktivasyon ve sözleşme gerekebilir [D?]. Plan ve fiyat değişikliklerinde esneklik sınırlı olabilir [D?]. Satıcıya bağımlılık |
| **PayTR Kart Saklama + tekrarlayan ödeme** [O] | Kart tokenı saklanır, çekimi bizim zamanlayıcımız tetikler | Faturalama mantığı tamamen bizde, taşınabilir | Yeniden deneme ve dunning'i biz yazarız |
| **Craftgate** [O] | Kart saklama, tekrarlayan ödeme, birden çok POS'a yönlendirme | Başarısız çekimde alternatif POS'a düşme imkânı | Ek katman, fiyat [D?] |
| **Param / Sipay / Paynet** | Kart saklama ve tekrarlı ödeme [D?] | — | Teyit edilmeli |
| **Paddle / Lemon Squeezy** (Merchant of Record) | Yurt dışı satıcı olarak tahsil eder | — | TL ve e-Fatura düzeninde B2B faturalama için uygun değil. Esnaf yurt dışı fatura istemez [T] |

- **Dikkat (3D Secure):** Türkiye'de ilk işlemde 3D Secure zorunlu. Sonraki "merchant-initiated" (üye işyeri başlatmalı) çekimler için sağlayıcıdan non-3D yetkisi veya abonelik ürünü gerekebilir [O/D?]. Sağlayıcı seçiminde **ilk soru** bu olmalı.
- **Öneri [T]:** Faturalama motorunu kendimiz yazalım (planlar, kıst hesabı/proration, kupon, deneme süresi, fatura durumu). Kart tokenlaması ve çekim için **tek bir PSP** kullanalım: M1'de hangi PSP entegre ediliyorsa o (PayTR veya iyzico). Böylece faturalama mantığı PSP'den bağımsız kalır.

### 6.2 Başarısız ödeme (dunning) tasarımı [T]

| Gün | Aksiyon |
|---|---|
| G0 | Çekim başarısız → e-posta + WhatsApp (utility) + panel içi uyarı: "Kartınızı güncelleyin" |
| G+1, G+3, G+5 | Otomatik yeniden deneme. Günün farklı saatlerinde (maaş, limit etkisi) |
| G+7 | Panelde kırmızı bant. "Havale ile öde" seçeneği gösterilir |
| G+10 | **Kısıtlı mod:** Sipariş almaya devam edilir (işletmenin cirosunu kesmemek için), ama raporlama, kampanya ve yeni kullanıcı ekleme kapanır |
| G+14 | Askıya alma: vitrin "geçici olarak kapalı" olur, WhatsApp otomasyonu durur. Veri korunur |
| G+45 | Fesih bildirimi. Sözleşmedeki veri dışa aktarma süresi başlar (§2.2 madde 10) |

- **Önemli [T]:** Askıya alma, işletmenin son müşteriye verdiği hizmeti ve dolayısıyla itibarını etkiler. Süreler sözleşmede açık yazılmalı.

### 6.3 Havale/EFT

- Yıllık peşin planlarda havale/EFT sunulmalı. [K02]'nin önerdiği yıllık indirimle birlikte düşünülebilir.
- Her fatura için benzersiz bir **ödeme referans kodu** üretilmeli (örneğin `SO-2026-000123`). Açıklamada bu kod aranır.
- MVP'de eşleştirme admin panelinden elle yapılır. Ölçekte banka hesap hareketleri API'si veya açık bankacılık hizmeti ile otomatik eşleştirme [D?].

### 6.4 e-Fatura / e-Arşiv

**Zorunluluk:**
- e-Fatura ve e-Arşiv geçiş zorunluluğu VUK Genel Tebliğleri (özellikle 509 sıra no'lu tebliğ ve değişiklikleri) ile belirleniyor. Genel hasılat eşiği ve internet satışı yapanlar için ayrı ve daha düşük bir eşik olduğu hatırlanıyor [O/D?]. Güncel eşikler mali müşavirle teyit edilmeli.
- **Gönüllü geçiş** her zaman mümkün [O].
- e-Fatura mükellefi olan bir alıcıya e-Fatura, olmayana e-Arşiv düzenlenir. Alıcının durumu GİB kayıtlı kullanıcı listesinden sorgulanır; entegratörler bunu API ile sunar [O].
- e-Fatura'ya geçişin e-Defter yükümlülüğünü de tetikleyip tetiklemediği [O/D?] — mali müşavire sorulacak.
- **Başlangıç seçeneği:** GİB'in e-Arşiv Portalı ücretsiz ama API'si yok, elle kullanılır [O]. İlk 10–20 müşteri için geçici çözüm olabilir. Resmi olmayan portal otomasyon kütüphaneleri **kullanılmamalı** [T].

**Entegratör ve ön muhasebe seçenekleri** (fiyatlar **doğrulanamadı**; tamamı [D?]):

| Sağlayıcı | Tür | API | Değerlendirme [O/T] |
|---|---|---|---|
| **Paraşüt** | Ön muhasebe + e-Fatura/e-Arşiv (özel entegratör altyapısıyla) | REST API v4 (JSON:API, OAuth2), dokümantasyon: https://apidocs.parasut.com [O] | Startup'lar ve mali müşavirlerle yaygın kullanılıyor. Fatura, cari, tahsilat ve muhasebe tek yerde. **MVP için en hızlı yol.** API erişiminin hangi pakette olduğu ve istek limitleri [D?] |
| **Nilvera** | GİB özel entegratörü | REST, geliştirici dostu olarak bilinir [O] | Ölçekte doğrudan entegratör adayı |
| **QNB eSolutions** (eski QNB eFinans) | Özel entegratör | SOAP/REST [O] | Kurumsal ve güvenilir. Küçük hacimde pahalı olabilir [D?] |
| **Uyumsoft** | Özel entegratör, ERP | SOAP ağırlıklı [O] | Köklü sağlayıcı |
| **Sovos** (Foriba'yı satın aldı) | Global e-fatura uyumu | Kurumsal API [O] | Bizim ölçek için ağır ve pahalı [T] |
| **Logo** (e-Logo, İşbaşı) | ERP / ön muhasebe + entegratör | API [O/D?] | Logo ekosistemi kullanan işletmeler için entegrasyon fırsatı |
| **BizimHesap** | Ön muhasebe + e-Fatura | API kapsamı [D?] | Küçük işletme odaklı |
| **Birfatura** | e-Fatura/e-Arşiv, e-ticaret ve pazaryeri entegrasyonları | API [D?] | E-ticaret satıcısı odaklı |
| Diğer özel entegratörler (İzibiz, EDM, Digital Planet, Veriban, Turkcell e-Şirket, Mysoft vb.) | Özel entegratör | Değişken | GİB özel entegratör listesinden teyit edilmeli |

### 6.5 Önerilen fatura akışı [T]

1. Ödeme başarılı olur, PSP webhook'u gelir.
2. Faturalama motoru faturayı oluşturur (plan, dönem, KDV %20).
3. Paraşüt API'de satış faturası oluşturulur ve resmileştirilir: alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv.
4. PDF veya link işletmeye e-posta ve panel üzerinden iletilir. İstenirse WhatsApp utility mesajı da gönderilebilir.
5. Tahsilat Paraşüt'te faturaya işlenir. Mali müşavir aynı sistemi görür.
6. Havale/EFT ödemesinde admin "ödendi" işaretler, aynı akış 2. adımdan devam eder.
7. İade veya iptalde iade faturası süreci mali müşavirle tanımlanır.

---

## 7. Şirket Kurulumu, Marka ve Sözleşmeler

### 7.1 Limited mi, anonim mi?

| Konu | Limited (Ltd) | Anonim (AŞ) |
|---|---|---|
| Asgari sermaye | **50.000 TL** (01.01.2024'ten itibaren) [O] | **250.000 TL** [O] |
| Sermaye ödemesi | Tescilden sonra 24 ay içinde [O] | Tescilden önce en az 1/4'ü, kalanı 24 ay içinde [O] |
| Pay devri | Noter onaylı yazılı sözleşme, genel kurul onayı ve tescil gerekir. **Yatırım turlarında hantal** [O] | Nama yazılı paylarda ciro, teslim ve pay defterine kayıt. **Yatırım ve hisse opsiyonu için daha uygun** [O] |
| Tek kişiyle kuruluş | Mümkün [O] | Mümkün [O] |
| Kuruluş ve işletim maliyeti | Daha düşük | Daha yüksek. Belirli bir sermaye eşiğinin üzerinde sözleşmeli avukat bulundurma zorunluluğu var (Avukatlık Kanunu m.35), eşik [D?] |
| Tür değiştirme | Ltd'den AŞ'ye geçiş mümkün (TTK tür değiştirme hükümleri) [O] | — |

**Öneri [T]:** Önümüzdeki 12–18 ayda melek yatırımcı veya fon görüşmesi olasıysa **AŞ.** Tamamen kendi kaynaklarla ilerlenecekse **Ltd**, sonra tür değiştirme.

Her iki durumda da yapılması gerekenler:
- Kurucular arası **pay sahipleri sözleşmesi** (vesting, ayrılan kurucunun payları, rekabet yasağı).
- Kurucu ve dış geliştiricilerden şirkete **fikri hak devri**. FSEK'e göre çalışanın eserinde mali haklar işverene geçer, ancak kurucu veya serbest çalışan için yazılı devir sözleşmesi gerekir [O].

### 7.2 Kurulum ve operasyon belgeleri (ödeme kuruluşu, Meta ve ETBİS için)

- **Kuruluş:** Ticaret sicil tescili, MERSİS numarası, ticaret sicil gazetesi, imza sirküleri, vergi levhası, faaliyet belgesi [Y].
- **Faaliyet kodu:** Bilgisayar programlama ve yazılım yayımcılığı veya veri işleme/barındırma NACE kodları. Mali müşavirle seçilmeli [O].
- **Banka ve tebligat:** Şirket banka hesabı ve IBAN. **e-Tebligat** adresi, sermaye şirketleri için zorunlu [O]. KEP opsiyonel [O/D?]. Yetkili için e-imza.
- **Ödeme kuruluşu başvurusu için sitede bulunması gerekenler [O]:** künye, iletişim, gizlilik ve aydınlatma, abonelik ve mesafeli hizmet sözleşmesi, iptal/iade koşulları, "hizmetin ifası" açıklaması, SSL.
- **Meta Business Verification:** Unvan ve adresi gösteren resmi belgeler (vergi levhası, ticaret sicil gazetesi, fatura vb.) [O]. Takvimdeki kritik yol bu, hemen başlatılmalı [K01].
- **ETBİS kaydı** (§4.6).

### 7.3 Teşvikler

- **Teknoloji Geliştirme Bölgesi (Teknokent), 4691 sayılı Kanun:**
  - Bölgede geliştirilen yazılım kazancına **kurumlar vergisi istisnası** (31.12.2028'e kadar) [O].
  - Personel ücretlerinde gelir vergisi ve SGK teşvikleri [O].
  - **KDV Kanunu geçici m.20:** Teknokentte üretilen belirli yazılım teslim ve hizmetlerinde (iş uygulamaları, internet ve mobil yazılımlar dahil) **KDV istisnası** [O]. SaaS aboneliğine uygulanıp uygulanmadığı özelgelere göre değişebilir [D?].
  - **Önemi [T]:** KDV istisnası uygulanabilirse, KDV'yi indiremeyen basit usul esnaf için fiyatımız fiilen %20 düşer. Ciddi bir rekabet avantajı olabilir.
- **TÜBİTAK BiGG, KOSGEB girişimci destekleri:** Güncel çağrılar [D?].

### 7.4 Marka tescili: kontrol yöntemi

**Dayanak:** 6769 sayılı Sınai Mülkiyet Kanunu (RG 10.01.2017) [Y].

**Kontrol adımları [O/T]:**

1. **TÜRKPATENT çevrimiçi marka araştırması** (https://www.turkpatent.gov.tr, "Araştırma" bölümü) ve **EPATS** (https://epats.turkpatent.gov.tr, e-Devlet ile giriş).
   - Aranacak ifadeler: "Siparişin Önünde", "Sipariş Önde", "Siparişönünde", "Önde Sipariş". Ayrıca "sipariş" ve "önünde/önde" unsurları ayrı ayrı. Sesli benzerlik ve farklı yazımlar (ş/s, ü/u) da kontrol edilmeli.
2. **Sınıflar (Nice) [O/T]:**
   - 9: yazılım
   - 35: işletme yönetimi, reklam, çevrimiçi sipariş aracılığı
   - 38: telekomünikasyon ve mesajlaşma
   - 42: SaaS / yazılım hizmetleri
   - Kurye hizmeti eklenirse 39 (teslimat).
   - 43 (restoran hizmetleri) bize ait değil.
3. **Tanımlayıcılık riski [T]:** "Sipariş" kelimesi bu sınıflarda tanımlayıcı. Bütün olarak ayırt edicilik tartışılabilir. **Kelime + logo** birlikte başvuru ve ayırt edici bir logo önerilir. Bir marka vekiliyle "tescil edilebilirlik" görüşü alınmalı.
4. **Süreç:** Başvurudan sonra bültende yayım ve **2 ay itiraz süresi** [O]. Toplam süre birkaç aydan bir yıla kadar uzayabilir [O/D?]. Resmi ücretler TÜRKPATENT tarifesinden alınmalı [D?].
5. **Yan kontroller:**
   - Alan adları: .com ve .com.tr. TRABİS ile 2022'den beri .com.tr belgesiz alınabiliyor [O].
   - Sosyal medya kullanıcı adları.
   - WhatsApp görünen adı (Meta display name kuralları) [K01].
   - Ticaret unvanı çakışması: MERSİS ve Ticaret Sicil Gazetesi araması.
   - Uluslararası: WIPO Global Brand Database.
6. **Öneri [T]:** Marka başvurusu **ürün adı kamuya duyurulmadan önce** yapılmalı. Başvuru tarihi öncelik sağlar.

### 7.5 Sözleşme ve politika seti

| # | Belge | Taraflar / kim adına | MVP öncesi? | Ana başlıklar [T] |
|---|---|---|---|---|
| 1 | **İşletme Abonelik Sözleşmesi** (B2B SaaS, click-wrap) | Biz ↔ İşletme | **Evet** | Hizmet kapsamı, paketler, ücret ve **fiyat endeksleme** (TÜFE/kur; Meta maliyetleri USD), ödeme ve dunning, askıya alma, fesih, veri dışa aktarma, hizmet seviyesi (hedef, taahhüt değil), sorumluluk sınırı, **Meta/WhatsApp şartlarına uyum yükümlülüğü** (WhatsApp Business ve Commerce Policy), içerik sorumluluğu (menü, fiyat, alerjen, görseller), İYS/ETK sorumluluğu, üçüncü taraf ödeme kuruluşu ilişkisi, yetkili mahkeme |
| 2 | **Veri İşleme Sözleşmesi (DPA)** + alt işleyen listesi + güvenlik eki | Biz (Vİ) ↔ İşletme (VS) | **Evet** | §2.2 |
| 3 | **Kurumsal Aydınlatma Metni + Gizlilik Politikası** | Biz (VS) | **Evet** | §2.4-A |
| 4 | **Çerez Politikası + rıza paneli** | Biz (sitemiz). Vitrinde işletme adına | **Evet** | §2.13 |
| 5 | **Son Müşteri Aydınlatma Metni şablonu** | İşletme (VS) adına | **Evet** | §2.4-B. Yurt dışına aktarım bölümü dahil |
| 6 | **Ön Bilgilendirme Formu + Mesafeli Satış Sözleşmesi şablonu** | İşletme ↔ Son müşteri | **Evet** | §4.7. Cayma istisnası, teslimat ücreti, ödeme |
| 7 | **Vitrin Kullanım Koşulları** | İşletme adına, bizim rol beyanımızla | **Evet** | "Satıcı işletmedir, Siparişin Önünde altyapı sağlayıcıdır" |
| 8 | **Site künyesi** (bizim ve vitrin için) | — | **Evet** | §4.10 |
| 9 | **Veri İhlali Müdahale Planı** (iç doküman) | Biz | **Evet** | §2.8 |
| 10 | **Saklama ve İmha Politikası** (iç doküman) | Biz | **Evet** (iyi uygulama) | §2.7 |
| 11 | **Standart sözleşmeler (KVKK m.9)** + Kurum'a bildirim kayıtları | Biz / işletme ↔ yurt dışı alt işleyen | Yurt dışı alt işleyen varsa **evet** | §2.10–2.11 |
| 12 | **ETK onay metni** (WhatsApp/SMS/e-posta) | İşletme adına | Kampanya modülüyle birlikte (Faz 2) | §3.4 |
| 13 | **Pazarlama/profilleme açık rıza metni** | İşletme adına | Faz 2 | §2.5 |
| 14 | **Bayi / referans sözleşmesi** | Biz ↔ Bayi | Faz 2 | Komisyon, stopaj, müşteri sahipliği, KVKK |
| 15 | **Pay sahipleri sözleşmesi + fikri hak devirleri** | Kurucular, geliştiriciler | **Evet** | §7.1 |
| 16 | **Personel gizlilik ve KVKK taahhütnameleri** | Biz ↔ Çalışan | **Evet** | Erişim yetkisi ve ihlalde yaptırım |

---

## 8. Vergi (maliyet planlaması)

### 8.1 KDV oranları

- **Genel oran %20:** 10.07.2023'ten itibaren Cumhurbaşkanı Kararı ile %18'den %20'ye çıktı [O]. **SaaS aboneliğimiz %20 KDV'ye tabi** [Y/O], Teknokent istisnası uygulanmıyorsa (§7.3).
- **Restoran ve yemek hizmetleri %10** [K02/O]. Bu işletmenin konusu, bizi doğrudan ilgilendirmiyor.
- **Esnafın gerçek maliyeti:**
  - KDV mükellefi işletme, faturamızdaki KDV'yi indirebilir.
  - **Basit usul esnaf KDV indiremez.** Basit usul kazanç istisnası nedeniyle gideri kazançtan da düşemez [O]. Onun için gerçek maliyet **KDV dahil fiyattır.**
  - Fiyat sayfası KDV hariç ve KDV dahil tutarı birlikte göstermeli [K02].

### 8.2 Yurt dışından alınan hizmetlerde sorumlu sıfatıyla KDV

- **Dayanak:** KDV Kanunu m.9 [Y]. Türkiye'de işyeri olmayan yabancı sağlayıcıdan alınan hizmetlerde (AWS/GCP, Meta, Anthropic/OpenAI API, GitHub, Google Workspace, Figma, Sentry vb.) **KDV'yi alıcı hesaplar ve 2 No'lu KDV beyannamesiyle beyan edip öder** [Y].
  - Beyan ve ödeme süresi: izleyen ayın 28'i [O].
  - Ödenen bu KDV, KDV mükellefi olan şirket için **ödendiği dönemin 1 No'lu beyannamesinde indirilebilir** [O].
- **Etkisi [T]:** Net vergi yükü sıfıra yakın, ama **yaklaşık 1 ay nakit akışı etkisi** var. Ayrıca beyanname ve operasyon yükü getirir. Yurt dışı gider kalemleri aylık olarak mali müşavire raporlanmalı.
- **WhatsApp mesaj ücretleri [K01/T]:**
  - **Tech Provider modelinde** Meta, işletmeden doğrudan USD olarak tahsil eder. Sorumlu sıfatıyla KDV yükümlülüğü **işletmeye** düşer.
  - Basit usul esnaf KDV mükellefi değildir. Bu durumda Meta'nın faturasına KDV ekleyip eklemediği (yabancı elektronik hizmet sağlayıcıların tüketiciye yönelik KDV rejimi) ve esnafın bir yükümlülüğü olup olmadığı **doğrulanamadı** [D?].
  - Bu, onboarding'de esnafa anlatılması gereken bir konu ve mali müşavire sorulacak.
- **Solution Partner / kredi hattı modelinde:**
  - Meta veya partner **bize** fatura eder. Yurt dışı partnerse sorumlu sıfatıyla KDV bizde doğar.
  - İşletmeye mesaj kredisi satarken **%20 KDV'li fatura** keseriz [O/T].
  - Kur farkı ve fiyat güncelleme mekanizması gerekir [K02].
- **Dijital hizmet vergisi:** Bazı global platformlar Türkiye'deki faturalarına DHV yansıtması ekleyebiliyor [D?]. Meta faturalarında bu kalem olup olmadığı teyit edilmeli.

### 8.3 Stopaj riski (yurt dışı yazılım ödemeleri)

- **KVK m.30:** Dar mükellef kurumlara ödenen **gayrimaddi hak bedelleri** (yazılım lisansı gibi) için **%20 stopaj** öngörülüyor [O]. Çifte vergilendirmeyi önleme anlaşmasıyla indirilebilir; bunun için karşı tarafın mukimlik belgesi gerekir [O].
- **Gri alan:** SaaS, bulut ve API kullanımı çoğu yorumda "hizmet" sayılır. Yurt dışında ifa edilen hizmet stopaja tabi olmayabilir. Ancak GİB özelgeleri farklı yönlerde [O/D?].
- **Öneri [T]:** Her yurt dışı tedarikçi mali müşavirle "hizmet mi, lisans mı?" diye sınıflandırılmalı. Stopaj gerekiyorsa brüte tamamlama maliyeti bütçeye eklenmeli.

### 8.4 Damga vergisi

- Belirli parayı içeren imzalı sözleşmeler **binde 9,48** damga vergisine tabi [O]. E-imzalı elektronik belgeler de kapsamda [O].
- **İmzasız elektronik kabul (click-wrap)** ile kurulan sözleşmelerde uygulamada genelde damga vergisi doğmadığı kabul ediliyor [O/D?].
- **Öneri [T]:** Küçük işletmelerle click-wrap kullanılmalı. Zincir müşterilerle ıslak veya e-imzalı sözleşme yapılırsa damga vergisi bütçelenmeli.

### 8.5 Kurumlar vergisi ve diğerleri

- **Kurumlar vergisi genel oranı %25** (2023 değişikliği) [O]. Teknokent istisnası için §7.3'e bakın.
- **Bayi komisyonları:** Gerçek kişi bayilere ödenen komisyonlarda stopaj ve belge düzeni (serbest meslek makbuzu veya fatura) gerekir [O]. Bayi programı başlamadan önce kurgulanmalı.

### 8.6 Maliyet planlaması özet tablosu [T]

| Kalem | Para birimi | Vergi etkisi | Not |
|---|---|---|---|
| Türkiye'deki hosting ve SaaS araçları | TL | Normal KDV (indirilebilir) | Yerli sağlayıcı seçmek sorumlu sıfatıyla KDV yükünü azaltır |
| Yurt dışı bulut ve araçlar (AWS, GitHub, LLM API, Sentry vb.) | USD | 2 No'lu KDV (1 ay nakit etkisi), olası stopaj, kartla ödemede kur farkı ve banka yurt dışı işlem masrafı | Aylık rapor |
| Meta WhatsApp ücretleri (Tech Provider) | USD, işletme öder | İşletmenin sorumlu sıfatıyla KDV durumu [D?] | Esnafa bilgilendirme |
| Meta ücretleri (kredi hattı ile biz ödersek) | USD | 2 No'lu KDV. Yeniden satışta %20 KDV | Kur riski, fiyat endeksleme |
| Ödeme kuruluşu komisyonları (kendi tahsilatımız) | TL | Kuruluşun faturası. BSMV/KDV ayrımı faturada görünür [D?] | Teklif alınmalı |
| e-Fatura entegratörü ve ön muhasebe | TL | Normal KDV | Kontör veya paket |
| Damga vergisi | TL | Binde 9,48 (imzalı sözleşmelerde) | Click-wrap tercih edilmeli |

---

## 9. Uyum Kontrol Listesi

### 9.1 MVP ÖNCESİ ZORUNLU (ilk ücretli işletmeden ve gerçek son müşteri verisinden önce)

| # | Madde | Bölüm |
|---|---|---|
| 1 | Şirket kurulumu (Ltd/AŞ), vergi levhası, banka hesabı, e-Tebligat, e-imza | §7.1–7.2 |
| 2 | Marka araştırması ve başvurusu, alan adları | §7.4 |
| 3 | Meta Business Verification ve Tech Provider süreçlerinin başlatılması | [K01] |
| 4 | Site künyesi (bizim) ve vitrin künyesi (işletme zorunlu alanları) | §4.10 |
| 5 | Kurumsal aydınlatma metni, gizlilik politikası, çerez politikası, rıza paneli | §2.4, §2.13 |
| 6 | İşletme abonelik sözleşmesi (click-wrap) + DPA + alt işleyen listesi | §2.2, §7.5 |
| 7 | Son müşteri aydınlatma metni şablonu. Vitrin, checkout, WhatsApp ilk yanıt ve takip sayfasında link | §2.4 |
| 8 | Ön bilgilendirme formu ve mesafeli satış sözleşmesi şablonu. "Ödeme yükümlülüğü doğar" onay adımı (vitrin ve WhatsApp). Cayma istisnası bilgisi | §4.7 |
| 9 | Fiyatların KDV dahil gösterimi. Gizli ek ücret (servis ücreti vb.) engeli. Teslimat ücreti ve minimum sepetin gösterimi | §4.8 |
| 10 | Yasak ürün kategorisi engeli (alkol, tütün, ilaç). Online ödemede taksitin kapalı olması | §4.9 |
| 11 | **Hosting kararı (öneri: Türkiye).** Yurt dışı alt işleyen envanteri. Kaçınılamayanlar için standart sözleşme + 5 iş günü içinde bildirim, ya da yazılı risk değerlendirmesi (Meta) | §2.10–2.12 |
| 12 | Teknik güvenlik: tenant izolasyonu, şifreleme, rol bazlı erişim, admin erişim logu, telefon maskeleme, yedekleme, PII temizleme | §2.2, §2.11 |
| 13 | Veri ihlali müdahale planı (72 saat) ve DPA'da işletmeye 24 saat içinde bildirim | §2.8 |
| 14 | Saklama ve imha politikası ile otomatik silme işleri. Coexistence sohbet geçmişi senkronu varsayılan olarak kapalı | §2.7, [K01] |
| 15 | İlgili kişi başvuru kanalı ve 30 günlük süreç. Panelde dışa aktarma ve silme | §2.9 |
| 16 | Şablonlarda **promosyon yasağı kontrolü** (utility/işlemsel mesajlar) | §3.2 |
| 17 | Sağlık verisi için yapılandırılmış alan olmaması. Sipariş notlarının kısa saklanması | §2.6 |
| 18 | Online tahsilat yok (kapıda ödeme). Varsa yalnızca işletmenin kendi PSP'si. Kart verisine dokunulmaması | §5.2 |
| 19 | Abonelik faturalaması: e-Arşiv/e-Fatura düzeni (Paraşüt veya GİB portalı) | §6.4 |
| 20 | VERBİS muafiyet değerlendirmesinin yazılı kaydı | §2.3 |
| 21 | Personel gizlilik ve KVKK taahhütnameleri, pay sahipleri sözleşmesi, fikri hak devirleri | §7.1, §7.5 |
| 22 | Web sitesi pazarlama metinlerinin (karşılaştırmalı reklam, "komisyonsuz" iddiası) avukat kontrolünden geçmesi | §4.8 |

### 9.2 MVP'DE ÖNERİLEN (ilk 3 ay)

- ETBİS kaydı (biz) ve işletmeler için ETBİS rehberi, panelde karekod alanı (§4.6).
- Mali müşavirle KDV, stopaj, 2 No'lu beyanname ve damga vergisi düzeninin kurulması (§8).
- Yazılı avukat görüşü: (i) Meta aktarımı, (ii) İYS'de platformun rolü, (iii) ETAHS sınırı, (iv) sipariş notu ve sağlık verisi (§13).
- Meta'ya ve Solution Partner'lara KVKK standart sözleşmesi sorusunun yazılı olarak iletilmesi (§2.11).
- Menüde alerjen etiketleri ve gramaj alanları (§4.9).
- Teknokent başvurusunun değerlendirilmesi (§7.3).

### 9.3 SONRA (Faz 2–3)

- **Kampanya modülü:** ETK onay akışları, İYS entegrasyonu (iş ortağı API'si), ret senkronizasyonu, frekans sınırı, audit log (§3.6).
- **Online ödeme M1:** PayTR, ardından iyzico. Faz 3'te Craftgate orkestrasyonu (§5.3).
- Online yemek kartı ödemesi (marka görüşmelerinden sonra) (§5.5).
- İşletme adına e-Arşiv düzenleme entegrasyonu (§5.6).
- Keşif/dizin sayfası (avukat görüşünden sonra, Senaryo B sınırlarında) (§4.3).
- VERBİS eşik takibi, ISO 27001 (kurumsal ve zincir satış için).
- Bayi programı (sözleşme, stopaj) (§8.5).

---

## 10. Önerilen Ödeme ve Fatura Sağlayıcıları (özet)

| İhtiyaç | Faz 1 (MVP) | Faz 2 | Faz 3 / ölçek |
|---|---|---|---|
| **Son müşteri ödemesi** | Kapıda: nakit, kart (işletmenin POS'u), yemek kartı cihazları. Panelde yalnızca kayıt | **İşletmenin kendi PayTR hesabı** (link/iframe), ardından **iyzico** | **Craftgate** (işletme istediği POS'u bağlar). Pazaryeri modeli (iyzico Pazaryeri vb.) **yalnızca** strateji "platform payı" yönüne dönerse |
| **Online yemek kartı** | — | Marka görüşmeleri | 1–2 marka ile API entegrasyonu |
| **Bizim abonelik tahsilatımız** | Kart: PSP kart saklama veya abonelik API'si (M1 ile aynı PSP; PayTR veya iyzico). Yıllıkta havale/EFT. Faturalama motoru bizde | Akıllı yeniden deneme, kart güncelleme linki | Başarısız çekimde alternatif POS'a düşme (Craftgate) |
| **e-Fatura / e-Arşiv (bizim faturalarımız)** | **Paraşüt** (API + ön muhasebe + mali müşavir erişimi). İlk birkaç müşteri için GİB e-Arşiv Portalı | Paraşüt | Hacim artınca doğrudan özel entegratör: **Nilvera / QNB eSolutions / Uyumsoft** (teklif karşılaştırması) |
| **İşletme adına e-Arşiv** | — | — | Çok kiracılı veya bayi API'si sunan bir özel entegratör [D?] |

**Kaçınılacaklar [T]:**
- Resmi olmayan GİB portal otomasyonları.
- Müşteri parasını kendi hesabımıza toplamak.
- Tek bir e-para kuruluşuna kritik bağımlılık (Papara örneği).
- Stripe veya MoR modelleri (Türkiye'de uygun değil).

---

## 11. Riskli Gri Alanlar

| # | Gri alan | Risk | Neden | Önerilen yaklaşım |
|---|---|---|---|---|
| 1 | **Meta/WhatsApp üzerinden yurt dışına aktarım (m.9)** | **Yüksek** | Düzenli aktarım standart sözleşme gerektirir. Meta'nın imzaladığı doğrulanamadı. Arızi aktarım uygun değil | Kendi verimiz Türkiye'de, veri minimizasyonu, alternatif web kanalı, Meta'ya yazılı soru, avukat görüşü (§2.11) |
| 2 | **Kampanya mesajlarında İYS ve platformun sorumluluğu** | **Yüksek** | WhatsApp operatör İYS filtresinden geçmez. Toplu onaysız gönderimde ceza 10 katına kadar artabilir | MVP'de modül yok. Faz 2'de İYS kontrolü yazılımda zorunlu (§3.6) |
| 3 | **İşlemsel mesaja promosyon karışması** ("teslim edildi + indirim kodu") | Orta-Yüksek | Tek satır bile mesajı ticari ileti yapar. Meta da kategoriyi değiştirebilir | Şablon kontrolü, "promosyon ayrı şablonda" kuralı (§3.2) |
| 4 | **Keşif/dizin sayfası ile ETAHS sınırı** | Orta-Yüksek | Pazaryeri yükümlülükleri, Nisan 2026 kuralları, müşteri verisinde VS rolü | MVP'de yok. Sonra B sınırında ve avukat görüşüyle (§4.2) |
| 5 | **Sipariş notlarında sağlık (alerji) verisi** | Orta | m.6'da sözleşmenin ifası dayanak değil | Yapılandırılmış alan yok, kısa saklama, avukat görüşü (§2.6) |
| 6 | **WhatsApp'tan gelen siparişte ön bilgilendirme ve kalıcı veri saklayıcı** | Orta | Mesafeli Sözleşmeler Yönetmeliği'nin teyit şartı | Özet + onay butonu + link + (varsa) e-posta PDF (§4.7) |
| 7 | **Online siparişte satış belgesi** (ÖKC fişi mi, e-Arşiv mi) | Orta (işletme riski, ürün vaadi) | İnternet satışında fatura zorunluluğu hatırlanıyor [O/D?] | Mali müşavir rehberi, e-Arşiv entegrasyonu (Faz 3) (§5.6) |
| 8 | **Coexistence ile 6 aylık sohbet geçmişi senkronu** | Orta | Esnafın kişisel sohbetleri bizim veritabanımıza gelir. Veri minimizasyonu ilkesiyle çelişir | Varsayılan olarak kapalı, açık onayla açılsın [K01] |
| 9 | **LLM ile mesaj ayrıştırma** | Orta | Yurt dışına aktarım | Tanımlayıcı temizleme, sağlayıcıyla standart sözleşme (§2.11) |
| 10 | **Veri işleyenden veri sorumlusuna kayma** (çapraz tenant analitik veya CRM) | Orta | Kendi hukuki sebebimiz gerekir | Tenant verisi tenant içinde kalır. Anonim istatistik tanımı yapılır (§2.1) |
| 11 | **Pazaryeri ödeme modeli ve 6493** | Orta | Para akışı yanlış kurgulanırsa lisanssız ödeme hizmeti riski | Para asla bizim hesabımıza girmez (§5.1) |
| 12 | **Yurt dışı yazılım ödemelerinde stopaj** | Orta (maliyet) | Hizmet ile lisans ayrımı | Mali müşavirle tedarikçi bazında sınıflandırma (§8.3) |
| 13 | **Esnafın kendi kanalında daha ucuz fiyat vermesi** | Orta (işletme riski) | Pazaryeri sözleşmelerinde parite veya yönlendirme maddeleri olabilir. 2016 Rekabet kararı MFN'yi sorunlu bulmuştu [K02] | Pazarlamada "kendi kanalına özel avantaj" dili. İşletmeye kendi sözleşmesini kontrol etmesi hatırlatılır |
| 14 | **Karşılaştırmalı reklam ve "komisyonsuz" iddiası** | Düşük-Orta | Ticari reklam mevzuatı | Nesnel ve kaynaklı karşılaştırma. Gizli sipariş başı ücret olmaması (§4.8) |
| 15 | **Yemek kartı regülasyonu ve komisyonları** | Düşük-Orta | Hareketli alan [D?] | MVP'de yalnızca kapıda. Sonra marka bazında ilerlenir |
| 16 | **Teknokent KDV istisnasının SaaS'a uygulanabilirliği** | Fırsat / gri | Özelgeler farklı yönde olabilir | Teknokent yönetimi ve mali müşavirle teyit (§7.3) |
| 17 | **Meta ücretlerinde esnafın KDV durumu** (Tech Provider) | Düşük-Orta | Basit usulde durum belirsiz | Mali müşavir görüşü, onboarding'de bilgilendirme (§8.2) |

---

## 12. Net Tavsiyeler (projeye özel)

1. **"Pazaryeri değil, işletmenin kendi kanalı" kurgusu hem ürün hem hukuk düzeyinde korunmalı.**
   - Her vitrin işletmenin markasıyla, işletmenin künyesiyle ve işletme adına düzenlenen sözleşmelerle çalışsın.
   - Ödeme işletmenin hesabına gitsin.
   - Ortak müşteri hesabı ve keşif uygulaması MVP'de olmasın.
   - Bu kurgu aynı anda şu yükleri önler: ETAHS yükümlülükleri, 6493 lisans riski, son müşteri verisinde veri sorumlusu olmak ve Nisan 2026 pazaryeri kuralları.
2. **Kişisel veri tabanı Türkiye'de barındırılsın.** Yurt dışı araçlar PII görmeyecek şekilde yapılandırılsın. Kaçınılmaz tek büyük yurt dışı akış (Meta) için yazılı risk değerlendirmesi ve avukat görüşü alınsın; Meta'ya KVKK standart sözleşmesi sorusu yazılı iletilsin.
3. **MVP ödeme = kapıda.** Online ödeme Faz 2'de "kendi PayTR/iyzico hesabını bağla" modeliyle gelsin. Müşteri parası hiçbir koşulda bizim hesabımıza girmesin.
4. **Kampanya modülü MVP'de olmasın.** Sipariş mesajları saf bilgilendirme olarak kalsın; şablon editörü promosyon içeriğini engellesin. Kampanya modülü Faz 2'de ETK onayı, İYS kontrolü, ret ve audit log ile birlikte gelsin.
5. **WhatsApp siparişine "onay adımı" eklensin:** özet, KDV dahil toplam, teslimat ücreti, cayma istisnası notu, ön bilgilendirme linki ve "Onaylıyorum (ödeme yükümlülüğü doğar)" butonu. Bu adım hem mesafeli satış uyumunu hem sipariş doğruluğunu artırır.
6. **Veri minimizasyonu varsayılan olsun:**
   - Coexistence geçmiş senkronu kapalı.
   - Alerji alanı yok.
   - Konum ve medya kısa sürede silinsin.
   - Müşteri kimliği BSUID ile, tenant bazında tutulsun [K01].
   - Otomatik silme işleri ilk sürümde yer alsın.
7. **Belge seti MVP öncesi hazırlansın** (§7.5 madde 1–10, 15–16). Hepsi click-wrap ve sürümlü olsun. Kabul kayıtları (kim, hangi sürüm, ne zaman) veritabanında tutulsun.
8. **Faturalama:** Kendi faturalama motorumuz + tek bir PSP (tokenlama) + Paraşüt API. Yıllık planda havale/EFT sunulsun. Dunning süreleri sözleşmeye yazılsın. Askıya almada bile işletmenin sipariş alması hemen kesilmesin.
9. **Vergi yapısı ilk aydan kurulsun.**
   - Yurt dışı giderler için 2 No'lu KDV ve stopaj sınıflandırması yapılsın.
   - Fiyat sayfası KDV hariç ve dahil birlikte göstersin.
   - Teknokent seçeneği fiyat avantajı açısından ciddiyetle değerlendirilsin.
10. **Şirket türü:** Yatırım planı varsa AŞ, yoksa Ltd. Marka başvurusu ürün adı duyurulmadan önce "kelime + logo" olarak 9, 35, 38 ve 42. sınıflarda yapılsın.
11. **Bütçe kalemleri:**
    - Bir KVKK/e-ticaret avukatıyla **sabit ücretli tek seferlik uyum paketi** (belge seti + 4 görüş konusu).
    - Bir mali müşavirle aylık sözleşme.
    - Bu iki maliyet MVP bütçesine konsun.
12. **Bu rapordaki [O] ve [D?] etiketli tüm maddeler**, özellikle eşikler, tutarlar, fiyatlar ve yürürlük tarihleri, ilk ücretli müşteriden önce §14'teki birincil kaynaklardan teyit edilsin. Bu oturumda canlı doğrulama yapılamadı.

---

## 13. Açık Sorular

### 13.1 Avukata

1. Meta (WhatsApp Cloud API) aktarımı için KVKK m.9 kapsamında hangi mekanizma kullanılmalı? Meta'nın şartlarında Türk standart sözleşmesi karşılığı var mı? Yoksa kabul edilebilir bir risk yönetimi çerçevesi nedir? İhracatçı işletme mi, biz mi?
2. Kampanya mesajlarında platform olarak 6563 ve Yönetmelik kapsamında "aracı" sayılır mıyız? Onaysız gönderimde müşterek sorumluluğumuz olur mu? İYS entegratörü olmak zorunlu mu, yoksa bir iş ortağı API'si yeterli mi?
3. Senaryo B (pasif dizin) ETAHS sayılır mı? Hangi özellik eşiği aşar?
4. Sipariş notunda müşterinin kendi yazdığı alerji bilgisini "sipariş kapsamında, saklamadan" işlemek m.6 açısından savunulabilir mi?
5. WhatsApp sohbetinde verilen özet ve link, Mesafeli Sözleşmeler Yönetmeliği'ndeki "kalıcı veri saklayıcı" şartını karşılar mı? Tek seferlik restoran siparişi "düzenli teslimat" istisnasına girer mi?
6. "Teşekkürler, değerlendirir misiniz?" ve "yarın kapalıyız" türü mesajlar onay gerektirir mi?
7. Standart sözleşme bildirimini işletmeler adına biz yapabilir miyiz? Hangi vekâlet veya yetkilendirme gerekir?
8. Web sitesinde rakip platform adlarıyla karşılaştırmalı komisyon hesabı yayımlamanın sınırları nelerdir?

### 13.2 Mali müşavire

1. SaaS aboneliğimiz Teknokent'te geliştirilirse KDV Kanunu geçici m.20 istisnası ve 4691 sayılı Kanun'daki kazanç istisnası uygulanabilir mi?
2. Kullandığımız her yurt dışı hizmet için "hizmet mi, gayrimaddi hak mı?" sınıflandırması nedir? Hangilerinde stopaj doğar?
3. Tech Provider modelinde esnafın Meta'ya yaptığı USD ödemelerinde KDV durumu nedir? Özellikle basit usul esnafta.
4. Bizim e-Fatura/e-Arşiv ve e-Defter yükümlülüğümüz ne zaman başlar? Gönüllü geçişin sonuçları nelerdir?
5. WhatsApp siparişi + kapıda ödeme "internet satışı" sayılır mı? İşletme ÖKC fişi yerine e-Arşiv düzenlemek zorunda mı? Hangi eşiklerle?
6. Click-wrap abonelik sözleşmelerinde damga vergisi doğar mı?
7. Mesaj kredisi yeniden satışında (Solution Partner modeli) KDV ve kur farkı nasıl muhasebeleştirilmeli?

### 13.3 Sağlayıcılara (yazılı teklif ve cevap)

1. **PayTR, iyzico, Craftgate (ve Param, Sipay):** Tek çekim oranı, sabit ücret, valör seçenekleri; alt üye işyeri veya üye işyeri onboarding belgeleri (basit usul esnaf kabulü dahil); tekrarlayan çekimde 3D Secure ve non-3D kuralı; abonelik API'si ücreti; çok kiracılı SaaS için "iş ortağı" programı.
2. **Paraşüt, Nilvera, QNB eSolutions, Uyumsoft:** API erişimi hangi pakette? Fatura başı veya kontör maliyeti nedir? İstek limitleri ne? Çok kiracılı veya bayi API'si var mı (işletme adına e-Arşiv için)?
3. **Meta / Türk Solution Partner'lar:** KVKK standart sözleşmesi, veri merkezi konumu, TL fatura ve kredi hattı.
4. **Yerli hosting sağlayıcıları:** Yönetilen Postgres, nesne depolama, yedekleme, SLA, fiyat. KVKK ve ISO 27001 belgeleri.
5. **İYS:** Entegratör veya iş ortağı olma şartları, API dokümanı, ücret tarifesi.
6. **Yemek kartı markaları:** Online ödeme API'si, küçük işletme için online üye işyeri şartları, komisyonlar.

### 13.4 Ürün ve iş kararları

1. Keşif/dizin sayfası yol haritasında var mı? Varsa hangi fazda?
2. Online ödeme ve kampanya modülü hangi fazda gelecek? (Bu rapor: ikisi de Faz 2.)
3. Tech Provider mı, Solution Partner kredi hattı mı? Bu karar vergi, KVKK ve faturalama akışını doğrudan etkiliyor [K01/K02].
4. Şirket türü (AŞ/Ltd) ve Teknokent başvurusu yapılacak mı?
5. Hosting için Türkiye seçeneğinin ek DevOps maliyeti kabul ediliyor mu?
6. Dikey genişlemede (market, şarküteri, tüp/su) alkol, tütün ve LPG kısıtları nedeniyle hangi işletme türleri hedef dışı kalacak?

---

## 14. Teyit Edilecek Birincil Kaynaklar

> **Not:** Aşağıdaki adresler **bu oturumda açılamadı.** Kanun adresleri mevzuat.gov.tr'nin standart kalıbıyla, Resmî Gazete adresleri günlük arşiv kalıbıyla yazıldı. Yönetmelikler mevzuat.gov.tr'de adıyla aranmalı.

**KVKK**
- 6698 sayılı Kanun: https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6698&MevzuatTur=1&MevzuatTertip=5
- 7499 sayılı Kanun (KVKK değişikliği), RG 12.03.2024: https://www.resmigazete.gov.tr/eskiler/2024/03/20240312.htm
- Yurt dışına aktarım Yönetmeliği, RG 10.07.2024: https://www.resmigazete.gov.tr/eskiler/2024/07/20240710.htm
- Kurum ana sayfası (standart sözleşmeler, Kurul kararları, rehberler, ihlal bildirim formu, güncel ceza tutarları): https://www.kvkk.gov.tr
- VERBİS: https://verbis.kvkk.gov.tr
- Aranacak başlıklar: "Veri Sorumluları Siciline Kayıt Yükümlülüğünden İstisna", "2019/10 sayılı Kurul Kararı", "Standart Sözleşme", "Çerez Uygulamaları Hakkında Rehber", "Kişisel Veri Güvenliği Rehberi"

**Ticari elektronik ileti / İYS**
- 6563 sayılı Kanun: https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6563&MevzuatTur=1&MevzuatTertip=5
- Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik, RG 15.07.2015: https://www.resmigazete.gov.tr/eskiler/2015/07/20150715.htm
- İYS değişikliği, RG 04.01.2020: https://www.resmigazete.gov.tr/eskiler/2020/01/20200104.htm
- İYS: https://iys.org.tr ; SSS: https://iys.org.tr/iys/sss [K02]

**E-ticaret ve tüketici**
- 7416 sayılı Kanun, RG 07.07.2022: https://www.resmigazete.gov.tr/eskiler/2022/07/20220707.htm
- ETAHS/ETHS Yönetmeliği, RG 29.12.2022: https://www.resmigazete.gov.tr/eskiler/2022/12/20221229.htm
- ETBİS: https://www.eticaret.gov.tr ; https://etbis.ticaret.gov.tr [K02]
- Ticaret Bakanlığı yemek sipariş düzenlemesi (Nisan 2026): https://ticaret.gov.tr/haberler/elektronik-ticarette-yemek-siparis-hizmetlerine-yonelik-yeni-duzenleme [K02]
- 6502 sayılı Kanun: https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6502&MevzuatTur=1&MevzuatTertip=5
- Mesafeli Sözleşmeler Yönetmeliği, RG 27.11.2014: https://www.resmigazete.gov.tr/eskiler/2014/11/20141127.htm
- Fiyat Etiketi Yönetmeliği ve restoran/kafe değişikliği: mevzuat.gov.tr'de "Fiyat Etiketi Yönetmeliği" araması [D? tarih]
- Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği: mevzuat.gov.tr araması
- 5651 sayılı Kanun: https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=5651&MevzuatTur=1&MevzuatTertip=5

**Ödeme**
- 6493 sayılı Kanun: https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6493&MevzuatTur=1&MevzuatTertip=5
- TCMB, ödeme ve elektronik para kuruluşları listesi: https://www.tcmb.gov.tr (Ödeme Hizmetleri bölümü)
- TÖDEB üye listesi: https://todeb.org.tr
- iyzico: https://www.iyzico.com ; Pazaryeri dokümanı: https://docs.iyzico.com/urunler/pazaryeri [K02]
- PayTR: https://www.paytr.com ; geliştirici: https://dev.paytr.com [O]
- Craftgate: https://craftgate.io ; geliştirici: https://developer.craftgate.io [O]
- Param: https://param.com.tr ; Sipay: https://sipay.com.tr ; Paynet: https://paynet.com.tr ; Moka United: https://mokaunited.com [O]
- Yemek kartları: https://www.multinet.com.tr ; https://www.pluxee.com.tr ; https://www.edenred.com.tr ; https://www.setcard.com.tr [O]

**Fatura ve vergi**
- GİB e-Belge portalı ve özel entegratör listesi: https://ebelge.gib.gov.tr
- GİB mevzuat ve özelgeler: https://www.gib.gov.tr
- KDV Kanunu (3065): https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=3065&MevzuatTur=1&MevzuatTertip=5
- Kurumlar Vergisi Kanunu (5520): https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=5520&MevzuatTur=1&MevzuatTertip=5
- Teknoloji Geliştirme Bölgeleri Kanunu (4691): https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=4691&MevzuatTur=1&MevzuatTertip=5
- Paraşüt API: https://apidocs.parasut.com [O]

**Şirket ve marka**
- Türk Ticaret Kanunu (6102): https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6102&MevzuatTur=1&MevzuatTertip=5
- Sınai Mülkiyet Kanunu (6769): https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6769&MevzuatTur=1&MevzuatTertip=5
- TÜRKPATENT: https://www.turkpatent.gov.tr ; EPATS: https://epats.turkpatent.gov.tr
- WIPO Global Brand Database: https://branddb.wipo.int

**Kardeş raporlar (aynı klasör)**
- [K01] `01-whatsapp-platform.md`: Meta fiyatları, Tech Provider/Solution Partner, opt-in politikası, BSUID, Coexistence
- [K02] `02-pazar-rakipler-is-modeli.md`: Nisan 2026 yemek sipariş düzenlemesi, İYS SSS, KDV oranları, fiyatlandırma, Rekabet kararları
