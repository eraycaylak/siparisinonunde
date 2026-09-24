import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/marketing/legal-page';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Ön bilgilendirme ve mesafeli satış sözleşmesi şablonu',
  description: 'İşletme ile son müşteri arasındaki ön bilgilendirme formu ve mesafeli satış sözleşmesi şablonu (taslak).',
  path: '/yasal/mesafeli-satis-sablonu',
});

export default function DistanceSalesTemplatePage() {
  return (
    <LegalPage
      title="Ön bilgilendirme formu ve mesafeli satış sözleşmesi şablonu"
      intro={
        <p>
          Bu şablon, işletmenin sipariş sayfasında her siparişte işletme ve sipariş bilgileriyle otomatik doldurulur. Taraflar işletme (satıcı)
          ve siparişi veren müşteridir (alıcı). {SITE_NAME} altyapı sağlayıcıdır; satıcı değildir. Köşeli parantez içindeki alanlar otomatik
          doldurulur.
        </p>
      }
      sections={[
        {
          title: 'Satıcı bilgileri',
          body: <p>[İşletme unvanı], [adres], [telefon], [e-posta], [vergi no], [varsa MERSİS no ve gıda işletmesi kayıt no].</p>,
        },
        {
          title: 'Sözleşme konusu ürünler',
          body: <p>[Ürün adı, seçenekleri ve adedi] — sipariş özetinde gösterildiği şekliyle.</p>,
        },
        {
          title: 'Fiyat ve ödeme',
          body: (
            <ul>
              <li>Ürünlerin vergiler dahil toplam fiyatı: [toplam tutar].</li>
              <li>Teslimat ücreti: [teslimat ücreti]. Başka ek ücret (servis ücreti vb.) alınmaz.</li>
              <li>Ödeme yöntemi: [kapıda nakit / kapıda kart / kapıda yemek kartı / kasada ödeme]. Ödeme teslimatta satıcıya yapılır.</li>
            </ul>
          ),
        },
        {
          title: 'Teslimat',
          body: <p>Teslimat adresi: [adres]. Tahmini teslim süresi: [süre]. Gel-al siparişlerde ürün satıcının adresinde teslim edilir.</p>,
        },
        {
          title: 'Cayma hakkı',
          body: (
            <p>
              Gıda siparişleri çabuk bozulabilen ürünler olduğundan cayma hakkı kapsamı dışındadır (Mesafeli Sözleşmeler Yönetmeliği m.15).
              Satıcı siparişi onaylamadan önce sipariş sayfasından iptal edebilirsiniz; onaydan sonra iptal talebiniz satıcının onayına tabidir.
            </p>
          ),
        },
        {
          title: 'Şikâyet ve başvuru',
          body: (
            <p>
              Şikâyetlerinizi satıcının yukarıdaki iletişim bilgilerine iletebilirsiniz. Uyuşmazlıklarda parasal sınırlar dahilinde tüketici hakem
              heyetlerine veya tüketici mahkemelerine başvurabilirsiniz.
            </p>
          ),
        },
        {
          title: 'Onay',
          body: (
            <p>
              “Siparişi onayla”ya bastığınızda siparişiniz kesinleşir ve ödeme yükümlülüğü doğar. Bu formun ve sözleşmenin sürümü siparişinize
              bağlanır ve sipariş takip sayfanızda gösterilir.
            </p>
          ),
        },
      ]}
    />
  );
}
