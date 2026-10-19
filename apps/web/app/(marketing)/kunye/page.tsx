import type { Metadata } from 'next';
import { TriangleAlert } from 'lucide-react';
import { getLegalEntity } from '@/lib/legal-entity';
import { pageMetadata } from '@/lib/seo';
import { SITE_NAME, legalEntityRows } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Künye',
  description: '6563 sayılı Kanun m.3 kapsamında hizmet sağlayıcı bilgileri.',
  path: '/kunye',
});

// Künye istek anında okunur (getLegalEntity → connection()): değer container ortamından gelir, `next build`'den
// değil; değişince yeniden derleme gerekmez (15 §4). Satırlar DPA ile aynı tek sıradan gelir (`legalEntityRows`,
// KEP dahil 10 alan); sayfaya ayrı bir alan listesi yazılmaz.
export default async function ImprintPage() {
  const entity = await getLegalEntity();
  const rows = legalEntityRows(entity);
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div role="note" className="mb-8 flex items-start gap-3 rounded-lg border-2 border-warning bg-warning-bg p-4 text-fg">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <p className="text-base font-semibold">Hukuki inceleme bekliyor, taslaktır. Bilgiler şirket belgeleriyle birebir aynı olacak şekilde doldurulacaktır.</p>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">Künye</h1>
      <p className="mt-3 text-base text-fg-muted">6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun m.3 kapsamında hizmet sağlayıcı bilgileri.</p>
      <dl className="mt-8 divide-y divide-border rounded-lg border border-border">
        {rows.map(({ label, value }) => (
          <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
            <dt className="text-sm font-semibold text-fg-muted">{label}</dt>
            <dd className="text-base text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-10" aria-labelledby="yer-saglayici">
        <h2 id="yer-saglayici" className="text-xl font-bold text-fg">
          İçerik bildirimi
        </h2>
        <p className="mt-2 text-base leading-7 text-fg">
          {SITE_NAME}, işletmelerin menü ve görsellerini barındıran yer sağlayıcı olabilir. Hukuka aykırı olduğunu düşündüğünüz bir içeriği{' '}
          {entity.email} adresine, içeriğin bağlantısıyla birlikte bildirebilirsiniz.
        </p>
      </section>
    </article>
  );
}
