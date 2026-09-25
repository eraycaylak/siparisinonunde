import Link from 'next/link';
import { cn } from '@/lib/cn';
import { STORE_LEGAL_DOCS, STORE_LEGAL_LINK_LABELS, storeLegalHref, type ImprintRow } from './store-legal';

/**
 * İşletmenin yasal metinlerine bağlantılar (S-10): aydınlatma, ön bilgilendirme, mesafeli satış. Vitrin altbilgisi ve
 * takip sayfası kullanır. Her bağlantı ≥ 48 px dokunma hedefi.
 */
export function StoreLegalLinks({ slug, label = 'Yasal metinler', className }: { slug: string; label?: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn('flex flex-wrap items-center justify-center gap-x-3', className)}>
      {STORE_LEGAL_DOCS.map((doc) => (
        <Link
          key={doc}
          href={storeLegalHref(slug, doc)}
          prefetch={false}
          className="inline-flex min-h-hit items-center rounded-md px-1 text-sm font-semibold text-fg underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {STORE_LEGAL_LINK_LABELS[doc]}
        </Link>
      ))}
    </nav>
  );
}

/** Açılır künye kutusu (6563 m.3 / 03 §4.9): yalnız dolu alanlar. */
export function ImprintDetails({ rows, className }: { rows: ImprintRow[]; className?: string }) {
  if (!rows.length) return null;
  return (
    <details className={cn('w-full max-w-md text-start text-sm text-fg-muted', className)}>
      <summary className="flex min-h-hit cursor-pointer items-center justify-center rounded-md px-3 font-semibold text-fg">
        İşletme bilgileri (künye)
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-surface p-3">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="font-semibold text-fg">{r.label}</dt>
            <dd className="min-w-0 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
