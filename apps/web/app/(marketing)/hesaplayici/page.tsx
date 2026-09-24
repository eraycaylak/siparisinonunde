import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { Calculator } from '@/components/marketing/calculator';
import { Section } from '@/components/marketing/section';

export const metadata: Metadata = pageMetadata({
  title: 'Komisyon hesaplayıcı',
  description: 'Pazaryerine ayda ne ödediğini ve siparişlerinin bir kısmı kendi kanalına geçerse ne kazanacağını hesapla. Sonuç için e-posta istemiyoruz.',
  path: '/hesaplayici',
});

export default function CalculatorPage() {
  return (
    <Section
      as="h1"
      id="hesaplayici"
      eyebrow="Komisyon hesaplayıcı"
      title="Pazaryerine ne ödüyorsun, kendi kanalında ne kazanırsın?"
      lead="Rakamlarını gir, sonucu hemen gör. Sonuç için e-posta ya da telefon istemiyoruz."
    >
      <Calculator />
    </Section>
  );
}
