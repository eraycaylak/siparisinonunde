'use client';

// Checkout → kalıcı adres geçişi (denetim 2026-10-04 madde 3.1 / H6).
// Akış B'de sipariş `awaiting_customer` doğduğunda doğrulama ekranı checkout URL'inde çizilmez: sekme yenilenirse
// kod ve kalan süre kaybolur, sepet de temizlenmiş olduğu için müşteri siparişini takip edemez.
// Bu bileşen tek iş yapar: /t/<token> adresine `router.replace` ile geçer (geri tuşu boşalmış checkout'a değil
// vitrine döner). Doğrulama ekranının kendisi `@/components/orders/verification-screen` içindedir ve yalnız takip
// sayfasından çizilir; kod, kalan süre ve sipariş özeti sunucudan (GET /store/track/:token) okunur.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Phone } from 'lucide-react';
import { Alert, Spinner } from '@/components/ui';
import { storefrontHref } from '@/lib/storefront-url';
import { telHref } from './labels';
import { trackingPath } from './track-link';

export interface VerificationHandoffProps {
  token: string;
  /**
   * Checkout'un geçtiği, bu geçişte kullanılmayan alanlar: kalıcı adreste hepsi sunucudan yeniden okunur
   * (tek doğruluk kaynağı takip yanıtı). İmza, çağıran tarafı değiştirmeden uyumlu kalsın diye korunuyor.
   */
  initial?: unknown;
  phone?: string;
  slug?: string;
  businessName?: string;
  businessPhone?: string | null;
  onChanged?: () => void;
}

export function VerificationHandoff({ slug, businessName, businessPhone, token }: VerificationHandoffProps) {
  const router = useRouter();
  // Token sunucudan gelir; yine de sınırda doğrulanır — `router.replace`'e denetlenmemiş dizge verilmez.
  const path = trackingPath(token);
  useEffect(() => {
    if (path) router.replace(path);
  }, [path, router]);

  // Token okunamadıysa sipariş yine de oluştu: müşteriyi boş bir yükleniyor ekranında bırakmayız.
  if (!path) {
    return (
      <Alert variant="warning" title="Siparişiniz alındı">
        Takip sayfanız açılamadı. Siparişinizin durumu için lütfen {businessName ?? 'işletmeyi'} arayın.
        {businessPhone ? (
          <a href={telHref(businessPhone)} className="mt-2 inline-flex min-h-hit items-center gap-2 font-bold underline underline-offset-4">
            <Phone aria-hidden className="size-5" /> İşletmeyi ara
          </a>
        ) : null}
        {slug ? (
          <a href={storefrontHref(slug)} className="mt-2 block font-semibold underline underline-offset-4">
            Menüye dön
          </a>
        ) : null}
      </Alert>
    );
  }
  return <Spinner label="Sipariş sayfanız açılıyor" />;
}
