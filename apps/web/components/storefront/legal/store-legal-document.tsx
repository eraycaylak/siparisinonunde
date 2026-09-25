import Link from 'next/link';
import { ArrowLeft, Store, TriangleAlert } from 'lucide-react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { storefrontHref } from '@/lib/storefront-url';
import { PrintButton } from './print-button';
import type { LegalBlock, StoreLegalDocument } from './store-legal';

/**
 * İşletmeye özel yasal metin sayfası (S-10): işletme markalı başlık, menüye dönüş, yazdır; belge gövdesi. Diğer metinlerin
 * bağlantıları storefront altbilgisindedir. Yazdırırken gezinme ve altbilgi gizlenir.
 */
export function StoreLegalDocumentView({ store, document: d }: { store: StorefrontView; document: StoreLegalDocument }) {
  const slug = store.tenant.slug;
  return (
    <div className="flex flex-col gap-5 pb-4 print:gap-3 print:pb-0">
      <div className="flex items-center gap-2 print:hidden">
        <Link href={storefrontHref(slug)} className="inline-flex min-h-hit items-center gap-1 rounded-md pe-2 font-semibold">
          <ArrowLeft aria-hidden className="size-5" /> Menüye dön
        </Link>
        <div className="ms-auto">
          <PrintButton />
        </div>
      </div>

      <header className="flex items-center gap-3 border-b-4 border-[var(--brand)] pb-3">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-raised">
          {store.tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.tenant.logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <Store aria-hidden className="size-6 text-[var(--brand-strong)]" />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="break-words text-lg font-bold leading-6 text-fg">{store.tenant.name}</span>
          <span className="break-words text-sm text-fg-muted">{d.imprint.legalName}</span>
        </span>
      </header>

      <article className="flex flex-col gap-5 print:gap-3" aria-labelledby="belge-baslik">
        <div className="flex flex-col gap-1">
          <h1 id="belge-baslik" className="text-2xl font-bold leading-8 text-fg">
            {d.title}
          </h1>
          <p className="text-sm text-fg-muted">Sürüm {d.version} · Taslak, hukuki inceleme bekliyor</p>
        </div>

        {d.imprint.missing.length ? (
          <div role="note" className="flex items-start gap-2 rounded-md border border-warning bg-warning-bg p-3 text-sm text-fg">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>İşletme künye bilgileri henüz tamamlanmadı; köşeli parantez içindeki alanlar işletme bilgileriyle doldurulacaktır.</span>
          </div>
        ) : null}

        {d.intro.length ? (
          <div className="flex flex-col gap-3 text-base leading-7 text-fg">
            {d.intro.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
        ) : null}

        {d.sections.map((s, i) => (
          <section key={s.title} aria-labelledby={`bolum-${i + 1}`} className="flex flex-col gap-2 print:break-inside-avoid-page">
            <h2 id={`bolum-${i + 1}`} className="text-lg font-bold text-fg">
              {i + 1}. {s.title}
            </h2>
            <div className="flex flex-col gap-3 text-base leading-7 text-fg">
              {s.blocks.map((b, j) => (
                <Block key={j} block={b} />
              ))}
            </div>
          </section>
        ))}
      </article>

    </div>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case 'p':
      return <p>{block.text}</p>;
    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-1 ps-5">
          {block.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case 'facts':
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-surface p-3 text-sm print:bg-transparent print:p-0">
          {block.rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="font-semibold">{r.label}</dt>
              <dd className="min-w-0 break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      );
  }
}
