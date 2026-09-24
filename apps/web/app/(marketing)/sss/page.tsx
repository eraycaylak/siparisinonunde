import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { JsonLd } from '@/components/common/json-ld';
import { CtaBand } from '@/components/marketing/cta-band';
import { FaqList } from '@/components/marketing/faq-list';
import { Section } from '@/components/marketing/section';
import { FAQ } from '@/lib/faq';

export const metadata: Metadata = pageMetadata({
  title: 'Sık sorulan sorular',
  description: 'Numaram gider mi, komisyon var mı, Meta ücreti kimde, kurulum ne kadar sürer? Kısa cevaplar.',
  path: '/sss',
});

export default function FaqPage() {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }}
      />
      <Section as="h1" id="sss" eyebrow="SSS" title="Sık sorulan sorular" lead="Aradığını bulamazsan demo formundan yaz; seni arayalım.">
        <FaqList items={FAQ} headingLevel="h2" />
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/demo" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Demo iste
          </Link>
          <Link href="/fiyatlar" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Fiyatlar
          </Link>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
