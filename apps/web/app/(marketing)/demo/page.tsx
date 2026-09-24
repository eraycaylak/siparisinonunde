import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { CalendarClock, Calculator, PhoneCall, Store } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { DemoForm } from '@/components/marketing/demo-form';
import { Section } from '@/components/marketing/section';

export const metadata: Metadata = pageMetadata({
  title: 'Demo iste',
  description: 'Kendi telefonundan demo işletmemize sipariş ver, tablette sesi duy, “Onaylandı” mesajı telefonuna gelsin.',
  path: '/demo',
});

const DEMO_STORE_SLUG = process.env.NEXT_PUBLIC_DEMO_STORE_SLUG ?? 'bozok-pide';

const NEXT_STEPS = [
  { text: '1 iş günü içinde arıyoruz', Icon: PhoneCall },
  { text: 'Yüz yüze ya da görüntülü 15 dakikalık demo', Icon: CalendarClock },
  { text: 'Kendi rakamlarınla hesap', Icon: Calculator },
];

export default function DemoPage() {
  return (
    <Section
      as="h1"
      id="demo"
      eyebrow="Demo"
      title="15 dakikada kendi telefonunda gör."
      lead="Kendi telefonundan demo işletmemize sipariş ver, tablette sesi duy, “Onaylandı” mesajı telefonuna gelsin. Sonra kendi rakamlarınla ne kadar tasarruf edeceğini birlikte hesaplayalım."
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <DemoForm />
        <aside className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-surface p-6">
            <h2 className="text-lg font-bold text-fg">Ne olacak?</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {NEXT_STEPS.map(({ text, Icon }) => (
                <li key={text} className="flex items-center gap-3 text-base text-fg">
                  <Icon aria-hidden className="size-5 shrink-0 text-fg-muted" />
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-surface-raised p-6">
            <Store aria-hidden className="size-7 text-fg" />
            <h2 className="mt-2 text-lg font-bold text-fg">Demo menüye göz at</h2>
            <p className="mt-1 text-base text-fg-muted">Bu bir demo işletmedir, sipariş teslim edilmez.</p>
            <Link href={`/s/${DEMO_STORE_SLUG}`} className={`${buttonVariants({ variant: 'secondary' })} mt-4`}>
              Demo menüyü aç
            </Link>
          </div>
        </aside>
      </div>
    </Section>
  );
}
