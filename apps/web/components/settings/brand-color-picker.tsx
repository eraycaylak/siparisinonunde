'use client';

import { Check, Info } from 'lucide-react';
import { BRAND_PRESETS, brandPalette, contrastRatio, isHexColor } from '@siparis/core/settings/brand';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/**
 * Ana renk seçici (12 §5.1): 12 hazır renk + serbest seçici + otomatik kontrast önizlemesi.
 * Değer null ise hazır paletin ilk rengi kullanılır.
 */
export function BrandColorPicker({
  value,
  onChange,
  businessName,
  logoUrl,
  error,
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
  businessName: string;
  logoUrl?: string | null;
  error?: string;
}) {
  const palette = brandPalette(value);
  const current = (value ?? palette.input).toUpperCase();
  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="text-sm font-semibold text-fg">Hazır renkler</legend>
        <div className="mt-2 grid grid-cols-6 gap-2 sm:grid-cols-12">
          {BRAND_PRESETS.map((p) => {
            const selected = p.hex.toUpperCase() === current;
            return (
              <button
                key={p.hex}
                type="button"
                onClick={() => onChange(p.hex)}
                aria-pressed={selected}
                aria-label={`${p.name} (${p.hex})`}
                title={p.name}
                className={cn(
                  'flex size-12 items-center justify-center rounded-full border-2 transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  selected ? 'scale-105 border-fg' : 'border-transparent',
                )}
                style={{ backgroundColor: p.hex }}
              >
                {selected ? <Check aria-hidden className="size-5" style={{ color: brandPalette(p.hex).brandContrast }} /> : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-fg">
          Serbest renk
          <input
            type="color"
            value={isHexColor(current) ? current.toLowerCase() : '#c62828'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-12 w-20 cursor-pointer rounded-md border border-border-strong bg-surface-raised p-1"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold text-fg sm:max-w-40">
          Renk kodu
          <Input
            value={value ?? ''}
            placeholder={palette.input}
            maxLength={7}
            onChange={(e) => {
              const v = e.target.value.trim();
              onChange(v === '' ? null : v.startsWith('#') ? v.toUpperCase() : `#${v.toUpperCase()}`);
            }}
            aria-invalid={Boolean(error) || undefined}
            spellCheck={false}
          />
        </label>
      </div>
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <BrandPreview businessName={businessName} hex={value} logoUrl={logoUrl} />
    </div>
  );
}

/** Storefront önizlemesi (açık ve koyu zeminde buton, bağlantı ve seçili çip). */
export function BrandPreview({ businessName, hex, logoUrl }: { businessName: string; hex: string | null; logoUrl?: string | null }) {
  const p = brandPalette(hex);
  const ratio = contrastRatio(p.brand, p.brandContrast);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-fg">Müşterinin göreceği görünüm</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-border bg-white text-[#111827]">
          <div className="flex items-center gap-3 border-b border-[#d9dde3] p-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-10 rounded-full object-cover" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full text-base font-bold" style={{ background: p.brand, color: p.brandContrast }}>
                {businessName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'İ'}
              </span>
            )}
            <span className="min-w-0 truncate font-bold">{businessName || 'İşletme adı'}</span>
          </div>
          <div className="flex flex-col gap-3 p-3">
            <div className="flex gap-2">
              <span className="rounded-full border-2 px-3 py-1 text-sm font-semibold" style={{ borderColor: p.brandUi, background: p.brandSubtle }}>
                Pideler
              </span>
              <span className="rounded-full border border-[#d9dde3] px-3 py-1 text-sm">İçecekler</span>
            </div>
            <span className="text-sm font-bold" style={{ color: p.brandStrong }}>
              180,00 TL
            </span>
            <span className="flex min-h-12 items-center justify-center rounded-md px-4 text-base font-bold" style={{ background: p.brand, color: p.brandContrast }}>
              Sepete ekle
            </span>
          </div>
        </div>
        <div className="flex flex-col justify-end gap-3 rounded-lg border border-border bg-[#0f1419] p-3 text-[#f3f4f6]">
          <span className="text-sm">Koyu tema</span>
          <span className="flex min-h-12 items-center justify-center rounded-md px-4 text-base font-bold" style={{ background: p.brandDark, color: p.brandDarkContrast }}>
            Siparişi onayla
          </span>
        </div>
      </div>
      <p className="flex items-start gap-2 text-sm text-fg-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {p.adjusted
          ? `Renginiz okunabilirlik için hafif koyulaştırıldı (buton kontrastı ${ratio.toFixed(1)}:1).`
          : `Buton yazısı ${p.brandContrast === '#FFFFFF' ? 'beyaz' : 'koyu'} gösterilir (kontrast ${ratio.toFixed(1)}:1).`}{' '}
        Baskı rengi ekrandan farklı olabilir.
      </p>
    </div>
  );
}
