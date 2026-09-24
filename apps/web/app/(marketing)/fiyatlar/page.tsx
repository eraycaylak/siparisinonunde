import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { Info } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { JsonLd } from '@/components/common/json-ld';
import { CtaBand } from '@/components/marketing/cta-band';
import { FaqList } from '@/components/marketing/faq-list';
import { PlanMatrix } from '@/components/marketing/plan-matrix';
import { PricingCards } from '@/components/marketing/pricing-cards';
import { Section } from '@/components/marketing/section';
import { FAQ } from '@/lib/faq';
import { formatLira } from '@/lib/format';
import { FOUNDER_DISCOUNT, FOUNDER_MONTHS, FOUNDER_SLOTS, PLANS, SETUP_FEE_TL, TRIAL_DAYS, VAT_RATE, withVat } from '@/lib/plans';
import { SITE_NAME, getSiteUrl } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Fiyatlar',
  description: 'Esnaf 990 TL, Pro 1.790 TL, Zincir 2.990 TL/şube (KDV hariç). Sipariş başına ücret, ciro yüzdesi yok. 14 gün ücretsiz deneme.',
  path: '/fiyatlar',
});

export default function PricingPage() {
  const faq = FAQ.filter((f) => ['meta-ucreti', 'kart-ekleme', 'taahhut', 'whatsappsiz'].includes(f.id));
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: SITE_NAME,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: `${getSiteUrl()}/fiyatlar`,
          offers: PLANS.filter((p) => p.availableNow).map((p) => ({
            '@type': 'Offer',
            name: p.name,
            price: p.monthlyTl,
            priceCurrency: 'TRY',
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: p.monthlyTl,
              priceCurrency: 'TRY',
              unitText: 'ay',
              valueAddedTaxIncluded: false,
            },
          })),
        }}
      />
      <Section
        as="h1"
        id="fiyatlar"
        eyebrow="Fiyatlar"
        title="Sabit aylık ücret. Sipariş başına ücret yok."
        lead={`Ciro yüzdesi yok, ödemelerinden pay yok. Aylık planda taahhüt yok. ${TRIAL_DAYS} gün ücretsiz dene, bize kart verme.`}
      >
        <PricingCards />
        <div className="mt-10 grid gap-4 rounded-xl border border-border bg-surface p-6 text-base leading-7 text-fg">
          <p className="flex items-start gap-2 font-semibold">
            <Info aria-hidden className="mt-1 size-5 shrink-0 text-fg-muted" />
            Fiyatlara KDV (%{VAT_RATE * 100}) dahil değildir; KDV dahil tutar her fiyatın altında yazar.
          </p>
          <p>
            <strong>WhatsApp (Meta) mesaj ücretleri abonelik fiyatına dahil değildir; işletmenin kendi Meta hesabından tahsil edilir.</strong>{' '}
            Her numarada ayda ilk 1.000 servis mesajı ücretsizdir. Günde 30 siparişte tahmini tutar ayda yaklaşık 113–152 TL’dir (kura ve Meta
            tarifesine göre değişir).
          </p>
          <p>
            <strong>Kurucu üye (ilk {FOUNDER_SLOTS} işletme):</strong> {FOUNDER_MONTHS} ay boyunca liste fiyatından %{FOUNDER_DISCOUNT * 100}{' '}
            indirim. İndirim oranı sabittir; liste fiyatı yıllık TÜFE güncellemesine tabidir.
          </p>
          <p>
            <strong>Biz kuralım:</strong> menün, WhatsApp bağlantın, QR stand ve paket kartı tasarımın bizden. {formatLira(SETUP_FEE_TL)} + KDV (
            {formatLira(withVat(SETUP_FEE_TL))}) tek sefer; ilk {FOUNDER_SLOTS} işletmeye ücretsiz.
          </p>
          <p>
            <strong>SMS:</strong> Müşteri doğrulama (SMS kodu) ve kritik durum SMS’leri aboneliğe dahildir: Esnaf’ta ayda 100, Pro’da 300,
            Zincir’de şube başına 300 SMS’e kadar (adil kullanım). Aşımda seni uyarırız.
          </p>
          <p>
            {TRIAL_DAYS} gün ücretsiz dene, bize kart verme. WhatsApp mesajlarının gitmesi için WhatsApp hesabına ödeme yöntemi eklemen gerekir;
            bu Meta’nın kuralıdır.
          </p>
          <p className="text-fg-muted">Zincir paketi çoklu şube özelliğiyle birlikte satışa açılır; 5 ve üzeri şube için özel teklif veririz.</p>
        </div>
      </Section>

      <Section id="karsilastir" tone="muted" eyebrow="Paket içeriği" title="Hangi pakette ne var?">
        <PlanMatrix />
      </Section>

      <Section id="fiyat-sss" eyebrow="SSS" title="Fiyatla ilgili sorular">
        <FaqList items={faq} />
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/hesaplayici" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Ne kadar tasarruf ederim?
          </Link>
          <Link href="/demo" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Demo iste
          </Link>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
