import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/marketing/legal-page';
import { LEGAL_ENTITY, SITE_NAME, legalEntityRows } from '@/lib/site';

// Veri İşleme Sözleşmesi (DPA), 11 madde: 08 §2.2 tablosuyla birebir. Abonelik sözleşmesinin ekidir, click-wrap ile
// kabul edilir (08 §7.4 belge 2, §7.5). Taraflar: işletme veri sorumlusu (VS), platform veri işleyen (Vİ).
// Künye bilgileri yapılandırmadan (LEGAL_* ortam değişkenleri) gelir; koda yazılmaz.

export const metadata: Metadata = pageMetadata({
  title: 'Veri işleme sözleşmesi (DPA)',
  description: `${SITE_NAME} ile işletme arasındaki KVKK m.12/2 veri işleme sözleşmesi ve güvenlik eki.`,
  path: '/yasal/dpa',
});

const SUBPROCESSORS_LINK = (
  <Link href="/yasal/alt-isleyenler" className="font-semibold underline underline-offset-4">
    alt işleyen listesi
  </Link>
);

export default function DpaPage() {
  return (
    <LegalPage
      title="Veri işleme sözleşmesi (DPA)"
      intro={
        <>
          <p>
            Bu sözleşme, {SITE_NAME} abonelik sözleşmesinin ekidir ve 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) m.12/2 uyarınca
            yapılır. İşletmenin müşterilerine ait kişisel veriler bakımından <strong>veri sorumlusu işletmedir</strong>; {SITE_NAME} bu verileri
            yalnız işletmenin talimatıyla işleyen <strong>veri işleyendir</strong>.
          </p>
          <p>
            Sözleşme, işletme yetkilisinin panelde aboneliği kabul etmesiyle elektronik ortamda kurulur. Kabul; kabul eden kullanıcı, sürüm,
            zaman ve IP bilgisiyle kayda geçer.
          </p>
          <p className="text-sm text-fg-muted">Veri işleyen (hizmet sağlayıcı) bilgileri:</p>
          <dl className="mt-2 divide-y divide-border rounded-lg border border-border text-sm">
            {legalEntityRows(LEGAL_ENTITY).map((row) => (
              <div key={row.label} className="grid gap-1 px-3 py-2 sm:grid-cols-[12rem_1fr]">
                <dt className="font-semibold text-fg-muted">{row.label}</dt>
                <dd className="min-w-0 break-words text-fg">{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      }
      sections={[
        {
          title: 'Kapsam, süre ve nitelik',
          body: (
            <>
              <p>
                İşlemenin konusu, işletmenin sipariş alma ve sipariş yönetimi hizmetini kullanmasıdır. İşleme, abonelik sürdüğü sürece devam
                eder. İşlemenin niteliği otomatik ve kısmen otomatik yollarla toplama, kaydetme, saklama, güncelleme, aktarma ve silmedir.
              </p>
              <p>İşlenen veri kategorileri:</p>
              <ul>
                <li>Kimlik: ad, soyad, WhatsApp profil adı.</li>
                <li>İletişim: telefon numarası, WhatsApp kullanıcı kimliği, varsa e-posta.</li>
                <li>Konum ve adres: teslimat adresi, mahalle, adres tarifi, paylaşılan konum.</li>
                <li>Sipariş: ürünler, tutar, ödeme yöntemi, sipariş notu, değerlendirme.</li>
                <li>Yazışma: WhatsApp mesajları ve gönderilen ses kaydı, fotoğraf, belge.</li>
                <li>İşlem güvenliği: IP adresi, tarayıcı ve cihaz bilgisi, oturum ve erişim kayıtları.</li>
              </ul>
              <p>
                İlgili kişi grupları: işletmenin son müşterileri, işletme personeli ve kuryeleri. İşletme, bu verileri hukuka uygun olarak
                topladığını ve aydınlatma yükümlülüğünü yerine getirdiğini beyan eder.
              </p>
            </>
          ),
        },
        {
          title: 'Talimat',
          body: (
            <>
              <p>
                {SITE_NAME}, kişisel verileri yalnız işletmenin belgelenmiş talimatıyla ve bu sözleşmede yazılı amaçlarla işler. İşletmenin
                paneldeki ayarları (çalışma saatleri, teslimat bölgeleri, mesaj tercihleri, personel yetkileri, saklama ayarları) belgelenmiş
                talimat sayılır.
              </p>
              <p>
                {SITE_NAME} verileri kendi amaçları için kullanmaz, başka işletmelerle paylaşmaz, son müşterilere kendi adına pazarlama yapmaz
                ve işletmenin müşteri listesini başka bir işletmeye açmaz. Hukuka aykırı göründüğü değerlendirilen bir talimat yazılı olarak
                işletmeye bildirilir ve bildirim yanıtlanana kadar uygulanmaz.
              </p>
            </>
          ),
        },
        {
          title: 'Gizlilik ve güvenlik eki',
          body: (
            <>
              <p>
                {SITE_NAME} personeli ve yüklenicileri yazılı gizlilik ve KVKK taahhütnamesi imzalar. Teknik ve idari tedbirler, Kişisel
                Verileri Koruma Kurumu’nun Kişisel Veri Güvenliği Rehberi esas alınarak uygulanır:
              </p>
              <ul>
                <li>Her kayıt işletme kimliğiyle (tenant) etiketlenir; sorgular işletme bağlamı olmadan çalışmaz.</li>
                <li>Aktarımda TLS; WhatsApp ve SMS sağlayıcı anahtarları veritabanında şifreli saklanır.</li>
                <li>Rol bazlı yetki; platform yöneticilerinde iki adımlı doğrulama (TOTP) zorunludur.</li>
                <li>Yetki değişikliği, veri görüntüleme ve dışa aktarma gibi işlemler denetim kaydına yazılır.</li>
                <li>Kayıtlarda telefon numarası ve adres maskelenir.</li>
                <li>Günlük yedek alınır; yedekler şifreli depolamada tutulur ve geri yükleme tatbikatı yapılır.</li>
                <li>Parolalar geri döndürülemez biçimde özetlenir; düz metin parola saklanmaz.</li>
              </ul>
              <p>
                Son müşteriye ait özel nitelikli kişisel veri (sağlık, alerji) toplanacak bir alan üründe bilerek açılmaz. İşletme, sipariş
                notuna yazılan böyle bir bilgiyi müşteri kaydına taşımamayı kabul eder.
              </p>
            </>
          ),
        },
        {
          title: 'Destek erişimi',
          body: (
            <p>
              {SITE_NAME} destek ekibi işletmenin verisini yalnız işletmenin talebiyle ya da bir güvenlik olayına müdahale için görür. Her
              destek erişimi, erişen kişi ve zaman bilgisiyle denetim kaydına yazılır. Destek oturumunda son müşteri telefon numarası maskeli
              gösterilir ve erişim işletmeye bildirilir.
            </p>
          ),
        },
        {
          title: 'Alt işleyenler',
          body: (
            <>
              <p>
                {SITE_NAME} hizmeti sağlamak için alt işleyen kullanır. Güncel {SUBPROCESSORS_LINK} kamuya açık olarak yayımlanır; her alt
                işleyenin amacı, konumu ve yurt dışına aktarımda KVKK m.9 dayanağı orada yazılıdır.
              </p>
              <p>
                Yeni bir alt işleyen eklenmesi ya da mevcut birinin değişmesi en az <strong>30 gün önceden</strong> işletmeye bildirilir.
                İşletme bu süre içinde gerekçeli olarak itiraz edebilir; itiraz çözülemezse işletme aboneliği ek ücret ödemeden feshedebilir ve
                verilerini dışa aktarabilir.
              </p>
              <p>{SITE_NAME}, alt işleyenlerine bu sözleşmedeki yükümlülüklerle en az aynı düzeyde yükümlülük getirir.</p>
            </>
          ),
        },
        {
          title: 'Yurt dışına aktarım',
          body: (
            <>
              <p>
                Hizmetin barındırıldığı altyapı Türkiye dışındadır. Kişisel veriler, {SUBPROCESSORS_LINK} sayfasında konumu yazılı alt
                işleyenler üzerinden yurt dışında işlenir ve saklanır. Bu nedenle “verileriniz Türkiye’de tutulur” beyanı
                verilmez.
              </p>
              <p>
                Aktarım KVKK m.9 uyarınca, Kişisel Verileri Koruma Kurulu’nun ilan ettiği standart sözleşme ile yapılır. Veri işleyen
                olarak {SITE_NAME}, kendi alt işleyenleriyle gereken modülü (Vİ→Vİ) imzalar ve imzadan itibaren 5 iş günü içinde Kurum’a
                bildirir; bildirim tarihleri alt işleyen listesinde yayımlanır. İşletmenin kendi veri sorumlusu sıfatıyla yapması gereken
                bildirimler için {SITE_NAME} gerekli bilgi ve belgeyi sağlar.
              </p>
            </>
          ),
        },
        {
          title: 'İlgili kişi başvuruları',
          body: (
            <p>
              Son müşteri KVKK m.11 kapsamında bir başvuru yaptığında muhatap işletmedir. {SITE_NAME}, işletmenin 30 günlük cevap süresine
              yetişebilmesi için panelde teknik destek sağlar: müşterinin kayıtlı verisini makine okunabilir biçimde dışa aktarma, düzeltme ve
              silme (anonimleştirme) araçları. Doğrudan {SITE_NAME}’e ulaşan son müşteri başvuruları gecikmeksizin ilgili işletmeye
              yönlendirilir ve başvuru sahibine bilgi verilir.
            </p>
          ),
        },
        {
          title: 'İhlal bildirimi',
          body: (
            <p>
              {SITE_NAME} bir veri ihlalini öğrendiğinde, en geç <strong>24 saat</strong> içinde etkilenen işletmeye bildirir. Bildirimde
              ihlalin niteliği, etkilenen veri kategorileri ve yaklaşık kayıt sayısı, alınan önlemler ve iletişim noktası yer alır. Bu süre,
              işletmenin Kurul’a karşı 72 saatlik bildirim yükümlülüğünü yerine getirebilmesi içindir. İşletmenin Kurul ve ilgili kişilere
              yapacağı bildirimler için {SITE_NAME} gereken bilgiyi sağlar.
            </p>
          ),
        },
        {
          title: 'Denetim ve sorumluluk',
          body: (
            <>
              <p>
                İşletme, yılda bir kez, makul kapsamda ve yazılı olarak uyum bilgisi isteyebilir. {SITE_NAME} bu talebi güvenlik tedbirleri
                raporu, soru listesi yanıtı ya da varsa bağımsız denetim veya sertifika belgesiyle karşılar. Yerinde denetim, yalnız raporla
                giderilemeyen somut bir şüphe varsa ve önceden kararlaştırılan tarihte yapılır.
              </p>
              <p>
                Taraflar kendi yükümlülüklerinin ihlalinden doğan zarardan sorumludur. {SITE_NAME}’in bu sözleşmeden doğan toplam
                sorumluluğu, ihlalden önceki 12 ayda işletmenin ödediği abonelik bedeli ile sınırlıdır; kasıt ve ağır ihmal hâlinde bu sınır
                uygulanmaz. İşletmenin hukuka aykırı talimatından ya da aydınlatma yükümlülüğünü yerine getirmemesinden doğan taleplerde
                sorumluluk işletmeye aittir.
              </p>
            </>
          ),
        },
        {
          title: 'Sözleşmenin sonu ve verinin iadesi',
          body: (
            <>
              <p>
                Abonelik sona erdiğinde işletmeye en az <strong>30 günlük dışa aktarma penceresi</strong> verilir: müşteri listesi ve sipariş
                geçmişi makine okunabilir biçimde indirilebilir. Pencere, gönüllü iptalde dönem sonundan, ödeme sorunlarında kapanış
                bildiriminden, deneme bitişinde askı süresinden işlemeye başlar.
              </p>
              <p>
                Pencere kapandıktan sonra kişisel veriler silinir ya da anonim hâle getirilir; silinen veri en geç 35 gün içinde yedeklerden de
                düşer. Vergi ve ticaret mevzuatındaki saklama süreleri (fatura, sipariş kaydı) ile kabul kayıtlarının saklanması bu kuralın
                istisnasıdır; bu kayıtlar süresi boyunca yalnız yasal yükümlülük amacıyla saklanır.
              </p>
            </>
          ),
        },
        {
          title: 'İşletmenin yükümlülükleri',
          body: (
            <ul>
              <li>Son müşterilerine yönelik aydınlatma metnini yayımlamak; şablon {SITE_NAME} tarafından sağlanır ve otomatik doldurulur.</li>
              <li>Künye bilgilerini (unvan, adres, telefon, vergi kimlik no) doğru ve güncel tutmak.</li>
              <li>Kişisel verileri hukuka uygun toplamak ve {SITE_NAME}’e hukuka uygun talimat vermek.</li>
              <li>Ticari elektronik ileti gönderimi için gereken onayları almak ve İYS yükümlülüklerini yerine getirmek.</li>
              <li>Panelde personele yalnız gereken yetkiyi vermek, ayrılan personelin erişimini kapatmak, parolaları paylaşmamak.</li>
              <li>Varsa VERBİS kaydını güncel tutmak.</li>
              <li>Menü, fiyat, görsel ve alerjen bilgisinin doğruluğundan sorumlu olmak.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
