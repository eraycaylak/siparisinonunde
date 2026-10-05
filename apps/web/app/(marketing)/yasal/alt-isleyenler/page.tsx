import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/marketing/legal-page';
import { SITE_NAME, SUPPORT_EMAIL } from '@/lib/site';

// Alt işleyen listesi (08 §2.2 madde 5, §2.11): DPA'nın kamuya açık eki. Liste, üründe gerçekten çağrılan
// sağlayıcılardan türetilmiştir; kullanılmayan sağlayıcı buraya yazılmaz. Yeni bir alt işleyen eklenmeden önce
// 08 §2.11 envanteri ve bu sayfa güncellenir (değişmez kural 7).

export const metadata: Metadata = pageMetadata({
  title: 'Alt işleyenler',
  description: `${SITE_NAME} hizmetinde kullanılan alt işleyenler, konumları ve yurt dışına aktarım dayanakları.`,
  path: '/yasal/alt-isleyenler',
});

interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
  /** KVKK m.9 yaklaşımı ya da "aktarım yok". */
  transfer: string;
}

const ROWS: Subprocessor[] = [
  {
    name: 'Cloudflare, Inc.',
    purpose: 'Barındırma: uygulama sunucusu, veritabanı, görsel ve veritabanı yedekleri, alan adı yönetimi, CDN ve TLS sonlandırma.',
    data: 'Tüm veri kategorileri: işletme yetkilisi ve personel bilgileri, son müşteri adı, telefonu, adresi, siparişleri ve yazışmaları, IP ve oturum kayıtları.',
    location: 'Yurt dışı (Amerika Birleşik Devletleri ve Avrupa Birliği ağırlıklı küresel ağ).',
    transfer: 'KVKK m.9 standart sözleşmesi (veri işleyenden veri işleyene modülü) ve imzadan sonra Kurum bildirimi.',
  },
  {
    name: 'Meta Platforms (WhatsApp Business Platform)',
    purpose: 'WhatsApp üzerinden sipariş mesajlarının iletilmesi, sipariş durumu bildirimleri ve mesaj şablonlarının onayı.',
    data: 'Mesaj içeriği, telefon numarası ya da WhatsApp kullanıcı kimliği, profil adı, gönderilen medya.',
    location: 'Yurt dışı.',
    transfer: 'KVKK m.9 kapsamında değerlendirilir; sağlayıcının Kurul standart sözleşmesini imzalaması sağlanamazsa yazılı aktarım risk değerlendirmesi yapılır. Mesajlarda adres ve sipariş ayrıntısı tekrarlanmaz, ayrıntı yalnız takip sayfasında gösterilir.',
  },
  {
    name: 'Twilio Inc. ya da 360dialog GmbH (WhatsApp iş çözümü sağlayıcısı)',
    purpose:
      'Platformun ortak WhatsApp numarasının teknik bağlantısı: mesaj gönderimi, gelen mesaj ve teslim durumlarının iletilmesi. Aynı anda yalnız biri kullanılır; hangisinin kullanıldığı yapılandırmayla belirlenir.',
    data: 'Mesaj içeriği, alıcı telefon numarası, WhatsApp profil adı, medya bağlantıları, teslim durumları.',
    location: 'Yurt dışı: Twilio Amerika Birleşik Devletleri, 360dialog Almanya.',
    transfer: 'KVKK m.9 standart sözleşmesi (veri işleyenden veri işleyene modülü) ve Kurum bildirimi. Kullanılmayan sağlayıcının erişim anahtarları silinir.',
  },
  {
    name: 'Netgsm (SMS hizmet sağlayıcısı)',
    purpose: 'Sipariş doğrulama kodu ve WhatsApp kullanılamadığında sipariş durumu SMS’i; işletme sahibine yeni sipariş alarmı; panel giriş kodu.',
    data: 'Telefon numarası ve mesaj metni (doğrulama kodu, işletme adı, takip bağlantısı).',
    location: 'Türkiye.',
    transfer: 'Yurt dışına aktarım yok. Mesajda adres ve sipariş ayrıntısı yer almaz.',
  },
  {
    name: 'Google LLC (Firebase Cloud Messaging), Apple Inc. (APNs), Mozilla Corporation (Push Service)',
    purpose: 'Panel kapalıyken işletme personelinin cihazına “yeni sipariş” bildirimi iletilmesi. Hangi servis kullanıldığı personelin tarayıcısına göre belirlenir.',
    data: 'Son müşteri verisi gönderilmez. Bildirim içeriği sipariş numarası düzeyindedir ve uçtan uca şifrelidir; servis yalnız cihazın bildirim adresini ve IP adresini görür.',
    location: 'Yurt dışı.',
    transfer: 'Son müşteri kişisel verisi aktarılmadığından bu kanalda son müşteri açısından aktarım doğmaz. Personelin teknik verisi tarayıcı üreticisinin koşullarıyla işlenir; panel kullanıcı bilgilendirmesinde yazılıdır.',
  },
  {
    name: 'OpenFreeMap (açık harita döşeme servisi)',
    purpose: 'İşletme panelinde şube konumunun ve teslimat bölgelerinin haritada gösterilmesi. Harita verisi OpenStreetMap katkıcılarına aittir.',
    data: 'Son müşteri verisi gönderilmez. Servis yalnız paneli kullanan kişinin IP adresini ve istenen harita karelerini görür; adres metni ve müşteri bilgisi gönderilmez.',
    location: 'Yurt dışı.',
    transfer: 'Kişisel veri aktarılmaz; yalnız bağlantı kuran cihazın IP adresi görünür.',
  },
  {
    name: 'Google LLC (Google Haritalar yönlendirme bağlantısı)',
    purpose: 'Panelde ve kurye ekranında teslimat adresinin yol tarifi için harita uygulamasında açılması.',
    data: 'Bağlantıya yalnız personel ya da kurye tıkladığında, o siparişin teslimat adresi Google’a gider. Otomatik istek gönderilmez.',
    location: 'Yurt dışı.',
    transfer: 'Aktarım yalnız personelin tıklamasıyla ve yol tarifi amacıyla doğar. Kullanmak istemeyen işletme adrese elle gidebilir; bağlantı zorunlu değildir.',
  },
  {
    name: 'GitHub, Inc.',
    purpose: 'Kaynak kodun saklanması ve dağıtım süreçlerinin çalıştırılması.',
    data: 'Son müşteri ya da işletme verisi bulunmaz. Üretim verisi, veritabanı dökümleri ve erişim anahtarları buraya konmaz; test verisi sentetiktir.',
    location: 'Yurt dışı.',
    transfer: 'Kişisel veri aktarılmaz.',
  },
];

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Alt işleyenler"
      intro={
        <>
          <p>
            Bu sayfa, {SITE_NAME} hizmetini sağlamak için kullanılan alt işleyenlerin güncel listesidir ve{' '}
            <Link href="/yasal/dpa" className="font-semibold underline underline-offset-4">
              veri işleme sözleşmesinin
            </Link>{' '}
            ekidir (KVKK m.12/2; aktarım envanteri). İşletmenin müşterilerine ait kişisel veriler bakımından veri sorumlusu işletmedir;{' '}
            {SITE_NAME} veri işleyen, aşağıdaki sağlayıcılar ise alt işleyendir.
          </p>
          <p>
            Listeye yeni bir sağlayıcı eklenmesi ya da mevcut birinin değişmesi işletmelere en az <strong>30 gün önceden</strong> bildirilir.
            İşletmenin itiraz ve fesih hakkı vardır (DPA madde 5).
          </p>
          <p>
            Yapay zekâ / büyük dil modeli sağlayıcısı listede yoktur: üründe müşteri verisini bir dil modeline gönderen hiçbir çağrı
            bulunmamaktadır.
          </p>
        </>
      }
      sections={[
        {
          title: 'Güncel liste',
          body: (
            // Kabuk `[&_ul]` / `[&_li]` seçicileriyle madde imi uyguluyor; kart düzeni için liste etiketi kullanılmaz.
            <div className="flex flex-col gap-4">
              {ROWS.map((row) => (
                <article key={row.name} className="rounded-lg border border-border p-4">
                  <p className="font-bold text-fg">{row.name}</p>
                  <dl className="mt-2 flex flex-col gap-2 text-sm">
                    <div>
                      <dt className="font-semibold text-fg-muted">Amaç</dt>
                      <dd>{row.purpose}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-fg-muted">İşlenen veri</dt>
                      <dd>{row.data}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-fg-muted">Konum</dt>
                      <dd>{row.location}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-fg-muted">Yurt dışına aktarım (KVKK m.9)</dt>
                      <dd>{row.transfer}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ),
        },
        {
          title: 'Aktarım dayanağı belgeleri',
          body: (
            <p>
              Yurt dışı alt işleyenler için imzalanan standart sözleşmelerin ve Kurum’a yapılan bildirimlerin tarihleri kayıt altında
              tutulur. İşletme, kendi veri sorumlusu yükümlülüğü için bu bilgileri {SUPPORT_EMAIL} adresinden yazılı olarak isteyebilir.
            </p>
          ),
        },
        {
          title: 'Bu sayfanın güncelliği',
          body: (
            <p>
              Liste, üründe gerçekten kullanılan sağlayıcılardan türetilir ve sağlayıcı değişikliğiyle birlikte güncellenir. Sayfanın sürümü
              yukarıda yazılıdır; eski sürümler {SUPPORT_EMAIL} adresinden istenebilir.
            </p>
          ),
        },
      ]}
    />
  );
}
