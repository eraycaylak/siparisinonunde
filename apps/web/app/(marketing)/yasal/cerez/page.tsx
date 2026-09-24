import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/marketing/legal-page';

export const metadata: Metadata = pageMetadata({
  title: 'Çerez politikası',
  description: 'Siparişin Önünde çerez politikası (taslak).',
  path: '/yasal/cerez',
});

export default function CookiePage() {
  return (
    <LegalPage
      title="Çerez politikası"
      intro={<p>Bu sitede ve işletme panelinde yalnız hizmetin çalışması için zorunlu çerezler ve benzeri teknolojiler kullanılır.</p>}
      sections={[
        {
          title: 'Zorunlu çerezler',
          body: (
            <ul>
              <li>
                <strong>sid</strong>: işletme paneli oturumu (HttpOnly, güvenli). Giriş yapıldığında oluşur; çıkışta ya da süre dolunca silinir.
              </li>
              <li>
                <strong>sfs</strong>: sipariş sayfasında WhatsApp’tan gelen menü bağlantısının oturumu. Kısa ömürlüdür.
              </li>
            </ul>
          ),
        },
        {
          title: 'Tarayıcı depolaması',
          body: (
            <p>
              Tema tercihiniz (açık/koyu) tarayıcınızın yerel depolamasında “theme” anahtarıyla tutulur ve sunucuya gönderilmez. Sipariş sayfasındaki
              sepet, siparişi tamamlayana kadar tarayıcınızda tutulur.
            </p>
          ),
        },
        {
          title: 'Analitik ve reklam',
          body: (
            <p>
              Şu anda analitik veya reklam çerezi kullanılmamaktadır. İleride kullanılırsa yalnız açık rızanızla yüklenecek; “Reddet” seçeneği
              “Kabul et” kadar kolay olacaktır.
            </p>
          ),
        },
        {
          title: 'Çerezleri yönetme',
          body: <p>Tarayıcı ayarlarından çerezleri silebilir veya engelleyebilirsiniz. Zorunlu çerezler engellenirse panele giriş yapılamaz.</p>,
        },
      ]}
    />
  );
}
