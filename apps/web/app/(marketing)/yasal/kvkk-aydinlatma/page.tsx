import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/marketing/legal-page';
import { LEGAL_ENTITY, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'KVKK aydınlatma metni',
  description: '6698 sayılı KVKK m.10 kapsamında aydınlatma metni (taslak).',
  path: '/yasal/kvkk-aydinlatma',
});

export default function KvkkPage() {
  return (
    <LegalPage
      title="KVKK aydınlatma metni"
      intro={
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu’nun 10. maddesi uyarınca, {SITE_NAME} internet sitesi ziyaretçileri, demo talep
          edenler ve işletme panelini kullanan yetkililer bilgilendirilir. Bu metin bir rıza metni değildir.
        </p>
      }
      sections={[
        {
          title: 'Veri sorumlusunun kimliği',
          body: (
            <p>
              {LEGAL_ENTITY.title} ({LEGAL_ENTITY.type}), {LEGAL_ENTITY.address}, {LEGAL_ENTITY.email}.
            </p>
          ),
        },
        {
          title: 'İşlenen veriler ve amaçlar',
          body: (
            <ul>
              <li>Kimlik ve iletişim (ad soyad, telefon, e-posta): demo talebinin karşılanması, hesabın açılması, destek ve bilgilendirme.</li>
              <li>İşletme bilgileri (işletme adı, il/ilçe, işletme türü): hizmete uygunluğun değerlendirilmesi ve teklif hazırlanması.</li>
              <li>İşlem güvenliği (oturum, IP, cihaz bilgisi, denetim kayıtları): hesabın ve hizmetin güvenliğinin sağlanması.</li>
              <li>Abonelik ve fatura bilgileri: sözleşmenin kurulması ve ifası, yasal yükümlülüklerin yerine getirilmesi.</li>
            </ul>
          ),
        },
        {
          title: 'Hukuki sebepler',
          body: (
            <p>
              Veriler; sözleşmenin kurulması veya ifası (m.5/2-c), hukuki yükümlülüğün yerine getirilmesi (m.5/2-ç) ve temel hak ve özgürlüklere
              zarar vermemek kaydıyla meşru menfaat (m.5/2-f) hukuki sebeplerine dayanılarak işlenir.
            </p>
          ),
        },
        {
          title: 'Aktarılan taraflar',
          body: (
            <p>
              Yurt içi barındırma ve SMS hizmet sağlayıcıları, WhatsApp mesaj iletimi için Meta ve aracı hizmet sağlayıcıları (yurt dışı),
              muhasebe ve e-fatura hizmet sağlayıcısı ile yetkili kamu kurumları. Aktarımlar yalnız belirtilen amaçlarla sınırlıdır.
            </p>
          ),
        },
        {
          title: 'Toplama yöntemi',
          body: <p>İnternet sitesindeki formlar, işletme paneli, telefon ve WhatsApp üzerinden elektronik ortamda.</p>,
        },
        {
          title: 'Haklarınız (m.11)',
          body: (
            <p>
              Verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, amaca uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı
              üçüncü kişileri bilme, düzeltme, silme veya yok edilmesini isteme, itiraz etme ve zararın giderilmesini talep etme haklarına
              sahipsiniz. Başvurularınızı {LEGAL_ENTITY.email} adresine iletebilirsiniz; en geç 30 gün içinde yanıtlanır.
            </p>
          ),
        },
        {
          title: 'Son müşteriler için not',
          body: (
            <p>
              İşletmelerin web menüsünden veya WhatsApp üzerinden sipariş veren müşteriler için veri sorumlusu siparişi verdikleri işletmedir.
              Bu kişilere yönelik aydınlatma metni, ilgili işletmenin sipariş sayfasında işletme bilgileriyle birlikte yayımlanır.
            </p>
          ),
        },
      ]}
    />
  );
}
