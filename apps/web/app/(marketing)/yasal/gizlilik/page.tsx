import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { LegalPage } from '@/components/marketing/legal-page';
import { LEGAL_ENTITY, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Gizlilik politikası',
  description: 'Siparişin Önünde gizlilik politikası (taslak).',
  path: '/yasal/gizlilik',
});

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Gizlilik politikası"
      intro={
        <p>
          Bu politika, {SITE_NAME} internet sitesini ziyaret edenlerin, demo talep edenlerin ve hizmeti kullanan işletme yetkililerinin kişisel
          verilerinin nasıl işlendiğini açıklar. Ayrıntılı bilgilendirme için{' '}
          <Link href="/yasal/kvkk-aydinlatma" className="font-semibold underline underline-offset-4">
            KVKK aydınlatma metnine
          </Link>{' '}
          bakın.
        </p>
      }
      sections={[
        {
          title: 'Veri sorumlusu',
          body: (
            <p>
              {LEGAL_ENTITY.title}, {LEGAL_ENTITY.address}. İletişim: {LEGAL_ENTITY.email}.
            </p>
          ),
        },
        {
          title: 'Hangi verileri işliyoruz?',
          body: (
            <ul>
              <li>Demo talebi: ad soyad, işletme adı, telefon, il/ilçe, işletme türü ve formda verdiğiniz diğer bilgiler.</li>
              <li>Hesap ve abonelik: işletme yetkilisinin adı, e-postası, telefonu, parola özeti (parolanın kendisi saklanmaz), oturum ve güvenlik kayıtları.</li>
              <li>Site kullanımı: yalnız hizmetin çalışması için gerekli teknik kayıtlar. Reklam veya analitik çerezi kullanmıyoruz.</li>
            </ul>
          ),
        },
        {
          title: 'Son müşteri verileri',
          body: (
            <p>
              İşletmelerin müşterilerine ait sipariş, adres ve iletişim verileri bakımından veri sorumlusu ilgili işletmedir. {SITE_NAME} bu
              verileri yalnız hizmeti sağlamak için ve işletmenin talimatıyla işler; başka işletmelerle paylaşmaz, bu kişilere kendi adına
              pazarlama yapmaz.
            </p>
          ),
        },
        {
          title: 'Verilerin saklandığı yer ve aktarım',
          body: (
            <p>
              Kişisel veriler Türkiye’deki sunucularda barındırılır. WhatsApp mesajlarının iletimi için Meta ve aracı hizmet sağlayıcıları (yurt
              dışı), SMS gönderimi için yurt içi SMS sağlayıcısı kullanılır. Yurt dışına aktarım, mevzuattaki güvencelere uygun olarak yapılır.
              Güncel alt işleyen listesi yayımlanacaktır.
            </p>
          ),
        },
        {
          title: 'Saklama süreleri',
          body: (
            <p>
              Veriler işleme amacının gerektirdiği süre kadar saklanır ve süre dolduğunda otomatik olarak silinir ya da anonimleştirilir. Örneğin
              demo talepleri 12 ay hareketsizlikten, uygulama kayıtları 30 gün sonra silinir.
            </p>
          ),
        },
        {
          title: 'Haklarınız ve başvuru',
          body: (
            <p>
              KVKK m.11 kapsamındaki haklarınız için {LEGAL_ENTITY.email} adresine başvurabilirsiniz. Başvurular en geç 30 gün içinde ücretsiz
              olarak yanıtlanır.
            </p>
          ),
        },
      ]}
    />
  );
}
