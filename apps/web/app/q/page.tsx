import { notFound } from 'next/navigation';
import { metadata as qrNotFoundMetadata } from './not-found';

// /q (kodsuz) ve bilinmeyen QR kodunun yönlendirildiği adres: listesiz nötr sayfa (not-found.tsx, 404).
// Başlık: Next iç içe not-found.tsx'in `metadata`'sını uygulamaz; sayfa vermezse kök düzenin "Yemek Gelsin · …" başlığı
// ve önizlemesi görünürdü. Nötr metadata burada yeniden dışa aktarılır.
export const metadata = qrNotFoundMetadata;

export default function QrIndex(): never {
  notFound();
}
