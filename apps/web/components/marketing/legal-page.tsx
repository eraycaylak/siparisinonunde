import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { LEGAL_DRAFT } from '@/lib/site';

export interface LegalSection {
  title: string;
  body: ReactNode;
}

/** Yasal metin kabı: üstte "taslak" uyarısı, sürüm ve tarih (08 §7.5). */
export function LegalPage({ title, intro, sections }: { title: string; intro?: ReactNode; sections: LegalSection[] }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div role="note" className="mb-8 flex items-start gap-3 rounded-lg border-2 border-warning bg-warning-bg p-4 text-fg">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <p className="text-base font-semibold">Hukuki inceleme bekliyor, taslaktır. Yayından önce avukat tarafından yazılacak ve onaylanacaktır.</p>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Sürüm {LEGAL_DRAFT.version} · Taslak tarihi {LEGAL_DRAFT.date}
      </p>
      {intro ? <div className="mt-6 text-base leading-7 text-fg">{intro}</div> : null}
      <div className="mt-8 flex flex-col gap-8">
        {sections.map((s, i) => (
          <section key={s.title} aria-labelledby={`b${i}`}>
            <h2 id={`b${i}`} className="text-xl font-bold text-fg">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-2 flex flex-col gap-3 text-base leading-7 text-fg [&_li]:ms-5 [&_ul]:list-disc [&_ul]:space-y-1">{s.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}
