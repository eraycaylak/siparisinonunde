import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { LEGAL_ENTITY, LEGAL_NAV, MARKETING_NAV, PILOT_AREA, SITE_TAGLINE } from '@/lib/site';

/** Altbilgi: ürün ve yasal bağlantılar, künye özeti, Meta ücreti notu (05 C.3.1). */
export function SiteFooter() {
  const year = 2026;
  return (
    <footer className="border-t border-border bg-surface print:hidden">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-sm text-sm text-fg-muted">
            {SITE_TAGLINE} Komisyonsuz, WhatsApp’tan. Pilot bölge: {PILOT_AREA.city} / {PILOT_AREA.district}.
          </p>
          <p className="max-w-sm text-sm text-fg-muted">
            WhatsApp (Meta) mesaj ücretleri abonelik fiyatına dahil değildir; işletmenin kendi Meta hesabından tahsil edilir.
          </p>
        </div>
        <nav aria-label="Ürün" className="flex flex-col gap-1">
          <h2 className="mb-1 text-sm font-bold text-fg">Ürün</h2>
          {MARKETING_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="inline-flex min-h-hit items-center text-sm text-fg-muted hover:text-fg hover:underline">
              {item.label}
            </Link>
          ))}
          <Link href="/panel/giris" className="inline-flex min-h-hit items-center text-sm text-fg-muted hover:text-fg hover:underline">
            İşletme girişi
          </Link>
        </nav>
        <nav aria-label="Yasal" className="flex flex-col gap-1">
          <h2 className="mb-1 text-sm font-bold text-fg">Yasal</h2>
          {LEGAL_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="inline-flex min-h-hit items-center text-sm text-fg-muted hover:text-fg hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {LEGAL_ENTITY.title} · {LEGAL_ENTITY.address}
          </p>
          <p>Bu sitede yalnız zorunlu çerezler kullanılır.</p>
        </div>
      </div>
    </footer>
  );
}
