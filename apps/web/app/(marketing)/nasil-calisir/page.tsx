import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  Clock,
  CreditCard,
  Globe,
  Link2,
  MessageCircle,
  MessageSquareText,
  PackageCheck,
  Phone,
  QrCode,
  Smartphone,
  Store,
  UtensilsCrossed,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { CtaBand } from '@/components/marketing/cta-band';
import { Section } from '@/components/marketing/section';

export const metadata: Metadata = pageMetadata({
  title: 'Nasıl çalışır',
  description: 'Müşterin WhatsApp’tan yazar ya da QR’ı okutur, sepetini kendisi yapar; sipariş panele sesli düşer, sen tek dokunuşla onaylarsın.',
  path: '/nasil-calisir',
});

const STEPS = [
  {
    title: 'Müşterin yazar',
    text: 'WhatsApp’tan “Merhaba” der ya da paketteki QR’ı okutur. Menü linki saniyeler içinde gelir.',
    Icon: MessageCircle,
  },
  {
    title: 'Sepetini kendisi yapar',
    text: 'Fotoğraflı menüden porsiyonunu, ekstrasını seçer, adresini yazar, siparişi onaylar. Uygulama indirmez, üye olmaz.',
    Icon: Globe,
  },
  {
    title: 'Sen tek dokunuşla onaylarsın',
    text: 'Sipariş panele sesli düşer. “Onayla · 30 dk”ya basarsın; müşterine “Onaylandı”, kurye çıkınca “Yolda” mesajı kendiliğinden gider.',
    Icon: BellRing,
  },
];

const SETUP = [
  { title: 'Hesabını aç', text: 'İşletme adın, telefonun ve e-postanla birkaç dakikada.', Icon: Store },
  { title: 'Menünü ekle ya da biz ekleyelim', text: 'Kategoriler, ürünler, porsiyon ve ekstralar. İstersen menünü biz gireriz.', Icon: UtensilsCrossed },
  {
    title: 'WhatsApp’ını bağla',
    text: 'Mevcut numaran yerinde kalır. Meta’nın istediği ödeme yöntemi adımını birlikte tamamlarız.',
    Icon: Smartphone,
  },
  { title: 'Deneme siparişi ver', text: 'Kendi telefonundan sipariş ver, panelde sesi duy, onayla. Hazırsın.', Icon: PackageCheck },
];

const ALARM = [
  { at: 'Hemen', text: 'Panelde sesli uyarı ve bildirim.' },
  { at: '1. dakika', text: 'Ses daha yüksek tekrar eder.' },
  { at: '2. dakika', text: 'Telefonuna WhatsApp’tan uyarı gelir.' },
  { at: '5. dakika', text: 'Telefonuna SMS gelir.' },
  { at: '10. dakika', text: 'Müşterine “işletme henüz onaylamadı” bilgisi gider.' },
  { at: '15. dakika', text: 'Sipariş iptal edilir; müşterine özür ve telefon numaran iletilir. Süreyi 10–30 dakika arasında ayarlarsın.' },
];

const CHANNELS = [
  { title: 'Paket içi kart ve magnet', text: 'Her pakete QR’lı kart; müşteri bir dahakine doğrudan sana yazar.', Icon: QrCode },
  { title: 'Kasa QR’ı ve masa standı', text: 'Gel-al müşterisi menüyü telefonundan açar.', Icon: Store },
  { title: 'Google ve Instagram linki', text: 'İşletme profiline ve biyografine tek link.', Icon: Link2 },
  { title: 'Telefon siparişi', text: 'Arayan müşterinin siparişini panele sen girersin; bildirimler yine kendiliğinden gider.', Icon: Phone },
];

export default function HowItWorksPage() {
  return (
    <>
      <Section
        as="h1"
        id="nasil-calisir"
        eyebrow="Nasıl çalışır"
        title="Müşterin yazar, sepetini yapar, sen onaylarsın."
        lead="Pazaryerinde bulunmaya devam edersin. Seni zaten tanıyan müşterin ise kendi kanalından, komisyonsuz sipariş verir."
      >
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map(({ title, text, Icon }, i) => (
            <li key={title} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-6">
              <span className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-ink text-lg font-bold text-white">{i + 1}</span>
                <Icon aria-hidden className="size-6 text-fg-muted" />
              </span>
              <h2 className="text-xl font-bold text-fg">{title}</h2>
              <p className="text-base leading-7 text-fg-muted">{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="kurulum" tone="muted" eyebrow="Kurulum" title="Kurulum 4 adım" lead="İstersen hepsini biz yaparız: menün, WhatsApp bağlantın, QR stand ve paket kartı tasarımın.">
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SETUP.map(({ title, text, Icon }, i) => (
            <li key={title} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-5">
              <span className="text-sm font-bold text-fg-muted">Adım {i + 1}</span>
              <Icon aria-hidden className="size-6 text-fg" />
              <h3 className="text-lg font-bold text-fg">{title}</h3>
              <p className="text-base leading-7 text-fg-muted">{text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="alarm"
        eyebrow="Sipariş kaçmasın"
        title="Onaylanmayan sipariş için 4 kademeli uyarı"
        lead="Tablet sessizde kaldıysa ya da kasada kimse yoksa sistem seni başka yollardan da uyarır."
      >
        <ol className="relative flex flex-col gap-4 border-s-2 border-border ps-6">
          {ALARM.map((a) => (
            <li key={a.at} className="relative">
              <span aria-hidden className="absolute -start-[31px] top-1.5 size-3 rounded-full bg-saffron ring-4 ring-bg" />
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="inline-flex items-center gap-1.5 text-base font-bold text-fg">
                  <Clock aria-hidden className="size-4" />
                  {a.at}
                </span>
                <span className="text-base text-fg-muted">{a.text}</span>
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="kanal" tone="muted" eyebrow="Müşteriyi kendi kanalına taşı" title="Sadık müşterin bir dahakine doğrudan sana yazsın">
        <ul className="grid gap-5 sm:grid-cols-2">
          {CHANNELS.map(({ title, text, Icon }) => (
            <li key={title} className="flex gap-4 rounded-xl border border-border bg-surface-raised p-5">
              <Icon aria-hidden className="size-6 shrink-0 text-fg" />
              <div>
                <h3 className="text-lg font-bold text-fg">{title}</h3>
                <p className="text-base leading-7 text-fg-muted">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-fg-muted">Paketine kart koymadan önce pazaryeri sözleşmendeki yönlendirme maddelerini kontrol et.</p>
      </Section>

      <Section id="takip" eyebrow="Daha az telefon" title="“Siparişim nerede?” araması azalır">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex gap-4">
            <MessageSquareText aria-hidden className="size-7 shrink-0 text-fg" />
            <p className="text-lg leading-8 text-fg-muted">
              Müşterin “Onaylandı”, “Yolda” ve “Teslim edildi” mesajlarını WhatsApp’tan alır. Sipariş başına en fazla 4 durum mesajı gider;
              gereksiz mesajla müşterini yormayız.
            </p>
          </div>
          <div className="flex gap-4">
            <CreditCard aria-hidden className="size-7 shrink-0 text-fg" />
            <p className="text-lg leading-8 text-fg-muted">
              Ödeme kapıda ya da kasada, senin cihazınla. Takip linki teslimden 7 gün sonra kendiliğinden geçersizleşir.
            </p>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/fiyatlar" className={buttonVariants({ variant: 'secondary' })}>
            Fiyatlar
            <ArrowRight aria-hidden />
          </Link>
          <Link href="/sss" className={buttonVariants({ variant: 'ghost' })}>
            Sık sorulanlar
          </Link>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
