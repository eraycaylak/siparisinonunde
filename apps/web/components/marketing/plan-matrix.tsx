import { Check, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PLAN_MATRIX, type MatrixCell } from '@/lib/plans';

function Cell({ value }: { value: MatrixCell }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1 text-status-ready-fg">
        <Check aria-hidden className="size-5" />
        <span className="sr-only">Var</span>
      </span>
    );
  if (value === false)
    return (
      <span className="inline-flex items-center text-fg-muted">
        <Minus aria-hidden className="size-5" />
        <span className="sr-only">Yok</span>
      </span>
    );
  return <span className="text-sm font-medium text-fg">{value}</span>;
}

/** Paket içerik matrisi (01 §6.3). Gelecek özellikler "Yakında" etiketiyle. */
export function PlanMatrix() {
  return (
    <div className="relative w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-start text-sm">
        <caption className="sr-only">Paketlere göre özellikler</caption>
        <thead className="bg-surface">
          <tr>
            <th scope="col" className="w-1/2 px-4 py-3 text-start font-bold text-fg">
              Özellik
            </th>
            <th scope="col" className="px-4 py-3 text-start font-bold text-fg">
              Esnaf
            </th>
            <th scope="col" className="px-4 py-3 text-start font-bold text-fg">
              Pro
            </th>
            <th scope="col" className="px-4 py-3 text-start font-bold text-fg">
              Zincir
            </th>
          </tr>
        </thead>
        {PLAN_MATRIX.map((group) => (
          <tbody key={group.title}>
            <tr className="border-t border-border bg-surface/60">
              <th scope="colgroup" colSpan={4} className="px-4 py-2 text-start text-xs font-bold uppercase tracking-wider text-fg-muted">
                {group.title}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <th scope="row" className="px-4 py-3 text-start font-normal text-fg">
                  <span>{row.label}</span>
                  {row.soon ? (
                    <Badge variant="outline" size="sm" className="ms-2 align-middle">
                      Yakında
                    </Badge>
                  ) : null}
                </th>
                <td className="px-4 py-3">
                  <Cell value={row.esnaf} />
                </td>
                <td className="px-4 py-3">
                  <Cell value={row.pro} />
                </td>
                <td className="px-4 py-3">
                  <Cell value={row.zincir} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
