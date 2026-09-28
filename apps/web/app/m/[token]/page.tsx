import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Clock } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { menuLinkTarget, resolveMenuLink } from '@/lib/menu-link';

// Kısa menü bağlantısı (WhatsApp mesajındaki yemekgelsin.net/m/<token>): dükkanın vitrinine yönlendirir; token vitrinde
// oturuma çevrilir. Süresi dolmuşsa (2 saat) nötr bir bilgi gösterilir. Arama motorlarına kapalı.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Menü' },
  description: 'İşletmenin menüsü.',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const slug = await resolveMenuLink(token);
  if (slug) redirect(menuLinkTarget(slug, token));
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-surface text-fg-muted">
        <Clock aria-hidden className="size-8" />
      </span>
      <h1 className="text-2xl font-bold text-fg">Bu bağlantının süresi doldu</h1>
      <p className="max-w-md text-lg text-fg-muted">Menü bağlantısı 2 saat geçerlidir. Yeni bağlantı için işletmeye WhatsApp’tan yeniden yazmanız yeterli.</p>
      <Link href="/" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
        Ana sayfa
      </Link>
    </main>
  );
}
