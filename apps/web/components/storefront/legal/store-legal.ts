// İşletmeye özel yasal metinler (S-10, 03 §4.8; 08 §2.4-B, §4.4): son müşteri için veri sorumlusu ve satıcı İŞLETMEDİR,
// platform veri işleyen ve yazılım altyapı sağlayıcısıdır. Metinler burada yapılandırılmış veri olarak üretilir (birim
// testli); /s/[slug]/yasal/[doc] sayfası yalnız çizer. Künye storefront yanıtının `legal` bloğundan dolar; eksik zorunlu
// alan köşeli parantezli yer tutucuyla gösterilir (künye eksikken vitrin canlıya alınamaz, 08 §4.7).
// Aydınlatma metninde "vb.", "gibi" türünden belirsiz ifade kullanılmaz (08 §2.4).

import { LEGAL_DOCUMENT_VERSION, MEAL_CARD_BRAND_LABELS, PAYMENT_METHOD_LABELS, isDraftLegalVersion, type MealCardBrand } from '@siparis/core/enums';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { formatMoney } from '@/lib/format';
import { SITE_NAME } from '@/lib/site';
import { storefrontHref } from '@/lib/storefront-url';
import { deliveryEtaText } from '../format';
import {
  contactPhrase,
  imprintRows,
  list,
  p,
  storeImprint,
  writtenContactPhrase,
  type LegalSection,
  type SellerImprint,
} from './store-legal-imprint';

// Künye yardımcıları aynı adlarla buradan da dışa verilir: çağıran dosyalar (checkout, takip sayfası, belge görünümü)
// tek giriş noktası kullanmaya devam eder.
export {
  IMPRINT_PLACEHOLDERS,
  availableImprintRows,
  imprintRows,
  sellerImprint,
  storeImprint,
  type ImprintInput,
  type ImprintRow,
  type LegalBlock,
  type LegalSection,
  type SellerImprint,
} from './store-legal-imprint';

export const STORE_LEGAL_DOCS = ['aydinlatma', 'on-bilgilendirme', 'mesafeli-satis'] as const;
export type StoreLegalDoc = (typeof STORE_LEGAL_DOCS)[number];

/** Sayfa başlıkları. */
export const STORE_LEGAL_TITLES: Record<StoreLegalDoc, string> = {
  aydinlatma: 'KVKK aydınlatma metni',
  'on-bilgilendirme': 'Ön bilgilendirme formu',
  'mesafeli-satis': 'Mesafeli satış sözleşmesi',
};

/** Bağlantı etiketleri (altbilgi, checkout, takip sayfası). */
export const STORE_LEGAL_LINK_LABELS: Record<StoreLegalDoc, string> = {
  aydinlatma: 'Aydınlatma metni',
  'on-bilgilendirme': 'Ön bilgilendirme formu',
  'mesafeli-satis': 'Mesafeli satış sözleşmesi',
};

/** Metin sürümü: siparişe bağlanan kabul kaydıyla (legal_acceptances.version) aynı. */
export const STORE_LEGAL_VERSION = LEGAL_DOCUMENT_VERSION;

/**
 * Yürürlükteki sürüm taslak mı? Kural: taslak metinle sözleşme kurulmaz (08 §7.5; denetim B2).
 * ⚠️ Bu bayrağı henüz hiçbir kapı okumuyor — checkout onay kutusu ve sipariş ucu taslak sürümde de çalışır.
 * Asıl kapı sunucuda, `apps/api/src/routes/store/orders.ts` → `POST /:slug/orders` içinde ve kabul kaydı
 * insert'inden önce olmalıdır; bu bayrak yalnız ekranın aynı ölçüte bağlanması için duruyor.
 */
export const STORE_LEGAL_IS_DRAFT = isDraftLegalVersion(STORE_LEGAL_VERSION);

/** 03 §4.4 / 08 §4.4 kilitli cayma cümlesi (checkout ve WhatsApp özetiyle birebir aynı). */
export const WITHDRAWAL_EXCEPTION_TEXT = 'Gıda siparişleri çabuk bozulabilen ürünler olduğundan cayma hakkı kapsamı dışındadır.';

export function isStoreLegalDoc(value: string): value is StoreLegalDoc {
  return (STORE_LEGAL_DOCS as readonly string[]).includes(value);
}

/** Uygulama içi bağlantı: /s/{slug}/yasal/{doc} (alt alan adında da çalışır; /s/ yolu proxy'de olduğu gibi kalır). */
export function storeLegalHref(slug: string, doc: StoreLegalDoc): string {
  return storefrontHref(slug, `/yasal/${doc}`);
}

// ---------------------------------------------------------------------------
// Belge yapısı

export interface StoreLegalDocument {
  doc: StoreLegalDoc;
  title: string;
  version: string;
  imprint: SellerImprint;
  intro: string[];
  sections: LegalSection[];
}

/** Belgeyi işletme verisiyle üretir. */
export function buildStoreLegalDocument(doc: StoreLegalDoc, store: StorefrontView): StoreLegalDocument {
  const imprint = storeImprint(store);
  const base = { doc, title: STORE_LEGAL_TITLES[doc], version: STORE_LEGAL_VERSION, imprint };
  switch (doc) {
    case 'aydinlatma':
      return { ...base, ...privacyNotice(imprint) };
    case 'on-bilgilendirme':
      return { ...base, ...preInformation(imprint, store) };
    case 'mesafeli-satis':
      return { ...base, ...distanceSalesContract(imprint, store) };
  }
}

/**
 * Belgenin kanonik düz metni. Kabul kaydının içerik özeti (hash) bu metinden alınır: "müşteri hangi metni onayladı"
 * sorusunun kanıtı sürüm + özet ikilisidir (08 §7.5; denetim H19). Biçim kasten sade ve kararlıdır — görsel değişiklik
 * (CSS, ikon, sıralama dışı düzen) özeti değiştirmez, metnin kendisi değişirse değiştirir. İşletme künyesi de metnin
 * parçasıdır: aynı şablon iki işletmede iki farklı özet üretir, çünkü sözleşmenin tarafı işletmedir.
 */
export function legalDocumentPlainText(d: StoreLegalDocument): string {
  const lines: string[] = [`# ${d.title}`, `surum: ${d.version}`, `belge: ${d.doc}`];
  for (const row of imprintRows(d.imprint)) lines.push(`kunye: ${row.label} = ${row.value}`);
  for (const t of d.intro) lines.push(t);
  d.sections.forEach((section, i) => {
    lines.push(`## ${i + 1}. ${section.title}`);
    for (const block of section.blocks) {
      if (block.kind === 'p') lines.push(block.text);
      else if (block.kind === 'list') for (const item of block.items) lines.push(`- ${item}`);
      else for (const row of block.rows) lines.push(`${row.label} = ${row.value}`);
    }
  });
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n');
}

// ---------------------------------------------------------------------------
// KVKK aydınlatma metni (08 §2.4-B iskeleti; saklama 08 §2.8, aktarım 08 §2.11)

function privacyNotice(i: SellerImprint): Pick<StoreLegalDocument, 'intro' | 'sections'> {
  return {
    intro: [
      `${i.legalName} olarak, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun (KVKK) 10. maddesi uyarınca, web sipariş sayfamızdan ya da WhatsApp sipariş hattımızdan sipariş veren veya bize yazan müşterilerimizi kişisel verilerinin işlenmesi hakkında bilgilendiririz.`,
      'Bu metin bir bilgilendirmedir, açık rıza metni değildir. Siparişinizi almak için sizden açık rıza istenmez.',
    ],
    sections: [
      {
        title: 'Veri sorumlusu',
        blocks: [
          p('Kişisel verilerinizin veri sorumlusu, künyesi aşağıda yer alan işletmedir:'),
          { kind: 'facts', rows: imprintRows(i) },
          p(
            `Sipariş sayfası ve WhatsApp sipariş hattı ${SITE_NAME} yazılım altyapısıyla çalışır. ${SITE_NAME}, verilerinizi yalnız bizim adımıza ve talimatımızla işleyen veri işleyendir; verilerinizi kendi amaçları için kullanmaz, başka işletmelerle paylaşmaz.`,
          ),
        ],
      },
      {
        title: 'İşlenen kişisel veriler',
        blocks: [
          list([
            'Kimlik: siparişte verdiğiniz ad ve soyad ya da WhatsApp profil adınız.',
            'İletişim: telefon numaranız ve WhatsApp kullanıcı kimliğiniz.',
            'Teslimat: teslimat adresiniz, mahalleniz, adres tarifiniz ve paylaştığınız konum.',
            'Sipariş: sipariş içeriği, tutarı, ödeme yöntemi, para üstü tercihi, sipariş notu ve sipariş değerlendirmeniz.',
            'Yazışma: WhatsApp sipariş hattımızla yazışmalarınız ve gönderdiğiniz ses kaydı, fotoğraf ve belgeler.',
            'Doğrulama: SMS doğrulama kodunun gönderildiği cep telefonu numarası ve doğrulama kaydı.',
            'İşlem güvenliği: siparişi onayladığınız andaki IP adresi, tarayıcı ve cihaz bilgisi ile zaman kaydı.',
          ]),
          p(
            'Sipariş notuna sağlık bilgisi (alerji, hastalık) yazmamanızı rica ederiz. Nota yazdığınız bilgiler yalnız o sipariş için kullanılır, müşteri kaydınıza aktarılmaz ve siparişin tamamlanmasından 30 gün sonra silinir.',
          ),
        ],
      },
      {
        title: 'İşleme amaçları ve hukuki sebepler',
        blocks: [
          list([
            'Siparişinizi almak, hazırlamak ve teslim etmek; sipariş durumunu size WhatsApp mesajı, SMS ya da takip sayfası ile bildirmek: sözleşmenin kurulması ve ifası (KVKK m.5/2-c).',
            'Siparişin sizin tarafınızdan verildiğini WhatsApp kodu ya da SMS doğrulama koduyla teyit etmek ve sahte siparişi önlemek: sözleşmenin kurulması ve ifası ile meşru menfaat (m.5/2-c, m.5/2-f).',
            'Soru, talep, iptal ve şikâyetlerinizi yanıtlamak: sözleşmenin ifası (m.5/2-c).',
            'Satış belgesi (fiş, fatura) düzenlemek, muhasebe ve yasal kayıt yükümlülüklerini yerine getirmek, yetkili kurumların taleplerini karşılamak: hukuki yükümlülük (m.5/2-ç).',
            'Kayıtlı adresinizi sonraki siparişinizde hatırlamak ve işletme içi sipariş istatistiği tutmak: sözleşmenin ifası ve meşru menfaat (m.5/2-c, m.5/2-f).',
            'Sipariş sayfasının ve sipariş kayıtlarının güvenliğini sağlamak: meşru menfaat (m.5/2-f).',
          ]),
          p('Size kampanya ya da reklam mesajı göndermeyiz. Sipariş durum mesajları yalnız bilgilendirme amaçlıdır.'),
        ],
      },
      {
        title: 'Toplama yöntemi',
        blocks: [
          p(
            'Verileriniz; web sipariş sayfasındaki sipariş formu, WhatsApp sipariş hattı, SMS doğrulaması ve telefonla verdiğiniz siparişlerde çalışanımızın sipariş paneline yaptığı giriş yoluyla, elektronik ortamda, otomatik ve kısmen otomatik yollarla toplanır.',
          ),
        ],
      },
      {
        title: 'Aktarılan taraflar ve aktarım amacı',
        blocks: [
          list([
            `${SITE_NAME} (yazılım altyapı sağlayıcısı, veri işleyen): sipariş sisteminin işletilmesi.`,
            `Cloudflare, Inc. (${SITE_NAME}'in barındırma hizmet sağlayıcısı, yurt dışı): sipariş sayfasının, takip sayfasının ve verilerin barındırılması ve yedeklenmesi. Verileriniz başta ABD ve Avrupa Birliği olmak üzere Türkiye dışındaki veri merkezlerinde işlenir ve saklanır; sipariş sayfasına bağlandığınızda bağlantınız (IP adresiniz dahil) Cloudflare ağından geçer. Bu aktarım KVKK m.9 uyarınca Kişisel Verileri Koruma Kurulu'nun ilan ettiği standart sözleşmeye dayanır.`,
            "Türkiye'deki SMS hizmet sağlayıcısı: doğrulama kodunun ve WhatsApp kullanılamadığında sipariş durumu SMS'inin gönderilmesi. Bu mesajlarda yalnız telefon numaranız, kod, işletme adı ve takip bağlantısı yer alır; adresiniz gönderilmez.",
            "Meta Platforms (WhatsApp) ve WhatsApp Business API erişimini sağlayan iş çözümü sağlayıcısı Twilio Inc. (ABD) ya da 360dialog GmbH (Almanya) (yurt dışı): WhatsApp üzerinden yazışma ve sipariş bildirimleri. Bu kanalda mesaj içeriğiniz, telefon numaranız ya da WhatsApp kullanıcı kimliğiniz ve profil adınız yurt dışında işlenir. Adresiniz ve telefon numaranız bildirim mesajlarında tekrarlanmaz; sipariş ayrıntıları yalnız takip sayfasında gösterilir. Yurt dışına aktarım KVKK m.9 hükümlerine uygun olarak yapılır.",
            'Kuryemiz ve teslimatı yapan çalışanımız: siparişin teslimi (ad, telefon, adres, sipariş ve ödeme bilgisi).',
            'Yetkili kamu kurum ve kuruluşları: yasal zorunluluk hâlinde ve talep edilen ölçüde.',
          ]),
          p(
            'Verileriniz başka işletmelerle paylaşılmaz ve pazarlama amacıyla üçüncü kişilere aktarılmaz. WhatsApp kullanmak istemezseniz web sipariş sayfasını kullanabilir ya da telefonla sipariş verebilirsiniz.',
          ),
        ],
      },
      {
        title: 'Saklama süreleri',
        blocks: [
          list([
            'Sipariş notu: sipariş tamamlandıktan (teslim, iptal ya da ret) 30 gün sonra silinir.',
            'WhatsApp ile paylaştığınız konum, ses kaydı, fotoğraf ve belgeler: 30 gün sonra silinir.',
            'WhatsApp mesaj içerikleri: 6 ay sonra silinir.',
            'Sipariş takip bağlantısı: sipariş tamamlandıktan 7 gün sonra geçersiz olur ve sayfadaki kişisel bilgiler artık gösterilmez.',
            "SMS doğrulama kayıtları 30 gün, SMS gönderim kayıtlarındaki telefon numarası en geç 90 gün sonra silinir.",
            'Ad, telefon ve adres bilgileriniz: son siparişiniz ya da son mesajınızdan itibaren en fazla 24 ay boyunca yeni bir işlem olmazsa anonim hâle getirilir.',
            'Sipariş kaydı (ürünler, tutar, tarih, ödeme yöntemi): vergi ve ticaret mevzuatındaki saklama süreleri (VUK m.253, TTK m.82) boyunca saklanır; kaydın kişisel alanları yukarıdaki süre dolunca anonim hâle getirilir.',
            'İşlem güvenliği kayıtları (IP adresi, erişim kayıtları): 1 yıl.',
            'Silinen veriler en geç 35 gün içinde yedeklerden de silinir.',
          ]),
        ],
      },
      {
        title: 'Haklarınız (KVKK m.11)',
        blocks: [
          p('KVKK m.11 uyarınca veri sorumlusuna başvurarak aşağıdaki haklarınızı kullanabilirsiniz:'),
          list([
            'Kişisel verilerinizin işlenip işlenmediğini öğrenme.',
            'İşlenmişse buna ilişkin bilgi talep etme.',
            'İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme.',
            'Yurt içinde ya da yurt dışında aktarıldığı üçüncü kişileri bilme.',
            'Eksik ya da yanlış işlenmişse düzeltilmesini isteme.',
            'KVKK m.7 çerçevesinde silinmesini ya da yok edilmesini isteme.',
            'Düzeltme, silme ve yok etme işlemlerinin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme.',
            'Münhasıran otomatik sistemlerle analiz edilmesi sonucunda aleyhinize bir sonucun ortaya çıkmasına itiraz etme.',
            'Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme.',
          ]),
          p(
            `Başvurunuzu, Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'e uygun olarak yazılı biçimde ${writtenContactPhrase(i)} iletebilirsiniz; sorularınız için ${i.phone} numaralı telefondan bize ulaşabilirsiniz. Başvurular en geç 30 gün içinde ücretsiz yanıtlanır; işlemin ayrıca bir maliyet gerektirmesi hâlinde Kişisel Verileri Koruma Kurulu'nun belirlediği tarife uygulanabilir.`,
          ),
          p("WhatsApp'tan bilgilendirme mesajı almak istemiyorsanız sipariş hattımıza DUR yazabilirsiniz; yeniden almak için BAŞLAT yazmanız yeterlidir."),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Satış koşulları (ön bilgilendirme ve sözleşmede ortak)

/** Kabul edilen ödeme yöntemleri metni (Faz 1: yalnız kapıda / kasada; online kart yok). */
export function paymentMethodsText(store: StorefrontView): string {
  const b = store.branch;
  const methods = b.paymentMethods
    .filter((m) => m !== 'online_card' && m !== 'pay_at_counter')
    .map((m) => PAYMENT_METHOD_LABELS[m].toLocaleLowerCase('tr-TR'));
  const brands = b.paymentMethods.includes('meal_card_on_delivery')
    ? b.mealCardBrands.map((x) => MEAL_CARD_BRAND_LABELS[x as MealCardBrand] ?? x).filter(Boolean)
    : [];
  const parts: string[] = [];
  if (methods.length) parts.push(`${methods.join(', ')}${brands.length ? ` (${brands.join(', ')})` : ''}`);
  if (b.acceptsPickup) parts.push('gel-al siparişlerde kasada ödeme');
  return parts.length ? `${parts.join('; ')}.` : 'sipariş formunda gösterilir.';
}

/** Teslimat bölgeleri: "Merkez: teslimat ücreti 20 TL, minimum sipariş 150 TL". */
export function zoneLines(store: StorefrontView): string[] {
  if (!store.branch.acceptsDelivery) return [];
  return store.zones.map((z) => {
    const fee = z.feeKurus > 0 ? `teslimat ücreti ${formatMoney(z.feeKurus, 'short')}` : 'teslimat ücretsiz';
    const min = z.minOrderKurus > 0 ? `, minimum sipariş ${formatMoney(z.minOrderKurus, 'short')}` : '';
    return `${z.name}: ${fee}${min}.`;
  });
}

/** Teslim türleri: paket servis (tahmini süre aralığıyla) ve gel-al (şube adresi, hazırlık süresi). */
export function fulfilmentLines(store: StorefrontView): string[] {
  const b = store.branch;
  const out: string[] = [];
  if (b.acceptsDelivery && store.zones.length) {
    const eta = deliveryEtaText(store);
    const when = eta
      ? `Tahmini teslim süresi ${eta}; kesin süre sipariş onaylanırken bildirilir ve takip sayfasında gösterilir.`
      : 'Tahmini teslim süresi sipariş onaylanırken bildirilir ve takip sayfasında gösterilir.';
    out.push(`Paket servis: ürünler sipariş formunda bildirdiğiniz adrese satıcının kuryesiyle teslim edilir. ${when}`);
  }
  if (b.acceptsPickup) {
    const where = b.address ? `${b.address} adresinden` : 'satıcının adresinden';
    out.push(`Gel-al: siparişinizi ${where} teslim alırsınız. Tahmini hazırlık süresi yaklaşık ${b.prepMinutes + (b.busyExtraMinutes ?? 0)} dakikadır.`);
  }
  if (!out.length) out.push('Teslimat seçenekleri sipariş formunda gösterilir.');
  return out;
}

const PLATFORM_ROLE_TEXT = `Bu sipariş sayfası ${SITE_NAME} yazılım altyapısıyla çalışır. ${SITE_NAME} satıcı ya da aracı değildir, satış sözleşmesinin tarafı değildir ve ödeme almaz.`;

const WITHDRAWAL_BASIS_TEXT =
  "Mesafeli Sözleşmeler Yönetmeliği m.15 uyarınca çabuk bozulabilen malların teslimine ve belirli bir tarihte ya da dönemde yapılması gereken yiyecek-içecek tedarikine ilişkin sözleşmelerde cayma hakkı kullanılamaz.";

const DEFECT_TEXT =
  "Teslim edilen ürün ayıplıysa (bozuk, eksik ya da yanlış ürün) durumu hemen satıcıya bildirin. 6502 sayılı Kanun'un 11. maddesindeki seçimlik haklarınız (bedel iadesi, bedelden indirim, ücretsiz onarım ya da değişim) saklıdır.";

function complaintText(i: SellerImprint): string {
  return `Talep ve şikâyetlerinizi satıcıya ${contactPhrase(i)} iletebilirsiniz. Uyuşmazlıklarda, Ticaret Bakanlığınca her yıl belirlenen parasal sınırlar içinde yerleşim yerinizdeki ya da işlemin yapıldığı yerdeki tüketici hakem heyetine, bu sınırların üzerinde tüketici mahkemesine başvurabilirsiniz.`;
}

// ---------------------------------------------------------------------------
// Ön bilgilendirme formu (Mesafeli Sözleşmeler Yönetmeliği m.5; 08 §4.4)

function preInformation(i: SellerImprint, store: StorefrontView): Pick<StoreLegalDocument, 'intro' | 'sections'> {
  const zones = zoneLines(store);
  return {
    intro: [
      "6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği'nin 5. maddesi uyarınca, siparişiniz kesinleşmeden önce aşağıdaki konularda bilgilendirilirsiniz.",
      'Siparişinize özgü ürün, adet, fiyat, teslimat ücreti ve toplam tutar "Siparişi tamamla" sayfasındaki sipariş özetinde, siparişten sonra da takip sayfanızda gösterilir; bu form o özetle birlikte geçerlidir.',
    ],
    sections: [
      { title: 'Satıcı bilgileri', blocks: [{ kind: 'facts', rows: imprintRows(i) }, p(PLATFORM_ROLE_TEXT)] },
      {
        title: 'Sözleşme konusu ürünlerin temel nitelikleri',
        blocks: [
          p(
            'Sipariş anında sepetinizde seçtiğiniz yiyecek ve içecekler. Ürünlerin adı, seçenekleri, adedi ve birim fiyatı sipariş özetinde; ürün açıklamaları menüde yer alır. Ürünler siparişiniz üzerine hazırlanır.',
          ),
        ],
      },
      {
        title: 'Fiyat, teslimat ücreti ve toplam tutar',
        blocks: [
          list([
            'Menüdeki fiyatlar Türk lirası cinsindendir ve KDV dahil tüm vergileri içerir.',
            'Paket serviste teslimat ücreti bölgeye göre belirlenir ve sipariş özetinde ayrı satırda gösterilir. Gel-al siparişlerde teslimat ücreti alınmaz.',
            'Teslimat ücreti dışında ek ücret (servis ücreti, kuver, paketleme ücreti) alınmaz; kapıda kartla ödemeye ek ücret uygulanmaz.',
            'KDV dahil toplam tutar "Siparişi onayla" butonunda gösterilir.',
          ]),
          ...(zones.length ? [p('Teslimat bölgeleri:'), list(zones)] : []),
        ],
      },
      {
        title: 'Ödeme',
        blocks: [
          p(`Ödeme teslimatta ya da gel-al siparişlerde teslim alırken doğrudan satıcıya yapılır; online ödeme alınmaz. Kabul edilen yöntemler: ${paymentMethodsText(store)}`),
          p('Gıda siparişlerinde kredi kartıyla taksit yapılamaz.'),
        ],
      },
      { title: 'Teslimat', blocks: [list(fulfilmentLines(store))] },
      {
        title: 'Cayma hakkı',
        blocks: [p(WITHDRAWAL_EXCEPTION_TEXT), p(WITHDRAWAL_BASIS_TEXT), p(DEFECT_TEXT)],
      },
      {
        title: 'İptal',
        blocks: [
          p(
            'Satıcı siparişinizi onaylamadan önce takip sayfasından siparişi iptal edebilirsiniz. Onaydan sonraki iptal talebi satıcının onayına bağlıdır. Satıcı siparişi onaylamazsa ya da süresi içinde yanıt vermezse sipariş iptal edilir ve size bildirilir; bu durumda ödeme yükümlülüğü doğmaz.',
          ),
        ],
      },
      { title: 'Şikâyet ve başvuru yolları', blocks: [p(complaintText(i))] },
      {
        title: 'Onay ve kayıt',
        blocks: [
          p(
            '"Siparişi onayla"ya bastığınızda siparişiniz kesinleşir ve ödeme yükümlülüğü doğar. Onayladığınız ön bilgilendirme formunun ve mesafeli satış sözleşmesinin sürümü, onay zamanıyla birlikte siparişinize bağlanır. Sipariş özeti ve takip bağlantısı WhatsApp sohbetinizde ya da SMS ile size iletilir; takip sayfası sipariş tamamlandıktan sonra 7 gün açık kalır.',
          ),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mesafeli satış sözleşmesi (08 §4.4)

function distanceSalesContract(i: SellerImprint, store: StorefrontView): Pick<StoreLegalDocument, 'intro' | 'sections'> {
  return {
    intro: [
      'Bu sözleşme, aşağıda bilgileri yer alan satıcı ile satıcının web sipariş sayfası ya da WhatsApp sipariş hattı üzerinden sipariş veren alıcı arasında, elektronik ortamda kurulur.',
    ],
    sections: [
      {
        title: 'Taraflar',
        blocks: [
          p('Satıcı:'),
          { kind: 'facts', rows: imprintRows(i) },
          p(
            'Alıcı: siparişi veren ve sipariş formunda adı, telefon numarası ve paket serviste teslimat adresi yer alan kişi. Alıcı bilgileri sipariş kaydında saklanır ve sipariş takip sayfasında gösterilir.',
          ),
          p(PLATFORM_ROLE_TEXT),
        ],
      },
      {
        title: 'Sözleşmenin konusu',
        blocks: [
          p(
            "Sözleşmenin konusu, alıcının elektronik ortamda sipariş verdiği ve nitelikleri ile satış fiyatı sipariş özetinde belirtilen yiyecek ve içeceklerin satışı ve teslimidir. Taraflar 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümlerine tabidir.",
          ),
        ],
      },
      {
        title: 'Ürünler ve bedel',
        blocks: [
          p(
            'Ürünlerin adı, seçenekleri, adedi, KDV dahil satış fiyatı, teslimat ücreti ve toplam tutar sipariş özetinde ve sipariş takip sayfasında yer alır. Teslimat ücreti dışında ek ücret alınmaz.',
          ),
        ],
      },
      {
        title: 'Sözleşmenin kurulması',
        blocks: [
          p(
            'Alıcı ön bilgilendirme formunu okuyup onayladıktan sonra "Siparişi onayla"ya bastığında sözleşme kurulur ve alıcının ödeme yükümlülüğü doğar. WhatsApp ile onaylama ya da SMS doğrulama kodu, siparişin alıcı tarafından verildiğini teyit eden bir güvenlik adımıdır; ayrı bir sözleşme onayı değildir.',
          ),
          p('Satıcı siparişi onaylamazsa ya da süresi içinde yanıt vermezse sipariş iptal edilir ve taraflar karşılıklı yükümlülüklerinden kurtulur.'),
        ],
      },
      {
        title: 'Ödeme',
        blocks: [
          p(
            `Bedel, sipariş formunda seçilen yöntemle teslimatta ya da gel-al siparişlerde kasada doğrudan satıcıya ödenir. Kabul edilen yöntemler: ${paymentMethodsText(store)} Kredi kartıyla taksit yapılmaz. Satıcı, satış belgesini (fiş ya da fatura) mevzuata uygun olarak düzenler.`,
          ),
        ],
      },
      { title: 'Teslimat', blocks: [list(fulfilmentLines(store)), p('Adres bulunamaz ya da teslim alacak kimse olmazsa satıcı alıcıyı telefonla arar.')] },
      { title: 'Cayma hakkı', blocks: [p(WITHDRAWAL_EXCEPTION_TEXT), p(WITHDRAWAL_BASIS_TEXT)] },
      {
        title: 'İptal',
        blocks: [
          p(
            'Satıcı siparişi onaylamadan önce alıcı takip sayfasından siparişi iptal edebilir. Onaydan sonraki iptal talebi satıcının onayına bağlıdır. Satıcı, ürünün tükenmesi ya da teslimatın mümkün olmaması hâlinde siparişi iptal edebilir ve bunu alıcıya bildirir; bu durumda alıcıdan ödeme alınmaz.',
          ),
        ],
      },
      { title: 'Ayıplı ürün', blocks: [p(DEFECT_TEXT)] },
      { title: 'Uyuşmazlıkların çözümü', blocks: [p(complaintText(i))] },
      {
        title: 'Kayıt ve yürürlük',
        blocks: [
          p(
            'Sipariş özeti ve takip bağlantısı alıcıya WhatsApp ya da SMS ile iletilir. Onaylanan sözleşme sürümü siparişe bağlanarak saklanır. Sözleşme, alıcının siparişi elektronik ortamda onayladığı anda yürürlüğe girer.',
          ),
        ],
      },
    ],
  };
}
