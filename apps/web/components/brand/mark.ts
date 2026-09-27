// Yemek Gelsin işaretinin vektör çizimi (JSX'siz: bileşen ve testler aynı kaynağı kullanır).

/*
 * Yemek Gelsin işareti (00 §12a madde 9, 12 §3.1): "YG" monogramı. Y'nin sağ kolu önden geçip G'nin üst kavisine akar;
 * sol kol ve G'nin alt çanağı onun arkasında kalır (ince ayrım boşlukları). G'nin çapraz çizgisi üç dişli bir çataldır.
 * Proje sahibinin logosundan (public/brand/yemekgelsinnet.png) vektöre çevrildi: doğrular, elips yayları ve köşe
 * yumuşatmaları görselin maskesine uydurularak kuruldu. Aynı çizim: public/brand/yemekgelsin-mark.svg. Uygulama simgeleri
 * (app/icon.svg, app/favicon.ico, app/apple-icon.png, public/brand/icon-192.png, icon-512.png, badge-96.png) bu yoldan
 * üretildi; küçük boyutlarda (favicon, bildirim rozeti) sade siluet kullanıldı. Çizim değişirse simgeler yeniden üretilir.
 */

/** İşaretin çizim alanı (en/boy ≈ 1,49). */
export const MARK_VIEWBOX = '0 0 451 302';

/** Tam işaret: sol kol, şerit (Y'nin sağ kolu + G'nin üst kavisi), G'nin alt çanağı + çatal; dişler boşluktur (evenodd). */
export const MARK_PATH =
  'M0 0L111.5 165.1L158.8 100.7L102.4 16.9A38.2 38.2 0 0 0 70.7 0ZM116.8 171.4L116.8 274.4L171.1 200.8L231.1 119.4C241.8 104.9 247 79.1 287.6 68.4A90.8 90.8 0 0 1 379.4 96.9L429.4 51.8A129.7 103.2 0 0 0 205.1 51.3ZM174 210.3A142 134.4 0 0 0 450.6 167.6L450.6 121.9L340 121.9A57 57 0 0 0 295.1 143.8L267 179.7L289.5 179.7C314.5 179.7 314.5 195.7 339.5 195.7L380.8 195.7A78.4 70.1 0 1 1 242.6 131L279.8 79.2C248.8 90.8 247.3 110.9 237.5 124.1ZM346.8 136.4H411.8A4.2 4.2 0 0 1 411.8 144.8H346.8A4.2 4.2 0 0 1 346.8 136.4ZM346.8 154.4H411.8A4.2 4.2 0 0 1 411.8 162.8H346.8A4.2 4.2 0 0 1 346.8 154.4ZM346.8 172.4H411.8A4.2 4.2 0 0 1 411.8 180.8H346.8A4.2 4.2 0 0 1 346.8 172.4Z';

/** Sade siluet (yaklaşık 20 px yüksekliğin altı): ayrım boşluğu ve çatal dişi yok. */
export const MARK_PATH_SIMPLE =
  'M0 0L116.8 173L116.8 274.4L171.1 200.8A142 134.4 0 0 0 450.6 167.6L450.6 121.9L340 121.9A57 57 0 0 0 295.1 143.8L267 179.7L289.5 179.7C314.5 179.7 314.5 195.7 339.5 195.7L380.8 195.7A78.4 70.1 0 1 1 242.6 131L287.6 68.4A90.8 90.8 0 0 1 379.4 96.9L429.4 51.8A129.7 103.2 0 0 0 205.1 51.3L163.5 107.8L102.4 16.9A38.2 38.2 0 0 0 70.7 0Z';
