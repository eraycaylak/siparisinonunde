// SSS (05 C.3.4; kısa cevaplar). Hitap "sen" (05 C.3). Varsayılan WhatsApp modeli ortak numaradır (00 §12a madde 8):
// tüm dükkanlar tek "Yemek Gelsin" numarasında, dükkan kodu/QR ile; işletmenin kendi numarası isteğe bağlıdır.

export interface FaqItem {
  id: string;
  q: string;
  a: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    id: 'numara-gerekir-mi',
    q: 'WhatsApp numarası bağlamam gerekiyor mu?',
    a: 'Hayır. Varsayılan olarak tüm dükkanlar tek Yemek Gelsin WhatsApp numarasını kullanır. Sana özel bir dükkan kodu, müşteri bağlantısı ve QR verilir; müşterin QR’ını okutunca ya da bağlantına dokununca sohbet senin dükkanınla açılır ve her mesaj dükkanının adıyla başlar. Telefonundaki WhatsApp’a dokunulmaz.',
  },
  {
    id: 'baska-dukkan',
    q: 'Aynı numarada başka dükkanlar da var; müşterim karışır mı?',
    a: 'Senin QR’ını ya da bağlantını kullanan müşteri doğrudan senin dükkanına bağlanır, siparişi yalnız senin paneline düşer. Müşteri kodsuz yazarsa ya da “dükkanlar” derse hangi dükkandan sipariş vereceği sorulur. Müşteri listen, sohbetlerin ve siparişlerin başka dükkanlarla paylaşılmaz.',
  },
  {
    id: 'kendi-numara',
    q: 'Kendi WhatsApp numaramdan sipariş alabilir miyim?',
    a: 'Evet, isteğe bağlı. Kendi numaranı resmi WhatsApp Business Platform’a bir aracı firma (360dialog) ya da doğrudan Meta üzerinden bağlarız; müşterilerin o zaman doğrudan senin numarana yazar. Geçmek için bize yazman yeterli.',
  },
  {
    id: 'komisyon',
    q: 'Sipariş başına komisyon alıyor musunuz?',
    a: 'Hayır. Sabit aylık ücret ödersin. Sipariş başına ücret, ciro yüzdesi ya da ödemelerinden pay almayız.',
  },
  {
    id: 'meta-ucreti',
    q: 'WhatsApp mesaj ücreti var mı, kim öder?',
    a: 'Var. Meta, işletmelerin gönderdiği WhatsApp mesajları için küçük bir ücret alır. Varsayılan ortak numarada mesajlar platform hesabından gider; ayrı bir Meta hesabı ya da kart tanımlaman gerekmez. Bu ücretin pakete yansıtılıp yansıtılmayacağı henüz kesinleşmedi; değişirse önceden bildiririz. Kendi numaranı bağlarsan ücret senin Meta hesabından çekilir ve aboneliğe dahil değildir; her numarada ayda ilk 1.000 servis mesajı ücretsizdir.',
  },
  {
    id: 'kart-ekleme',
    q: 'WhatsApp için kart tanımlamam gerekiyor mu?',
    a: 'Ortak numarada hayır. Kendi numaranı bağlarsan evet: Meta, müşterilerine kendi numarasından WhatsApp mesajı gönderen her işletmeden kendi hesabına ödeme yöntemi tanımlamasını ister. Kartı sen tanımlarsın; biz görmeyiz, bize kart vermezsin.',
  },
  {
    id: 'uygulama',
    q: 'Müşterim uygulama indirmek ya da üye olmak zorunda mı?',
    a: 'Hayır. WhatsApp’tan yazar ya da QR’ı okutur; menü telefonunun tarayıcısında açılır.',
  },
  {
    id: 'whatsappsiz',
    q: 'Müşterimin WhatsApp’ı yoksa?',
    a: 'Web menüden sipariş verir, telefonuna gelen SMS koduyla siparişini doğrular. Siparişin durumunu takip linkinden izler; “onaylandı” ve “iptal” gibi önemli durumlar ona SMS ile de gider. WhatsApp’ta bir arıza olursa aynı yol kendiliğinden devreye girer, yani siparişin durmaz. Bu SMS’ler aboneliğine dahildir (Esnaf’ta ayda 100, Pro’da 300, Zincir’de şube başına 300 SMS’e kadar).',
  },
  {
    id: 'pazaryeri',
    q: 'Pazaryerinden çıkmam mı gerekiyor?',
    a: 'Hayır. Keşif pazaryerinde kalsın; seni zaten tanıyan müşterin kendi kanalından sipariş versin. Paketine kart koymadan önce pazaryeri sözleşmendeki yönlendirme maddelerine bakmanı öneririz.',
  },
  {
    id: 'kacirirsam',
    q: 'Siparişi kaçırırsam ne olur?',
    a: 'Yeni sipariş panelde sesli uyarıyla düşer. 2 dakikada onaylanmazsa telefonuna WhatsApp’tan, 5. dakikada SMS’le uyarı gelir. 10. dakikada müşterine “işletme henüz onaylamadı” bilgisi gider; 15 dakikada yanıt verilmezse sipariş iptal edilir ve müşterine özürle birlikte telefon numaran iletilir. İptal süresini 10–30 dakika arasında ayarlayabilirsin; müşteriye bilgi her zaman iptalden en az 5 dakika önce gider.',
  },
  {
    id: 'odeme',
    q: 'Ödemeyi nasıl alırım?',
    a: 'Kapıda nakit, kapıda kart (kendi POS cihazınla) ve kapıda yemek kartı; gel-alda kasada. Online kartla ödeme yakında, kendi ödeme kuruluşu hesabınla. Müşterinin parası bize hiç uğramaz.',
  },
  {
    id: 'kurye',
    q: 'Kurye veriyor musunuz?',
    a: 'Hayır, kurye senin. Kuryen uygulama indirmeden siparişlerini görür, “Yola çıktım” ve “Teslim ettim”e basar; müşterine mesaj kendiliğinden gider.',
  },
  {
    id: 'kurulum-suresi',
    q: 'Kurulum ne kadar sürer?',
    a: 'Ortak numara hazır olduğu için WhatsApp tarafında beklemen gerekmez; asıl süreyi menünün büyüklüğü belirler. İstersen menünü de biz gireriz.',
  },
  {
    id: 'taahhut',
    q: 'Taahhüt var mı, nasıl bırakırım?',
    a: 'Aylık planda taahhüt yok; dönem sonunda iptal edersin. Müşteri listeni ve sipariş geçmişini istediğin zaman dışa aktarırsın.',
  },
  {
    id: 'veriler',
    q: 'Müşteri verileri kimin?',
    a: 'Senin. Biz yalnız hizmeti sağlamak için işleriz. Verilerin Cloudflare’in bulut altyapısında (yurt dışı) KVKK’nın yurt dışına aktarım kurallarına uygun olarak barındırılır, başka işletmelerle paylaşılmaz, müşterilerine biz pazarlama yapmayız.',
  },
  {
    id: 'bot',
    q: 'Bot müşterilerimle kendi kafasına göre konuşur mu?',
    a: 'Hayır. Bot selam verir, menü linkini ve sipariş bilgisini yollar. Müşteri “Yetkiliyle görüş” dediğinde sen devralırsın; istersen botu tamamen kapatırsın. Alkol, tütün ve ilaç ise WhatsApp’tan satılamaz.',
  },
];

/** Ana sayfadaki 5 soru (05 C.3.1). */
export const HOME_FAQ_IDS = ['numara-gerekir-mi', 'komisyon', 'meta-ucreti', 'uygulama', 'taahhut'] as const;
