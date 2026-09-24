'use client';

// Kütüphanesiz rapor grafikleri (SVG/CSS): sütun grafiği (tek seri), saat×gün ısı haritası (tek ton sıralı),
// yatay çubuk listesi ve gösterge kutusu. Renkler .viz-root CSS değişkenlerinden (açık/koyu ayrı seçilmiş).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Tek seri rengi (doğrulandı: açık #2a78d6 / koyu #3987e5, yüzeye ≥ 3:1). */
export function VizStyles() {
  return (
    <style>{`
      .viz-root { --viz-series: #2a78d6; --viz-grid: #e5e7eb; --viz-empty: var(--surface); }
      .dark .viz-root { --viz-series: #3987e5; --viz-grid: #2c3640; }
      @media (prefers-color-scheme: dark) { :root[data-theme="system"]:not(.light) .viz-root { --viz-series: #3987e5; --viz-grid: #2c3640; } }
    `}</style>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  /** Araç ipucu satırları */
  detail: string[];
}

/** Sütun grafiği: ≤ 24 px sütun, 4 px yuvarlak uç, tabanda kare; ızgara ince ve silik; imleçle araç ipucu. */
export function ColumnChart({ data, formatValue, height = 220, ariaLabel }: { data: ColumnDatum[]; formatValue: (v: number) => string; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56;
  const padB = 24;
  const padT = 8;
  const plotW = Math.max(0, width - padL - 4);
  const plotH = height - padB - padT;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44))));
  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="viz-root relative w-full" onPointerLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
          {ticks.map((t) => {
            const y = padT + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={padL} x2={width - 4} y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={padL - 6} y={y + 4} textAnchor="end" className="fill-fg-muted text-[11px] tabular-nums">
                  {formatValue(t)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const bh = (d.value / max) * plotH;
            const x = padL + i * band + (band - barW) / 2;
            const y = padT + plotH - bh;
            const r = Math.min(4, bh, barW / 2);
            const path =
              bh <= 0
                ? ''
                : `M${x},${padT + plotH} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barW - r},${y} Q${x + barW},${y} ${x + barW},${y + r} L${x + barW},${padT + plotH} Z`;
            return (
              <g key={d.key}>
                {path ? <path d={path} fill="var(--viz-series)" opacity={hover === null || hover === i ? 1 : 0.55} /> : null}
                {i % labelEvery === 0 ? (
                  <text x={padL + i * band + band / 2} y={height - 6} textAnchor="middle" className="fill-fg-muted text-[11px]">
                    {d.label}
                  </text>
                ) : null}
                <rect x={padL + i * band} y={padT} width={band} height={plotH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {h && hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm shadow-md"
          style={{ left: Math.min(Math.max(0, padL + hover * band + band / 2 - 72), Math.max(0, width - 160)) }}
          role="status"
        >
          <div className="font-bold text-fg">{formatValue(h.value)}</div>
          <div className="text-fg-muted">{h.label}</div>
          {h.detail.map((line) => (
            <div key={line} className="text-fg-muted">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const DAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const DAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

/** Saat × gün ısı haritası (tek ton, açıktan koyuya 5 basamak; 0 = boş yüzey). */
export function Heatmap({ matrix }: { matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const level = (v: number) => (v <= 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  const bg = (l: number) => (l === 0 ? 'var(--viz-empty)' : `color-mix(in oklab, var(--viz-series) ${[0, 22, 40, 58, 78, 100][l]}%, var(--surface-raised))`);
  const hv = hover ? matrix[hover.d]?.[hover.h] ?? 0 : null;
  return (
    <div className="viz-root flex flex-col gap-2">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: '2.25rem repeat(24, minmax(0, 1fr))' }} role="img" aria-label="Saat ve güne göre sipariş sayısı ısı haritası" onPointerLeave={() => setHover(null)}>
        {DAY_INDEX.map((d, row) => (
          <HeatRow key={d} label={DAYS_TR[row]!}>
            {Array.from({ length: 24 }, (_, h) => {
              const v = matrix[d]?.[h] ?? 0;
              return (
                <span
                  key={h}
                  className={cn('aspect-square min-h-2 rounded-[2px]', hover?.d === d && hover.h === h && 'outline-2 outline-offset-0 outline-fg')}
                  style={{ background: bg(level(v)) }}
                  title={`${DAYS_TR[row]} ${String(h).padStart(2, '0')}.00–${String(h).padStart(2, '0')}.59 · ${v} sipariş`}
                  onPointerEnter={() => setHover({ d, h })}
                />
              );
            })}
          </HeatRow>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[10px] text-fg-muted">
            {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <span aria-live="polite">
          {hover && hv !== null
            ? `${DAYS_TR[DAY_INDEX.indexOf(hover.d)]} ${String(hover.h).padStart(2, '0')}.00: ${hv} sipariş`
            : 'Bir hücrenin üzerine gelin'}
        </span>
        <span className="flex items-center gap-1">
          Az
          {[1, 2, 3, 4, 5].map((l) => (
            <span key={l} className="inline-block size-3 rounded-[2px]" style={{ background: bg(l) }} />
          ))}
          Çok
        </span>
      </div>
    </div>
  );
}

function HeatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="self-center text-xs text-fg-muted">{label}</span>
      {children}
    </>
  );
}

/** Yatay çubuk listesi (tek seri): etiket + değer metni + ince çubuk (12 px, yuvarlak uç). */
export function BarList({ items, emptyText }: { items: { key: string; label: ReactNode; value: number; valueText: string; sub?: string }[]; emptyText: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-fg-muted">{emptyText}</p>;
  return (
    <ul className="viz-root flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold text-fg">{i.label}</span>
            <span className="shrink-0 text-sm tabular-nums text-fg">
              {i.valueText}
              {i.sub ? <span className="ms-2 text-fg-muted">{i.sub}</span> : null}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-surface">
            <div className="h-3 rounded-e-[4px] rounded-s-[2px]" style={{ width: `${Math.max(1, (i.value / max) * 100)}%`, background: 'var(--viz-series)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Gösterge kutusu: etiket · değer · (isteğe bağlı) açıklama. */
export function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' | 'success' }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-4">
      <span className="text-sm text-fg-muted">{label}</span>
      <span className={cn('text-2xl font-semibold tabular-nums text-fg', tone === 'danger' && 'text-destructive', tone === 'success' && 'text-success')}>{value}</span>
      {hint ? <span className="text-sm text-fg-muted">{hint}</span> : null}
    </div>
  );
}
