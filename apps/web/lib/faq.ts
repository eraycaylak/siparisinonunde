// SSS (05 C.3.4; 15 soru, kısa cevaplar). Hitap "sen" (05 C.3).

export interface FaqItem {
  id: string;
  q: string;
  a: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    id: 'numaram-gider-mi',
    q: 'Numaram gider mi?',
    a: 'Hayır. Mevcut WhatsApp Business numaranı bağlarız. Telefonundaki uygulamadan yazmaya devam edersin, siparişler aynı anda panele düşer. İstersen sipariş için yeni bir numara da bağlayabilirsin.',
  },
  {
    id: 'normal-whatsapp',
    q: 'Normal (yeşil) WhatsApp kullanıyorum, olur mu?',
    a: 'Olur. Önce aynı numarayla ücretsiz WhatsApp Business uygulamasına geçersin; kurulumda adım adım gösteriyoruz.',
  },
  {
    id: 'komisyon',
    q: 'Sipariş başına komisyon alıyor musunuz?',
    a: 'Hayır. Sabit aylık ücret ödersin. Sipariş başına ücret, ciro yüzdesi ya da ödemelerinden pay almayız.',
  },
  {
    id: 'meta-ucreti',
    q: 'WhatsApp mesaj ücreti var mı, kim öder?',
    a: 'Var. Meta, müşterine giden mesajlar için küçük bir ücret alır ve bunu senin WhatsApp hesabına tanımladığın ödeme yönteminden çeker; aboneliğe dahil değildir. Her numarada ayda ilk 1.000 servis mesajı ücretsizdir. Tutarı panelinde her ay görürsün.',
  },
  {
    id: 'kart-ekleme',
    q: 'Neden WhatsApp hesabıma ödeme yöntemi eklemem gerekiyor? Denemede de mi?',
    a: 'Evet, denemede de. Meta, müşterilerine WhatsApp mesajı gönderen her işletmeden ödeme yöntemi tanımlamasını istiyor. Bu yüzden WhatsApp bağlantısını kurarken ödeme yöntemi adımı zorunludur. Kartı sen tanımlarsın; biz görmeyiz, bize kart vermezsin. WhatsApp bağlantın tamamlanana kadar web siparişlerini SMS doğrulamasıyla almaya başlayabilirsin.',
  },
  {
    id: 'uygulama',
    q: 'Müşterim uygulama indirmek ya da üye olmak zorunda mı?',
    a: 'Hayır. WhatsApp’tan yazar ya da QR’ı okutur; menü telefonunun tarayıcısında açılır.',
  },
  {
    id: 'whatsappsiz',
    q: 'Müşterimin WhatsApp’ı yoksa?',
    a: 'Web menüden sipariş verir, telefonuna gelen SMS koduyla siparişini doğrular. Siparişin durumunu takip linkinden izler; “onaylandı” ve “iptal” gibi önemli durumlar ona SMS ile de gider. WhatsApp bağlantın henüz tamamlanmadıysa ya da WhatsApp’ta bir arıza olursa aynı yol kendiliğinden devreye girer, yani siparişin durmaz. Bu SMS’ler aboneliğine dahildir (Esnaf’ta ayda 100, Pro’da 300, Zincir’de şube başına 300 SMS’e kadar).',
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
    a: 'WhatsApp bağlantısı kısa bir adımdır; asıl süreyi menünün büyüklüğü belirler. Web siparişini WhatsApp bağlantısı bitmeden de almaya başlayabilirsin. İstersen biz kurarız.',
  },
  {
    id: 'taahhut',
    q: 'Taahhüt var mı, nasıl bırakırım?',
    a: 'Aylık planda taahhüt yok; dönem sonunda iptal edersin. Müşteri listeni ve sipariş geçmişini istediğin zaman dışa aktarırsın.',
  },
  {
    id: 'veriler',
    q: 'Müşteri verileri kimin?',
    a: 'Senin. Biz yalnız hizmeti sağlamak için işleriz. Verilerin Türkiye’deki sunucularda barındırılır, başka işletmelerle paylaşılmaz, müşterilerine biz pazarlama yapmayız.',
  },
  {
    id: 'bot',
    q: 'Bot müşterilerimle kendi kafasına göre konuşur mu?',
    a: 'Hayır. Bot selam verir, menü linkini ve sipariş bilgisini yollar. Müşteri “Yetkiliyle görüş” dediğinde sen devralırsın; istersen botu tamamen kapatırsın. Alkol, tütün ve ilaç ise WhatsApp’tan satılamaz.',
  },
];

/** Ana sayfadaki 5 soru (05 C.3.1). */
export const HOME_FAQ_IDS = ['numaram-gider-mi', 'komisyon', 'meta-ucreti', 'uygulama', 'taahhut'] as const;
