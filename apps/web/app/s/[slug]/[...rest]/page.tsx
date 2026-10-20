import { notFound } from 'next/navigation';
import { metadata as storefrontNotFoundMetadata } from '../../not-found';

// Vitrin altında eşleşmeyen yol (/s/{slug}/olmayan-sayfa; alt alan adında {slug}.yemekgelsin.net/olmayan-sayfa proxy ile
// buraya yazılır). Bu dosya olmasa Next kök 404'ü (app/not-found.tsx) gösterirdi: "Ana sayfaya dön" ve "İşletme paneli"
// bağlantıları ve "· Yemek Gelsin" başlığı vitrin müşterisine görünürdü (00 §12a madde 11 "yalnız yazılım"). notFound()
// en yakın sınıra, platform/panel bağlantısı göstermeyen app/s/not-found.tsx'e düşer. Daha özel yollar (siparis,
// yasal/[doc]) bu yakalayıcıdan önce eşleşir.
//
// Başlık: iç içe not-found.tsx'in `metadata`'sı Next'te uygulanmaz (yalnız kök/global not-found); sayfa kendi metadata'sını
// vermezse kök düzenin "Yemek Gelsin · …" başlığı ve önizlemesi görünürdü. Vitrin 404'ünün nötr metadata'sı burada da verilir.
export const metadata = storefrontNotFoundMetadata;

export default function StorefrontUnknownPath(): never {
  notFound();
}
