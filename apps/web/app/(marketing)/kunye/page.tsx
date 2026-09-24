import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { TriangleAlert } from 'lucide-react';
import { LEGAL_ENTITY, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Künye',
  description: '6563 sayılı Kanun m.3 kapsamında hizmet sağlayıcı bilgileri.',
  path: '/kunye',
});

const ROWS: Array<[string, string]> = [
  ['Unvan', LEGAL_ENTITY.title],
  ['Şirket türü', LEGAL_ENTITY.type],
  ['Adres', LEGAL_ENTITY.address],
  ['E-posta', LEGAL_ENTITY.email],
  ['Telefon', LEGAL_ENTITY.phone],
  ['Vergi dairesi', LEGAL_ENTITY.taxOffice],
  ['Vergi / T.C. kimlik no', LEGAL_ENTITY.taxNo],
  ['MERSİS no', LEGAL_ENTITY.mersis],
  ['Meslek odası', LEGAL_ENTITY.chamber],
];

export default function ImprintPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div role="note" className="mb-8 flex items-start gap-3 rounded-lg border-2 border-warning bg-warning-bg p-4 text-fg">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <p className="text-base font-semibold">Hukuki inceleme bekliyor, taslaktır. Bilgiler şirket belgeleriyle birebir aynı olacak şekilde doldurulacaktır.</p>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">Künye</h1>
      <p className="mt-3 text-base text-fg-muted">6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun m.3 kapsamında hizmet sağlayıcı bilgileri.</p>
      <dl className="mt-8 divide-y divide-border rounded-lg border border-border">
        {ROWS.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
            <dt className="text-sm font-semibold text-fg-muted">{k}</dt>
            <dd className="text-base text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-10" aria-labelledby="yer-saglayici">
        <h2 id="yer-saglayici" className="text-xl font-bold text-fg">
          İçerik bildirimi
        </h2>
        <p className="mt-2 text-base leading-7 text-fg">
          {SITE_NAME}, işletmelerin menü ve görsellerini barındıran yer sağlayıcı olabilir. Hukuka aykırı olduğunu düşündüğünüz bir içeriği{' '}
          {LEGAL_ENTITY.email} adresine, içeriğin bağlantısıyla birlikte bildirebilirsiniz.
        </p>
      </section>
    </article>
  );
}
