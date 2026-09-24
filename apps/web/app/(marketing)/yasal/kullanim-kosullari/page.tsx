import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/marketing/legal-page';
import { LEGAL_ENTITY, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Kullanım koşulları',
  description: 'Siparişin Önünde abonelik ve kullanım koşulları (taslak).',
  path: '/yasal/kullanim-kosullari',
});

export default function TermsPage() {
  return (
    <LegalPage
      title="Kullanım koşulları ve abonelik şartları"
      intro={
        <p>
          Bu metin, {LEGAL_ENTITY.title} (“{SITE_NAME}”, “biz”) ile hizmeti kullanan işletme (“işletme”, “siz”) arasındaki abonelik ilişkisinin
          özetidir. İşletmeler ticari amaçla hareket ettiğinden bu ilişki tüketici işlemi değildir.
        </p>
      }
      sections={[
        {
          title: 'Hizmetin tanımı',
          body: (
            <>
              <p>
                {SITE_NAME}; işletmenin kendi WhatsApp numarası ve web menüsü üzerinden sipariş almasını, siparişleri panelde yönetmesini ve
                müşterisine durum bildirimi göndermesini sağlayan bir yazılım hizmetidir.
              </p>
              <p>
                Satıcı her zaman işletmedir. {SITE_NAME} altyapı sağlayıcıdır; müşteri adına sipariş almaz, müşteri parasını tahsil etmez,
                kurye sağlamaz ve işletmeleri listeleyen bir pazaryeri işletmez.
              </p>
            </>
          ),
        },
        {
          title: 'Paketler, ücretler ve deneme',
          body: (
            <ul>
              <li>Fiyatlar KDV hariç yazılır; KDV ayrıca eklenir. Liste fiyatları yıllık TÜFE oranında güncellenebilir.</li>
              <li>Sipariş başına ücret, ciro yüzdesi ya da ödemelerden pay alınmaz.</li>
              <li>Kurucu üye indirimi 12 ay boyunca liste fiyatından %30 indirim oranıdır; sabit bir TL fiyat değildir.</li>
              <li>14 günlük deneme bize kart bilgisi verilmeden kullanılır. Deneme bitiminde paket seçilmezse 3 gün uyarı verilir, ardından online sipariş alma durur; 90 gün içinde paket seçilirse veriler aynen geri gelir.</li>
              <li>SMS doğrulama ve kritik durum SMS’leri adil kullanım kotasıyla aboneliğe dahildir (Esnaf ayda 100, Pro ayda 300, Zincir şube başına 300).</li>
            </ul>
          ),
        },
        {
          title: 'WhatsApp (Meta) ücretleri',
          body: (
            <p>
              WhatsApp (Meta) mesaj ücretleri abonelik fiyatına dahil değildir; işletmenin kendi Meta/WhatsApp hesabından tahsil edilir.
              WhatsApp hesabı, numarası ve bu hesaba bağlı varlıklar işletmeye aittir.
            </p>
          ),
        },
        {
          title: 'İşletmenin yükümlülükleri',
          body: (
            <ul>
              <li>Menü, fiyat, porsiyon ve alerjen bilgilerinin doğruluğundan işletme sorumludur. Menü fiyatları KDV dahil girilir.</li>
              <li>Alkol, tütün ürünleri, ilaç ve tüp gaz WhatsApp ve web üzerinden satılamaz; bu ürünler menüde satışa açılamaz.</li>
              <li>WhatsApp Business ve Meta Ticaret Politikası kurallarına uyulur.</li>
              <li>Sipariş durum mesajlarına kampanya veya indirim eklenmez. Ticari ileti gönderimi için İYS kaydı ve alıcının önceden onayı gerekir.</li>
              <li>İşletme, son müşterisinin kişisel verileri bakımından veri sorumlusudur; {SITE_NAME} bu verileri işletme adına işler.</li>
            </ul>
          ),
        },
        {
          title: 'Ödeme gecikmesi',
          body: (
            <p>
              Ödeme alınamazsa 1., 3. ve 7. günlerde yeniden denenir ve hatırlatma yapılır. 10. günden itibaren panel salt-okunur olur (sipariş
              almaya devam edilir), 21. günden itibaren online sipariş alma durdurulur. 75. günde hesap kapatma ve veri silme süreci başlar; bu
              süreçten önce verilerinizi dışa aktarma hakkınız hatırlatılır.
            </p>
          ),
        },
        {
          title: 'Fesih ve veri dışa aktarma',
          body: (
            <p>
              Aylık planda taahhüt yoktur; abonelik dönem sonunda sona erer. Müşteri listesi ve sipariş geçmişi her zaman dışa aktarılabilir.
              Hesap kapanışında veriler en az 30 günlük dışa aktarma penceresinden sonra silinir.
            </p>
          ),
        },
        {
          title: 'Hizmet seviyesi ve sorumluluk',
          body: (
            <p>
              Aylık %99,9 erişilebilirlik bir hedeftir, taahhüt değildir. Üçüncü taraf hizmetlerindeki (Meta/WhatsApp, SMS sağlayıcısı,
              barındırma) kesintilerden doğan zararlardan sorumluluk, yürürlükteki mevzuatın izin verdiği ölçüde sınırlıdır. Ayrıntılar nihai
              sözleşmede yer alacaktır.
            </p>
          ),
        },
        {
          title: 'Değişiklikler ve uyuşmazlık',
          body: (
            <p>
              Esaslı değişiklikler yürürlükten en az 30 gün önce bildirilir; kabul edilmezse dönem sonunda fesih hakkı doğar. Uyuşmazlıklarda
              [yetkili mahkeme ve icra daireleri — avukatla belirlenecek] yetkilidir.
            </p>
          ),
        },
      ]}
    />
  );
}
