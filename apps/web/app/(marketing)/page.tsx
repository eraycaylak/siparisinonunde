import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  Bike,
  Globe,
  MapPin,
  MessageCircle,
  Printer,
  QrCode,
  Server,
  ShieldCheck,
  Smartphone,
  UsersRound,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { JsonLd } from '@/components/common/json-ld';
import { CtaBand } from '@/components/marketing/cta-band';
import { FaqList } from '@/components/marketing/faq-list';
import { MiniCalculator } from '@/components/marketing/mini-calculator';
import { OrderPreview } from '@/components/marketing/order-preview';
import { Section } from '@/components/marketing/section';
import { cn } from '@/lib/cn';
import { FAQ, HOME_FAQ_IDS } from '@/lib/faq';
import { formatLira } from '@/lib/format';
import { PLANS, withVat } from '@/lib/plans';
import { PILOT_AREA, SITE_DESCRIPTION, SITE_NAME, getSiteUrl } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: `${SITE_NAME} · Keşif pazaryerinde, sadakat sende.`,
  description: SITE_DESCRIPTION,
  path: '/',
  absoluteTitle: true,
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

const FEATURES = [
  { title: 'Sesli uyarı ve 2 dk alarmı', text: 'Yeni sipariş sesle düşer. Onaylanmazsa 2. dakikada telefonuna WhatsApp’tan, 5. dakikada SMS’le uyarı gelir.', Icon: BellRing },
  { title: 'Otomatik WhatsApp bildirimleri', text: '“Onaylandı”, “Yolda”, “Teslim edildi” mesajları ve takip linki kendiliğinden gider.', Icon: MessageCircle },
  { title: 'Fotoğraflı web menü ve QR', text: 'Porsiyon, ekstra ve çıkarılacaklarla menün; masada, pakette ve Instagram’da aynı link.', Icon: QrCode },
  { title: 'Kurye ekranı', text: 'Kuryen uygulama indirmeden siparişlerini görür, “Yola çıktım” ve “Teslim ettim”e basar.', Icon: Bike },
  { title: 'Müşteri listesi', text: 'Kim ne sipariş etti, hangi adrese; müşterin senin, verisi senin.', Icon: UsersRound },
  { title: 'Fiş yazdırma', text: 'Mutfak ve paket fişini tarayıcıdan 80 mm yazıcıya basarsın.', Icon: Printer },
];

const TRUST = [
  { text: 'Resmi WhatsApp Business Platform altyapısı', Icon: ShieldCheck },
  { text: 'Numaran ve WhatsApp Business uygulaman yerinde kalır', Icon: Smartphone },
  { text: 'Verilerin Türkiye’de barındırılır', Icon: Server },
];

export default function HomePage() {
  const siteUrl = getSiteUrl();
  const homeFaq = FAQ.filter((f) => (HOME_FAQ_IDS as readonly string[]).includes(f.id));
  const sellable = PLANS.filter((p) => p.availableNow);
  return (
    <>
      <JsonLd
        data={[
          { '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: siteUrl },
          { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: siteUrl, inLanguage: 'tr-TR' },
        ]}
      />

      {/* Hero */}
      <section aria-labelledby="hero-baslik" className="relative overflow-hidden bg-bg">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:pb-24">
          <div className="flex flex-col gap-6">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-sm font-semibold text-fg">
              <MapPin aria-hidden className="size-4 text-fg-muted" />
              Pilot: {PILOT_AREA.city} / {PILOT_AREA.district}
            </p>
            <h1 id="hero-baslik" className="text-4xl font-bold leading-[1.1] tracking-tight text-fg sm:text-5xl lg:text-6xl">
              Keşif pazaryerinde, <span className="underline decoration-saffron decoration-[6px] underline-offset-[10px]">sadakat sende.</span>
            </h1>
            <p className="max-w-xl text-lg leading-8 text-fg-muted sm:text-xl">
              Müşterin sana zaten WhatsApp’tan yazıyor. Siparişini komisyonsuz al, panelde sesli uyarıyla yönet; müşterine “Onaylandı” ve
              “Yolda” mesajı kendiliğinden gitsin.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/hesaplayici" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
                Ne kadar tasarruf ederim?
                <ArrowRight aria-hidden />
              </Link>
              <Link href="/demo" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                Demo iste
              </Link>
              <Link href="/panel/kayit" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
                14 gün ücretsiz dene
              </Link>
            </div>
            <p className="text-sm font-semibold text-fg-muted">Sipariş başına ücret yok. Ciro yüzdesi yok. Taahhüt yok.</p>
          </div>
          <OrderPreview />
        </div>
        <div className="border-y border-border bg-surface">
          <ul className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:grid-cols-3">
            {TRUST.map(({ text, Icon }) => (
              <li key={text} className="flex items-center gap-3 text-sm font-semibold text-fg sm:text-base">
                <Icon aria-hidden className="size-5 shrink-0 text-fg-muted" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Problem */}
      <Section
        id="sorun"
        eyebrow="Sorun"
        title="Seni zaten tanıyan müşterin için de her siparişte komisyon ödüyorsun."
        lead="Pazaryeri yeni müşteri getirir; bu değerli. Ama yıllardır senden yemek alan müşterinin siparişinden de kesinti yapılır."
      >
        <div className="flex flex-col gap-2 rounded-xl border-s-4 border-saffron bg-surface p-6">
          <p className="text-3xl font-bold tabular-nums text-fg sm:text-4xl">%15–40 arası kesinti</p>
          <p className="text-base text-fg-muted">Sözleşmeye ve kurye modeline göre değişir. Komisyon, reklam, kampanya ve teslimat kalemleri birlikte.</p>
        </div>
      </Section>

      {/* Nasıl çalışır */}
      <Section id="nasil" tone="muted" eyebrow="Nasıl çalışır" title="Üç adımda kendi sipariş kanalın">
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map(({ title, text, Icon }, i) => (
            <li key={title} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-6">
              <span className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-ink text-lg font-bold text-white">{i + 1}</span>
                <Icon aria-hidden className="size-6 text-fg-muted" />
              </span>
              <h3 className="text-xl font-bold text-fg">{title}</h3>
              <p className="text-base leading-7 text-fg-muted">{text}</p>
            </li>
          ))}
        </ol>
        <Link href="/nasil-calisir" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-8')}>
          Nasıl çalışır?
          <ArrowRight aria-hidden />
        </Link>
      </Section>

      {/* Mini hesaplayıcı */}
      <Section
        id="hesapla"
        eyebrow="Hesapla"
        title="Pazaryerine ayda ne ödüyorsun?"
        lead="Üç rakamı gir, aylık kesintini ve Siparişin Önünde’nin kaç siparişte kendini amorti ettiğini gör."
      >
        <MiniCalculator />
      </Section>

      {/* Özellikler */}
      <Section id="ozellikler" tone="muted" eyebrow="Özellikler" title="Siparişi almaktan teslim etmeye kadar">
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, text, Icon }) => (
            <li key={title} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-6">
              <Icon aria-hidden className="size-7 text-fg" />
              <h3 className="text-lg font-bold text-fg">{title}</h3>
              <p className="text-base leading-7 text-fg-muted">{text}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* Numaran güvende */}
      <Section id="numaran-guvende" eyebrow="Numaran güvende" title="Telefonundaki WhatsApp Business’tan yazmaya devam edersin.">
        <div className="grid gap-6 md:grid-cols-2">
          <p className="text-lg leading-8 text-fg-muted">
            Siparişler aynı anda panele düşer. Resmi WhatsApp Business Platform altyapısını kullanırız; resmi olmayan araçlarla numaranı
            riske atmayız. İstersen sipariş için yeni bir numara da bağlayabilirsin.
          </p>
          <p className="text-lg leading-8 text-fg-muted">
            WhatsApp bağlantın tamamlanana kadar web siparişlerini SMS doğrulamasıyla almaya başlayabilirsin. WhatsApp’ta bir arıza olursa
            aynı yol kendiliğinden devreye girer; siparişin durmaz.
          </p>
        </div>
      </Section>

      {/* Fiyat özeti */}
      <Section id="fiyat" tone="muted" eyebrow="Fiyat" title="Sabit aylık ücret. Komisyon yok.">
        <div className="grid gap-5 md:grid-cols-2">
          {sellable.map((p) => (
            <div key={p.code} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-6">
              <h3 className="text-xl font-bold text-fg">{p.name}</h3>
              <p className="text-base text-fg-muted">{p.audience}</p>
              <p className="text-3xl font-bold tabular-nums text-fg">
                {formatLira(p.monthlyTl)} <span className="text-base font-semibold text-fg-muted">/ay + KDV</span>
              </p>
              <p className="text-sm text-fg-muted tabular-nums">KDV dahil {formatLira(withVat(p.monthlyTl))}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-base text-fg-muted">WhatsApp (Meta) mesaj ücretleri abonelik fiyatına dahil değildir; işletmenin kendi Meta hesabından tahsil edilir.</p>
        <Link href="/fiyatlar" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-6')}>
          Tüm fiyatlar ve paketler
          <ArrowRight aria-hidden />
        </Link>
      </Section>

      {/* Pilot */}
      <Section id="pilot" eyebrow="Pilot" title={`${PILOT_AREA.city} ${PILOT_AREA.district}’de ilk 10 işletme`}>
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl text-lg leading-8 text-fg">
            Pilot işletmelere 3 ay ücretsiz kullanım ve kurulum bizden. Karşılığında haftada bir kısa geri bildirim görüşmesi istiyoruz.
          </p>
          <Link href="/demo" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Pilota başvur
          </Link>
        </div>
      </Section>

      {/* SSS */}
      <Section id="sss" tone="muted" eyebrow="SSS" title="Sık sorulanlar">
        <FaqList items={homeFaq} />
        <Link href="/sss" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-6')}>
          Tüm sorular
          <ArrowRight aria-hidden />
        </Link>
      </Section>

      <CtaBand />
    </>
  );
}
