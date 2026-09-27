import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { CalendarClock, Calculator, MessageCircle, PhoneCall, ShieldCheck, Store } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { DemoForm } from '@/components/marketing/demo-form';
import { Section } from '@/components/marketing/section';
import { demoStoreSlug, isLeadFormEnabled, supportWhatsappHref } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Demo iste',
  description: 'Kendi telefonundan demo işletmemize sipariş ver, tablette sesi duy, “Onaylandı” mesajı telefonuna gelsin.',
  path: '/demo',
});

// Demo işletmenin vitrini: canlı ortamda demo işletme yoktur (00 §12a madde 10), NEXT_PUBLIC_DEMO_STORE_SLUG boş derlenir
// ve "Demo menüye göz at" kartı gösterilmez
const DEMO_STORE_SLUG = demoStoreSlug();

// Lead formu: Türkiye dışındaki Cloudflare ortamında kapalı (kişisel veri yalnız Türkiye'de; CLAUDE.md kural 7, 00 §12a
// madde 10). Kapalıyken form yerine bilgi kartı ve (tanımlıysa) destek hattının WhatsApp bağlantısı; bilgi saklanmaz.
const LEAD_FORM = isLeadFormEnabled();
const SUPPORT_WA = supportWhatsappHref('Merhaba, Yemek Gelsin hakkında bilgi almak istiyorum. İşletme adı: ');

function LeadsPausedCard() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-border bg-surface-raised p-5 sm:p-6">
      <ShieldCheck aria-hidden className="size-8 text-fg" />
      <h2 className="text-2xl font-bold text-fg">Başvurular Türkiye’deki sunucumuzda açılıyor</h2>
      <p className="text-lg text-fg-muted">
        Başvuru bilgilerini yalnız Türkiye’deki altyapımızda saklıyoruz. Canlı sunucumuz hazır olunca demo talebi ve işletme
        kaydı bu sayfada açılacak.
      </p>
      {SUPPORT_WA ? (
        <a href={SUPPORT_WA} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'primary' })}>
          <MessageCircle aria-hidden /> WhatsApp’tan yaz
        </a>
      ) : (
        <p className="text-base text-fg-muted">Şimdilik bu sayfadan bilgi toplamıyoruz; çok yakında buradayız.</p>
      )}
    </div>
  );
}

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
        {LEAD_FORM ? <DemoForm /> : <LeadsPausedCard />}
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
          {DEMO_STORE_SLUG ? (
            <div className="rounded-xl border border-border bg-surface-raised p-6">
              <Store aria-hidden className="size-7 text-fg" />
              <h2 className="mt-2 text-lg font-bold text-fg">Demo menüye göz at</h2>
              <p className="mt-1 text-base text-fg-muted">Bu bir demo işletmedir, sipariş teslim edilmez.</p>
              <Link href={`/s/${DEMO_STORE_SLUG}`} className={`${buttonVariants({ variant: 'secondary' })} mt-4`}>
                Demo menüyü aç
              </Link>
            </div>
          ) : null}
        </aside>
      </div>
    </Section>
  );
}
